'use server';

/**
 * Hudu connection server actions (EE-only).
 *
 * connect / test / getStatus / disconnect for the per-tenant Hudu connection.
 * Gating mirrors requireHuduUiFlagEnabled (and the Entra action gating): EE
 * tier + Enterprise add-on, `system_settings` RBAC (read=view, update=manage),
 * and the `hudu-integration` feature flag — enforced on every action.
 *
 * SECURITY: the api key is only ever written to the secret provider
 * (`hudu_api_key`/`hudu_base_url` tenant secrets) and is never returned to the
 * client, logged, or included in any status payload. Disconnect deletes both
 * secrets and marks the row inactive but RETAINS company mappings (shared CE
 * table `tenant_external_entity_mappings` is untouched — NFR7).
 */

import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { ADD_ONS, TIER_FEATURES } from '@alga-psa/types';
import { featureFlags } from 'server/src/lib/feature-flags/featureFlags';
import { assertAddOnAccess } from 'server/src/lib/tier-gating/assertAddOnAccess';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { createTenantKnex } from 'server/src/lib/db';
import { HuduClient } from '../../integrations/hudu/huduClient';
import type { HuduErrorKind, HuduValidationResult } from '../../integrations/hudu/huduClient';
import { HUDU_SECRET_KEYS, resolveHuduCredentials } from '../../integrations/hudu/secrets';
import {
  getHuduIntegration,
  setHuduIntegrationActive,
  upsertHuduIntegration,
} from '../../integrations/hudu/huduIntegrationRepository';

export interface HuduConnectionStatusData {
  connected: boolean;
  isActive: boolean;
  baseUrl: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  passwordAccess: boolean;
}

export interface HuduTestConnectionData {
  connected: boolean;
  passwordAccess: boolean;
  errorKind?: HuduErrorKind;
  error?: string;
}

export type HuduActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; errorKind?: HuduErrorKind };

export interface HuduCredentialsInput {
  baseUrl: string;
  apiKey: string;
}

/**
 * Connect input. `apiKey` may be omitted to keep using the already-stored key
 * (the UI never round-trips the stored value, so "blank key" means "keep").
 */
export interface HuduConnectInput {
  baseUrl: string;
  apiKey?: string;
}

type HuduActionPermission = 'read' | 'update';

function withHuduSettingsAccess<TArgs extends unknown[], TResult>(
  requiredPermission: HuduActionPermission,
  handler: (user: IUserWithRoles, context: { tenant: string }, ...args: TArgs) => Promise<TResult>
) {
  return withAuth(async (user, context, ...args: TArgs): Promise<TResult> => {
    if (user.user_type === 'client') {
      throw new Error('Forbidden');
    }

    const allowed = await hasPermission(user, 'system_settings', requiredPermission);
    if (!allowed) {
      throw new Error(`Forbidden: insufficient permissions (${requiredPermission})`);
    }

    await assertTierAccess(TIER_FEATURES.INTEGRATIONS);
    await assertAddOnAccess(ADD_ONS.ENTERPRISE);

    const enabled = await featureFlags.isEnabled('hudu-integration', {
      userId: user.user_id,
      tenantId: context.tenant,
    });
    if (!enabled) {
      throw new Error('Hudu integration is disabled for this tenant.');
    }

    return handler(user, context as { tenant: string }, ...args);
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function settingsPasswordAccess(settings: Record<string, unknown> | null | undefined): boolean {
  return settings?.password_access === true;
}

async function validateCandidate(
  tenant: string,
  credentials: HuduCredentialsInput
): Promise<HuduValidationResult> {
  const client = new HuduClient({
    tenantId: tenant,
    credentials: { apiKey: credentials.apiKey, baseUrl: credentials.baseUrl },
  });
  return client.validateConnection();
}

/**
 * Connect Hudu: validate the candidate credentials against the live instance,
 * store them via the secret provider, and upsert the tenant's connection row
 * as active. The api key never leaves the secret provider. A blank/omitted
 * apiKey keeps the already-stored key (the UI never round-trips the value).
 */
export const connectHudu = withHuduSettingsAccess(
  'update',
  async (_user, { tenant }, input: HuduConnectInput): Promise<HuduActionResult<HuduConnectionStatusData>> => {
    try {
      const baseUrl = input?.baseUrl?.trim();
      let apiKey = input?.apiKey?.trim();
      if (baseUrl && !apiKey) {
        // Keep-existing-key: fall back to the stored credential.
        apiKey = await resolveHuduCredentials(tenant)
          .then((stored) => stored.apiKey)
          .catch(() => undefined);
      }
      if (!baseUrl || !apiKey) {
        return { success: false, error: 'Hudu base URL and API key are required.' };
      }

      const validation = await validateCandidate(tenant, { baseUrl, apiKey });
      if (!validation.ok || !validation.connected) {
        return {
          success: false,
          error: validation.error?.message ?? 'Hudu connection validation failed.',
          errorKind: validation.error?.kind,
        };
      }

      const secretProvider = await getSecretProviderInstance();
      await secretProvider.setTenantSecret(tenant, HUDU_SECRET_KEYS.apiKey, apiKey);
      await secretProvider.setTenantSecret(tenant, HUDU_SECRET_KEYS.baseUrl, baseUrl);

      const { knex } = await createTenantKnex(tenant);
      const row = await upsertHuduIntegration(knex, tenant, {
        base_url: baseUrl,
        is_active: true,
        connected_at: new Date().toISOString(),
        settings: { password_access: validation.passwordAccess },
      });

      logger.info('[HuduActions] Hudu connected', { tenant });

      return {
        success: true,
        data: {
          connected: true,
          isActive: true,
          baseUrl: row.base_url,
          connectedAt: toIso(row.connected_at),
          lastSyncedAt: toIso(row.last_synced_at),
          passwordAccess: validation.passwordAccess,
        },
      };
    } catch (error) {
      logger.error('[HuduActions] connectHudu failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);

/**
 * Test the Hudu connection. With candidate credentials, validates them without
 * storing anything; without, validates the currently stored credentials.
 * Returns connected + password-access capability, or a typed error shape.
 */
export const testHuduConnection = withHuduSettingsAccess(
  'update',
  async (_user, { tenant }, input?: Partial<HuduCredentialsInput>): Promise<HuduActionResult<HuduTestConnectionData>> => {
    try {
      const baseUrl = input?.baseUrl?.trim();
      const apiKey = input?.apiKey?.trim();

      let validation: HuduValidationResult;
      if (baseUrl && apiKey) {
        validation = await validateCandidate(tenant, { baseUrl, apiKey });
      } else {
        // Merge partial candidates with the stored credentials so a blank key
        // (or blank base URL) means "use the stored value".
        const stored = await resolveHuduCredentials(tenant);
        validation = await validateCandidate(tenant, {
          baseUrl: baseUrl || stored.baseUrl,
          apiKey: apiKey || stored.apiKey,
        });
      }

      if (!validation.ok || !validation.connected) {
        return {
          success: true,
          data: {
            connected: false,
            passwordAccess: false,
            errorKind: validation.error?.kind,
            error: validation.error?.message ?? 'Hudu connection validation failed.',
          },
        };
      }

      return {
        success: true,
        data: { connected: true, passwordAccess: validation.passwordAccess },
      };
    } catch (error) {
      logger.error('[HuduActions] testHuduConnection failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);

/**
 * Current connection state. SECURITY: the payload never contains the api key —
 * only connection metadata (base_url, flags, timestamps, capability).
 */
export const getHuduConnectionStatus = withHuduSettingsAccess(
  'read',
  async (_user, { tenant }): Promise<HuduActionResult<HuduConnectionStatusData>> => {
    try {
      const { knex } = await createTenantKnex(tenant);
      const row = await getHuduIntegration(knex, tenant);

      if (!row) {
        return {
          success: true,
          data: {
            connected: false,
            isActive: false,
            baseUrl: null,
            connectedAt: null,
            lastSyncedAt: null,
            passwordAccess: false,
          },
        };
      }

      return {
        success: true,
        data: {
          connected: row.is_active,
          isActive: row.is_active,
          baseUrl: row.base_url,
          connectedAt: toIso(row.connected_at),
          lastSyncedAt: toIso(row.last_synced_at),
          passwordAccess: settingsPasswordAccess(row.settings),
        },
      };
    } catch (error) {
      logger.error('[HuduActions] getHuduConnectionStatus failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);

/**
 * Disconnect Hudu: delete both tenant secrets and mark the connection row
 * inactive. Company mappings in the shared CE table
 * `tenant_external_entity_mappings` are deliberately RETAINED (FR4/NFR7).
 */
export const disconnectHudu = withHuduSettingsAccess(
  'update',
  async (_user, { tenant }): Promise<HuduActionResult<{ disconnected: true }>> => {
    try {
      const secretProvider = await getSecretProviderInstance();
      await secretProvider.deleteTenantSecret(tenant, HUDU_SECRET_KEYS.apiKey);
      await secretProvider.deleteTenantSecret(tenant, HUDU_SECRET_KEYS.baseUrl);

      const { knex } = await createTenantKnex(tenant);
      await setHuduIntegrationActive(knex, tenant, false);

      logger.info('[HuduActions] Hudu disconnected', { tenant });

      return { success: true, data: { disconnected: true } };
    } catch (error) {
      logger.error('[HuduActions] disconnectHudu failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);
