import { Knex } from 'knex';
import { IStockLevel } from '@alga-psa/types';

/**
 * Stock-level cache helpers. `stock_movements` is the source of truth; the
 * (tenant, service_id, location_id) balance row is a maintained cache.
 */

export function availableQuantity(level: Pick<IStockLevel, 'quantity_on_hand' | 'reserved_quantity' | 'held_quantity'>): number {
  return (level.quantity_on_hand ?? 0) - (level.reserved_quantity ?? 0) - (level.held_quantity ?? 0);
}

/** Ensure a (tenant, service_id, location_id) balance row exists. No-op if present. */
export async function ensureStockLevel(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  locationId: string,
): Promise<void> {
  await trx('stock_levels')
    .insert({
      tenant,
      service_id: serviceId,
      location_id: locationId,
      quantity_on_hand: 0,
      reserved_quantity: 0,
      held_quantity: 0,
    })
    .onConflict(['tenant', 'service_id', 'location_id'])
    .ignore();
}

/** Apply a signed delta to a location's on-hand (non-serialized cache maintenance). */
export async function applyOnHandDelta(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  locationId: string,
  delta: number,
): Promise<void> {
  await ensureStockLevel(trx, tenant, serviceId, locationId);
  await trx('stock_levels')
    .where({ tenant, service_id: serviceId, location_id: locationId })
    .update({
      quantity_on_hand: trx.raw('quantity_on_hand + ?', [delta]),
      updated_at: trx.fn.now(),
    });
}

/**
 * Recompute a serialized product's on-hand at a location as the count of
 * in_stock units there. Authoritative for serialized products regardless of
 * which transition occurred.
 */
export async function recomputeSerializedOnHand(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  locationId: string,
): Promise<void> {
  const row = await trx('stock_units')
    .where({ tenant, service_id: serviceId, location_id: locationId, status: 'in_stock' })
    .count<{ c: string }>('* as c')
    .first();
  const count = Number(row?.c ?? 0);
  await ensureStockLevel(trx, tenant, serviceId, locationId);
  await trx('stock_levels')
    .where({ tenant, service_id: serviceId, location_id: locationId })
    .update({ quantity_on_hand: count, updated_at: trx.fn.now() });
}

/** Adjust a location's reserved (soft) or held (hard) allocation counter by a signed delta. */
export async function applyAllocationDelta(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  locationId: string,
  column: 'reserved_quantity' | 'held_quantity',
  delta: number,
): Promise<void> {
  await ensureStockLevel(trx, tenant, serviceId, locationId);
  await trx('stock_levels')
    .where({ tenant, service_id: serviceId, location_id: locationId })
    .update({
      [column]: trx.raw(`GREATEST(0, ${column} + ?)`, [delta]),
      updated_at: trx.fn.now(),
    });
}
