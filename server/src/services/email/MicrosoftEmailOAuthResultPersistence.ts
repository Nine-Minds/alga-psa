/**
 * Atomic persistence of a successful Microsoft inbound-email OAuth result.
 *
 * The mailbox OAuth callback receives fresh tokens from Microsoft. Persisting
 * them must be atomic with the webhook/subscription initialization that follows:
 * if setup fails *after* the credential write, the previously connected
 * provider must be left fully working (old refresh token, old client_id /
 * profile pinning, old subscription state).
 *
 * This module uses a compensating restore rather than a single database
 * transaction because webhook initialization makes external Microsoft Graph
 * calls that cannot be rolled back. The flow is:
 *
 *   1. capture the prior `microsoft_email_provider_config` + `email_providers`
 *      rows,
 *   2. persist the new tokens + authoritative issuer metadata transactionally,
 *   3. run webhook/subscription setup against the freshly written rows,
 *   4. on any post-persistence failure, restore the captured prior rows in a
 *      transaction and rethrow.
 */

import { createTenantKnex, tenantDb } from '@alga-psa/db';

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

export interface MicrosoftEmailOAuthPersistContext {
  provider: Record<string, any>;
  config: Record<string, any>;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
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
   * triggers a restore of the prior connection.
   */
  setupWebhook: (ctx: MicrosoftEmailOAuthPersistContext) => Promise<void>;
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
    });
  } catch (error) {
    if (priorConfig || priorProvider) {
      try {
        await knex.transaction(async (trx) => {
          const trxDb = tenantDb(trx, tenant);
          if (priorConfig) {
            await trxDb.table('microsoft_email_provider_config')
              .where('email_provider_id', providerId)
              .update(pickRestorePayload(priorConfig, CONFIG_RESTORE_COLUMNS));
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
