'use server'

import { createTenantKnex, runWithTenant, tenantDb } from '@alga-psa/db';
import { setupPubSub } from './setupPubSub';
import { GmailWebhookService } from '../../services/email/GmailWebhookService';
import type { GoogleEmailProviderConfig } from '../../components/email/types';
import type { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

/**
 * Generate standardized Pub/Sub topic and subscription names for a tenant
 */
function generatePubSubNames(tenantId: string) {
  // Use ngrok URL in development if available
  const baseUrl = process.env.NGROK_URL || 
                  process.env.NEXT_PUBLIC_BASE_URL || 
                  process.env.NEXTAUTH_URL ||
                  'http://localhost:3000';
  
  return {
    topicName: `gmail-notifications-${tenantId}`,
    subscriptionName: `gmail-webhook-${tenantId}`,
    webhookUrl: `${baseUrl}/api/email/webhooks/google`
  };
}

interface ConfigureGmailProviderOptions {
  tenant: string;
  providerId: string;
  projectId: string;
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
   * auto-paused: 'resumed' — pause cleared and reconciliation handed off;
   * 'resumed_partial' — resumed but the paused interval was only partially
   * reconciled (see warnings); 'failed' — still paused, reconnect required;
   * undefined — no recovery was attempted (provider was not auth-paused).
   */
  authFailureRecovery?: 'resumed' | 'resumed_partial' | 'failed';
}

/**
 * Configure Gmail provider with Pub/Sub and webhook registration.
 * This is the single orchestrator for Gmail provider setup that ensures
 * exactly one Pub/Sub initialization per logical trigger.
 *
 * Returns a result object indicating what succeeded/failed so the UI can inform the user.
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

  try {
    await runWithTenant(tenant, async () => {
      // Capture the pre-watch history cursor and pause state before any
      // registration overwrites them: the auth-failure recovery path must
      // reconcile from the cursor that was valid when the provider paused.
      const { knex: boundaryKnex } = await createTenantKnex(tenant);
      const boundaryDb = tenantDb(boundaryKnex, tenant);
      const [boundaryProvider, boundaryGoogleConfig] = await Promise.all([
        boundaryDb.table('email_providers').where({ id: providerId }).first('inbound_paused_at', 'inbound_pause_reason'),
        boundaryDb.table('google_email_provider_config').where({ email_provider_id: providerId }).first('history_id'),
      ]);
      const savedHistoryId = boundaryGoogleConfig?.history_id ? String(boundaryGoogleConfig.history_id) : null;
      const pausedForAuthFailure = Boolean(
        boundaryProvider?.inbound_paused_at && boundaryProvider.inbound_pause_reason === 'auth_failure'
      );

      // Check if Pub/Sub was already initialized recently (within 24 hours) unless force=true
      // or the provider is paused for auth failure (reconnect must re-establish the watch).
      if (!force && !pausedForAuthFailure) {
        const {knex} = await createTenantKnex(tenant);
        const db = tenantDb(knex, tenant);
        const config = await db.table('google_email_provider_config')
          .select('pubsub_initialised_at')
          .where('email_provider_id', providerId)
          .first() as GoogleEmailProviderConfig | undefined;

        if (config?.pubsub_initialised_at) {
          const initialisedAt = new Date(config.pubsub_initialised_at);
          const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          
          if (initialisedAt > twentyFourHoursAgo) {
            console.log(`⏭️ Skipping Pub/Sub setup for Gmail provider ${providerId} - already initialized within 24 hours`, {
              tenant,
              providerId,
              pubsub_initialised_at: config.pubsub_initialised_at
            });
            result.success = true;
            result.pubsubConfigured = true;
            result.watchRegistered = true;
            return;
          }
        }
      }

      const pubsubNames = generatePubSubNames(tenant);
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
          result.success = result.pubsubConfigured; // Still considered success if pubsub was configured
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
        
        // Register the Gmail watch
        await gmailWebhookService.registerWatch(emailProviderConfig, {
          projectId,
          topicName: pubsubNames.topicName,
          subscriptionName: pubsubNames.subscriptionName,
          webhookUrl: pubsubNames.webhookUrl
        });
        
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
            // must not toast success while the mailbox is still paused, and
            // partial reconciliations must surface their warning.
            if (!recovery.resumed) {
              result.authFailureRecovery = 'failed';
              result.success = false;
              result.error = recovery.error || 'Gmail reconnection failed. Reconnect the mailbox and try again.';
            } else if (recovery.reconciliation?.status === 'partial') {
              result.authFailureRecovery = 'resumed_partial';
              result.warnings.push(
                recovery.reconciliation.warning ||
                  'Reconnection resumed, but some paused-interval mail was not reconciled. Run a mailbox resync.'
              );
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
        // Record the error but don't throw - provider is saved, Pub/Sub may still work
        result.warnings.push('Gmail watch registration failed. Reconnect the mailbox or retry setup after verifying Google permissions.');
        // If Pub/Sub was configured, we're partially successful
        result.success = result.pubsubConfigured;
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

  return result;
}
