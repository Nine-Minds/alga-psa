import { Knex } from 'knex';
import {
  IStockMovement,
  IStockUnit,
  StockMovementType,
  StockMovementSourceDocType,
} from '@alga-psa/types';
import { applyOnHandDelta, recomputeSerializedOnHand } from './levels';

/**
 * The movement primitive — the single chokepoint every inventory flow writes through.
 *
 * It (1) appends an immutable stock_movements row, (2) optionally patches the unit,
 * and (3) keeps the stock_levels on-hand cache consistent, all inside the caller's
 * transaction. For serialized units the on-hand cache is RECOMPUTED from in_stock unit
 * counts (authoritative); for non-serialized products a signed delta is applied per
 * movement type.
 */

export interface RecordMovementInput {
  movement_type: StockMovementType;
  service_id: string;
  quantity: number;
  unit_id?: string | null;
  from_location_id?: string | null;
  to_location_id?: string | null;
  unit_cost?: number | null;
  cost_currency?: string | null;
  cogs_cost?: number | null;
  reason?: string | null;
  source_doc_type?: StockMovementSourceDocType | null;
  source_doc_id?: string | null;
  performed_by?: string | null;
  /** Columns to set on the serialized unit (status, location_id, client_id, etc.) in the same txn. */
  unitPatch?: Partial<IStockUnit>;
}

// Movement types that ADD to the destination location's on-hand (non-serialized).
const TO_PLUS: ReadonlySet<StockMovementType> = new Set([
  'receipt',
  'transfer_in',
  'return_restock',
  'rma_in',
  'loan_in',
]);

// Movement types that REMOVE from the source location's on-hand (non-serialized).
const FROM_MINUS: ReadonlySet<StockMovementType> = new Set([
  'consume',
  'transfer_out',
  'loan_out',
  'retire',
]);

// 'return_defective' and 'rma_out' intentionally do not touch sellable on-hand:
// the unit is not sellable while returned/in-RMA.

export async function recordStockMovement(
  trx: Knex.Transaction,
  tenant: string,
  input: RecordMovementInput,
): Promise<IStockMovement> {
  const [movement] = await trx('stock_movements')
    .insert({
      tenant,
      movement_type: input.movement_type,
      service_id: input.service_id,
      unit_id: input.unit_id ?? null,
      from_location_id: input.from_location_id ?? null,
      to_location_id: input.to_location_id ?? null,
      quantity: input.quantity,
      unit_cost: input.unit_cost ?? null,
      cost_currency: input.cost_currency ?? null,
      cogs_cost: input.cogs_cost ?? null,
      reason: input.reason ?? null,
      source_doc_type: input.source_doc_type ?? null,
      source_doc_id: input.source_doc_id ?? null,
      performed_by: input.performed_by ?? null,
    })
    .returning('*');

  // Apply unit patch (status + location/client/asset/etc.) before recomputing serialized counts.
  if (input.unit_id && input.unitPatch && Object.keys(input.unitPatch).length > 0) {
    await trx('stock_units')
      .where({ tenant, unit_id: input.unit_id })
      .update({ ...input.unitPatch, updated_at: trx.fn.now() });
  }

  if (input.unit_id) {
    // Serialized: recompute on-hand at each touched location from in_stock counts.
    const locations = new Set<string>();
    if (input.from_location_id) locations.add(input.from_location_id);
    if (input.to_location_id) locations.add(input.to_location_id);
    for (const loc of locations) {
      await recomputeSerializedOnHand(trx, tenant, input.service_id, loc);
    }
  } else {
    // Non-serialized: apply signed deltas per movement type.
    const type = input.movement_type;
    if (TO_PLUS.has(type) && input.to_location_id) {
      await applyOnHandDelta(trx, tenant, input.service_id, input.to_location_id, input.quantity);
    } else if (FROM_MINUS.has(type) && input.from_location_id) {
      await applyOnHandDelta(trx, tenant, input.service_id, input.from_location_id, -input.quantity);
    } else if (type === 'adjust') {
      if (input.to_location_id) {
        await applyOnHandDelta(trx, tenant, input.service_id, input.to_location_id, input.quantity);
      }
      if (input.from_location_id) {
        await applyOnHandDelta(trx, tenant, input.service_id, input.from_location_id, -input.quantity);
      }
    }
  }

  return movement as IStockMovement;
}

/** Signed on-hand delta a movement type implies for a given direction (used by reconcile). */
export function onHandDeltaFor(type: StockMovementType): { to: number; from: number } {
  if (TO_PLUS.has(type)) return { to: 1, from: 0 };
  if (FROM_MINUS.has(type)) return { to: 0, from: -1 };
  if (type === 'adjust') return { to: 1, from: -1 };
  return { to: 0, from: 0 }; // return_defective, rma_out
}
