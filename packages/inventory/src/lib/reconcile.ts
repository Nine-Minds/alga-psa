import { Knex } from 'knex';
import { StockMovementType } from '@alga-psa/types';
import { onHandDeltaFor } from './movements';
import { ensureStockLevel } from './levels';

/**
 * Reconciliation: recompute on-hand for a product across all locations from the
 * source of truth, and (optionally) write the corrected cache. Used by tests
 * (cache == replay) and for repair.
 *
 * - Serialized products: on-hand = count of in_stock units per location.
 * - Non-serialized products: on-hand = sum of signed movement deltas per location.
 *
 * Reserved/held allocation counters are NOT derivable from movements and are left untouched.
 */
export interface ReconciledLevel {
  location_id: string;
  quantity_on_hand: number;
}

export async function computeOnHandFromTruth(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  isSerialized: boolean,
): Promise<ReconciledLevel[]> {
  const totals = new Map<string, number>();

  if (isSerialized) {
    const rows = await trx('stock_units')
      .where({ tenant, service_id: serviceId, status: 'in_stock' })
      .whereNotNull('location_id')
      .groupBy('location_id')
      .select('location_id')
      .count<{ location_id: string; c: string }[]>('* as c');
    for (const r of rows) totals.set(r.location_id, Number(r.c));
  } else {
    const movements = await trx('stock_movements')
      .where({ tenant, service_id: serviceId })
      .select('movement_type', 'from_location_id', 'to_location_id', 'quantity');
    for (const m of movements) {
      const delta = onHandDeltaFor(m.movement_type as StockMovementType);
      if (delta.to !== 0 && m.to_location_id) {
        totals.set(m.to_location_id, (totals.get(m.to_location_id) ?? 0) + delta.to * Number(m.quantity));
      }
      if (delta.from !== 0 && m.from_location_id) {
        totals.set(m.from_location_id, (totals.get(m.from_location_id) ?? 0) + delta.from * Number(m.quantity));
      }
    }
  }

  return Array.from(totals.entries()).map(([location_id, quantity_on_hand]) => ({ location_id, quantity_on_hand }));
}

export async function reconcileStockLevels(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  isSerialized: boolean,
): Promise<ReconciledLevel[]> {
  const computed = await computeOnHandFromTruth(trx, tenant, serviceId, isSerialized);

  // Zero out any existing cache rows not present in the computed set, then write computed values.
  const computedLocations = new Set(computed.map((c) => c.location_id));
  const existing = await trx('stock_levels')
    .where({ tenant, service_id: serviceId })
    .select('location_id');
  for (const e of existing) {
    if (!computedLocations.has(e.location_id)) {
      await trx('stock_levels')
        .where({ tenant, service_id: serviceId, location_id: e.location_id })
        .update({ quantity_on_hand: 0, updated_at: trx.fn.now() });
    }
  }

  for (const c of computed) {
    await ensureStockLevel(trx, tenant, serviceId, c.location_id);
    await trx('stock_levels')
      .where({ tenant, service_id: serviceId, location_id: c.location_id })
      .update({ quantity_on_hand: c.quantity_on_hand, updated_at: trx.fn.now() });
  }

  return computed;
}
