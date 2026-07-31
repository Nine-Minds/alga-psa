import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { GeneratedSuggestion, SuggestionGenerator } from './types';

interface AgingAssetRow {
  asset_id: string;
  client_id: string;
  client_name: string;
  default_currency_code: string;
  name: string;
  purchase_date: Date | string | null;
  warranty_end_date: Date | string | null;
  attributes: Record<string, unknown> | null;
  is_eol: boolean | string | null;
}

function completedYears(anchor: Date, now: Date): number {
  let years = now.getUTCFullYear() - anchor.getUTCFullYear();
  if (
    now.getUTCMonth() < anchor.getUTCMonth()
    || (now.getUTCMonth() === anchor.getUTCMonth() && now.getUTCDate() < anchor.getUTCDate())
  ) years -= 1;
  return Math.max(0, years);
}

export async function buildAssetAgingSuggestions(
  knex: Knex,
  tenant: string,
  ageYears: number,
  now = new Date(),
): Promise<GeneratedSuggestion[]> {
  const cutoff = new Date(Date.UTC(
    now.getUTCFullYear() - ageYears,
    now.getUTCMonth(),
    now.getUTCDate(),
  )).toISOString();
  const db = tenantDb(knex, tenant);
  const query = db.table('assets as a');
  db.tenantJoin(query, 'clients as c', 'a.client_id', 'c.client_id');
  db.tenantJoin(query, 'workstation_assets as wa', 'a.asset_id', 'wa.asset_id', { type: 'left' });
  db.tenantJoin(query, 'server_assets as sa', 'a.asset_id', 'sa.asset_id', { type: 'left' });
  const rows = await query
    .where({ 'c.is_inactive': false })
    .andWhere((builder) => {
      builder
        .where('a.purchase_date', '<=', cutoff)
        .orWhere((fallback) => fallback
          .whereNull('a.purchase_date')
          .where('a.warranty_end_date', '<=', cutoff))
        .orWhereRaw(`LOWER(COALESCE(
          a.attributes->>'os_end_of_life',
          a.attributes->>'end_of_life',
          wa.system_info->>'osEndOfLife',
          sa.system_info->>'osEndOfLife',
          'false'
        )) IN ('true', '1', 'yes')`);
    })
    .select(
      'a.asset_id',
      'a.client_id',
      'a.name',
      'a.purchase_date',
      'a.warranty_end_date',
      'a.attributes',
      knex.raw(`COALESCE(
        a.attributes->>'os_end_of_life',
        a.attributes->>'end_of_life',
        wa.system_info->>'osEndOfLife',
        sa.system_info->>'osEndOfLife',
        'false'
      ) AS is_eol`),
      'c.client_name',
      'c.default_currency_code',
    ) as AgingAssetRow[];

  const byClient = new Map<string, AgingAssetRow[]>();
  for (const row of rows) {
    const current = byClient.get(row.client_id) ?? [];
    current.push(row);
    byClient.set(row.client_id, current);
  }

  return [...byClient.values()].map((assets) => {
    const evidenceAssets = assets.map((asset) => {
      const usesPurchaseDate = Boolean(asset.purchase_date);
      const anchorValue = asset.purchase_date ?? asset.warranty_end_date;
      const anchor = anchorValue instanceof Date
        ? anchorValue
        : anchorValue
          ? new Date(String(anchorValue))
          : null;
      const isEol = ['true', '1', 'yes'].includes(String(asset.is_eol ?? false).toLowerCase());
      return {
        asset_id: asset.asset_id,
        name: asset.name,
        age_years: anchor ? completedYears(anchor, now) : 0,
        age_source: anchor ? (usesPurchaseDate ? 'purchase_date' : 'warranty_end_date') : 'not_available',
        is_eol: isEol,
      };
    }).sort((left, right) => right.age_years - left.age_years);
    const first = assets[0];
    return {
      client_id: first.client_id,
      title: `${first.client_name} asset refresh`,
      evidence: {
        assets: evidenceAssets,
        asset_ids: evidenceAssets.map((asset) => asset.asset_id),
        count: evidenceAssets.length,
        asset_count: evidenceAssets.length,
        oldest_years: evidenceAssets[0]?.age_years ?? ageYears,
      },
      mrr_cents: 0,
      nrr_cents: 0,
      currency_code: first.default_currency_code,
      dedupe_key: `asset_aging:${first.client_id}:${now.getUTCFullYear()}`,
    };
  });
}

export const assetAgingGenerator: SuggestionGenerator = {
  key: 'asset_aging',
  run: ({ knex, tenant, settings }) => buildAssetAgingSuggestions(
    knex,
    tenant,
    settings.asset_age_years,
  ),
};
