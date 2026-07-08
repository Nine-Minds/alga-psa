'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createAndLinkDeliveredAsset, PendingAssetLink } from '../lib/assetLink';
import {
  IPurchaseOrder,
  IPurchaseOrderLine,
  ISalesOrder,
  ISalesOrderLine,
  IStockUnit,
  SalesOrderStatus,
  PurchaseOrderStatus,
} from '@alga-psa/types';
import { publishInventoryEvent, recordStockMovement, timestampPayload } from '../lib';
import { resolveTenantCurrency } from '../lib';

/**
 * Drop-ship: vendor ships straight to the client, the stock never touches one of
 * my shelves. See design §6.J.
 *
 *  - createDropShipForSoLine: turn a `fulfillment_type='drop_ship'` SO line into a
 *    purchase order flagged `is_drop_ship` with the client + address captured and a
 *    `source_so_line_id` link back to the SO line.
 *  - confirmDropShipShipment: a combined receipt+delivery. It records the unit as
 *    `delivered` (serialized → a unit row with location_id NULL, F139) and consumes
 *    it for COGS WITHOUT any from/to location — so `quantity_on_hand` is never
 *    incremented at any of my locations — then marks the SO line fulfilled.
 */

async function requireSoPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'sales_order', action))) {
    throw new Error(`Permission denied: sales_order ${action} required`);
  }
}

/** Cost basis for a line: product average cost, else catalog cost, else 0. */
async function resolveCost(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  fallbackCurrency: string,
): Promise<{ unitCost: number; costCurrency: string }> {
  const defaultCurrency = fallbackCurrency || await resolveTenantCurrency(trx, tenant);
  const pis = await trx('product_inventory_settings')
    .where({ tenant, service_id: serviceId })
    .select('average_cost', 'cost_currency')
    .first();
  const sc = await trx('service_catalog')
    .where({ tenant, service_id: serviceId })
    .select('cost', 'cost_currency')
    .first();
  return {
    unitCost: Number(pis?.average_cost ?? sc?.cost ?? 0),
    costCurrency: pis?.cost_currency ?? sc?.cost_currency ?? defaultCurrency,
  };
}

export interface CreateDropShipForSoLineInput {
  vendor_id: string;
  drop_ship_address?: Record<string, unknown> | null;
}

export interface DropShipPurchaseOrder extends IPurchaseOrder {
  lines: IPurchaseOrderLine[];
}

/**
 * Create a drop-ship purchase order for a `drop_ship` sales-order line. The PO is
 * flagged `is_drop_ship`, carries the SO client + address, and its single line links
 * back via `source_so_line_id`.
 */
export const createDropShipForSoLine = withAuth(
  async (
    user,
    { tenant },
    soLineId: string,
    input: CreateDropShipForSoLineInput,
  ): Promise<DropShipPurchaseOrder> => {
    await requireSoPerm(user, 'create');
    if (!input?.vendor_id) throw new Error('vendor_id is required');

    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const soLine = (await trx('sales_order_lines')
        .where({ tenant, so_line_id: soLineId })
        .first()) as ISalesOrderLine | undefined;
      if (!soLine) throw new Error('Sales order line not found');
      if (soLine.fulfillment_type !== 'drop_ship') {
        throw new Error('Sales order line is not a drop-ship line');
      }

      const so = (await trx('sales_orders')
        .where({ tenant, so_id: soLine.so_id })
        .first()) as ISalesOrder | undefined;
      if (!so) throw new Error('Sales order not found');

      const vendor = await trx('vendors').where({ tenant, vendor_id: input.vendor_id }).first();
      if (!vendor) throw new Error('Vendor not found');

      const currencyCode = so.currency_code || await resolveTenantCurrency(trx, tenant);
      const numRes = await trx.raw('SELECT generate_next_number(?::uuid, ?) as number', [tenant, 'PURCHASE_ORDER']);
      const poNumber = numRes.rows[0].number;

      const [po] = await trx('purchase_orders')
        .insert({
          tenant,
          po_number: poNumber,
          vendor_id: input.vendor_id,
          status: 'open' as PurchaseOrderStatus,
          order_date: trx.fn.now(),
          is_drop_ship: true,
          drop_ship_client_id: so.client_id,
          drop_ship_address: input.drop_ship_address ?? null,
          currency_code: currencyCode,
          notes: `Drop-ship for sales order ${so.so_number}`,
          created_by: user.user_id,
        })
        .returning('*');

      const { unitCost, costCurrency } = await resolveCost(trx, tenant, soLine.service_id, currencyCode);

      const [line] = await trx('purchase_order_lines')
        .insert({
          tenant,
          po_id: (po as IPurchaseOrder).po_id,
          service_id: soLine.service_id,
          quantity_ordered: soLine.quantity_ordered,
          quantity_received: 0,
          unit_cost: unitCost,
          cost_currency: costCurrency,
          source_so_line_id: soLineId,
        })
        .returning('*');

      return { ...(po as IPurchaseOrder), lines: [line as IPurchaseOrderLine] };
    });

    await publishInventoryEvent('INVENTORY_PURCHASE_ORDER_CREATED', timestampPayload({
      tenant,
      po_id: result.po_id,
      user_id: user.user_id,
    }));

    return result;
  },
);

export interface DropShipSerialInput {
  serial_number: string;
  mac_address?: string | null;
  warranty_expires_at?: string | Date | null;
  warranty_term?: string | null;
  unit_cost?: number | null;
}

export interface ConfirmDropShipShipmentInput {
  serials?: DropShipSerialInput[];
}

/** Reference the drop-ship PO line by either id. */
export interface DropShipLineRef {
  po_line_id?: string;
  so_line_id?: string;
}

export interface ConfirmDropShipShipmentResult {
  po_line: IPurchaseOrderLine;
  so_line: ISalesOrderLine;
  sales_order_status: SalesOrderStatus;
  units: IStockUnit[];
  quantity_fulfilled: number;
  /** Non-fatal issues (e.g. post-commit asset creation failures — F029). */
  warnings: string[];
}

/**
 * Combined receipt+delivery on vendor shipment confirmation. Never touches on-hand:
 * the consume movement carries no from/to location, so `stock_levels` are unchanged.
 */
export const confirmDropShipShipment = withAuth(
  async (
    user,
    { tenant },
    ref: DropShipLineRef,
    input?: ConfirmDropShipShipmentInput,
  ): Promise<ConfirmDropShipShipmentResult> => {
    await requireSoPerm(user, 'update');
    if (!ref?.po_line_id && !ref?.so_line_id) {
      throw new Error('A po_line_id or so_line_id is required');
    }

    const { knex: db } = await createTenantKnex();
    const core = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Resolve the drop-ship PO line from whichever id was supplied (probe, no lock).
      let poLineProbe: IPurchaseOrderLine | undefined;
      if (ref.po_line_id) {
        poLineProbe = (await trx('purchase_order_lines')
          .where({ tenant, po_line_id: ref.po_line_id })
          .first()) as IPurchaseOrderLine | undefined;
      } else {
        poLineProbe = (await trx('purchase_order_lines')
          .where({ tenant, source_so_line_id: ref.so_line_id })
          .first()) as IPurchaseOrderLine | undefined;
      }
      if (!poLineProbe) throw new Error('Drop-ship purchase order line not found');
      if (!poLineProbe.source_so_line_id) {
        throw new Error('Purchase order line is not linked to a sales order line');
      }
      const soLineProbe = (await trx('sales_order_lines')
        .where({ tenant, so_line_id: poLineProbe.source_so_line_id })
        .select('so_id')
        .first()) as { so_id: string } | undefined;
      if (!soLineProbe) throw new Error('Sales order line not found');

      // Canonical lock order — SO header → PO header → lines — matching every other
      // SO/PO flow so a duplicate confirm or a racing receive serializes (F018/F020).
      const so = (await trx('sales_orders')
        .where({ tenant, so_id: soLineProbe.so_id })
        .forUpdate()
        .first()) as ISalesOrder | undefined;
      if (!so) throw new Error('Sales order not found');
      const po = (await trx('purchase_orders')
        .where({ tenant, po_id: poLineProbe.po_id })
        .forUpdate()
        .first()) as IPurchaseOrder | undefined;
      if (!po) throw new Error('Purchase order not found');
      if (!po.is_drop_ship) throw new Error('Purchase order is not a drop-ship order');
      const soLine = (await trx('sales_order_lines')
        .where({ tenant, so_line_id: poLineProbe.source_so_line_id })
        .forUpdate()
        .first()) as ISalesOrderLine | undefined;
      if (!soLine) throw new Error('Sales order line not found');
      const poLine = (await trx('purchase_order_lines')
        .where({ tenant, po_line_id: poLineProbe.po_line_id })
        .forUpdate()
        .first()) as IPurchaseOrderLine | undefined;
      if (!poLine) throw new Error('Drop-ship purchase order line not found');

      const settings = await trx('product_inventory_settings')
        .where({ tenant, service_id: soLine.service_id })
        .select('is_serialized', 'creates_asset_on_delivery')
        .first();
      const isSerialized = Boolean(settings?.is_serialized);
      const createsAsset = Boolean(settings?.creates_asset_on_delivery);

      const svc = await trx('service_catalog')
        .where({ tenant, service_id: soLine.service_id })
        .select('service_name')
        .first();

      const { unitCost: defaultUnitCost, costCurrency } = await resolveCost(
        trx,
        tenant,
        soLine.service_id,
        po.currency_code || await resolveTenantCurrency(trx, tenant),
      );

      const serials = input?.serials ?? [];
      const units: IStockUnit[] = [];
      const pendingAssets: PendingAssetLink[] = [];
      let quantity: number;

      if (isSerialized) {
        if (serials.length === 0) {
          throw new Error('Serialized drop-ship requires at least one serial');
        }
        quantity = serials.length;
        if (Number(soLine.quantity_fulfilled) + quantity > Number(soLine.quantity_ordered)) {
          throw new Error(
            `Shipment of ${quantity} would exceed the ordered quantity (${soLine.quantity_ordered}, already fulfilled ${soLine.quantity_fulfilled})`,
          );
        }

        for (const s of serials) {
          if (!s.serial_number?.trim()) throw new Error('Each serial requires a serial_number');
          const unitCost = s.unit_cost ?? defaultUnitCost;

          // F139: delivered straight to the client, location_id NULL — it was never
          // on one of my shelves.
          const [unit] = await trx('stock_units')
            .insert({
              tenant,
              service_id: soLine.service_id,
              serial_number: s.serial_number.trim(),
              mac_address: s.mac_address ?? null,
              status: 'delivered',
              location_id: null,
              client_id: so.client_id,
              warranty_expires_at: s.warranty_expires_at ?? null,
              warranty_term: s.warranty_term ?? null,
              unit_cost: unitCost,
              cost_currency: costCurrency,
              received_at: trx.fn.now(),
              delivered_at: trx.fn.now(),
              source_po_id: po.po_id,
            })
            .returning('*');
          const unitRow = unit as IStockUnit;

          // Consume for COGS — no from/to location, so on-hand is untouched.
          await recordStockMovement(trx, tenant, {
            movement_type: 'consume',
            service_id: soLine.service_id,
            quantity: 1,
            unit_id: unitRow.unit_id,
            unit_cost: unitCost,
            cost_currency: costCurrency,
            cogs_cost: unitCost,
            source_doc_type: 'sales_order',
            source_doc_id: so.so_id,
            performed_by: user.user_id,
            unitPatch: {},
          });

          // Managed asset for the delivered serial — created AFTER this transaction
          // commits (F029), so a rollback cannot orphan an asset row.
          if (createsAsset) {
            pendingAssets.push({
              unit: unitRow,
              serviceId: soLine.service_id,
              serviceName: svc?.service_name ?? '',
              clientId: so.client_id,
            });
          }

          units.push(unitRow);
        }
      } else {
        // Non-serialized: fulfill the outstanding quantity on the line.
        quantity = Math.max(0, soLine.quantity_ordered - soLine.quantity_fulfilled);
        if (quantity <= 0) throw new Error('Sales order line is already fully fulfilled');

        // Consume for COGS — no unit, no from/to location, so on-hand is untouched.
        await recordStockMovement(trx, tenant, {
          movement_type: 'consume',
          service_id: soLine.service_id,
          quantity,
          unit_cost: defaultUnitCost,
          cost_currency: costCurrency,
          cogs_cost: defaultUnitCost * quantity,
          source_doc_type: 'sales_order',
          source_doc_id: so.so_id,
          performed_by: user.user_id,
        });
      }

      // Mark the PO line received and recompute PO status.
      const newReceived = Number(poLine.quantity_received) + quantity;
      const [updatedPoLine] = await trx('purchase_order_lines')
        .where({ tenant, po_line_id: poLine.po_line_id })
        .update({ quantity_received: newReceived, updated_at: trx.fn.now() })
        .returning('*');

      if (po.status !== 'cancelled') {
        const poLines = (await trx('purchase_order_lines')
          .where({ tenant, po_id: po.po_id })
          .select('quantity_ordered', 'quantity_received')) as Array<{ quantity_ordered: number; quantity_received: number }>;
        const allReceived = poLines.every((l) => Number(l.quantity_received) >= Number(l.quantity_ordered));
        const anyReceived = poLines.some((l) => Number(l.quantity_received) > 0);
        const poStatus: PurchaseOrderStatus = allReceived ? 'received' : anyReceived ? 'partially_received' : po.status;
        if (poStatus !== po.status) {
          await trx('purchase_orders')
            .where({ tenant, po_id: po.po_id })
            .update({ status: poStatus, updated_at: trx.fn.now() });
        }
      }

      // Mark the SO line fulfilled and recompute SO status.
      const newFulfilled = Number(soLine.quantity_fulfilled) + quantity;
      const [updatedSoLine] = await trx('sales_order_lines')
        .where({ tenant, so_line_id: soLine.so_line_id })
        .update({ quantity_fulfilled: newFulfilled, updated_at: trx.fn.now() })
        .returning('*');

      let soStatus: SalesOrderStatus = so.status;
      if (so.status === 'confirmed' || so.status === 'partially_fulfilled') {
        const soLines = (await trx('sales_order_lines')
          .where({ tenant, so_id: so.so_id })
          .select('quantity_ordered', 'quantity_fulfilled')) as Array<{ quantity_ordered: number; quantity_fulfilled: number }>;
        const allFulfilled = soLines.every((l) => Number(l.quantity_fulfilled) >= Number(l.quantity_ordered));
        soStatus = allFulfilled ? 'fulfilled' : 'partially_fulfilled';
        if (soStatus !== so.status) {
          await trx('sales_orders')
            .where({ tenant, so_id: so.so_id })
            .update({ status: soStatus, updated_at: trx.fn.now() });
        }
      }
      const fulfilledLineCount = await trx('sales_order_lines')
        .where({ tenant, so_id: so.so_id })
        .andWhere('quantity_fulfilled', '>', 0)
        .count<{ c: string }>('* as c')
        .first();

      return {
        po_line: updatedPoLine as IPurchaseOrderLine,
        so_line: updatedSoLine as ISalesOrderLine,
        sales_order_status: soStatus,
        units,
        quantity_fulfilled: quantity,
        pendingAssets,
        so_fulfilled_event: {
          tenant,
          so_id: so.so_id,
          so_number: so.so_number,
          client_id: so.client_id ?? null,
          fulfilled_line_count: Number(fulfilledLineCount?.c ?? 0),
          drop_ship: true,
        },
      };
    });

    // F029: create + link managed assets only after the delivery is durable; a
    // failure here is a warning, never an unwind of the shipment.
    const warnings: string[] = [];
    for (const p of core.pendingAssets) {
      try {
        const assetId = await createAndLinkDeliveredAsset(db, tenant, p);
        if (assetId) {
          const delivered = core.units.find((u) => u.unit_id === p.unit.unit_id);
          if (delivered) delivered.asset_id = assetId;
        }
      } catch (e) {
        warnings.push(
          `Asset creation failed for unit ${p.unit.serial_number ?? p.unit.unit_id}: ${
            e instanceof Error ? e.message : String(e)
          }. The delivery succeeded — create and link the asset manually.`,
        );
      }
    }
    await publishInventoryEvent('INVENTORY_SO_FULFILLED', core.so_fulfilled_event);
    await publishInventoryEvent('INVENTORY_PURCHASE_ORDER_UPDATED', timestampPayload({
      tenant,
      po_id: core.po_line.po_id,
      user_id: user.user_id,
      changed_fields: ['status', 'quantity_received'],
    }));
    await publishInventoryEvent('INVENTORY_SALES_ORDER_UPDATED', timestampPayload({
      tenant,
      so_id: core.so_line.so_id,
      user_id: user.user_id,
      changed_fields: ['status', 'quantity_fulfilled'],
    }));
    for (const unit of core.units) {
      await publishInventoryEvent('INVENTORY_STOCK_UNIT_CREATED', timestampPayload({
        tenant,
        unit_id: unit.unit_id,
        service_id: unit.service_id,
        user_id: user.user_id,
      }));
    }

    const { pendingAssets: _pending, so_fulfilled_event: _soFulfilledEvent, ...rest } = core;
    return { ...rest, warnings };
  },
);
