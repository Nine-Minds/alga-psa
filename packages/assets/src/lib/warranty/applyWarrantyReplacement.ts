import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Apply a vendor replacement to the SAME asset row (C5 invariant 2): one client device, one asset id.
 * The previous serial / model / manufacturer / warranty end date stay in `asset_history` (and the RMA's
 * `rma_events`), so nothing is lost by updating in place.
 *
 * Writes `assets` and `asset_history` only — never stock, service or billing tables. The caller owns
 * permission checks and the post-commit ASSET_UPDATED publish (see `changedPaths`).
 */
export interface WarrantyReplacementInput {
  assetId: string;
  serialNumber: string;
  model?: string | null;
  manufacturer?: string | null;
  /** `YYYY-MM-DD`. Omitted/null leaves the existing date alone. */
  warrantyEndDate?: string | null;
  rmaId: string;
  rmaNumber: string;
  actorUserId: string;
}

export interface WarrantyReplacementResult {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  changedPaths: string[];
}

const TRACKED = ['serial_number', 'model', 'manufacturer', 'warranty_end_date'] as const;

const dateOnly = (v: unknown): string | null => {
  if (v == null) return null;
  // timestamptz at UTC midnight: use UTC calendar parts so the date doesn't shift on non-UTC hosts.
  // LEVERAGE: pattern utc-calendar-date — Date -> UTC YYYY-MM-DD also lives in warrantyReads.getAssetWarrantySummary
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
};

export async function applyWarrantyReplacement(
  trx: Knex.Transaction,
  tenant: string,
  input: WarrantyReplacementInput
): Promise<WarrantyReplacementResult> {
  const db = tenantDb(trx, tenant);
  const asset = await db
    .table('assets')
    .where({ asset_id: input.assetId })
    .forUpdate()
    .select('asset_id', 'serial_number', 'model', 'manufacturer', 'warranty_end_date')
    .first();
  if (!asset) throw new Error('Asset not found');

  const before: Record<string, unknown> = {
    serial_number: asset.serial_number ?? null,
    model: asset.model ?? null,
    manufacturer: asset.manufacturer ?? null,
    warranty_end_date: dateOnly(asset.warranty_end_date),
  };
  const after: Record<string, unknown> = {
    serial_number: input.serialNumber.trim(),
    model: input.model ?? before.model,
    manufacturer: input.manufacturer ?? before.manufacturer,
    warranty_end_date: input.warrantyEndDate ?? before.warranty_end_date,
  };
  const changedPaths = TRACKED.filter((k) => before[k] !== after[k]);

  if (changedPaths.length > 0) {
    const patch: Record<string, unknown> = { updated_at: trx.fn.now() };
    for (const k of changedPaths) patch[k] = after[k];
    await db.table('assets').where({ asset_id: input.assetId }).update(patch);
  }

  // Always write the history row: a replacement that happens to keep the same serial is still an event.
  await db.table('asset_history').insert({
    tenant,
    asset_id: input.assetId,
    changed_by: input.actorUserId,
    change_type: 'warranty_replacement',
    changes: JSON.stringify({
      rma_id: input.rmaId,
      rma_number: input.rmaNumber,
      before: Object.fromEntries(TRACKED.map((k) => [k, before[k]])),
      after: Object.fromEntries(TRACKED.map((k) => [k, after[k]])),
    }),
    changed_at: new Date().toISOString(),
  });

  return { before, after, changedPaths: [...changedPaths] };
}
