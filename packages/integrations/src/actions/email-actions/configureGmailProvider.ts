'use server'

import { createTenantKnex, runWithTenant, tenantDb } from '@alga-psa/db';
import { setupPubSub } from './setupPubSub';
import { GmailWebhookService } from '../../services/email/GmailWebhookService';
import type { GoogleEmailProviderConfig } from '../../components/email/types';
import type { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';
import { getGmailPubSubNames } from '../../utils/email/gmailPubSub';
import { isActionableGoogleOAuthMessage } from '@alga-psa/shared/services/email/providers/googleMailboxOAuthClient';

const RECONCILE_FAILED_PREFIX = 'Gmail reconnected but';

interface ConfigureGmailProviderOptions {
  tenant: string;
  providerId: string;
  projectId: string;
  /**
   * Retained for callers that request an explicit refresh. Configuration is
   * always verified end to end now, so this no longer changes what runs.
   */
  force?: boolean;
}

export interface ConfigureGmailProviderResult {
  success: boolean;
  pubsubConfigured: boolean;
  watchRegistered: boolean;
  error?: string;
  warnings: string[];
  /**
   * Outcome of the auth-failure recovery attempted when the provider was
   * auto-paused: 'resumed' — pause cleared and the paused interval fully
   * reconciled; 'failed' — still paused, reconnect required; undefined — no
   * recovery was attempted (provider was not auth-paused).
   */
  authFailureRecovery?: 'resumed' | 'failed';
}

/**
 * Configure Gmail provider with Pub/Sub and webhook registration.
 * This is the single orchestrator for Gmail provider setup.
 *
 * Every field of the returned result reflects work this call actually did and
 * verified. `success` is true only when Pub/Sub is provisioned with a push
 * endpoint that matches this instance *and* a Gmail watch is registered
 * against it; anything less carries an error the administrator can act on.
 */
export async function configureGmailProvider({
  tenant,
  providerId,
  projectId,
  force = false
}: ConfigureGmailProviderOptions): Promise<ConfigureGmailProviderResult> {
  const result: ConfigureGmailProviderResult = {
    success: false,
    pubsubConfigured: false,
    watchRegistered: false,
    warnings: []
  };

  if (tenant == null || !tenant || !providerId || !projectId) {
    result.error = 'Missing required parameters: tenant, providerId, and projectId are required';
    return result;
  }

  // Whether this provider was auto-paused on auth failures when the call
  // started. The lifecycle recovery owns that row's status, so the honest-status
  // write below must stay out of its way.
  let pausedForAuthFailure = false;
  // Whether the provider was in `status='error'` (and not auth-paused) when the
  // call started. A successful call then reconciles the mail the outage missed.
  let recoveringFromError = false;
  let savedHistoryId: string | null = null;
  let outageSince = new Date();

  try {
    await runWithTenant(tenant, async () => {
      // Capture the pre-watch history cursor and pause state before any
      // registration overwrites them: the auth-failure recovery path must
      // reconcile from the cursor that was valid when the provider paused.
      const { knex: boundaryKnex } = await createTenantKnex(tenant);
      const boundaryDb = tenantDb(boundaryKnex, tenant);
      const [boundaryProvider, boundaryGoogleConfig] = await Promise.all([
        boundaryDb.table('email_providers').where({ id: providerId }).first('inbound_paused_at', 'inbound_pause_reason', 'status', 'last_sync_at', 'created_at'),
        boundaryDb.table('google_email_provider_config').where({ email_provider_id: providerId }).first('history_id'),
      ]);
      savedHistoryId = boundaryGoogleConfig?.history_id ? String(boundaryGoogleConfig.history_id) : null;
      pausedForAuthFailure = Boolean(
        boundaryProvider?.inbound_paused_at && boundaryProvider.inbound_pause_reason === 'auth_failure'
      );
      recoveringFromError = !pausedForAuthFailure && boundaryProvider?.status === 'error';
      // Last time delivery was known good: the lower bound of the reconciler's
      // time-query fallback. Read before the success path advances last_sync_at.
      outageSince = new Date(boundaryProvider?.last_sync_at ?? boundaryProvider?.created_at ?? Date.now());

      // There is deliberately no "configured recently, skip it" shortcut here.
      // Claiming a working watch without checking is what let broken Gmail
      // providers sit green for days; provisioning is idempotent, so the honest
      // answer costs a few API calls and nothing else.
      const pubsubNames = await getGmailPubSubNames(tenant);
      console.log(`🔧 Configuring Gmail provider ${providerId} with Pub/Sub:`, {
        tenant,
        providerId,
        projectId,
        topicName: pubsubNames.topicName,
        subscriptionName: pubsubNames.subscriptionName,
        webhookUrl: pubsubNames.webhookUrl,
        force
      });
      
      // Step 1: Set up Pub/Sub topic and subscription
      await setupPubSub({
        tenantId: tenant,
        projectId,
        topicName: pubsubNames.topicName,
        subscriptionName: pubsubNames.subscriptionName,
        webhookUrl: pubsubNames.webhookUrl
      });
      
      console.log(`✅ Successfully set up Pub/Sub for Gmail provider ${providerId}:`, {
        tenant,
        providerId,
        topicName: pubsubNames.topicName,
        subscriptionName: pubsubNames.subscriptionName
      });
      result.pubsubConfigured = true;

      // Step 2: Update pubsub_initialised_at timestamp
      const { knex } = await createTenantKnex(tenant);
      const db = tenantDb(knex, tenant);
      await db.table('google_email_provider_config')
        .where('email_provider_id', providerId)
        .update({
          pubsub_initialised_at: knex.fn.now()
        });

      // Step 3: Register Gmail watch subscription (webhook only - no Pub/Sub)
      try {
        console.log(`🔗 Registering Gmail watch subscription for provider ${providerId}`);
        
        // Get both the base provider and Google-specific config
        const baseProvider = await db.table('email_providers')
          .select('*')
          .where('id', providerId)
          .first();

        const googleConfig = await db.table('google_email_provider_config')
          .select('*')
          .where('email_provider_id', providerId)
          .first() as GoogleEmailProviderConfig;

        if (!baseProvider || !googleConfig) {
          throw new Error(`Gmail provider or config not found for provider ${providerId}`);
        }

        // Guard: only attempt watch registration if tokens exist
        if (!googleConfig.access_token || !googleConfig.refresh_token) {
          console.log(`⏭️ Skipping Gmail watch registration for provider ${providerId}: OAuth tokens missing`, {
            tenant,
            hasAccessToken: !!googleConfig.access_token,
            hasRefreshToken: !!googleConfig.refresh_token
          });
          result.warnings.push('OAuth tokens missing - Gmail watch registration skipped');
          // Without tokens there is no watch, so no mail will ever arrive —
          // Pub/Sub being provisioned changes nothing about that. This is a
          // failure for every provider, paused or not.
          result.success = false;
          if (pausedForAuthFailure) {
            result.authFailureRecovery = 'failed';
            result.error = 'Gmail reconnection failed: OAuth authorization is required. Reconnect the mailbox and try again.';
          } else {
            result.error = 'Gmail watch could not be registered: the mailbox has not completed Google OAuth authorization. Connect the mailbox and try again.';
          }
          return;
        }

        // Create EmailProviderConfig for the GmailWebhookService
        const emailProviderConfig: EmailProviderConfig = {
          id: baseProvider.id,
          tenant: baseProvider.tenant,
          name: baseProvider.provider_name,
          provider_type: baseProvider.provider_type as 'google',
          mailbox: baseProvider.mailbox,
          folder_to_monitor: 'Inbox',
          active: baseProvider.is_active,
          webhook_notification_url: pubsubNames.webhookUrl,
          connection_status: baseProvider.status || 'disconnected',
          created_at: baseProvider.created_at,
          updated_at: baseProvider.updated_at,
          provider_config: {
            project_id: googleConfig.project_id ?? undefined,
            pubsub_topic_name: pubsubNames.topicName,
            pubsub_subscription_name: pubsubNames.subscriptionName,
            client_id: googleConfig.client_id || undefined,
            label_filters: Array.isArray((googleConfig as any).label_filters)
              ? (googleConfig as any).label_filters
              : (() => {
                  try {
                    const parsed = JSON.parse((googleConfig as any).label_filters || '[]');
                    return Array.isArray(parsed) ? parsed : [];
                  } catch {
                    return [];
                  }
                })(),
            access_token: googleConfig.access_token || undefined,
            refresh_token: googleConfig.refresh_token || undefined,
            token_expires_at: googleConfig.token_expires_at || undefined,
            history_id: googleConfig.history_id || undefined,
            watch_expiration: googleConfig.watch_expiration || undefined
          }
        };

        const gmailWebhookService = new GmailWebhookService();
        
        // Register the Gmail watch. registerWatch reports failure by return
        // value rather than by throwing, so the result has to be read — an
        // unchecked call here is a watch that silently never existed.
        const watchResult = await gmailWebhookService.registerWatch(emailProviderConfig, {
          projectId,
          topicName: pubsubNames.topicName,
          subscriptionName: pubsubNames.subscriptionName,
          webhookUrl: pubsubNames.webhookUrl
        });

        if (!watchResult.success) {
          throw new Error(watchResult.error || 'Gmail watch registration failed.');
        }

        // Recovering from `status='error'`: the watch is re-established at a
        // fresh cursor, so everything between the outage start and now would be
        // skipped. Reconcile it from the pre-watch cursor first, through the
        // same durable, idempotent reconciler the auth-pause recovery uses.
        // last_sync_at only advances once that succeeds, so a failed attempt is
        // retried over the same window by the next renewal run.
        if (recoveringFromError) {
          try {
            const { EmailProviderLifecycleService } = await import(
              '@alga-psa/shared/services/email/EmailProviderLifecycleService'
            );
            const reconciliation = await new EmailProviderLifecycleService().reconcileGoogleDeliveryGap({
              providerId,
              tenant,
              since: outageSince,
              savedHistoryId,
            });
            console.info('Gmail error-recovery reconciliation completed', {
              tenant,
              providerId,
              queuedMessages: reconciliation.queuedMessages,
              usedFallbackQuery: reconciliation.usedFallbackQuery,
            });
          } catch (reconcileError) {
            // The new watch already replaced history_id with its fresh cursor.
            // Put the pre-watch cursor back so the retry reconciles the same gap,
            // and clear watch_expiration so renew-google-gmail-watch (which only
            // selects null/near-expiry watches) picks this provider up on its
            // next run instead of ~6.75 days from now.
            await db.table('google_email_provider_config')
              .where('email_provider_id', providerId)
              .update({
                ...(savedHistoryId ? { history_id: savedHistoryId } : {}),
                watch_expiration: null,
              });
            const reason = reconcileError instanceof Error ? reconcileError.message : String(reconcileError);
            throw new Error(`${RECONCILE_FAILED_PREFIX} mail received during the outage could not be recovered yet; it will be retried automatically. Details: ${reason}`);
          }
        }

        // Update the main provider's last_sync_at to reflect successful configuration
        await db.table('email_providers')
          .where('id', providerId)
          .update({
            last_sync_at: knex.fn.now(),
            updated_at: knex.fn.now()
          });

        console.log(`✅ Successfully registered Gmail watch subscription for provider ${providerId}`);
        result.watchRegistered = true;
        result.success = true;

        // A successful reconnect for a provider auto-paused on repeated auth
        // failures must resume ingestion only after durably reconciling the
        // paused interval. Tokens are freshly saved and the watch above
        // re-established delivery, so recovery only reconciles from the
        // saved pre-watch cursor and clears the pause.
        if (pausedForAuthFailure) {
          try {
            const { EmailProviderLifecycleService } = await import(
              '@alga-psa/shared/services/email/EmailProviderLifecycleService'
            );
            const recovery = await new EmailProviderLifecycleService().recoverAuthPausedProvider(
              providerId,
              tenant,
              { credentialsValidated: true, deliveryEstablished: true, savedHistoryId }
            );
            console.info('Gmail auth-failure recovery after reconnect', {
              tenant,
              providerId,
              resumed: recovery.resumed,
              reconciliation: recovery.reconciliation,
              error: recovery.error,
            });
            // The recovery outcome is part of the action result: the caller
            // must not toast success while the mailbox is still paused.
            // (There is no partial outcome: recovery either fully reconciles
            // the paused interval before clearing the pause or fails with the
            // provider left paused.)
            if (!recovery.resumed) {
              result.authFailureRecovery = 'failed';
              result.success = false;
              result.error = recovery.error || 'Gmail reconnection failed. Reconnect the mailbox and try again.';
            } else {
              result.authFailureRecovery = 'resumed';
            }
          } catch (recoveryError) {
            console.warn('Gmail auth-failure recovery after reconnect failed (provider stays paused)', {
              tenant,
              providerId,
              savedHistoryId,
              error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
            });
            result.authFailureRecovery = 'failed';
            result.success = false;
            result.error = 'Gmail reconnection failed. Reconnect the mailbox and try again.';
          }
        }
      } catch (watchError) {
        const errorMessage = watchError instanceof Error ? watchError.message : String(watchError);
        console.error(`❌ Failed to register Gmail watch subscription for provider ${providerId}:`, {
          tenant,
          providerId,
          error: errorMessage,
          stack: watchError instanceof Error ? watchError.stack : undefined
        });
        // No watch means Gmail publishes nothing, so a provisioned topic buys
        // the tenant exactly nothing. The provider row stays saved — the
        // administrator can retry — but the call reports what it is.
        result.watchRegistered = false;
        result.success = false;
        result.error = isActionableGoogleOAuthMessage(errorMessage) || errorMessage.startsWith(RECONCILE_FAILED_PREFIX)
          ? errorMessage
          : pausedForAuthFailure
          ? `Gmail reconnection failed. Reconnect the mailbox and try again. Google reported: ${errorMessage}`
          : `Gmail watch registration failed, so no mail will be delivered. Verify the mailbox's Google authorization and the Pub/Sub topic permissions, then retry. Google reported: ${errorMessage}`;
        if (pausedForAuthFailure) {
          result.authFailureRecovery = 'failed';
        }
      }
    });
  } catch (pubsubError) {
    const errorMessage = pubsubError instanceof Error ? pubsubError.message : String(pubsubError);
    console.error(`❌ Failed to configure Gmail provider ${providerId}:`, {
      tenant,
      providerId,
      projectId,
      error: errorMessage,
      stack: pubsubError instanceof Error ? pubsubError.stack : undefined
    });
    // This is a critical failure - Pub/Sub setup failed
    result.error = errorMessage || 'Unable to configure Gmail Pub/Sub.';
    result.success = false;
  }

  // The provider card renders from the stored row, not from this result.
  // Leaving that row at "connected" after a failed configure reproduces the
  // exact lie this orchestrator exists to remove, so the outcome is persisted.
  // Providers auto-paused on auth failures are skipped: the lifecycle recovery
  // owns their status and error text.
  if (!pausedForAuthFailure) {
    try {
      await runWithTenant(tenant, async () => {
        const { knex } = await createTenantKnex(tenant);
        await tenantDb(knex, tenant)
          .table('email_providers')
          .where('id', providerId)
          .update(
            result.success
              ? { status: 'connected', error_message: null, updated_at: knex.fn.now() }
              : {
                  status: 'error',
                  error_message: result.error || 'Gmail inbound delivery is not configured.',
                  updated_at: knex.fn.now(),
                }
          );
      });
    } catch (statusError) {
      console.error(`Failed to record Gmail configuration outcome for provider ${providerId}:`, statusError);
    }
  }

  return result;
}
