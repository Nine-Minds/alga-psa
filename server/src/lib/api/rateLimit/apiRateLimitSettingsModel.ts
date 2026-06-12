import { getConnection } from '@/lib/db/db';
import type { BucketConfig } from '@alga-psa/core/rateLimit';

const TABLE_NAME = 'api_rate_limit_settings';

export interface ApiRateLimitSettingsRow {
  tenant: string;
  apiKeyId: string | null;
  maxTokens: number;
  refillPerMin: number;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_API_RATE_LIMIT_SETTINGS = {
  maxTokens: 120,
  refillPerMin: 60,
} as const;

export const DEFAULT_API_RATE_LIMIT_CONFIG: BucketConfig = {
  maxTokens: DEFAULT_API_RATE_LIMIT_SETTINGS.maxTokens,
  refillRate: DEFAULT_API_RATE_LIMIT_SETTINGS.refillPerMin / 60,
};

function mapRow(row: any): ApiRateLimitSettingsRow {
  return {
    tenant: row.tenant,
    apiKeyId: row.api_key_id ?? null,
    maxTokens: row.max_tokens,
    refillPerMin: row.refill_per_min,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toBucketConfig(row: ApiRateLimitSettingsRow): BucketConfig {
  return {
    maxTokens: row.maxTokens,
    refillRate: row.refillPerMin / 60,
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// api_key_id is a uuid column; querying it with a non-uuid string (e.g. the
// 'nm_store' bucket sentinel) raises a Postgres cast error that surfaces as a
// 500. Treat non-uuid keys as "no per-key override" instead.
function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

async function loadForKey(
  tenant: string,
  apiKeyId?: string | null,
): Promise<ApiRateLimitSettingsRow | null> {
  const knex = await getConnection(tenant);
  const query = knex(TABLE_NAME)
    .where({ tenant })
    .first();

  if (apiKeyId == null) {
    query.whereNull('api_key_id');
  } else {
    query.where({ api_key_id: apiKeyId });
  }

  const row = await query;
  return row ? mapRow(row) : null;
}

async function loadForKeys(
  tenant: string,
  apiKeyIds: string[],
): Promise<{
  overrides: Map<string, ApiRateLimitSettingsRow>;
  tenantDefault: ApiRateLimitSettingsRow | null;
}> {
  const knex = await getConnection(tenant);
  const rows = await knex(TABLE_NAME)
    .where({ tenant })
    .andWhere((builder) => {
      builder.whereNull('api_key_id');
      if (apiKeyIds.length > 0) {
        builder.orWhereIn('api_key_id', apiKeyIds);
      }
    });

  const overrides = new Map<string, ApiRateLimitSettingsRow>();
  let tenantDefault: ApiRateLimitSettingsRow | null = null;

  for (const raw of rows) {
    const mapped = mapRow(raw);
    if (mapped.apiKeyId == null) {
      tenantDefault = mapped;
    } else {
      overrides.set(mapped.apiKeyId, mapped);
    }
  }

  return { overrides, tenantDefault };
}

export const apiRateLimitSettingsReadOps = {
  getForKey: loadForKey,
  getForKeys: loadForKeys,
};

export async function getForKey(
  tenant: string,
  apiKeyId?: string | null,
): Promise<ApiRateLimitSettingsRow | null> {
  return apiRateLimitSettingsReadOps.getForKey(tenant, apiKeyId);
}

export async function getForKeys(
  tenant: string,
  apiKeyIds: string[],
): Promise<{
  overrides: Map<string, ApiRateLimitSettingsRow>;
  tenantDefault: ApiRateLimitSettingsRow | null;
}> {
  return apiRateLimitSettingsReadOps.getForKeys(tenant, apiKeyIds);
}

export async function upsertForKey(
  tenant: string,
  apiKeyId: string,
  input: { maxTokens: number; refillPerMin: number },
): Promise<ApiRateLimitSettingsRow> {
  const knex = await getConnection(tenant);

  const [row] = await knex(TABLE_NAME)
    .insert({
      tenant,
      api_key_id: apiKeyId,
      max_tokens: input.maxTokens,
      refill_per_min: input.refillPerMin,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    })
    .onConflict(['tenant', 'api_key_id'])
    .merge({
      max_tokens: input.maxTokens,
      refill_per_min: input.refillPerMin,
      updated_at: new Date().toISOString(),
    })
    .returning('*');

  return mapRow(row);
}

export async function upsertForTenant(
  tenant: string,
  input: { maxTokens: number; refillPerMin: number },
): Promise<ApiRateLimitSettingsRow> {
  const knex = await getConnection(tenant);

  return knex.transaction(async (trx) => {
    const existing = await trx(TABLE_NAME)
      .where({ tenant })
      .whereNull('api_key_id')
      .first();

    if (existing) {
      const [updated] = await trx(TABLE_NAME)
        .where({ tenant })
        .whereNull('api_key_id')
        .update({
          max_tokens: input.maxTokens,
          refill_per_min: input.refillPerMin,
          updated_at: trx.fn.now(),
        })
        .returning('*');

      return mapRow(updated);
    }

    const [created] = await trx(TABLE_NAME)
      .insert({
        tenant,
        api_key_id: null,
        max_tokens: input.maxTokens,
        refill_per_min: input.refillPerMin,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning('*');

    return mapRow(created);
  });
}

export async function clearForKey(tenant: string, apiKeyId: string): Promise<number> {
  const knex = await getConnection(tenant);

  return knex(TABLE_NAME)
    .where({ tenant, api_key_id: apiKeyId })
    .del();
}

export async function resolveApiRateLimitConfig(
  tenant: string,
  apiKeyId?: string,
): Promise<BucketConfig> {
  if (apiKeyId && isUuid(apiKeyId)) {
    const perKey = await apiRateLimitSettingsReadOps.getForKey(tenant, apiKeyId);
    if (perKey) {
      return toBucketConfig(perKey);
    }
  }

  const tenantDefault = await apiRateLimitSettingsReadOps.getForKey(tenant, null);
  if (tenantDefault) {
    return toBucketConfig(tenantDefault);
  }

  return DEFAULT_API_RATE_LIMIT_CONFIG;
}
