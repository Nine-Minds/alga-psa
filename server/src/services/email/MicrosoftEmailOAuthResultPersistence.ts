/**
 * Atomic persistence of a successful Microsoft inbound-email OAuth result.
 *
 * The mailbox OAuth callback receives fresh tokens from Microsoft. Persisting
 * them must be atomic with the webhook/subscription initialization that follows:
 * if setup fails *after* the credential write, the previously connected
 * provider must be left fully working (old refresh token, old client_id /
 * profile pinning, coherent subscription state).
 *
 * This module uses a compensating restore rather than a single database
 * transaction because webhook initialization makes external Microsoft Graph
 * calls that cannot be rolled back. The flow is:
 *
 *   1. capture the prior `microsoft_email_provider_config` + `email_providers`
 *      rows,
 *   2. persist the new tokens + authoritative issuer metadata transactionally,
 *   3. run webhook/subscription setup against the freshly written rows. The
 *      setup receives a compensation ledger and records every Graph
 *      subscription it deletes or creates,
 *   4. on any post-persistence failure, run the caller's Graph compensation
 *      (delete subscriptions the failed setup created) and then restore the
 *      captured rows in a transaction, re-deriving the subscription fields so
 *      they never resurrect a subscription id that no longer exists in Graph.
 *
 * Restoration is retry-safe: it updates (never inserts) the existing rows and
 * the caller deletes any subscription created by the failed attempt, so a
 * second callback attempt neither duplicates rows nor subscriptions.
 */

import { createTenantKnex, tenantDb } from '@alga-psa/db';

/** How long before a compensated provider re-probes Graph for a subscription. */
const COMPENSATED_POLLING_PROBE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Mutable columns on `microsoft_email_provider_config` that the OAuth callback
 * or webhook setup can change, and that a failed flow must restore. */
const CONFIG_RESTORE_COLUMNS = [
  'client_id',
  'client_secret',
  'tenant_id',
  'microsoft_profile_id',
  'client_secret_ref',
  'access_token',
  'refresh_token',
  'token_expires_at',
  'webhook_subscription_id',
  'webhook_verification_token',
  'webhook_expires_at',
  'last_subscription_renewal',
  'delivery_mode',
  'last_webhook_delivery_at',
  'next_subscription_probe_at',
  'webhook_silent_runs',
  'updated_at',
] as const;

/** Mutable columns on `email_providers` that the OAuth callback can change. */
const PROVIDER_RESTORE_COLUMNS = ['status', 'error_message', 'last_sync_at', 'updated_at'] as const;

/**
 * Ledger of Graph subscription mutations recorded by the failed webhook setup.
 * `deletedSubscriptionIds` are subscriptions the setup removed from Graph;
 * `createdSubscriptionIds` are subscriptions the setup created and that the
 * caller must delete to leave Graph clean for a retry.
 */
export interface MicrosoftEmailWebhookCompensationLedger {
  deletedSubscriptionIds: string[];
  createdSubscriptionIds: string[];
}

/** Live ledger exposed to `setupWebhook` so its adapter can record mutations. */
export interface MicrosoftEmailWebhookCompensation {
  onSubscriptionDeleted(subscriptionId: string): void;
  onSubscriptionCreated(subscriptionId: string): void;
}

export interface MicrosoftEmailOAuthPersistContext {
  provider: Record<string, any>;
  config: Record<string, any>;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  /**
   * Record every Graph subscription the webhook setup deletes or creates. The
   * restore consults the ledger so it never resurrects a subscription id that
   * the setup already removed from Graph.
   */
  webhookCompensation: MicrosoftEmailWebhookCompensation;
}

export interface MicrosoftEmailOAuthIssuerPersistMetadata {
  client_id: string;
  client_secret: string;
  tenant_id: string;
  microsoft_profile_id: string | null;
  client_secret_ref: string | null;
}

export interface PersistMicrosoftEmailOAuthResultParams {
  tenant: string;
  providerId: string;
  tokens: { accessToken: string; refreshToken: string | null; expiresAt: Date };
  /** Authoritative issuer metadata resolved from the signed state's choice. */
  issuerMetadata?: MicrosoftEmailOAuthIssuerPersistMetadata | null;
  /**
   * Runs webhook/subscription initialization after the token write. It receives
   * the freshly persisted rows and effective credentials. A resolved validation
   * failure should fall back to polling and return normally; any thrown error
   * triggers Graph compensation + restore of the prior connection.
   */
  setupWebhook: (ctx: MicrosoftEmailOAuthPersistContext) => Promise<void>;
  /**
   * Compensates the Graph side of a failed setup: delete every subscription the
   * setup created (tracked in the ledger). Runs before the database restore.
   */
  compensateWebhook: (ledger: MicrosoftEmailWebhookCompensationLedger) => Promise<void>;
}

function pickRestorePayload(prior: Record<string, any>, columns: readonly string[]): Record<string, any> {
  const payload: Record<string, any> = {};
  for (const column of columns) {
    if (column in prior) {
      payload[column] = prior[column];
    }
  }
  return payload;
}

/**
 * Re-derive the subscription fields of a restored config row from the ledger.
 * The captured snapshot's subscription id is only truthful if the failed setup
 * never deleted it in Graph; otherwise restoring it would resurrect a phantom
 * subscription. When the prior subscription is gone, the restored row lands on
 * a coherent polling state that the maintenance probe will rebuild.
 */
function reconcileSubscriptionRestore(
  payload: Record<string, any>,
  priorConfig: Record<string, any>,
  ledger: MicrosoftEmailWebhookCompensationLedger
): void {
  const priorSubscriptionId = priorConfig?.webhook_subscription_id ?? null;
  const priorSubscriptionDeleted =
    Boolean(priorSubscriptionId) &&
    ledger.deletedSubscriptionIds.includes(String(priorSubscriptionId));
  if (!priorSubscriptionDeleted) return;

  payload.webhook_subscription_id = null;
  payload.webhook_expires_at = null;
  payload.delivery_mode = 'polling';
  payload.webhook_silent_runs = 0;
  payload.last_webhook_delivery_at = null;
  payload.next_subscription_probe_at = new Date(
    Date.now() + COMPENSATED_POLLING_PROBE_INTERVAL_MS
  ).toISOString();
  payload.updated_at = new Date().toISOString();
}

export async function persistMicrosoftEmailOAuthResult(
  params: PersistMicrosoftEmailOAuthResultParams
): Promise<void> {
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, params.tenant);
  const { providerId, tenant } = params;

  const priorConfig = await db.table('microsoft_email_provider_config')
    .where('email_provider_id', providerId)
    .first();
  const priorProvider = await db.table('email_providers')
    .where('id', providerId)
    .first();

  const ledger: MicrosoftEmailWebhookCompensationLedger = {
    deletedSubscriptionIds: [],
    createdSubscriptionIds: [],
  };
  const record = (bucket: 'deletedSubscriptionIds' | 'createdSubscriptionIds') =>
    (subscriptionId: string) => {
      if (!subscriptionId || ledger[bucket].includes(subscriptionId)) return;
      ledger[bucket].push(subscriptionId);
    };
  const webhookCompensation: MicrosoftEmailWebhookCompensation = {
    onSubscriptionDeleted: record('deletedSubscriptionIds'),
    onSubscriptionCreated: record('createdSubscriptionIds'),
  };

  try {
    await knex.transaction(async (trx) => {
      const trxDb = tenantDb(trx, tenant);
      const updatePayload: Record<string, unknown> = {
        access_token: params.tokens.accessToken,
        refresh_token: params.tokens.refreshToken || null,
        token_expires_at: params.tokens.expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (params.issuerMetadata) {
        updatePayload.client_id = params.issuerMetadata.client_id;
        updatePayload.client_secret = params.issuerMetadata.client_secret;
        updatePayload.tenant_id = params.issuerMetadata.tenant_id;
        updatePayload.microsoft_profile_id = params.issuerMetadata.microsoft_profile_id;
        updatePayload.client_secret_ref = params.issuerMetadata.client_secret_ref;
      }

      await trxDb.table('microsoft_email_provider_config')
        .where('email_provider_id', providerId)
        .update(updatePayload);

      await trxDb.table('email_providers')
        .where('id', providerId)
        .update({
          status: 'connected',
          error_message: null,
          updated_at: trx.fn.now(),
        });
    });

    const config = await db.table('microsoft_email_provider_config')
      .where('email_provider_id', providerId)
      .first();
    const provider = await db.table('email_providers')
      .where('id', providerId)
      .first();

    await params.setupWebhook({
      provider,
      config,
      clientId: params.issuerMetadata?.client_id || '',
      clientSecret: params.issuerMetadata?.client_secret || '',
      accessToken: params.tokens.accessToken,
      refreshToken: params.tokens.refreshToken,
      expiresAt: params.tokens.expiresAt,
      webhookCompensation,
    });
  } catch (error) {
    // Compensate the Graph side first (delete subscriptions the failed setup
    // created) so a retry cannot duplicate them. Best-effort: a failed
    // compensation must not prevent the database restore.
    try {
      await params.compensateWebhook({
        deletedSubscriptionIds: [...ledger.deletedSubscriptionIds],
        createdSubscriptionIds: [...ledger.createdSubscriptionIds],
      });
    } catch (compensationError) {
      console.error('[MicrosoftEmailOAuthResultPersistence] Failed to compensate Graph subscriptions after OAuth failure', {
        tenant,
        providerId,
        ledger,
        compensationError: compensationError instanceof Error ? compensationError.message : String(compensationError),
      });
    }

    if (priorConfig || priorProvider) {
      try {
        await knex.transaction(async (trx) => {
          const trxDb = tenantDb(trx, tenant);
          if (priorConfig) {
            const restorePayload = pickRestorePayload(priorConfig, CONFIG_RESTORE_COLUMNS);
            reconcileSubscriptionRestore(restorePayload, priorConfig, ledger);
            await trxDb.table('microsoft_email_provider_config')
              .where('email_provider_id', providerId)
              .update(restorePayload);
          }
          if (priorProvider) {
            await trxDb.table('email_providers')
              .where('id', providerId)
              .update(pickRestorePayload(priorProvider, PROVIDER_RESTORE_COLUMNS));
          }
        });
      } catch (restoreError) {
        console.error('[MicrosoftEmailOAuthResultPersistence] Failed to restore prior connection after OAuth failure', {
          tenant,
          providerId,
          restoreError: restoreError instanceof Error ? restoreError.message : String(restoreError),
        });
      }
    }
    throw error;
  }
}
