import { Knex } from 'knex';
import { StockMovementSourceDocType } from '@alga-psa/types';
import { recordStockMovement } from './movements';
import { ensureStockLevel } from './levels';
import { PendingAssetLink } from './assetLink';

/**
 * Stock-consumption hook used by the billing-side materials flow (and any caller
 * that consumes a product). It decrements on-hand inside the caller's transaction
 * and under the caller's permission (no extra gate).
 *
 * - Non-serialized track_stock products: decrement quantity at the product's
 *   default (or tenant default) location.
 * - Serialized track_stock products: deliver the SPECIFIC picked unit (unit_id);
 *   if no unit is picked, it's a no-op (the UI surfaces a serial picker).
 *
 * Returns whether a movement was recorded.
 */

export interface ConsumeOpts {
  service_id: string;
  quantity: number;
  source_doc_type: StockMovementSourceDocType;
  source_doc_id: string;
  performed_by?: string | null;
  /** Serialized: the specific in_stock unit to deliver. */
  unit_id?: string | null;
  /** Owner recorded on the delivered unit. */
  client_id?: string | null;
}

/**
 * Consumption would drive on-hand negative (or the picked unit / location is not
 * consumable). Adjustments, counts, and receiving are the correction paths and are
 * NOT guarded (F015) — negative on-hand corrupts COGS layering, so only `consume`
 * refuses (F014, decision D1).
 */
export class InsufficientStockError extends Error {
  constructor(message: string, public readonly available: number) {
    super(message);
    this.name = 'InsufficientStockError';
  }
}

async function serviceName(trx: Knex.Transaction, tenant: string, serviceId: string): Promise<string> {
  const svc = await trx('service_catalog').where({ tenant, service_id: serviceId }).select('service_name').first();
  return svc?.service_name ?? 'product';
}

async function loadTrackedSettings(trx: Knex.Transaction, tenant: string, serviceId: string): Promise<any | null> {
  const settings = await trx('product_inventory_settings').where({ tenant, service_id: serviceId }).first();
  return settings && settings.track_stock ? settings : null;
}

async function resolveLocation(trx: Knex.Transaction, tenant: string, settings: any): Promise<string | null> {
  let loc: string | null = settings.default_location_id || null;
  if (!loc) {
    const def = await trx('stock_locations').where({ tenant, is_default: true }).first();
    loc = def?.location_id || null;
  }
  return loc;
}

export interface ConsumeResult {
  consumed: boolean;
  /**
   * Set when the delivered serialized unit should get a managed asset
   * (creates_asset_on_delivery — F044). The CALLER must run
   * createAndLinkDeliveredAsset AFTER its transaction commits (F029: creating the
   * asset mid-transaction orphans it if the caller rolls back).
   */
  pending_asset_link?: PendingAssetLink | null;
}

export async function recordStockConsumption(
  trx: Knex.Transaction,
  tenant: string,
  opts: ConsumeOpts,
): Promise<ConsumeResult> {
  const settings = await loadTrackedSettings(trx, tenant, opts.service_id);
  if (!settings) return { consumed: false };

  if (settings.is_serialized) {
    if (!opts.unit_id) return { consumed: false }; // serialized requires a picked unit (canonical materials layer validates)
    const unit = await trx('stock_units').where({ tenant, unit_id: opts.unit_id }).first();
    if (!unit || unit.service_id !== opts.service_id || unit.status !== 'in_stock') {
      throw new InsufficientStockError(
        `The selected unit of ${await serviceName(trx, tenant, opts.service_id)} is no longer in stock.`,
        0,
      );
    }
    await recordStockMovement(trx, tenant, {
      movement_type: 'consume',
      service_id: opts.service_id,
      quantity: 1,
      from_location_id: unit.location_id,
      unit_id: opts.unit_id,
      cogs_cost: unit.unit_cost ?? null,
      source_doc_type: opts.source_doc_type,
      source_doc_id: opts.source_doc_id,
      performed_by: opts.performed_by ?? null,
      unitPatch: { status: 'delivered', client_id: opts.client_id ?? null, delivered_at: trx.fn.now() as any, location_id: null },
    });

    // The ticket/project install path is the most common MSP hardware touch — it
    // must create the managed asset exactly like SO fulfillment does (F044).
    let pendingAssetLink: PendingAssetLink | null = null;
    if (settings.creates_asset_on_delivery && opts.client_id) {
      const svc = await trx('service_catalog')
        .where({ tenant, service_id: opts.service_id })
        .select('service_name')
        .first();
      const delivered = await trx('stock_units').where({ tenant, unit_id: opts.unit_id }).first();
      pendingAssetLink = {
        unit: delivered,
        serviceId: opts.service_id,
        serviceName: svc?.service_name ?? '',
        clientId: opts.client_id,
      };
    }
    return { consumed: true, pending_asset_link: pendingAssetLink };
  }

  const loc = await resolveLocation(trx, tenant, settings);
  if (!loc) {
    throw new InsufficientStockError(
      `No stock location is configured for ${await serviceName(trx, tenant, opts.service_id)} — set a default location before consuming stock.`,
      0,
    );
  }

  // F014 (D1): check-and-decrement atomically. The FOR UPDATE lock is held until the
  // caller's transaction commits, so a concurrent consume of the same level row waits
  // here and re-reads the post-commit balance. Exact-to-zero is allowed.
  await ensureStockLevel(trx, tenant, opts.service_id, loc);
  const level = await trx('stock_levels')
    .where({ tenant, service_id: opts.service_id, location_id: loc })
    .forUpdate()
    .first();
  const onHand = Number(level?.quantity_on_hand ?? 0);
  if (onHand < opts.quantity) {
    throw new InsufficientStockError(
      `Insufficient stock for ${await serviceName(trx, tenant, opts.service_id)}: ${onHand} available, ${opts.quantity} requested.`,
      onHand,
    );
  }

  await recordStockMovement(trx, tenant, {
    movement_type: 'consume',
    service_id: opts.service_id,
    quantity: opts.quantity,
    from_location_id: loc,
    cogs_cost: settings.average_cost ?? null,
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
  const settings = await loadTrackedSettings(trx, tenant, opts.service_id);
  if (!settings) return { restored: false };

  if (settings.is_serialized) {
    // find the unit that was delivered for this source doc, and restore it
    const mv = await trx('stock_movements')
      .where({ tenant, service_id: opts.service_id, source_doc_type: opts.source_doc_type, source_doc_id: opts.source_doc_id, movement_type: 'consume' })
      .whereNotNull('unit_id')
      .orderBy('created_at', 'desc')
      .first();
    if (!mv || !mv.unit_id) return { restored: false };
    const loc = mv.from_location_id || (await resolveLocation(trx, tenant, settings));
    if (!loc) return { restored: false };
    await recordStockMovement(trx, tenant, {
      movement_type: 'return_restock',
      service_id: opts.service_id,
      quantity: 1,
      to_location_id: loc,
      unit_id: mv.unit_id,
      reason: 'Reversal of unbilled material',
      source_doc_type: opts.source_doc_type,
      source_doc_id: opts.source_doc_id,
      performed_by: opts.performed_by ?? null,
      unitPatch: { status: 'in_stock', client_id: null, delivered_at: null, location_id: loc },
    });
    return { restored: true };
  }

  const loc = await resolveLocation(trx, tenant, settings);
  if (!loc) return { restored: false };
  await recordStockMovement(trx, tenant, {
    movement_type: 'return_restock',
    service_id: opts.service_id,
    quantity: opts.quantity,
    to_location_id: loc,
    reason: 'Reversal of unbilled consumption',
    source_doc_type: opts.source_doc_type,
    source_doc_id: opts.source_doc_id,
    performed_by: opts.performed_by ?? null,
  });
  return { restored: true };
}
