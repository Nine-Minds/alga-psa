'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  IProductInventorySettings,
  ISalesOrder,
  ISalesOrderLine,
  IStockUnit,
  SalesOrderStatus,
  CreateAssetRequest,
  Asset,
} from '@alga-psa/types';
import { createAsset } from '@alga-psa/assets/actions';
import { recordStockMovement, applyAllocationDelta, availableQuantity } from '../lib';

async function requireSoPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'sales_order', action))) {
    throw new Error(`Permission denied: sales_order ${action} required`);
  }
}

/** A serialized unit row joined with the hard-hold flag used by the poach guard (F084). */
type CandidateUnit = IStockUnit & { foreign_hard_hold: boolean };

export interface FulfillSalesOrderLineInput {
  /** Source location for non-serialized consume, or a filter for serialized FIFO. */
  location_id?: string | null;
  /** Explicit serialized units to deliver (caller pick). Overrides FIFO selection. */
  unit_ids?: string[];
  /** Quantity to fulfill. Defaults to the line's remaining quantity. */
  quantity?: number;
}

export interface FulfillSalesOrderLineResult {
  so_line_id: string;
  so_id: string;
  service_id: string;
  is_serialized: boolean;
  /** Quantity fulfilled by THIS call. */
  quantity_fulfilled: number;
  /** New cumulative quantity_fulfilled on the line. */
  line_quantity_fulfilled: number;
  /** Serialized units delivered by this call. */
  unit_ids: string[];
  /** Managed assets created on delivery (F085/F086). */
  asset_ids: string[];
  so_status: SalesOrderStatus;
  /** Soft-availability and related advisories (never block — design §6.B.1). */
  warnings: string[];
}

/**
 * Load serialized candidate units for a line, annotated with the F084 poach flag:
 * a unit hard-held by a DIFFERENT sales-order line. FIFO-ordered by received_at.
 */
async function loadCandidateUnits(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  soLineId: string,
  opts: { unitIds?: string[]; locationId?: string | null },
): Promise<CandidateUnit[]> {
  const q = trx('stock_units as u')
    .leftJoin('sales_order_lines as sol', function () {
      this.on('u.allocated_so_line_id', '=', 'sol.so_line_id').andOn('u.tenant', '=', 'sol.tenant');
    })
    .leftJoin('sales_orders as so2', function () {
      this.on('sol.so_id', '=', 'so2.so_id').andOn('sol.tenant', '=', 'so2.tenant');
    })
    .where({ 'u.tenant': tenant, 'u.service_id': serviceId })
    .whereIn('u.status', ['in_stock', 'allocated'])
    .select('u.*')
    .select(
      trx.raw(
        `(u.allocated_so_line_id IS NOT NULL AND u.allocated_so_line_id <> ? AND so2.allocation_mode = 'hard') AS foreign_hard_hold`,
        [soLineId],
      ),
    )
    .orderBy('u.received_at', 'asc');

  if (opts.unitIds && opts.unitIds.length > 0) {
    q.whereIn('u.unit_id', opts.unitIds);
  } else if (opts.locationId) {
    q.where('u.location_id', opts.locationId);
  }

  return (await q) as CandidateUnit[];
}

/** Recompute SO header status after a fulfillment. Never downgrades a terminal status. */
async function recomputeSalesOrderStatus(
  trx: Knex.Transaction,
  tenant: string,
  so: Pick<ISalesOrder, 'so_id' | 'status'>,
): Promise<SalesOrderStatus> {
  if (so.status !== 'confirmed' && so.status !== 'partially_fulfilled') {
    return so.status;
  }
  const lines = await trx('sales_order_lines')
    .where({ tenant, so_id: so.so_id })
    .select('quantity_ordered', 'quantity_fulfilled');
  const allFulfilled = lines.every((l) => Number(l.quantity_fulfilled) >= Number(l.quantity_ordered));
  const anyFulfilled = lines.some((l) => Number(l.quantity_fulfilled) > 0);
  const next: SalesOrderStatus = allFulfilled ? 'fulfilled' : anyFulfilled ? 'partially_fulfilled' : so.status;
  if (next !== so.status) {
    await trx('sales_orders').where({ tenant, so_id: so.so_id }).update({ status: next, updated_at: trx.fn.now() });
  }
  return next;
}

/**
 * Create a managed asset for a delivered serialized unit and wire the bidirectional
 * link (assets.service_id + assets.stock_unit_id, and the stock_units.asset_id
 * back-pointer). Carries serial + warranty. See design §6.B.5 (F085/F086).
 */
async function linkAssetOnDelivery(
  trx: Knex.Transaction,
  tenant: string,
  unit: IStockUnit,
  serviceId: string,
  serviceName: string,
  clientId: string,
): Promise<string | null> {
  const serial = unit.serial_number || unit.unit_id;
  const req: CreateAssetRequest = {
    asset_type: 'unknown',
    client_id: clientId,
    asset_tag: serial,
    name: serviceName ? `${serviceName} ${serial}`.trim() : serial,
    status: 'active',
    serial_number: unit.serial_number || undefined,
    ...(unit.warranty_expires_at
      ? { warranty_end_date: new Date(unit.warranty_expires_at as any).toISOString() }
      : {}),
  };
  // createAsset is an ABAC-respecting server action; it runs in its own transaction.
  const asset = (await createAsset(req)) as Asset;
  if (!asset?.asset_id) return null;

  // Establish the inventory back-pointers inside this transaction.
  await trx('assets')
    .where({ tenant, asset_id: asset.asset_id })
    .update({ service_id: serviceId, stock_unit_id: unit.unit_id, updated_at: trx.fn.now() });
  await trx('stock_units')
    .where({ tenant, unit_id: unit.unit_id })
    .update({ asset_id: asset.asset_id, updated_at: trx.fn.now() });

  return asset.asset_id;
}

/**
 * Fulfill (consume / deliver) a sales-order line — design §6.B.
 *
 * Serialized: pick unit(s) (caller `unit_ids`, else FIFO by received_at among this
 * line's allocated + in_stock units), guarding against poaching another SO's
 * hard-held units (F084); record `consume`, mark each unit `delivered` to the SO's
 * client, capture per-unit COGS, and optionally create + link a managed asset
 * (F085/F086). Non-serialized: record a single `consume` for `quantity` at COGS =
 * product average_cost and release the line's reservation/hold. Then bump
 * quantity_fulfilled and recompute the SO status. Availability is soft-warned,
 * never hard-blocked.
 */
export const fulfillSalesOrderLine = withAuth(
  async (
    user,
    { tenant },
    soLineId: string,
    input?: FulfillSalesOrderLineInput,
  ): Promise<FulfillSalesOrderLineResult> => {
    await requireSoPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const warnings: string[] = [];

      const line = (await trx('sales_order_lines')
        .where({ tenant, so_line_id: soLineId })
        .first()) as ISalesOrderLine | undefined;
      if (!line) throw new Error('Sales order line not found');

      const so = (await trx('sales_orders')
        .where({ tenant, so_id: line.so_id })
        .first()) as ISalesOrder | undefined;
      if (!so) throw new Error('Sales order not found');
      if (so.status === 'cancelled' || so.status === 'closed') {
        throw new Error(`Cannot fulfill a ${so.status} sales order`);
      }
      if (line.fulfillment_type === 'drop_ship') {
        throw new Error('Drop-ship lines are fulfilled through the drop-ship receipt flow, not from stock');
      }

      const serviceId = line.service_id;
      const settings = (await trx('product_inventory_settings')
        .where({ tenant, service_id: serviceId })
        .first()) as IProductInventorySettings | undefined;
      if (!settings) throw new Error('Inventory is not enabled for this product');

      const svc = await trx('service_catalog')
        .where({ tenant, service_id: serviceId })
        .select('service_name')
        .first();
      const serviceName: string = svc?.service_name ?? '';

      const remaining = Number(line.quantity_ordered) - Number(line.quantity_fulfilled);
      if (remaining <= 0) throw new Error('Sales order line is already fully fulfilled');

      const isHard = so.allocation_mode === 'hard';
      const deliveredUnitIds: string[] = [];
      const assetIds: string[] = [];
      let fulfilledQty = 0;

      if (settings.is_serialized) {
        // -- Serialized path -------------------------------------------------
        const explicit = (input?.unit_ids ?? []).filter(Boolean);
        const requestedQty = explicit.length > 0 ? explicit.length : input?.quantity ?? remaining;

        const candidates = await loadCandidateUnits(trx, tenant, serviceId, soLineId, {
          unitIds: explicit.length > 0 ? explicit : undefined,
          locationId: input?.location_id ?? undefined,
        });
        const byId = new Map(candidates.map((c) => [c.unit_id, c]));

        let picked: CandidateUnit[];
        if (explicit.length > 0) {
          // Caller-selected units: validate each; a poached hard-hold is a hard error (F084).
          picked = explicit.map((id) => {
            const u = byId.get(id);
            if (!u) throw new Error(`Unit ${id} is not available for this product/line`);
            if (u.foreign_hard_hold) {
              throw new Error(`Unit ${id} is hard-held by another sales order and cannot be poached`);
            }
            return u;
          });
        } else {
          // FIFO selection: skip foreign hard-holds; prefer units allocated to this line, then unallocated.
          const eligible = candidates.filter((u) => !u.foreign_hard_hold);
          eligible.sort((a, b) => {
            const aMine = a.allocated_so_line_id === soLineId ? 0 : 1;
            const bMine = b.allocated_so_line_id === soLineId ? 0 : 1;
            if (aMine !== bMine) return aMine - bMine;
            return 0; // received_at order preserved by the query
          });
          picked = eligible.slice(0, requestedQty);
        }

        if (picked.length < requestedQty) {
          warnings.push(
            `Only ${picked.length} of ${requestedQty} requested serialized unit(s) were available; fulfilling ${picked.length}.`,
          );
        }
        if (picked.length === 0) throw new Error('No serialized units available to fulfill this line');

        const now = new Date().toISOString();
        for (const unit of picked) {
          const fromLocation = unit.location_id ?? null;
          await recordStockMovement(trx, tenant, {
            movement_type: 'consume',
            service_id: serviceId,
            quantity: 1,
            unit_id: unit.unit_id,
            from_location_id: fromLocation,
            cogs_cost: unit.unit_cost ?? null,
            cost_currency: unit.cost_currency ?? settings.cost_currency,
            source_doc_type: 'sales_order',
            source_doc_id: so.so_id,
            performed_by: user.user_id,
            unitPatch: {
              status: 'delivered',
              client_id: so.client_id,
              delivered_at: now,
              location_id: null,
              allocated_so_line_id: null,
            },
          });

          // Release a hard-hold counter that this line placed on the unit's location.
          if (isHard && unit.allocated_so_line_id === soLineId && fromLocation) {
            await applyAllocationDelta(trx, tenant, serviceId, fromLocation, 'held_quantity', -1);
          }

          deliveredUnitIds.push(unit.unit_id);

          if (settings.creates_asset_on_delivery) {
            const assetId = await linkAssetOnDelivery(trx, tenant, unit, serviceId, serviceName, so.client_id);
            if (assetId) assetIds.push(assetId);
          }
        }
        fulfilledQty = picked.length;
      } else {
        // -- Non-serialized path --------------------------------------------
        const qty = input?.quantity ?? remaining;
        if (!qty || qty <= 0) throw new Error('quantity is required to fulfill a non-serialized line');
        const fromLocation = input?.location_id ?? settings.default_location_id ?? null;
        if (!fromLocation) throw new Error('A source location is required to fulfill a non-serialized line');

        // Soft availability check — warn, never block.
        const level = await trx('stock_levels')
          .where({ tenant, service_id: serviceId, location_id: fromLocation })
          .first();
        const available = level ? availableQuantity(level) : 0;
        if (available < qty) {
          warnings.push(
            `Available quantity (${available}) is below the requested ${qty} at the source location; fulfilling anyway.`,
          );
        }

        await recordStockMovement(trx, tenant, {
          movement_type: 'consume',
          service_id: serviceId,
          quantity: qty,
          from_location_id: fromLocation,
          cogs_cost: settings.average_cost ?? null,
          cost_currency: settings.cost_currency,
          source_doc_type: 'sales_order',
          source_doc_id: so.so_id,
          performed_by: user.user_id,
        });

        // Release the reservation (soft) or hold (hard) this fulfillment satisfies.
        await applyAllocationDelta(
          trx,
          tenant,
          serviceId,
          fromLocation,
          isHard ? 'held_quantity' : 'reserved_quantity',
          -qty,
        );
        fulfilledQty = qty;
      }

      // Bump the line's fulfilled counter and recompute SO status.
      const [updatedLine] = await trx('sales_order_lines')
        .where({ tenant, so_line_id: soLineId })
        .update({
          quantity_fulfilled: trx.raw('quantity_fulfilled + ?', [fulfilledQty]),
          updated_at: trx.fn.now(),
        })
        .returning('quantity_fulfilled');
      const lineQuantityFulfilled = Number(updatedLine?.quantity_fulfilled ?? Number(line.quantity_fulfilled) + fulfilledQty);

      const soStatus = await recomputeSalesOrderStatus(trx, tenant, so);

      return {
        so_line_id: soLineId,
        so_id: so.so_id,
        service_id: serviceId,
        is_serialized: settings.is_serialized,
        quantity_fulfilled: fulfilledQty,
        line_quantity_fulfilled: lineQuantityFulfilled,
        unit_ids: deliveredUnitIds,
        asset_ids: assetIds,
        so_status: soStatus,
        warnings,
      };
    });
  },
);
