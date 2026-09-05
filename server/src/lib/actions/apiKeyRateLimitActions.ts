'use server'

import { z } from 'zod';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { IRole } from '@alga-psa/types';
import { TokenBucketRateLimiter } from '@alga-psa/core/rateLimit';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

import { withAuth } from '@alga-psa/auth/withAuth';
import { getUserRoles } from '@alga-psa/auth/actions';
import {
  clearForKey as clearApiRateLimitOverride,
  DEFAULT_API_RATE_LIMIT_CONFIG,
  DEFAULT_API_RATE_LIMIT_SETTINGS,
  getForKey as getApiRateLimitSettingsRow,
  getForKeys as getApiRateLimitSettingsRows,
  type ApiRateLimitSettingsRow,
  resolveApiRateLimitConfig,
  upsertForKey,
  upsertForTenant,
} from '@/lib/api/rateLimit/apiRateLimitSettingsModel';
import { invalidateApiRateLimitConfig } from '@/lib/api/rateLimit/apiRateLimitConfigGetter';

const apiRateLimitInputSchema = z.object({
  maxTokens: z.number().int().positive(),
  refillPerMin: z.number().int().positive(),
});

type ApiRateLimitActionError = ActionMessageError | ActionPermissionError;

/**
 * API-rate-limit settings are internal-user configuration. A client-portal
 * identity must not inspect or mutate them, even if a client role happens to
 * carry an admin-like name. Returns a permission error for client users.
 */
function clientUserPermissionError(user: { user_type?: string }): ActionPermissionError | null {
  if (user.user_type === 'client') {
    return permissionError('Permission denied: API key configuration is restricted to internal users', 'msp/profile:errors.apiKeys.configInternalOnly');
  }
  return null;
}

export interface ApiRateLimitSettingsValue {
  maxTokens: number;
  refillPerMin: number;
}

export interface ApiRateLimitSettingsView {
  apiKeyId: string;
  override: ApiRateLimitSettingsValue | null;
  tenantDefault: ApiRateLimitSettingsValue | null;
  effective: ApiRateLimitSettingsValue;
  bucketState: {
    remaining: number;
    maxTokens: number;
  } | null;
  source: 'key' | 'tenant' | 'default';
}

async function getTenantAdminError(userId: string): Promise<ActionPermissionError | null> {
  const userRoles = await getUserRoles(userId);
  const isAdmin = userRoles.some((role: IRole) => role.role_name.toLowerCase() === 'admin');

  if (isAdmin) {
    return null;
  }

  return permissionError('Permission denied: Admin access required', 'msp/profile:errors.permissions.adminRequired');
}

async function getApiKeyExistsError(tenant: string, apiKeyId: string): Promise<ActionMessageError | null> {
  const { knex } = await createTenantKnex(tenant);
  const apiKey = await tenantDb(knex, tenant).table('api_keys')
    .select('api_key_id')
    .where({ api_key_id: apiKeyId })
    .first();

  if (apiKey) {
    return null;
  }

  return actionError('API key not found.', 'msp/profile:errors.apiKeys.notFound');
}

function mapSettingsRow(row: ApiRateLimitSettingsRow | null): ApiRateLimitSettingsValue | null {
  if (!row) {
    return null;
  }

  return {
    maxTokens: row.maxTokens,
    refillPerMin: row.refillPerMin,
  };
}

async function buildApiRateLimitSettingsView(
  tenant: string,
  apiKeyId: string,
): Promise<ApiRateLimitSettingsView> {
  const [override, tenantDefault, effective, bucketState] = await Promise.all([
    getApiRateLimitSettingsRow(tenant, apiKeyId),
    getApiRateLimitSettingsRow(tenant, null),
    resolveApiRateLimitConfig(tenant, apiKeyId),
    TokenBucketRateLimiter.getInstance().getState('api', tenant, apiKeyId),
  ]);

  const effectiveValue: ApiRateLimitSettingsValue = {
    maxTokens: effective.maxTokens,
    refillPerMin: Math.round(effective.refillRate * 60),
  };

  return {
    apiKeyId,
    override: mapSettingsRow(override),
    tenantDefault: mapSettingsRow(tenantDefault),
    effective: effectiveValue,
    bucketState: bucketState
      ? {
          remaining: bucketState.tokens,
          maxTokens: bucketState.maxTokens,
        }
      : null,
    source: override ? 'key' : tenantDefault ? 'tenant' : 'default',
  };
}

export const getApiRateLimitForKey = withAuth(async (
  user,
  { tenant },
  apiKeyId: string,
): Promise<ApiRateLimitSettingsView | ApiRateLimitActionError> => {
  const clientError = clientUserPermissionError(user);
  if (clientError) {
    return clientError;
  }
  const adminError = await getTenantAdminError(user.user_id);
  if (adminError) {
    return adminError;
  }
  const keyError = await getApiKeyExistsError(tenant, apiKeyId);
  if (keyError) {
    return keyError;
  }
  return buildApiRateLimitSettingsView(tenant, apiKeyId);
});

export const getApiRateLimitsForKeys = withAuth(
  async (user, { tenant }, apiKeyIds: string[]): Promise<ApiRateLimitSettingsView[] | ApiRateLimitActionError> => {
    const clientError = clientUserPermissionError(user);
    if (clientError) {
      return clientError;
    }
    const adminError = await getTenantAdminError(user.user_id);
    if (adminError) {
      return adminError;
    }

    if (apiKeyIds.length === 0) {
      return [];
    }

    const uniqueIds = Array.from(new Set(apiKeyIds));

    const { knex } = await createTenantKnex(tenant);
    const existingRows = await tenantDb(knex, tenant).table('api_keys')
      .select('api_key_id')
      .whereIn('api_key_id', uniqueIds);
    const existingIds = new Set(existingRows.map((row: { api_key_id: string }) => row.api_key_id));

    const validIds = uniqueIds.filter((id) => existingIds.has(id));
    if (validIds.length === 0) {
      return [];
    }

    const { overrides, tenantDefault } = await getApiRateLimitSettingsRows(tenant, validIds);

    const limiter = TokenBucketRateLimiter.getInstance();
    const bucketStates = await Promise.all(
      validIds.map((apiKeyId) => limiter.getState('api', tenant, apiKeyId)),
    );

    const tenantDefaultValue = mapSettingsRow(tenantDefault);

    return validIds.map((apiKeyId, index) => {
      const overrideRow = overrides.get(apiKeyId) ?? null;
      const overrideValue = mapSettingsRow(overrideRow);

      const effectiveSource = overrideRow ?? tenantDefault;
      const effective: ApiRateLimitSettingsValue = effectiveSource
        ? { maxTokens: effectiveSource.maxTokens, refillPerMin: effectiveSource.refillPerMin }
        : {
            maxTokens: DEFAULT_API_RATE_LIMIT_CONFIG.maxTokens,
            refillPerMin: Math.round(DEFAULT_API_RATE_LIMIT_CONFIG.refillRate * 60),
          };

      const bucketState = bucketStates[index];

      return {
        apiKeyId,
        override: overrideValue,
        tenantDefault: tenantDefaultValue,
        effective,
        bucketState: bucketState
          ? { remaining: bucketState.tokens, maxTokens: bucketState.maxTokens }
          : null,
        source: overrideRow ? 'key' : tenantDefault ? 'tenant' : 'default',
      };
    });
  },
);

export const setApiRateLimitForKey = withAuth(
  async (
    user,
    { tenant },
    apiKeyId: string,
    input: ApiRateLimitSettingsValue,
  ): Promise<ApiRateLimitSettingsView | ApiRateLimitActionError> => {
    const clientError = clientUserPermissionError(user);
    if (clientError) {
      return clientError;
    }
    const adminError = await getTenantAdminError(user.user_id);
    if (adminError) {
      return adminError;
    }
    const keyError = await getApiKeyExistsError(tenant, apiKeyId);
    if (keyError) {
      return keyError;
    }

    const parsed = apiRateLimitInputSchema.safeParse(input);
    if (!parsed.success) {
      return actionError('API rate limits must be positive whole numbers.', 'msp/profile:errors.apiKeys.rateLimitsPositive');
    }

    await upsertForKey(tenant, apiKeyId, parsed.data);
    invalidateApiRateLimitConfig(tenant, apiKeyId);

    return buildApiRateLimitSettingsView(tenant, apiKeyId);
  },
);

export const setTenantDefaultApiRateLimit = withAuth(
  async (_user, { tenant }, input: ApiRateLimitSettingsValue): Promise<ApiRateLimitSettingsValue | ApiRateLimitActionError> => {
    const clientError = clientUserPermissionError(_user);
    if (clientError) {
      return clientError;
    }
    const adminError = await getTenantAdminError(_user.user_id);
    if (adminError) {
      return adminError;
    }

    const parsed = apiRateLimitInputSchema.safeParse(input);
    if (!parsed.success) {
      return actionError('API rate limits must be positive whole numbers.', 'msp/profile:errors.apiKeys.rateLimitsPositive');
    }

    const row = await upsertForTenant(tenant, parsed.data);
    invalidateApiRateLimitConfig(tenant);

    return {
      maxTokens: row.maxTokens,
      refillPerMin: row.refillPerMin,
    };
  },
);

export const clearApiRateLimitForKey = withAuth(async (
  user,
  { tenant },
  apiKeyId: string,
): Promise<(ApiRateLimitSettingsView & { deleted: boolean; defaultSettings: ApiRateLimitSettingsValue }) | ApiRateLimitActionError> => {
  const clientError = clientUserPermissionError(user);
  if (clientError) {
    return clientError;
  }
  const adminError = await getTenantAdminError(user.user_id);
  if (adminError) {
    return adminError;
  }
  const keyError = await getApiKeyExistsError(tenant, apiKeyId);
  if (keyError) {
    return keyError;
  }

  const deleted = await clearApiRateLimitOverride(tenant, apiKeyId);
  invalidateApiRateLimitConfig(tenant, apiKeyId);

  return {
    deleted: deleted > 0,
    defaultSettings: DEFAULT_API_RATE_LIMIT_SETTINGS,
    ...(await buildApiRateLimitSettingsView(tenant, apiKeyId)),
  };
});
