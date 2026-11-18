import type { Knex } from 'knex';

import { createTenantKnex } from '@alga-psa/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

import { tenantScopedTable } from './db';
import {
  assertAllowedDattoBaseUrl,
  DattoRmmClient,
  DattoRmmReconnectRequiredError,
  normalizeDattoBaseUrl,
  type DattoRmmAuthError,
  type DattoTokenStore,
} from './dattoApiClient';
import {
  DATTO_RMM_PROVIDER,
  DATTO_RMM_SECRET_KEYS,
  dattoPlatformApiUrl,
  DATTO_RMM_PLATFORMS,
  type DattoRmmPlatform,
} from './shared';

/**
 * The rmm_integrations row for Datto, or null when the tenant has not saved
 * a configuration yet.
 */
export async function getDattoIntegrationRow(knex: Knex | Knex.Transaction, tenant: string) {
  const row = await tenantScopedTable(knex, 'rmm_integrations', tenant)
    .where({ provider: DATTO_RMM_PROVIDER })
    .first();
  return (row as Record<string, any> | undefined) ?? null;
}

/**
 * The polling and device-sync gates in rmmAlertPollingHandlers.ts skip an
 * integration whose settings.tokenLifecycle.status is 'reconnect_required' (the
 * shape NinjaOne already uses), so Datto persists the same key.
 */
export async function markDattoReconnectRequired(tenant: string, reason: string): Promise<void> {
  const { knex } = await createTenantKnex();
  const lifecycle = {
    status: 'reconnect_required',
    reconnectRequired: true,
    reconnectReason: reason,
    updatedAt: new Date().toISOString(),
  };

  await tenantScopedTable(knex, 'rmm_integrations', tenant)
    .where({ provider: DATTO_RMM_PROVIDER })
    .update({
      settings: knex.raw(
        `COALESCE(settings, '{}'::jsonb) || jsonb_build_object('tokenLifecycle', COALESCE(settings->'tokenLifecycle', '{}'::jsonb) || ?::jsonb)`,
        [JSON.stringify(lifecycle)]
      ),
      updated_at: new Date(),
    });
}

/**
 * Clears the reconnect flag. A no-op unless the flag is set, so it is cheap to
 * call after every successful authentication and after saving new credentials.
 */
export async function clearDattoReconnectRequired(tenant: string): Promise<void> {
  const { knex } = await createTenantKnex();
  const lifecycle = {
    status: 'healthy',
    reconnectRequired: false,
    reconnectReason: null,
    updatedAt: new Date().toISOString(),
  };

  await tenantScopedTable(knex, 'rmm_integrations', tenant)
    .where({ provider: DATTO_RMM_PROVIDER })
    .whereRaw(`settings->'tokenLifecycle'->>'status' = 'reconnect_required'`)
    .update({
      settings: knex.raw(
        `COALESCE(settings, '{}'::jsonb) || jsonb_build_object('tokenLifecycle', COALESCE(settings->'tokenLifecycle', '{}'::jsonb) || ?::jsonb)`,
        [JSON.stringify(lifecycle)]
      ),
      updated_at: new Date(),
    });
}

/** Persists the bearer token in tenant secrets so it survives across jobs. */
function createSecretTokenStore(
  tenant: string,
  secretProvider: Awaited<ReturnType<typeof getSecretProviderInstance>>
): DattoTokenStore {
  return {
    async get() {
      const token = await secretProvider.getTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.accessToken);
      const expiresRaw = await secretProvider.getTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.accessTokenExpiresAt);
      const expiresAt = Number(expiresRaw);
      if (!token || !Number.isFinite(expiresAt)) return null;
      return { token, expiresAt };
    },
    async set(token, expiresAt) {
      await secretProvider.setTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.accessToken, token);
      await secretProvider.setTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.accessTokenExpiresAt, String(expiresAt));
    },
    async clear() {
      await secretProvider.setTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.accessToken, null);
      await secretProvider.setTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.accessTokenExpiresAt, null);
    },
  };
}

function resolveBaseUrl(integration: Record<string, any>): string | null {
  const instanceUrl = String(integration.instance_url || '').trim();
  const platform = integration.settings?.platform as string | undefined;
  try {
    if (instanceUrl) {
      const normalized = normalizeDattoBaseUrl(instanceUrl);
      // The stored value could predate the host allowlist or have been edited
      // directly; never send credentials to a host that is not Datto's.
      assertAllowedDattoBaseUrl(normalized);
      return normalized;
    }
    if (platform && (DATTO_RMM_PLATFORMS as readonly string[]).includes(platform)) {
      return dattoPlatformApiUrl(platform as DattoRmmPlatform);
    }
  } catch {
    // An unusable or non-Datto stored URL is the same as no URL: the caller sees "not configured".
  }
  return null;
}

/**
 * Builds a configured Datto client from the tenant's stored integration and
 * secrets. Returns null when there is no active integration or no credentials.
 * Pass `allowInactive` for setup flows (Save/Test Connection) that run before
 * the integration is activated.
 *
 * A credential rejection from Datto flags the integration reconnect-required
 * so the polling and sync gates stop calling a dead account; a successful
 * authentication clears the flag again.
 *
 * `respectReconnectRequired` makes a flagged integration throw
 * DattoRmmReconnectRequiredError instead of hitting the token endpoint again
 * with credentials known to be bad. Interactive actions (reboot, refresh,
 * remote control) opt in; save and test-connection must not, since re-entering
 * credentials is how the flag gets cleared.
 *
 * `maxRetries` / `maxRetryAfterMs` pass through to the client; request
 * handlers (the webhook) use small values so they never sleep out a long
 * rate-limit window.
 */
export async function buildDattoClientForTenant(
  tenant: string,
  options: {
    allowInactive?: boolean;
    respectReconnectRequired?: boolean;
    maxRetries?: number;
    maxRetryAfterMs?: number;
  } = {}
): Promise<DattoRmmClient | null> {
  const { knex } = await createTenantKnex();
  const secretProvider = await getSecretProviderInstance();

  const integration = await getDattoIntegrationRow(knex, tenant);
  if (!integration) return null;
  if (!integration.is_active && !options.allowInactive) return null;

  const baseUrl = resolveBaseUrl(integration);
  if (!baseUrl) return null;

  if (options.respectReconnectRequired) {
    const lifecycle = integration.settings?.tokenLifecycle;
    if (lifecycle?.status === 'reconnect_required') {
      throw new DattoRmmReconnectRequiredError(
        typeof lifecycle.reconnectReason === 'string' ? lifecycle.reconnectReason : null
      );
    }
  }

  const apiKey = await secretProvider.getTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.apiKey);
  const apiSecret = await secretProvider.getTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.apiSecret);
  if (!apiKey || !apiSecret) return null;

  return new DattoRmmClient({
    baseUrl,
    apiKey,
    apiSecret,
    maxRetries: options.maxRetries,
    maxRetryAfterMs: options.maxRetryAfterMs,
    tokenStore: createSecretTokenStore(tenant, secretProvider),
    onAuthFailure: async (err: DattoRmmAuthError) => {
      try {
        await markDattoReconnectRequired(tenant, err.message);
      } catch {
        // Flagging is best-effort; the auth error still reaches the caller.
      }
    },
    onAuthSuccess: async () => {
      try {
        await clearDattoReconnectRequired(tenant);
      } catch {
        // Best-effort for the same reason.
      }
    },
  });
}
