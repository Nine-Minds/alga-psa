'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  IPurchaseOrder,
  IPurchaseOrderLine,
  IStockUnit,
  PurchaseOrderStatus,
} from '@alga-psa/types';
import { publishInventoryEvent, recordStockMovement, timestampPayload } from '../lib';

async function requirePoPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'purchase_order', action))) {
    throw new Error(`Permission denied: purchase_order ${action} required`);
  }
}

type PurchaseOrderActionError = ActionMessageError | ActionPermissionError;

function purchaseOrderActionErrorFrom(error: unknown): PurchaseOrderActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }

    switch (error.message) {
      case 'Purchase order not found':
        return actionError('Purchase order not found. It may have been updated or deleted. Please refresh and try again.');
      case 'Purchase order line not found':
        return actionError('Purchase order line not found. It may have been updated or deleted. Please refresh and try again.');
      case 'vendor_id is required':
        return actionError('Select a vendor before creating the purchase order.');
      case 'currency_code is required':
        return actionError('Select a currency before creating the purchase order.');
      case 'Vendor not found':
        return actionError('Vendor not found. It may have been deleted. Please choose another vendor.');
      case 'quantity_ordered must be greater than 0':
        return actionError('Each line quantity must be greater than 0.');
      case 'Cannot submit a purchase order with no lines':
        return actionError('Add at least one line before submitting this purchase order.');
      case 'Cannot cancel a fully received purchase order':
        return actionError('This purchase order is already fully received and cannot be cancelled.');
      case 'Cannot cancel a purchase order that has already received stock':
        return actionError('This purchase order has already received stock and cannot be cancelled.');
      case 'quantity must be greater than 0':
        return actionError('Quantity must be greater than 0.');
      case 'location_id is required':
        return actionError('Select a location before receiving stock.');
      case 'Cannot receive against a draft purchase order; submit it first':
        return actionError('Submit this purchase order before receiving stock against it.');
      case 'Cannot receive against a cancelled purchase order':
        return actionError('This purchase order is cancelled and cannot receive stock.');
      case 'Stock location not found':
        return actionError('Stock location not found. It may have been deleted. Please choose another location.');
      case 'Inventory is not enabled for this product':
        return actionError('Inventory is not enabled for this product.');
      case 'Inventory tracking is disabled for this product':
        return actionError('Inventory tracking is disabled for this product.');
      case 'Each serialized unit requires a serial_number':
        return actionError('Each serialized unit needs a serial number.');
      case 'Cannot remove a line that has already received stock':
        return actionError('This line has already received stock and cannot be removed.');
      case 'Cannot edit a cancelled purchase order':
        return actionError('This purchase order is cancelled and cannot be edited.');
      default:
        if (
          error.message.startsWith('Line cost_currency') ||
          error.message.startsWith('Only draft purchase orders can be submitted') ||
          error.message.startsWith('Cannot add a line to a') ||
          error.message.startsWith('Cannot edit a line on a') ||
          error.message.startsWith('Receipt currency') ||
          error.message.startsWith('Serialized receipt requires exactly') ||
          error.message.startsWith('Duplicate serial_number in batch:') ||
          error.message.startsWith('Duplicate mac_address in batch:') ||
          error.message.startsWith('Serial number already exists:') ||
          error.message.startsWith('MAC address already exists:')
        ) {
          return actionError(error.message);
        }
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '23503') {
    return actionError('One of the selected purchase order records is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('A stock unit with the same serial number or MAC address already exists.');
  }

  return null;
}

async function withPurchaseOrderActionErrors<T>(work: () => Promise<T>): Promise<T | PurchaseOrderActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = purchaseOrderActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

/** Load a PO row (within txn) or throw. */
async function getPoOrThrow(
  trx: Knex.Transaction,
  tenant: string,
  poId: string,
  opts?: { forUpdate?: boolean },
): Promise<IPurchaseOrder> {
  const q = trx('purchase_orders').where({ tenant, po_id: poId });
  // Header row lock = transition mutex: concurrent receive/cancel serialize here and
  // the status guard that follows is authoritative (F020).
  if (opts?.forUpdate) q.forUpdate();
  const po = await q.first();
  if (!po) throw new Error('Purchase order not found');
  return po as IPurchaseOrder;
}

/** Load a PO line row (within txn) or throw. */
async function getPoLineOrThrow(trx: Knex.Transaction, tenant: string, poLineId: string): Promise<IPurchaseOrderLine> {
  const line = await trx('purchase_order_lines').where({ tenant, po_line_id: poLineId }).first();
  if (!line) throw new Error('Purchase order line not found');
  return line as IPurchaseOrderLine;
}

/**
 * Recompute and persist a PO's status from its lines:
 *   - received: every line quantity_received >= quantity_ordered (and at least one line exists)
 *   - partially_received: some receipts but not all lines complete
 *   - open: submitted with no receipts yet
 * Never moves a PO out of draft/cancelled.
 */
async function recomputePoStatus(trx: Knex.Transaction, tenant: string, poId: string): Promise<PurchaseOrderStatus> {
  const po = await getPoOrThrow(trx, tenant, poId);
  if (po.status === 'draft' || po.status === 'cancelled') return po.status;

  const lines = (await trx('purchase_order_lines').where({ tenant, po_id: poId })) as IPurchaseOrderLine[];
  let anyReceived = false;
  let allComplete = lines.length > 0;
  for (const l of lines) {
    if (Number(l.quantity_received) > 0) anyReceived = true;
    if (Number(l.quantity_received) < Number(l.quantity_ordered)) allComplete = false;
  }

  const next: PurchaseOrderStatus = allComplete ? 'received' : anyReceived ? 'partially_received' : 'open';
  if (next !== po.status) {
    await trx('purchase_orders').where({ tenant, po_id: poId }).update({ status: next, updated_at: trx.fn.now() });
  }
  return next;
}

export const getPurchaseOrder = withAuth(
  async (user, { tenant }, poId: string): Promise<IPurchaseOrder | null | PurchaseOrderActionError> => {
    return withPurchaseOrderActionErrors(async () => {
      await requirePoPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        const po = await trx('purchase_orders').where({ tenant, po_id: poId }).first();
        if (!po) return null;
        const lines = (await trx('purchase_order_lines')
          .where({ tenant, po_id: poId })
          .orderBy('created_at', 'asc')) as IPurchaseOrderLine[];
        return { ...(po as IPurchaseOrder), lines };
      });
    });
  },
);

/**
 * A purchase order plus the per-PO line aggregates the list view needs — committed
 * amount (the defining number of a PO), receive progress, and line count — so the grid
 * can answer "how much money / how much still owed" without an N+1 drill-in per row.
 */
export type PurchaseOrderListRow = IPurchaseOrder & {
  /** Σ(unit_cost × quantity_ordered) across lines, in integer cents (PO currency). */
  total_amount: number;
  qty_ordered: number;
  qty_received: number;
  line_count: number;
  /** Joined server-side so the grid never flashes a raw vendor UUID. */
  vendor_name: string | null;
};

export const listPurchaseOrders = withAuth(
  async (user, { tenant }, opts?: { status?: PurchaseOrderStatus; vendor_id?: string }): Promise<PurchaseOrderListRow[] | PurchaseOrderActionError> => {
    return withPurchaseOrderActionErrors(async () => {
      await requirePoPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        // Per-PO line rollup: committed dollar total and received/ordered progress.
        const lineAgg = trx('purchase_order_lines')
          .where({ tenant })
          .groupBy('po_id')
          .select('po_id')
          .select(trx.raw('COALESCE(SUM(unit_cost * quantity_ordered), 0) as total_amount'))
          .select(trx.raw('COALESCE(SUM(quantity_ordered), 0) as qty_ordered'))
          .select(trx.raw('COALESCE(SUM(quantity_received), 0) as qty_received'))
          .select(trx.raw('COUNT(*) as line_count'))
          .as('la');

        const q = trx('purchase_orders as po')
          .leftJoin(lineAgg, 'la.po_id', 'po.po_id')
          .leftJoin('vendors as v', function () {
            this.on('v.vendor_id', '=', 'po.vendor_id').andOn('v.tenant', '=', 'po.tenant');
          })
          .where({ 'po.tenant': tenant });
        if (opts?.status) q.andWhere({ 'po.status': opts.status });
        if (opts?.vendor_id) q.andWhere({ 'po.vendor_id': opts.vendor_id });

        const rows = await q
          .select('po.*')
          .select('v.vendor_name')
          .select(trx.raw('COALESCE(la.total_amount, 0)::bigint as total_amount'))
          .select(trx.raw('COALESCE(la.qty_ordered, 0)::int as qty_ordered'))
          .select(trx.raw('COALESCE(la.qty_received, 0)::int as qty_received'))
          .select(trx.raw('COALESCE(la.line_count, 0)::int as line_count'))
          .orderBy('po.order_date', 'desc');

        // pg returns bigint as a string; coerce the money/count fields to numbers.
        return rows.map((r: any) => ({
          ...r,
          total_amount: Number(r.total_amount),
          qty_ordered: Number(r.qty_ordered),
          qty_received: Number(r.qty_received),
          line_count: Number(r.line_count),
        })) as PurchaseOrderListRow[];
      });
    });
  },
);

/**
 * Vendor price-list defaulting for a PO line (F056): when the caller doesn't supply
 * a cost, price from the PO vendor's offer (matching currency), else the product's
 * average/catalog cost. Returns the vendor SKU snapshot for the paperwork (F057).
 */
async function resolvePoLineDefaults(
  trx: Knex.Transaction,
  tenant: string,
  vendorId: string,
  serviceId: string,
  poCurrency: string,
  explicitCost?: number | null,
): Promise<{ unit_cost: number; vendor_sku: string | null }> {
  const offer = await trx('vendor_products')
    .where({ tenant, vendor_id: vendorId, service_id: serviceId })
    .first();
  const vendorSku: string | null = offer?.vendor_sku ?? null;
  if (explicitCost != null) return { unit_cost: Number(explicitCost), vendor_sku: vendorSku };
  if (offer?.unit_cost != null && offer.cost_currency === poCurrency) {
    return { unit_cost: Number(offer.unit_cost), vendor_sku: vendorSku };
  }
  const pis = await trx('product_inventory_settings')
    .where({ tenant, service_id: serviceId })
    .select('average_cost')
    .first();
  const sc = await trx('service_catalog').where({ tenant, service_id: serviceId }).select('cost').first();
  return { unit_cost: Number(pis?.average_cost ?? sc?.cost ?? 0), vendor_sku: vendorSku };
}

export const createPurchaseOrder = withAuth(
  async (
    user,
    { tenant },
    input: {
      vendor_id: string;
      currency_code: string;
      ship_to_location_id?: string | null;
      expected_date?: string | Date | null;
      order_date?: string | Date | null;
      is_drop_ship?: boolean;
      drop_ship_client_id?: string | null;
      drop_ship_address?: Record<string, unknown> | null;
      notes?: string | null;
      lines?: Array<{ service_id: string; quantity_ordered: number; unit_cost?: number | null; cost_currency?: string }>;
    },
  ): Promise<IPurchaseOrder | PurchaseOrderActionError> => {
    return withPurchaseOrderActionErrors(async () => {
      await requirePoPerm(user, 'create');
      if (!input.vendor_id) throw new Error('vendor_id is required');
      const currency = (input.currency_code ?? '').trim();
      if (!currency) throw new Error('currency_code is required');

      const { knex: db } = await createTenantKnex();
      const result = await withTransaction(db, async (trx: Knex.Transaction) => {
        const vendor = await trx('vendors').where({ tenant, vendor_id: input.vendor_id }).first();
        if (!vendor) throw new Error('Vendor not found');

        const r = await trx.raw('SELECT generate_next_number(?::uuid, ?) as number', [tenant, 'PURCHASE_ORDER']);
        const poNumber: string = r.rows[0].number;

        const [po] = await trx('purchase_orders')
          .insert({
            tenant,
            po_number: poNumber,
            vendor_id: input.vendor_id,
            status: 'draft',
            order_date: input.order_date ?? trx.fn.now(),
            expected_date: input.expected_date ?? null,
            ship_to_location_id: input.ship_to_location_id ?? null,
            is_drop_ship: input.is_drop_ship ?? false,
            drop_ship_client_id: input.drop_ship_client_id ?? null,
            drop_ship_address: input.drop_ship_address ?? null,
            currency_code: currency,
            notes: input.notes ?? null,
            created_by: user.user_id,
          })
          .returning('*');

        const lines: IPurchaseOrderLine[] = [];
        for (const l of input.lines ?? []) {
          const lineCurrency = (l.cost_currency ?? currency).trim();
          if (lineCurrency !== currency) {
            throw new Error(`Line cost_currency (${lineCurrency}) must match PO currency_code (${currency})`);
          }
          if (!(Number(l.quantity_ordered) > 0)) throw new Error('quantity_ordered must be greater than 0');
          const defaults = await resolvePoLineDefaults(
            trx,
            tenant,
            input.vendor_id,
            l.service_id,
            currency,
            l.unit_cost,
          );
          const [row] = await trx('purchase_order_lines')
            .insert({
              tenant,
              po_id: (po as IPurchaseOrder).po_id,
              service_id: l.service_id,
              quantity_ordered: l.quantity_ordered,
              quantity_received: 0,
              unit_cost: defaults.unit_cost,
              vendor_sku: defaults.vendor_sku,
              cost_currency: lineCurrency,
            })
            .returning('*');
          lines.push(row as IPurchaseOrderLine);
        }

        return { ...(po as IPurchaseOrder), lines };
      });

      await publishInventoryEvent('INVENTORY_PURCHASE_ORDER_CREATED', timestampPayload({
        tenant,
        po_id: result.po_id,
        user_id: user.user_id,
      }));

      return result;
    });
  },
);

export const addPoLine = withAuth(
  async (
    user,
    { tenant },
    poId: string,
    input: { service_id: string; quantity_ordered: number; unit_cost?: number | null; cost_currency?: string; source_so_line_id?: string | null },
  ): Promise<IPurchaseOrderLine> => {
    await requirePoPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const po = await getPoOrThrow(trx, tenant, poId);
      if (po.status === 'cancelled' || po.status === 'received') {
        throw new Error(`Cannot add a line to a ${po.status} purchase order`);
      }
      const lineCurrency = (input.cost_currency ?? po.currency_code).trim();
      if (lineCurrency !== po.currency_code) {
        throw new Error(`Line cost_currency (${lineCurrency}) must match PO currency_code (${po.currency_code})`);
      }
      if (!(Number(input.quantity_ordered) > 0)) throw new Error('quantity_ordered must be greater than 0');

      // Price from the vendor's offer when the caller didn't specify a cost (F056).
      const defaults = await resolvePoLineDefaults(
        trx,
        tenant,
        po.vendor_id,
        input.service_id,
        po.currency_code,
        input.unit_cost,
      );

      const [row] = await trx('purchase_order_lines')
        .insert({
          tenant,
          po_id: poId,
          service_id: input.service_id,
          quantity_ordered: input.quantity_ordered,
          quantity_received: 0,
          unit_cost: defaults.unit_cost,
          vendor_sku: defaults.vendor_sku,
          cost_currency: lineCurrency,
          source_so_line_id: input.source_so_line_id ?? null,
        })
        .returning('*');
      return row as IPurchaseOrderLine;
    });

    await publishInventoryEvent('INVENTORY_PURCHASE_ORDER_UPDATED', timestampPayload({
      tenant,
      po_id: poId,
      user_id: user.user_id,
      changed_fields: ['lines'],
    }));

    return result;
  },
);

export const updatePoLine = withAuth(
  async (
    user,
    { tenant },
    poLineId: string,
    patch: Partial<Pick<IPurchaseOrderLine, 'quantity_ordered' | 'unit_cost' | 'cost_currency'>>,
  ): Promise<IPurchaseOrderLine> => {
    await requirePoPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const line = await getPoLineOrThrow(trx, tenant, poLineId);
      const po = await getPoOrThrow(trx, tenant, line.po_id);
      if (po.status === 'cancelled' || po.status === 'received') {
        throw new Error(`Cannot edit a line on a ${po.status} purchase order`);
      }
      if (patch.cost_currency !== undefined && patch.cost_currency !== po.currency_code) {
        throw new Error(`Line cost_currency (${patch.cost_currency}) must match PO currency_code (${po.currency_code})`);
      }
      if (patch.quantity_ordered !== undefined && !(Number(patch.quantity_ordered) > 0)) {
        throw new Error('quantity_ordered must be greater than 0');
      }

      const update: Record<string, unknown> = { updated_at: trx.fn.now() };
      for (const k of ['quantity_ordered', 'unit_cost', 'cost_currency'] as const) {
        if (k in patch) update[k] = (patch as any)[k];
      }
      const [row] = await trx('purchase_order_lines').where({ tenant, po_line_id: poLineId }).update(update).returning('*');
      return row as IPurchaseOrderLine;
    });

    await publishInventoryEvent('INVENTORY_PURCHASE_ORDER_UPDATED', timestampPayload({
      tenant,
      po_id: result.po_id,
      user_id: user.user_id,
      changed_fields: Object.keys(patch),
    }));

    return result;
  },
);

export const removePoLine = withAuth(
  async (user, { tenant }, poLineId: string): Promise<{ removed: boolean }> => {
    await requirePoPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const line = await getPoLineOrThrow(trx, tenant, poLineId);
      if (Number(line.quantity_received) > 0) {
        throw new Error('Cannot remove a line that has already received stock');
      }
      const po = await getPoOrThrow(trx, tenant, line.po_id);
      if (po.status === 'cancelled') throw new Error('Cannot edit a cancelled purchase order');
      await trx('purchase_order_lines').where({ tenant, po_line_id: poLineId }).del();
      return { removed: true, po_id: po.po_id };
    });

    await publishInventoryEvent('INVENTORY_PURCHASE_ORDER_UPDATED', timestampPayload({
      tenant,
      po_id: result.po_id,
      user_id: user.user_id,
      changed_fields: ['lines'],
    }));

    return { removed: result.removed };
  },
);

export const submitPurchaseOrder = withAuth(
  async (user, { tenant }, poId: string): Promise<IPurchaseOrder | PurchaseOrderActionError> => {
    return withPurchaseOrderActionErrors(async () => {
      await requirePoPerm(user, 'update');
      const { knex: db } = await createTenantKnex();
      const result = await withTransaction(db, async (trx: Knex.Transaction) => {
        const po = await getPoOrThrow(trx, tenant, poId);
        if (po.status !== 'draft') throw new Error(`Only draft purchase orders can be submitted (current: ${po.status})`);
        const lineCount = await trx('purchase_order_lines').where({ tenant, po_id: poId }).count<{ c: string }>('* as c').first();
        if (Number(lineCount?.c ?? 0) === 0) throw new Error('Cannot submit a purchase order with no lines');

        const [row] = await trx('purchase_orders')
          .where({ tenant, po_id: poId })
          .update({ status: 'open', updated_at: trx.fn.now() })
          .returning('*');
        return row as IPurchaseOrder;
      });

      await publishInventoryEvent('INVENTORY_PURCHASE_ORDER_UPDATED', timestampPayload({
        tenant,
        po_id: poId,
        user_id: user.user_id,
        changed_fields: ['status'],
      }));

      return result;
    });
  },
);

export const cancelPurchaseOrder = withAuth(
  async (user, { tenant }, poId: string): Promise<IPurchaseOrder | PurchaseOrderActionError> => {
    return withPurchaseOrderActionErrors(async () => {
      await requirePoPerm(user, 'update');
      const { knex: db } = await createTenantKnex();
      const result = await withTransaction(db, async (trx: Knex.Transaction) => {
        const po = await getPoOrThrow(trx, tenant, poId, { forUpdate: true });
        if (po.status === 'cancelled') return po;
        if (po.status === 'received') throw new Error('Cannot cancel a fully received purchase order');

        const received = await trx('purchase_order_lines')
          .where({ tenant, po_id: poId })
          .andWhere('quantity_received', '>', 0)
          .first();
        if (received) throw new Error('Cannot cancel a purchase order that has already received stock');

        const [row] = await trx('purchase_orders')
          .where({ tenant, po_id: poId })
          .update({ status: 'cancelled', updated_at: trx.fn.now() })
          .returning('*');
        return row as IPurchaseOrder;
      });

      await publishInventoryEvent('INVENTORY_PURCHASE_ORDER_UPDATED', timestampPayload({
        tenant,
        po_id: poId,
        user_id: user.user_id,
        changed_fields: ['status'],
      }));

      return result;
    });
  },
);

export interface ReceivePoLineResult {
  po_line: IPurchaseOrderLine;
  po_status: PurchaseOrderStatus;
  units: IStockUnit[];
  /** True when cumulative quantity_received now exceeds quantity_ordered. */
  over_receipt: boolean;
}

/**
 * Receive stock against a PO line (design §6.A). Writes 'receipt' movement(s) through the
 * movement primitive, increments quantity_received, recomputes the moving-average cost for
 * non-serialized products, and recomputes PO status (open → partially_received → received).
 * Over-receipt is allowed but flagged with a warning.
 */
export const receivePoLine = withAuth(
  async (
    user,
    { tenant },
    poLineId: string,
    input: {
      location_id: string;
      quantity: number;
      serials?: Array<{
        serial_number: string;
        mac_address?: string | null;
        warranty_expires_at?: string | Date | null;
        warranty_term?: string | null;
      }>;
    },
  ): Promise<ReceivePoLineResult | PurchaseOrderActionError> => {
    return withPurchaseOrderActionErrors(async () => {
    await requirePoPerm(user, 'update');
    const qty = Number(input.quantity);
    if (!(qty > 0)) throw new Error('quantity must be greater than 0');
    if (!input.location_id) throw new Error('location_id is required');

    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const lineProbe = await getPoLineOrThrow(trx, tenant, poLineId);
      // Parent-first lock order (PO header, then line) — receive/cancel serialize (F020).
      const po = await getPoOrThrow(trx, tenant, lineProbe.po_id, { forUpdate: true });
      const line = (await trx('purchase_order_lines')
        .where({ tenant, po_line_id: poLineId })
        .forUpdate()
        .first()) as IPurchaseOrderLine;
      if (po.status === 'draft') throw new Error('Cannot receive against a draft purchase order; submit it first');
      if (po.status === 'cancelled') throw new Error('Cannot receive against a cancelled purchase order');

      // Currency guard: the line cost currency must match the PO currency.
      if (line.cost_currency !== po.currency_code) {
        throw new Error(`Line cost_currency (${line.cost_currency}) must match PO currency_code (${po.currency_code})`);
      }

      const location = await trx('stock_locations').where({ tenant, location_id: input.location_id }).first();
      if (!location) throw new Error('Stock location not found');

      // Locked: the moving-average update below is a read-modify-write on this row (F020).
      const settings = await trx('product_inventory_settings')
        .where({ tenant, service_id: line.service_id })
        .forUpdate()
        .first();
      if (!settings) throw new Error('Inventory is not enabled for this product');
      if (!settings.track_stock) throw new Error('Inventory tracking is disabled for this product');

      // Currency guard vs the product's existing cost basis (F042): blending a receipt
      // in one currency into an average held in another silently corrupts the average.
      // Same guard receiveStockManual has; convert the PO (or the product) first.
      if (settings.cost_currency && line.cost_currency && settings.cost_currency !== line.cost_currency) {
        const held = await trx('stock_levels')
          .where({ tenant, service_id: line.service_id })
          .sum<{ s: string }>('quantity_on_hand as s')
          .first();
        if (Number(held?.s ?? 0) > 0 || Number(settings.average_cost ?? 0) > 0) {
          throw new Error(
            `Receipt currency (${line.cost_currency}) does not match the product's cost currency (${settings.cost_currency}); cannot blend into the moving average`,
          );
        }
      }

      const isSerialized: boolean = settings.is_serialized;
      const unitCost = Number(line.unit_cost);
      const currency = line.cost_currency;
      const performedBy = user.user_id;
      const units: IStockUnit[] = [];

      if (isSerialized) {
        const serials = input.serials ?? [];
        if (serials.length !== qty) {
          throw new Error(`Serialized receipt requires exactly ${qty} serial(s); got ${serials.length}`);
        }

        // Enforce serial + MAC uniqueness up front (within tenant), and within this batch.
        const seenSerials = new Set<string>();
        const seenMacs = new Set<string>();
        for (const s of serials) {
          const serial = (s.serial_number ?? '').trim();
          if (!serial) throw new Error('Each serialized unit requires a serial_number');
          if (seenSerials.has(serial)) throw new Error(`Duplicate serial_number in batch: ${serial}`);
          seenSerials.add(serial);
          const existingSerial = await trx('stock_units')
            .where({ tenant, service_id: line.service_id, serial_number: serial })
            .first();
          if (existingSerial) throw new Error(`Serial number already exists: ${serial}`);

          const mac = s.mac_address ? String(s.mac_address).trim() : null;
          if (mac) {
            if (seenMacs.has(mac)) throw new Error(`Duplicate mac_address in batch: ${mac}`);
            seenMacs.add(mac);
            const existingMac = await trx('stock_units').where({ tenant, mac_address: mac }).first();
            if (existingMac) throw new Error(`MAC address already exists: ${mac}`);
          }
        }

        // Insert each unit (in_stock at the receiving location) THEN record a per-unit receipt.
        for (const s of serials) {
          const [unit] = await trx('stock_units')
            .insert({
              tenant,
              service_id: line.service_id,
              serial_number: (s.serial_number ?? '').trim(),
              mac_address: s.mac_address ? String(s.mac_address).trim() : null,
              status: 'in_stock',
              location_id: input.location_id,
              unit_cost: unitCost,
              cost_currency: currency,
              warranty_expires_at: s.warranty_expires_at ?? null,
              warranty_term: s.warranty_term ?? null,
              received_at: trx.fn.now(),
              source_po_id: po.po_id,
            })
            .returning('*');

          await recordStockMovement(trx, tenant, {
            movement_type: 'receipt',
            service_id: line.service_id,
            quantity: 1,
            unit_id: (unit as IStockUnit).unit_id,
            to_location_id: input.location_id,
            unit_cost: unitCost,
            cost_currency: currency,
            source_doc_type: 'purchase_order',
            source_doc_id: po.po_id,
            performed_by: performedBy,
          });

          units.push(unit as IStockUnit);
        }
      } else {
        // Non-serialized: capture pre-receipt on-hand for the moving-average, then a batch receipt.
        const sumRow = await trx('stock_levels')
          .where({ tenant, service_id: line.service_id })
          .sum<{ s: string }>('quantity_on_hand as s')
          .first();
        const oldQty = Number(sumRow?.s ?? 0);
        const oldAvg = Number(settings.average_cost ?? 0);

        await recordStockMovement(trx, tenant, {
          movement_type: 'receipt',
          service_id: line.service_id,
          quantity: qty,
          to_location_id: input.location_id,
          unit_cost: unitCost,
          cost_currency: currency,
          source_doc_type: 'purchase_order',
          source_doc_id: po.po_id,
          performed_by: performedBy,
        });

        // Moving-average: new_avg = (old_qty*old_avg + recv_qty*recv_cost) / (old_qty + recv_qty)
        const denom = oldQty + qty;
        const newAvg = denom > 0 ? Math.round((oldQty * oldAvg + qty * unitCost) / denom) : unitCost;
        await trx('product_inventory_settings')
          .where({ tenant, service_id: line.service_id })
          .update({ average_cost: newAvg, cost_currency: currency, updated_at: trx.fn.now() });
      }

      // Increment quantity_received on the line.
      const [updatedLine] = await trx('purchase_order_lines')
        .where({ tenant, po_line_id: poLineId })
        .update({ quantity_received: trx.raw('quantity_received + ?', [qty]), updated_at: trx.fn.now() })
        .returning('*');

      const overReceipt = Number((updatedLine as IPurchaseOrderLine).quantity_received) > Number(line.quantity_ordered);
      const poStatus = await recomputePoStatus(trx, tenant, po.po_id);
      const receivedLineCount = await trx('purchase_order_lines')
        .where({ tenant, po_id: po.po_id })
        .andWhere('quantity_received', '>', 0)
        .count<{ c: string }>('* as c')
        .first();
      const vendor = po.vendor_id
        ? await trx('vendors').where({ tenant, vendor_id: po.vendor_id }).select('vendor_name').first()
        : null;

      return {
        po_line: updatedLine as IPurchaseOrderLine,
        po_status: poStatus,
        units,
        over_receipt: overReceipt,
        po_received_event: {
          tenant,
          po_id: po.po_id,
          po_number: po.po_number,
          vendor_id: po.vendor_id ?? null,
          vendor_name: vendor?.vendor_name ?? null,
          received_line_count: Number(receivedLineCount?.c ?? 0),
        },
      };
    });

    await publishInventoryEvent('INVENTORY_PO_RECEIVED', result.po_received_event);
    await publishInventoryEvent('INVENTORY_PURCHASE_ORDER_UPDATED', timestampPayload({
      tenant,
      po_id: result.po_line.po_id,
      user_id: user.user_id,
      changed_fields: ['status', 'quantity_received'],
    }));
    for (const unit of result.units) {
      await publishInventoryEvent('INVENTORY_STOCK_UNIT_CREATED', timestampPayload({
        tenant,
        unit_id: unit.unit_id,
        service_id: unit.service_id,
        user_id: user.user_id,
      }));
    }

    const { po_received_event: _poReceivedEvent, ...publicResult } = result;
    return publicResult;
    });
  },
);
