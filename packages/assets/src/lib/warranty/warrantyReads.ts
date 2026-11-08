import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { RmaStatus } from '@alga-psa/types';
import {
  createAssetReadContext,
  filterReadableAssets,
  isAssetReadAllowed,
  type AssetAuthUser,
} from '../assetReadAuthorization';

/**
 * Read models the asset screens use for warranty (C5). `rma_cases` is inventory's table, read here for
 * display only. Every read applies C4's record-level asset check: an asset the caller cannot read answers
 * as if it had no claims.
 */
export interface AssetRmaBadge {
  asset_id: string;
  rma_id: string;
  rma_number: string;
  status: RmaStatus;
}

export interface AssetWarrantyClaimRow {
  rma_id: string;
  rma_number: string;
  status: RmaStatus;
  rma_type: 'standard' | 'advance_replacement';
  warranty_outcome: string | null;
  vendor_name: string | null;
  rma_reference: string | null;
  return_by: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface AssetWarrantySummary {
  asset_id: string;
  ownership: 'client' | 'msp';
  /** True when the asset is tied to a stock unit, so claims go through the stock-unit RMA flow instead. */
  stock_tracked: boolean;
  warranty_end_date: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  claims: AssetWarrantyClaimRow[];
  open_claim: AssetWarrantyClaimRow | null;
}

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

/** Open (non-closed) claim per asset, for chips on the asset list and a ticket's associated assets. */
export async function getRmaBadgesForAssets(
  knex: Knex | Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  assetIds: readonly string[]
): Promise<AssetRmaBadge[]> {
  const ids = Array.from(new Set(assetIds)).slice(0, 500);
  if (ids.length === 0) return [];
  const rows = await tenantDb(knex, tenant)
    .table('rma_cases')
    .whereIn('asset_id', ids)
    .whereNull('returned_unit_id')
    .whereNot('status', 'closed')
    .orderBy('opened_at', 'desc')
    .select('asset_id', 'rma_id', 'rma_number', 'status');
  if (rows.length === 0) return [];
  const assets = await tenantDb(knex, tenant)
    .table('assets')
    .whereIn('asset_id', Array.from(new Set(rows.map((r: any) => r.asset_id))))
    .select<Array<{ asset_id: string; client_id: string }>>('asset_id', 'client_id');
  const ctx = await createAssetReadContext(knex, tenant, user);
  const readable = new Set((await filterReadableAssets(knex, tenant, ctx, assets)).map((a) => a.asset_id));
  const seen = new Set<string>();
  const out: AssetRmaBadge[] = [];
  for (const r of rows as any[]) {
    if (!readable.has(r.asset_id) || seen.has(r.asset_id)) continue; // newest open claim wins
    seen.add(r.asset_id);
    out.push({ asset_id: r.asset_id, rma_id: r.rma_id, rma_number: r.rma_number, status: r.status });
  }
  return out;
}

/** The asset's Warranty card: dates, vendor, and every claim (asset-only and stock-unit alike), or null if unreadable. */
export async function getAssetWarrantySummary(
  knex: Knex | Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  assetId: string
): Promise<AssetWarrantySummary | null> {
  const db = tenantDb(knex, tenant);
  const asset = await db
    .table('assets')
    .where({ asset_id: assetId })
    .select('asset_id', 'client_id', 'ownership', 'stock_unit_id', 'warranty_end_date', 'vendor_id')
    .first();
  if (!asset) return null;
  const ctx = await createAssetReadContext(knex, tenant, user);
  if (!(await isAssetReadAllowed(knex, tenant, ctx, asset))) return null;

  const vendor = asset.vendor_id
    ? await db.table('vendors').where({ vendor_id: asset.vendor_id }).select('vendor_name').first()
    : null;
  const rows = await db
    .table('rma_cases as r')
    .leftJoin('vendors as v', function joinVendor() {
      this.on('v.tenant', 'r.tenant').andOn('v.vendor_id', 'r.vendor_id');
    })
    .where({ 'r.asset_id': assetId })
    .orderBy('r.opened_at', 'desc')
    .select(
      'r.rma_id', 'r.rma_number', 'r.status', 'r.rma_type', 'r.warranty_outcome', 'r.rma_reference',
      knex.raw("to_char(r.return_by, 'YYYY-MM-DD') as return_by"),
      'r.opened_at', 'r.closed_at', 'v.vendor_name'
    );
  const claims: AssetWarrantyClaimRow[] = rows.map((r: any) => ({
    rma_id: r.rma_id,
    rma_number: r.rma_number,
    status: r.status,
    rma_type: r.rma_type,
    warranty_outcome: r.warranty_outcome ?? null,
    vendor_name: r.vendor_name ?? null,
    rma_reference: r.rma_reference ?? null,
    return_by: r.return_by ?? null,
    opened_at: iso(r.opened_at)!,
    closed_at: iso(r.closed_at),
  }));
  const wed = asset.warranty_end_date;
  return {
    asset_id: assetId,
    ownership: asset.ownership,
    stock_tracked: Boolean(asset.stock_unit_id),
    // assets.warranty_end_date is timestamptz at UTC midnight: read the calendar date in UTC, not host-local.
    // LEVERAGE: pattern utc-calendar-date — Date -> UTC YYYY-MM-DD also lives in applyWarrantyReplacement.dateOnly
    warranty_end_date:
      wed == null ? null : wed instanceof Date
        ? `${wed.getUTCFullYear()}-${String(wed.getUTCMonth() + 1).padStart(2, '0')}-${String(wed.getUTCDate()).padStart(2, '0')}`
        : String(wed).slice(0, 10),
    vendor_id: asset.vendor_id ?? null,
    vendor_name: vendor?.vendor_name ?? null,
    claims,
    open_claim: claims.find((c) => c.status !== 'closed') ?? null,
  };
}
