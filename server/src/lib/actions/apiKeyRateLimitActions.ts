'use server'

import { z } from 'zod';
import { createTenantKnex } from '@alga-psa/db';
import { IRole } from '@alga-psa/types';
import { TokenBucketRateLimiter } from '@alga-psa/core/rateLimit';

import { withAuth } from '@alga-psa/auth/withAuth';
import { getUserRoles } from '@alga-psa/auth/actions';
import {
  clearForKey as clearApiRateLimitOverride,
  DEFAULT_API_RATE_LIMIT_SETTINGS,
  getForKey as getApiRateLimitSettingsRow,
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

async function assertTenantAdmin(userId: string): Promise<void> {
  const userRoles = await getUserRoles(userId);
  const isAdmin = userRoles.some((role: IRole) => role.role_name.toLowerCase() === 'admin');

  if (!isAdmin) {
    throw new Error('Forbidden: Admin access required');
  }
}

async function assertApiKeyExists(tenant: string, apiKeyId: string): Promise<void> {
  const { knex } = await createTenantKnex(tenant);
  const apiKey = await knex('api_keys')
    .select('api_key_id')
    .where({ tenant, api_key_id: apiKeyId })
    .first();

  if (!apiKey) {
    throw new Error('API key not found');
  }
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

export const getApiRateLimitForKey = withAuth(async (user, { tenant }, apiKeyId: string) => {
  await assertTenantAdmin(user.user_id);
  await assertApiKeyExists(tenant, apiKeyId);
  return buildApiRateLimitSettingsView(tenant, apiKeyId);
});

export const setApiRateLimitForKey = withAuth(
  async (user, { tenant }, apiKeyId: string, input: ApiRateLimitSettingsValue) => {
    await assertTenantAdmin(user.user_id);
    await assertApiKeyExists(tenant, apiKeyId);

    const parsed = apiRateLimitInputSchema.parse(input);
    await upsertForKey(tenant, apiKeyId, parsed);
    invalidateApiRateLimitConfig(tenant, apiKeyId);

    return buildApiRateLimitSettingsView(tenant, apiKeyId);
  },
);

export const setTenantDefaultApiRateLimit = withAuth(
  async (_user, { tenant }, input: ApiRateLimitSettingsValue) => {
    await assertTenantAdmin(_user.user_id);

    const parsed = apiRateLimitInputSchema.parse(input);
    const row = await upsertForTenant(tenant, parsed);
    invalidateApiRateLimitConfig(tenant);

    return {
      maxTokens: row.maxTokens,
      refillPerMin: row.refillPerMin,
    };
  },
);

export const clearApiRateLimitForKey = withAuth(async (user, { tenant }, apiKeyId: string) => {
  await assertTenantAdmin(user.user_id);
  await assertApiKeyExists(tenant, apiKeyId);

  const deleted = await clearApiRateLimitOverride(tenant, apiKeyId);
  invalidateApiRateLimitConfig(tenant, apiKeyId);

  return {
    deleted,
    defaultSettings: DEFAULT_API_RATE_LIMIT_SETTINGS,
    ...(await buildApiRateLimitSettingsView(tenant, apiKeyId)),
  };
});
