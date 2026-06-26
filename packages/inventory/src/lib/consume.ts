import { Knex } from 'knex';
import { StockMovementSourceDocType } from '@alga-psa/types';
import { recordStockMovement } from './movements';

/**
 * Stock-consumption hook used by the billing-side materials flow (and any caller
 * that consumes a product without picking a serial). It decrements on-hand for
 * NON-serialized, track_stock products at a resolved location.
 *
 * Serialized products are skipped here (they require explicit unit/serial selection,
 * handled by the inventory fulfillment flow) — so this is a no-op for them rather
 * than guessing a unit. Returns whether a movement was recorded.
 *
 * Runs inside the caller's transaction and under the caller's permission (no extra
 * gate) — billing flows must not be double-gated on inventory permissions.
 */

export interface ConsumeOpts {
  service_id: string;
  quantity: number;
  source_doc_type: StockMovementSourceDocType;
  source_doc_id: string;
  performed_by?: string | null;
}

async function resolveSettingsAndLocation(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
): Promise<{ settings: any; locationId: string } | null> {
  const settings = await trx('product_inventory_settings').where({ tenant, service_id: serviceId }).first();
  if (!settings || !settings.track_stock || settings.is_serialized) return null;
  let locationId: string | null = settings.default_location_id || null;
  if (!locationId) {
    const def = await trx('stock_locations').where({ tenant, is_default: true }).first();
    locationId = def?.location_id || null;
  }
  if (!locationId) return null;
  return { settings, locationId };
}

export async function recordStockConsumption(
  trx: Knex.Transaction,
  tenant: string,
  opts: ConsumeOpts,
): Promise<{ consumed: boolean }> {
  const r = await resolveSettingsAndLocation(trx, tenant, opts.service_id);
  if (!r) return { consumed: false };
  await recordStockMovement(trx, tenant, {
    movement_type: 'consume',
    service_id: opts.service_id,
    quantity: opts.quantity,
    from_location_id: r.locationId,
    cogs_cost: r.settings.average_cost ?? null,
    source_doc_type: opts.source_doc_type,
    source_doc_id: opts.source_doc_id,
    performed_by: opts.performed_by ?? null,
  });
  return { consumed: true };
}

/** Restore stock for an unbilled consumption being reversed (e.g. deleting an unbilled material). */
export async function reverseStockConsumption(
  trx: Knex.Transaction,
  tenant: string,
  opts: ConsumeOpts,
): Promise<{ restored: boolean }> {
  const r = await resolveSettingsAndLocation(trx, tenant, opts.service_id);
  if (!r) return { restored: false };
  await recordStockMovement(trx, tenant, {
    movement_type: 'return_restock',
    service_id: opts.service_id,
    quantity: opts.quantity,
    to_location_id: r.locationId,
    reason: 'Reversal of unbilled consumption',
    source_doc_type: opts.source_doc_type,
    source_doc_id: opts.source_doc_id,
    performed_by: opts.performed_by ?? null,
  });
  return { restored: true };
}
