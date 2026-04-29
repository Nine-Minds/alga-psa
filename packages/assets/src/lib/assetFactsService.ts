import type { Knex } from 'knex';
import type { AssetFact, AssetFactSourceType } from '@alga-psa/types';

export interface AssetFactUpsertInput {
  tenant: string;
  assetId: string;
  sourceType: AssetFactSourceType;
  provider?: string | null;
  integrationId?: string | null;
  namespace: string;
  factKey: string;
  label: string;
  valueText?: string | null;
  valueNumber?: number | null;
  valueBool?: boolean | null;
  valueJson?: Record<string, unknown>;
  source: string;
  sourceUpdatedAt?: string | Date | null;
  lastSyncedAt?: string | Date | null;
  isAvailable: boolean;
}

function toIsoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

export async function upsertAssetFact(knex: Knex, input: AssetFactUpsertInput): Promise<void> {
  const now = knex.fn.now();
  await knex('asset_facts')
    .insert({
      tenant: input.tenant,
      asset_id: input.assetId,
      source_type: input.sourceType,
      provider: input.provider ?? null,
      integration_id: input.integrationId ?? null,
      namespace: input.namespace,
      fact_key: input.factKey,
      label: input.label,
      value_text: input.isAvailable ? input.valueText ?? null : null,
      value_number: input.isAvailable ? input.valueNumber ?? null : null,
      value_bool: input.isAvailable ? input.valueBool ?? null : null,
      value_json: input.valueJson ?? {},
      source: input.source,
      source_updated_at: input.sourceUpdatedAt ?? null,
      last_synced_at: input.lastSyncedAt ?? now,
      is_available: input.isAvailable,
      created_at: now,
      updated_at: now,
    })
    .onConflict(['tenant', 'asset_id', 'source_type', 'namespace', 'fact_key'])
    .merge({
      provider: input.provider ?? null,
      integration_id: input.integrationId ?? null,
      label: input.label,
      value_text: input.isAvailable ? input.valueText ?? null : null,
      value_number: input.isAvailable ? input.valueNumber ?? null : null,
      value_bool: input.isAvailable ? input.valueBool ?? null : null,
      value_json: input.valueJson ?? {},
      source: input.source,
      source_updated_at: input.sourceUpdatedAt ?? null,
      last_synced_at: input.lastSyncedAt ?? now,
      is_available: input.isAvailable,
      updated_at: now,
    });
}

export async function listAvailableAssetFactsForAsset(knex: Knex, args: {
  tenant: string;
  assetId: string;
}): Promise<AssetFact[]> {
  const rows = await knex('asset_facts')
    .where({
      tenant: args.tenant,
      asset_id: args.assetId,
      is_available: true,
    })
    .orderBy('namespace', 'asc')
    .orderBy('fact_key', 'asc');

  return rows.map((row: any) => ({
    asset_fact_id: row.asset_fact_id,
    tenant: row.tenant,
    asset_id: row.asset_id,
    source_type: row.source_type,
    provider: row.provider,
    integration_id: row.integration_id,
    namespace: row.namespace,
    fact_key: row.fact_key,
    label: row.label,
    value_text: row.value_text,
    value_number: row.value_number === null || typeof row.value_number === 'undefined' ? null : Number(row.value_number),
    value_bool: row.value_bool,
    value_json: row.value_json || {},
    source: row.source,
    source_updated_at: toIsoOrNull(row.source_updated_at),
    last_synced_at: toIsoOrNull(row.last_synced_at),
    is_available: Boolean(row.is_available),
    created_at: toIsoOrNull(row.created_at) || new Date(0).toISOString(),
    updated_at: toIsoOrNull(row.updated_at) || new Date(0).toISOString(),
  }));
}
