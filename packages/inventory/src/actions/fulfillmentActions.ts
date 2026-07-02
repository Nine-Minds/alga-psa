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
} from '@alga-psa/types';
import {
  applyAllocationDelta,
  assertLocationWritable,
  availableQuantity,
  collectStockLowSignalAfterConsume,
  publishInventoryEvent,
  recordStockMovement,
  timestampPayload,
} from '../lib';
import { createAndLinkDeliveredAsset, PendingAssetLink } from '../lib/assetLink';

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
  opts: { unitIds?: string[]; locationId?: string | null; lock?: boolean },
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

  // Lock the candidate units so a concurrent fulfill/confirm cannot claim the same
  // physical unit (F022). FIFO auto-pick skips rows locked by others; an explicit
  // pick waits for the lock and is then re-validated by the status filter.
  // (lock:false = read-only listing for the unit-picker UI.)
  if (opts.lock !== false) {
    q.forUpdate('u');
    if (!(opts.unitIds && opts.unitIds.length > 0)) q.skipLocked();
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


/** A serialized unit as shown in the fulfill dialog's picker (F003/F004). */
export interface FulfillmentCandidateUnit {
  unit_id: string;
  serial_number: string | null;
  mac_address: string | null;
  location_id: string | null;
  location_name: string | null;
  received_at: string | Date | null;
  /** Hard-held by ANOTHER sales order — not selectable (F084 poach guard). */
  foreign_hard_hold: boolean;
  /** Already allocated to this line — the FIFO default picks these first. */
  allocated_to_this_line: boolean;
  /** Soft-allocated to a different order — selectable, but labeled (F004). */
  foreign_soft_allocated: boolean;
}

/**
 * Read-only candidate list for the fulfill dialog's serialized unit picker (F003).
 * FIFO-ordered; hard-holds by other orders are included but flagged so the UI can
 * exclude them, and foreign soft allocations are labeled rather than hidden (F004).
 */
export const listFulfillmentCandidateUnits = withAuth(
  async (user, { tenant }, soLineId: string): Promise<FulfillmentCandidateUnit[]> => {
    await requireSoPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const line = (await trx('sales_order_lines')
        .where({ tenant, so_line_id: soLineId })
        .first()) as ISalesOrderLine | undefined;
      if (!line) throw new Error('Sales order line not found');

      const candidates = await loadCandidateUnits(trx, tenant, line.service_id, soLineId, { lock: false });
      const locationIds = [...new Set(candidates.map((u) => u.location_id).filter(Boolean))] as string[];
      const locations = locationIds.length
        ? await trx('stock_locations').where({ tenant }).whereIn('location_id', locationIds).select('location_id', 'name')
        : [];
      const locationName = new Map(locations.map((l: any) => [l.location_id, l.name as string]));

      return candidates.map((u) => ({
        unit_id: u.unit_id,
        serial_number: u.serial_number ?? null,
        mac_address: u.mac_address ?? null,
        location_id: u.location_id ?? null,
        location_name: u.location_id ? locationName.get(u.location_id) ?? null : null,
        received_at: u.received_at ?? null,
        foreign_hard_hold: Boolean(u.foreign_hard_hold),
        allocated_to_this_line: u.allocated_so_line_id === soLineId,
        foreign_soft_allocated: Boolean(
          u.allocated_so_line_id && u.allocated_so_line_id !== soLineId && !u.foreign_hard_hold,
        ),
      }));
    });
  },
);

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

      const lineProbe = (await trx('sales_order_lines')
        .where({ tenant, so_line_id: soLineId })
        .select('so_id')
        .first()) as { so_id: string } | undefined;
      if (!lineProbe) throw new Error('Sales order line not found');

      // Lock parent-first (SO header, then line) — the same order every SO flow uses,
      // so concurrent confirm/cancel/fulfill serialize instead of racing (F018).
      const so = (await trx('sales_orders')
        .where({ tenant, so_id: lineProbe.so_id })
        .forUpdate()
        .first()) as ISalesOrder | undefined;
      if (!so) throw new Error('Sales order not found');
      const line = (await trx('sales_order_lines')
        .where({ tenant, so_line_id: soLineId })
        .forUpdate()
        .first()) as ISalesOrderLine | undefined;
      if (!line) throw new Error('Sales order line not found');
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
      const pendingAssets: PendingAssetLink[] = [];
      const pendingStockLowSignals: Awaited<ReturnType<typeof collectStockLowSignalAfterConsume>>[] = [];
      let fulfilledQty = 0;
      let reservedDrain = 0;

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

        // A tech can't fulfill out of another tech's van (F035).
        const sourceLocations = [...new Set(picked.map((u) => u.location_id).filter(Boolean))] as string[];
        for (const loc of sourceLocations) {
          await assertLocationWritable(trx, tenant, (user as any)?.user_id, loc);
        }

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

          // NOTE: no held_quantity decrement here — serialized allocation never
          // increments the counter (the claim is the unit's allocated status), so
          // decrementing on fulfill was asymmetric dead accounting (F026).

          deliveredUnitIds.push(unit.unit_id);

          if (settings.creates_asset_on_delivery) {
            // F029: collected now, created only after the stock transaction commits.
            pendingAssets.push({ unit, serviceId, serviceName, clientId: so.client_id });
          }
        }
        fulfilledQty = picked.length;
      } else {
        // -- Non-serialized path --------------------------------------------
        const qty = input?.quantity ?? remaining;
        if (!qty || qty <= 0) throw new Error('quantity is required to fulfill a non-serialized line');
        const fromLocation = input?.location_id ?? settings.default_location_id ?? null;
        if (!fromLocation) throw new Error('A source location is required to fulfill a non-serialized line');
        // A tech can't fulfill out of another tech's van (F035).
        await assertLocationWritable(trx, tenant, (user as any)?.user_id, fromLocation);

        // Soft availability check — warn, never block. The line's own reservation at
        // this location is not a shortage, so add it back before comparing (F024).
        const level = await trx('stock_levels')
          .where({ tenant, service_id: serviceId, location_id: fromLocation })
          .forUpdate()
          .first();
        const ownReservationHere =
          line.reserved_location_id === fromLocation ? Number(line.quantity_reserved ?? 0) : 0;
        const available = (level ? availableQuantity(level) : 0) + ownReservationHere;
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

        const pendingStockLow = await collectStockLowSignalAfterConsume(trx, tenant, serviceId, fromLocation, qty);
        if (pendingStockLow) pendingStockLowSignals.push(pendingStockLow);

        // Release exactly what this line reserved — never other orders' claims — at
        // the location the reservation was placed (F024/F025).
        reservedDrain = Math.min(qty, Number(line.quantity_reserved ?? 0));
        if (reservedDrain > 0 && line.reserved_location_id) {
          await applyAllocationDelta(
            trx,
            tenant,
            serviceId,
            line.reserved_location_id,
            isHard ? 'held_quantity' : 'reserved_quantity',
            -reservedDrain,
          );
        }
        fulfilledQty = qty;
      }

      // Bump the line's fulfilled counter — capped in SQL so overshoot is impossible
      // even if a concurrent writer slipped past the guards above (F023). The row
      // lock makes this a belt-and-braces check, not the primary defense.
      const updatedRows = await trx('sales_order_lines')
        .where({ tenant, so_line_id: soLineId })
        .andWhereRaw('quantity_fulfilled + ? <= quantity_ordered', [fulfilledQty])
        .update({
          quantity_fulfilled: trx.raw('quantity_fulfilled + ?', [fulfilledQty]),
          quantity_reserved: trx.raw('GREATEST(0, quantity_reserved - ?)', [reservedDrain]),
          updated_at: trx.fn.now(),
        })
        .returning('quantity_fulfilled');
      if (updatedRows.length === 0) {
        throw new Error('Fulfillment would exceed the ordered quantity; nothing was fulfilled');
      }
      const lineQuantityFulfilled = Number(
        (updatedRows[0] as any)?.quantity_fulfilled ?? Number(line.quantity_fulfilled) + fulfilledQty,
      );

      const soStatus = await recomputeSalesOrderStatus(trx, tenant, so);
      const fulfilledLineCount = await trx('sales_order_lines')
        .where({ tenant, so_id: so.so_id })
        .andWhere('quantity_fulfilled', '>', 0)
        .count<{ c: string }>('* as c')
        .first();

      return {
        so_line_id: soLineId,
        so_id: so.so_id,
        service_id: serviceId,
        is_serialized: settings.is_serialized,
        quantity_fulfilled: fulfilledQty,
        line_quantity_fulfilled: lineQuantityFulfilled,
        unit_ids: deliveredUnitIds,
        so_status: soStatus,
        warnings,
        pendingAssets,
        pendingStockLowSignals,
        so_fulfilled_event: {
          tenant,
          so_id: so.so_id,
          so_number: so.so_number,
          client_id: so.client_id ?? null,
          fulfilled_line_count: Number(fulfilledLineCount?.c ?? 0),
          drop_ship: false,
        },
      };
    }).then(async (core) => {
      // F029: create + link managed assets only after the stock transaction is
      // durable. createAsset commits in its own transaction, so doing this mid-flight
      // left orphan assets whenever the stock work rolled back. A failure here no
      // longer unwinds the delivery — it is surfaced as a warning instead.
      const assetIds: string[] = [];
      for (const p of core.pendingAssets) {
        try {
          const id = await createAndLinkDeliveredAsset(db, tenant, p);
          if (id) assetIds.push(id);
        } catch (e) {
          core.warnings.push(
            `Asset creation failed for unit ${p.unit.serial_number ?? p.unit.unit_id}: ${
              e instanceof Error ? e.message : String(e)
            }. The delivery succeeded — create and link the asset manually.`,
          );
        }
      }
      for (const signal of core.pendingStockLowSignals) {
        if (signal) await publishInventoryEvent('INVENTORY_STOCK_LOW', signal);
      }
      await publishInventoryEvent('INVENTORY_SO_FULFILLED', core.so_fulfilled_event);
      await publishInventoryEvent('INVENTORY_SALES_ORDER_UPDATED', timestampPayload({
        tenant,
        so_id: core.so_id,
        user_id: user.user_id,
        changed_fields: ['status', 'quantity_fulfilled'],
      }));
      for (const unitId of core.unit_ids) {
        await publishInventoryEvent('INVENTORY_STOCK_UNIT_UPDATED', timestampPayload({
          tenant,
          unit_id: unitId,
          service_id: core.service_id,
          user_id: user.user_id,
          changed_fields: ['status', 'client_id', 'delivered_at', 'location_id'],
        }));
      }
      const {
        pendingAssets: _pending,
        pendingStockLowSignals: _pendingStockLowSignals,
        so_fulfilled_event: _soFulfilledEvent,
        ...rest
      } = core;
      return { ...rest, asset_ids: assetIds };
    });
  },
);
