import { getConnection } from '@/lib/db/db';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { BucketConfig } from '@alga-psa/core/rateLimit';

const TABLE_NAME = 'api_rate_limit_settings';

interface ApiRateLimitSettingsDbRow {
  tenant: string;
  api_key_id: string | null;
  max_tokens: number;
  refill_per_min: number;
  created_at: Date;
  updated_at: Date;
}

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

function mapRow(row: ApiRateLimitSettingsDbRow): ApiRateLimitSettingsRow {
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
  const query = tenantDb(knex, tenant).table<ApiRateLimitSettingsDbRow>(TABLE_NAME);

  if (apiKeyId == null) {
    query.whereNull('api_key_id');
  } else {
    query.where({ api_key_id: apiKeyId });
  }

  const row = await query.first();
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
  const rows = await tenantDb(knex, tenant).table<ApiRateLimitSettingsDbRow>(TABLE_NAME)
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

  const [row] = await (tenantDb(knex, tenant).table<ApiRateLimitSettingsDbRow>(TABLE_NAME) as unknown as Knex.QueryBuilder)
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
    .returning('*') as unknown as ApiRateLimitSettingsDbRow[];

  return mapRow(row);
}

export async function upsertForTenant(
  tenant: string,
  input: { maxTokens: number; refillPerMin: number },
): Promise<ApiRateLimitSettingsRow> {
  const knex = await getConnection(tenant);

  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    const existing = await db.table<ApiRateLimitSettingsDbRow>(TABLE_NAME)
      .whereNull('api_key_id')
      .first();

    if (existing) {
      const [updated] = await db.table<ApiRateLimitSettingsDbRow>(TABLE_NAME)
        .whereNull('api_key_id')
        .update({
          max_tokens: input.maxTokens,
          refill_per_min: input.refillPerMin,
          updated_at: trx.fn.now(),
        })
        .returning('*');

      return mapRow(updated);
    }

    const [created] = await db.table<ApiRateLimitSettingsDbRow>(TABLE_NAME)
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

  return tenantDb(knex, tenant).table<ApiRateLimitSettingsDbRow>(TABLE_NAME)
    .where({ api_key_id: apiKeyId })
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
