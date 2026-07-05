import { Knex } from 'knex';
import { StockMovementType } from '@alga-psa/types';
import { onHandDeltaFor } from './movements';
import { ensureStockLevel } from './levels';

/**
 * Reconciliation: recompute a product's stock_levels cache across all locations from
 * the sources of truth, and write the corrected cache. Used by tests (cache == replay)
 * and by the admin "Rebuild stock caches" repair action (F027/F028).
 *
 * - Serialized products: on-hand = count of in_stock units per location.
 * - Non-serialized products: on-hand = sum of signed movement deltas per location.
 * - reserved/held counters: sum of open sales-order lines' quantity_reserved grouped
 *   by reserved_location_id and the SO's allocation_mode. (Serialized claims live on
 *   stock_units.allocated_so_line_id, so their counters recompute to 0.)
 */
export interface ReconciledOnHand {
  location_id: string;
  quantity_on_hand: number;
}

export interface ReconciledLevel extends ReconciledOnHand {
  reserved_quantity: number;
  held_quantity: number;
}

/**
 * Recompute the reserved/held allocation counters per location from live open SO
 * lines (F027). Lines on draft/cancelled/closed/fulfilled orders count as zero, so
 * any drift on them is cleared by the write-back.
 */
export async function computeAllocationsFromTruth(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  isSerialized: boolean,
): Promise<Map<string, { reserved: number; held: number }>> {
  const totals = new Map<string, { reserved: number; held: number }>();
  if (isSerialized) return totals;

  const rows = (await trx('sales_order_lines as sol')
    .join('sales_orders as so', function () {
      this.on('sol.so_id', '=', 'so.so_id').andOn('sol.tenant', '=', 'so.tenant');
    })
    .where('sol.tenant', tenant)
    .andWhere('sol.service_id', serviceId)
    .whereIn('so.status', ['confirmed', 'partially_fulfilled'])
    .andWhere('sol.quantity_reserved', '>', 0)
    .whereNotNull('sol.reserved_location_id')
    .groupBy('sol.reserved_location_id', 'so.allocation_mode')
    .select('sol.reserved_location_id as location_id', 'so.allocation_mode')
    .sum({ q: 'sol.quantity_reserved' })) as Array<{ location_id: string; allocation_mode: string; q: string }>;

  for (const r of rows) {
    const cur = totals.get(r.location_id) ?? { reserved: 0, held: 0 };
    if (r.allocation_mode === 'hard') cur.held += Number(r.q);
    else cur.reserved += Number(r.q);
    totals.set(r.location_id, cur);
  }
  return totals;
}

export async function computeOnHandFromTruth(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  isSerialized: boolean,
): Promise<ReconciledOnHand[]> {
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
  const onHand = await computeOnHandFromTruth(trx, tenant, serviceId, isSerialized);
  const allocations = await computeAllocationsFromTruth(trx, tenant, serviceId, isSerialized);

  // The write-back covers the union of computed locations and existing cache rows,
  // so stale rows (locations no longer holding stock or claims) are zeroed too.
  const onHandByLocation = new Map(onHand.map((c) => [c.location_id, c.quantity_on_hand]));
  const locations = new Set<string>([...onHandByLocation.keys(), ...allocations.keys()]);
  const existing = await trx('stock_levels')
    .where({ tenant, service_id: serviceId })
    .select('location_id');
  for (const e of existing) locations.add(e.location_id);

  const result: ReconciledLevel[] = [];
  for (const locationId of locations) {
    const level: ReconciledLevel = {
      location_id: locationId,
      quantity_on_hand: onHandByLocation.get(locationId) ?? 0,
      reserved_quantity: allocations.get(locationId)?.reserved ?? 0,
      held_quantity: allocations.get(locationId)?.held ?? 0,
    };
    await ensureStockLevel(trx, tenant, serviceId, locationId);
    await trx('stock_levels')
      .where({ tenant, service_id: serviceId, location_id: locationId })
      .update({
        quantity_on_hand: level.quantity_on_hand,
        reserved_quantity: level.reserved_quantity,
        held_quantity: level.held_quantity,
        updated_at: trx.fn.now(),
      });
    result.push(level);
  }

  return result;
}
