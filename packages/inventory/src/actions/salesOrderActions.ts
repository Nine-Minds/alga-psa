'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  ISalesOrder,
  ISalesOrderLine,
  IPurchaseOrder,
  IPurchaseOrderLine,
  SalesOrderInvoiceMode,
  SalesOrderAllocationMode,
  SalesOrderLineFulfillmentType,
} from '@alga-psa/types';
import { availableQuantity, applyAllocationDelta, recomputeSerializedOnHand } from '../lib';
import { explodeKitOntoSalesOrder } from './kitActions';

/**
 * Sales orders (outbound document) — see design §6.I.
 *
 * Allocation model (per allocation_mode):
 * - Non-serialized: on-hand is untouched; a per-location counter is bumped — `reserved_quantity`
 *   (soft) or `held_quantity` (hard). `available = on_hand - reserved - held` then drops.
 * - Serialized: the chosen units move `in_stock → allocated` (carrying `allocated_so_line_id`), and
 *   the location's on-hand cache is RECOMPUTED from in_stock counts (so it drops). The
 *   `allocated_so_line_id` marker is what stops a casual material pull from poaching committed stock.
 *   Allocation is NOT a stock movement, so it does not flow through `recordStockMovement`.
 */

const INVOICE_MODES: SalesOrderInvoiceMode[] = ['on_fulfillment', 'manual'];
const ALLOCATION_MODES: SalesOrderAllocationMode[] = ['soft', 'hard'];
const FULFILLMENT_TYPES: SalesOrderLineFulfillmentType[] = ['from_stock', 'drop_ship'];

async function requireSoPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'sales_order', action))) {
    throw new Error(`Permission denied: sales_order ${action} required`);
  }
}

interface ProductMeta {
  is_serialized: boolean;
  is_kit: boolean;
  track_stock: boolean;
  default_location_id: string | null;
  preferred_vendor_id: string | null;
  average_cost: number | null;
  cost_currency: string | null;
  catalog_cost: number | null;
}

/** Merge product_inventory_settings + service_catalog for a service (settings may be absent). */
async function getProductMeta(trx: Knex.Transaction, tenant: string, serviceId: string): Promise<ProductMeta> {
  const settings = await trx('product_inventory_settings').where({ tenant, service_id: serviceId }).first();
  const catalog = await trx('service_catalog').where({ tenant, service_id: serviceId }).select('cost', 'cost_currency').first();
  return {
    is_serialized: Boolean(settings?.is_serialized),
    is_kit: Boolean(settings?.is_kit),
    track_stock: Boolean(settings?.track_stock),
    default_location_id: settings?.default_location_id ?? null,
    preferred_vendor_id: settings?.preferred_vendor_id ?? null,
    average_cost: settings?.average_cost ?? null,
    cost_currency: settings?.cost_currency ?? catalog?.cost_currency ?? null,
    catalog_cost: catalog?.cost ?? null,
  };
}

async function getSoOrThrow(trx: Knex.Transaction, tenant: string, soId: string): Promise<ISalesOrder> {
  const row = await trx('sales_orders').where({ tenant, so_id: soId }).first();
  if (!row) throw new Error('Sales order not found');
  return row as ISalesOrder;
}

async function loadLines(trx: Knex.Transaction, tenant: string, soId: string): Promise<ISalesOrderLine[]> {
  return (await trx('sales_order_lines')
    .where({ tenant, so_id: soId })
    .orderBy('created_at', 'asc')) as ISalesOrderLine[];
}

/** Total available (across all locations) for a service. */
async function totalAvailable(trx: Knex.Transaction, tenant: string, serviceId: string): Promise<number> {
  const rows = await trx('stock_levels').where({ tenant, service_id: serviceId });
  return rows.reduce((sum: number, r: any) => sum + availableQuantity(r), 0);
}

/** Resolve the single location an allocation should draw from: default first, else most-available. */
async function resolveAllocationLocation(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  meta: ProductMeta,
): Promise<string | null> {
  if (meta.default_location_id) return meta.default_location_id;
  const rows = await trx('stock_levels').where({ tenant, service_id: serviceId });
  let best: { location_id: string; available: number } | null = null;
  for (const r of rows as any[]) {
    const avail = availableQuantity(r);
    if (avail > 0 && (!best || avail > best.available)) best = { location_id: r.location_id, available: avail };
  }
  return best?.location_id ?? null;
}

/** Allocate one line's outstanding quantity per the SO's allocation mode. Partial/zero is fine (backorder). */
async function allocateLine(
  trx: Knex.Transaction,
  tenant: string,
  so: ISalesOrder,
  line: ISalesOrderLine,
  meta: ProductMeta,
): Promise<void> {
  const remaining = Number(line.quantity_ordered) - Number(line.quantity_fulfilled ?? 0);
  if (remaining <= 0) return;

  if (meta.is_serialized) {
    const preferred = await resolveAllocationLocation(trx, tenant, line.service_id, meta);
    // Pick in_stock units, preferring the resolved location, then FIFO by received_at.
    const q = trx('stock_units')
      .where({ tenant, service_id: line.service_id, status: 'in_stock' })
      .limit(remaining);
    const units = preferred
      ? ((await q.orderByRaw('CASE WHEN location_id = ? THEN 0 ELSE 1 END ASC, received_at ASC NULLS LAST', [preferred])) as any[])
      : ((await q.orderByRaw('received_at ASC NULLS LAST')) as any[]);

    const touched = new Set<string>();
    for (const u of units) {
      await trx('stock_units')
        .where({ tenant, unit_id: u.unit_id })
        .update({ status: 'allocated', allocated_so_line_id: line.so_line_id, updated_at: trx.fn.now() });
      if (u.location_id) touched.add(u.location_id);
    }
    for (const loc of touched) await recomputeSerializedOnHand(trx, tenant, line.service_id, loc);
    return;
  }

  // Non-serialized: bump the per-location reserved (soft) / held (hard) counter.
  const location = await resolveAllocationLocation(trx, tenant, line.service_id, meta);
  if (!location) return; // nothing on hand anywhere → backorder
  const column = so.allocation_mode === 'hard' ? 'held_quantity' : 'reserved_quantity';
  await applyAllocationDelta(trx, tenant, line.service_id, location, column, remaining);
}

/** Decrement a per-location allocation counter for a service by `amount`, draining from the rows that hold it. */
async function reverseAllocationCounter(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  column: 'reserved_quantity' | 'held_quantity',
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  let remaining = amount;
  const rows = (await trx('stock_levels')
    .where({ tenant, service_id: serviceId })
    .andWhere(column, '>', 0)
    .orderBy(column, 'desc')) as any[];
  for (const r of rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(r[column]));
    await applyAllocationDelta(trx, tenant, serviceId, r.location_id, column, -take);
    remaining -= take;
  }
}

/** Reverse every allocation held by an SO's lines (serialized units → in_stock; reserved/held counters drained). */
async function releaseAllocations(
  trx: Knex.Transaction,
  tenant: string,
  so: ISalesOrder,
  lines: ISalesOrderLine[],
): Promise<void> {
  // Serialized: return any units still parked on these lines (not yet delivered) to in_stock.
  const lineIds = lines.map((l) => l.so_line_id);
  if (lineIds.length > 0) {
    const units = (await trx('stock_units')
      .where({ tenant, status: 'allocated' })
      .whereIn('allocated_so_line_id', lineIds)) as any[];
    for (const u of units) {
      await trx('stock_units')
        .where({ tenant, unit_id: u.unit_id })
        .update({ status: 'in_stock', allocated_so_line_id: null, updated_at: trx.fn.now() });
    }
    for (const u of units) {
      if (u.location_id) await recomputeSerializedOnHand(trx, tenant, u.service_id, u.location_id);
    }
  }

  // Non-serialized: drain the reserved/held counter by each line's outstanding quantity.
  const column = so.allocation_mode === 'hard' ? 'held_quantity' : 'reserved_quantity';
  for (const line of lines) {
    const meta = await getProductMeta(trx, tenant, line.service_id);
    if (meta.is_serialized || meta.is_kit) continue;
    if (line.fulfillment_type === 'drop_ship') continue;
    const outstanding = Number(line.quantity_ordered) - Number(line.quantity_fulfilled ?? 0);
    await reverseAllocationCounter(trx, tenant, line.service_id, column, outstanding);
  }
}

export const getSalesOrder = withAuth(
  async (user, { tenant }, soId: string): Promise<(ISalesOrder & { lines: ISalesOrderLine[] }) | null> => {
    await requireSoPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const row = await trx('sales_orders').where({ tenant, so_id: soId }).first();
      if (!row) return null;
      const lines = await loadLines(trx, tenant, soId);
      return { ...(row as ISalesOrder), lines };
    });
  },
);

export const listSalesOrders = withAuth(
  async (user, { tenant }, _input?: { includeCancelled?: boolean }): Promise<ISalesOrder[]> => {
    await requireSoPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Join the client so the list can show a name, not a raw UUID.
      return (await trx('sales_orders as so')
        .leftJoin('clients as c', function () {
          this.on('c.client_id', '=', 'so.client_id').andOn('c.tenant', '=', 'so.tenant');
        })
        .where('so.tenant', tenant)
        .orderBy('so.created_at', 'desc')
        .select('so.*', 'c.client_name')) as ISalesOrder[];
    });
  },
);

export const createSalesOrder = withAuth(
  async (
    user,
    { tenant },
    input: {
      client_id: string;
      currency_code: string;
      invoice_mode: SalesOrderInvoiceMode;
      allocation_mode: SalesOrderAllocationMode;
      client_po_number?: string | null;
      order_date?: string | Date | null;
      expected_ship_date?: string | Date | null;
      ship_to?: Record<string, unknown> | null;
      notes?: string | null;
      lines?: Array<{
        service_id: string;
        quantity_ordered: number;
        unit_price: number;
        tax_rate_id?: string | null;
        fulfillment_type?: SalesOrderLineFulfillmentType;
        currency_code?: string;
      }>;
    },
  ): Promise<ISalesOrder & { lines: ISalesOrderLine[] }> => {
    await requireSoPerm(user, 'create');
    if (!input.client_id) throw new Error('client_id is required');
    const currency = (input.currency_code ?? '').trim();
    if (!currency) throw new Error('currency_code is required');
    const invoiceMode: SalesOrderInvoiceMode = input.invoice_mode ?? 'on_fulfillment';
    if (!INVOICE_MODES.includes(invoiceMode)) throw new Error(`Invalid invoice_mode: ${invoiceMode}`);
    const allocationMode: SalesOrderAllocationMode = input.allocation_mode ?? 'soft';
    if (!ALLOCATION_MODES.includes(allocationMode)) throw new Error(`Invalid allocation_mode: ${allocationMode}`);

    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const r = await trx.raw('SELECT generate_next_number(?::uuid, ?) as number', [tenant, 'SALES_ORDER']);
      const soNumber: string = r.rows[0].number;

      const [so] = await trx('sales_orders')
        .insert({
          tenant,
          so_number: soNumber,
          client_id: input.client_id,
          status: 'draft',
          order_date: input.order_date ?? trx.fn.now(),
          expected_ship_date: input.expected_ship_date ?? null,
          ship_to: input.ship_to ?? null,
          currency_code: currency,
          client_po_number: input.client_po_number ?? null,
          invoice_mode: invoiceMode,
          allocation_mode: allocationMode,
          notes: input.notes ?? null,
          created_by: user.user_id,
        })
        .returning('*');
      const soId = (so as ISalesOrder).so_id;

      for (const l of input.lines ?? []) {
        if (!(Number(l.quantity_ordered) > 0)) throw new Error('quantity_ordered must be greater than 0');
        // Currency guard: an explicit per-line currency must match the SO currency.
        const lineCurrency = (l.currency_code ?? currency).trim();
        if (lineCurrency !== currency) {
          throw new Error(`Line currency (${lineCurrency}) must match sales order currency_code (${currency})`);
        }
        const fulfillmentType: SalesOrderLineFulfillmentType = l.fulfillment_type ?? 'from_stock';
        if (!FULFILLMENT_TYPES.includes(fulfillmentType)) {
          throw new Error(`Invalid fulfillment_type: ${fulfillmentType}`);
        }

        const meta = await getProductMeta(trx, tenant, l.service_id);
        if (meta.is_kit) {
          // Kit explosion is owned by kitActions — insert parent + component lines, don't duplicate it.
          await explodeKitOntoSalesOrder(trx, tenant, soId, l.service_id, l.quantity_ordered, l.unit_price);
          continue;
        }

        await trx('sales_order_lines').insert({
          tenant,
          so_id: soId,
          service_id: l.service_id,
          quantity_ordered: l.quantity_ordered,
          quantity_fulfilled: 0,
          quantity_invoiced: 0,
          unit_price: l.unit_price,
          cost_snapshot: meta.average_cost ?? meta.catalog_cost ?? null,
          tax_rate_id: l.tax_rate_id ?? null,
          fulfillment_type: fulfillmentType,
          parent_so_line_id: null,
        });
      }

      const lines = await loadLines(trx, tenant, soId);
      return { ...(so as ISalesOrder), lines };
    });
  },
);

export const addSoLine = withAuth(
  async (
    user,
    { tenant },
    soId: string,
    input: {
      service_id: string;
      quantity_ordered: number;
      unit_price: number;
      tax_rate_id?: string | null;
      fulfillment_type?: SalesOrderLineFulfillmentType;
      currency_code?: string;
    },
  ): Promise<ISalesOrderLine | ISalesOrderLine[]> => {
    await requireSoPerm(user, 'update');
    if (!(Number(input.quantity_ordered) > 0)) throw new Error('quantity_ordered must be greater than 0');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const so = await getSoOrThrow(trx, tenant, soId);
      if (so.status !== 'draft') throw new Error(`Cannot add a line to a ${so.status} sales order; release it first`);

      const lineCurrency = (input.currency_code ?? so.currency_code).trim();
      if (lineCurrency !== so.currency_code) {
        throw new Error(`Line currency (${lineCurrency}) must match sales order currency_code (${so.currency_code})`);
      }
      const fulfillmentType: SalesOrderLineFulfillmentType = input.fulfillment_type ?? 'from_stock';
      if (!FULFILLMENT_TYPES.includes(fulfillmentType)) throw new Error(`Invalid fulfillment_type: ${fulfillmentType}`);

      const meta = await getProductMeta(trx, tenant, input.service_id);
      if (meta.is_kit) {
        const exploded = await explodeKitOntoSalesOrder(trx, tenant, soId, input.service_id, input.quantity_ordered, input.unit_price);
        return [exploded.parentLine, ...exploded.componentLines];
      }

      const [row] = await trx('sales_order_lines')
        .insert({
          tenant,
          so_id: soId,
          service_id: input.service_id,
          quantity_ordered: input.quantity_ordered,
          quantity_fulfilled: 0,
          quantity_invoiced: 0,
          unit_price: input.unit_price,
          cost_snapshot: meta.average_cost ?? meta.catalog_cost ?? null,
          tax_rate_id: input.tax_rate_id ?? null,
          fulfillment_type: fulfillmentType,
          parent_so_line_id: null,
        })
        .returning('*');
      return row as ISalesOrderLine;
    });
  },
);

export const updateSoLine = withAuth(
  async (
    user,
    { tenant },
    soLineId: string,
    patch: Partial<Pick<ISalesOrderLine, 'quantity_ordered' | 'unit_price' | 'tax_rate_id' | 'fulfillment_type'>>,
  ): Promise<ISalesOrderLine> => {
    await requireSoPerm(user, 'update');
    if (patch.fulfillment_type && !FULFILLMENT_TYPES.includes(patch.fulfillment_type)) {
      throw new Error(`Invalid fulfillment_type: ${patch.fulfillment_type}`);
    }
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const line = await trx('sales_order_lines').where({ tenant, so_line_id: soLineId }).first();
      if (!line) throw new Error('Sales order line not found');
      const so = await getSoOrThrow(trx, tenant, line.so_id);
      if (so.status !== 'draft') throw new Error(`Cannot edit a line on a ${so.status} sales order; release it first`);
      if (patch.quantity_ordered !== undefined && !(Number(patch.quantity_ordered) > 0)) {
        throw new Error('quantity_ordered must be greater than 0');
      }

      const update: Record<string, unknown> = { updated_at: trx.fn.now() };
      for (const k of ['quantity_ordered', 'unit_price', 'tax_rate_id', 'fulfillment_type'] as const) {
        if (k in patch) update[k] = (patch as any)[k];
      }
      const [row] = await trx('sales_order_lines').where({ tenant, so_line_id: soLineId }).update(update).returning('*');
      return row as ISalesOrderLine;
    });
  },
);

export const removeSoLine = withAuth(
  async (user, { tenant }, soLineId: string): Promise<{ removed: boolean }> => {
    await requireSoPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const line = await trx('sales_order_lines').where({ tenant, so_line_id: soLineId }).first();
      if (!line) throw new Error('Sales order line not found');
      const so = await getSoOrThrow(trx, tenant, line.so_id);
      if (so.status !== 'draft') throw new Error(`Cannot remove a line from a ${so.status} sales order; release it first`);
      // Remove kit child lines along with the parent.
      await trx('sales_order_lines').where({ tenant, parent_so_line_id: soLineId }).del();
      await trx('sales_order_lines').where({ tenant, so_line_id: soLineId }).del();
      return { removed: true };
    });
  },
);

export const confirmSalesOrder = withAuth(
  async (user, { tenant }, soId: string): Promise<ISalesOrder & { lines: ISalesOrderLine[] }> => {
    await requireSoPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const so = await getSoOrThrow(trx, tenant, soId);
      if (so.status !== 'draft') throw new Error(`Only draft sales orders can be confirmed (current: ${so.status})`);

      const lines = await loadLines(trx, tenant, soId);
      for (const line of lines) {
        if (line.fulfillment_type === 'drop_ship') continue; // procured straight to client, never allocated from stock
        const meta = await getProductMeta(trx, tenant, line.service_id);
        if (meta.is_kit) continue; // kit parent is a container; its component lines carry the stock
        await allocateLine(trx, tenant, so, line, meta);
      }

      const [updated] = await trx('sales_orders')
        .where({ tenant, so_id: soId })
        .update({ status: 'confirmed', updated_at: trx.fn.now() })
        .returning('*');
      const finalLines = await loadLines(trx, tenant, soId);
      return { ...(updated as ISalesOrder), lines: finalLines };
    });
  },
);

/** Reverse allocations for a sales order (used on edit or cancel) without changing its status. */
export const releaseSalesOrderAllocation = withAuth(
  async (user, { tenant }, soId: string): Promise<{ released: boolean }> => {
    await requireSoPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const so = await getSoOrThrow(trx, tenant, soId);
      const lines = await loadLines(trx, tenant, soId);
      await releaseAllocations(trx, tenant, so, lines);
      return { released: true };
    });
  },
);

export interface BackorderLine {
  so_line_id: string;
  service_id: string;
  quantity_ordered: number;
  quantity_fulfilled: number;
  available: number;
  shortfall: number;
  backordered: boolean;
}

/** Per-line: ordered-minus-fulfilled vs. available, flagging shortfalls. */
export const computeBackorder = withAuth(
  async (user, { tenant }, soId: string): Promise<BackorderLine[]> => {
    await requireSoPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      await getSoOrThrow(trx, tenant, soId);
      const lines = await loadLines(trx, tenant, soId);
      const result: BackorderLine[] = [];
      for (const line of lines) {
        if (line.fulfillment_type === 'drop_ship') continue;
        const meta = await getProductMeta(trx, tenant, line.service_id);
        if (meta.is_kit) continue;
        const outstanding = Number(line.quantity_ordered) - Number(line.quantity_fulfilled ?? 0);
        const available = await totalAvailable(trx, tenant, line.service_id);
        const shortfall = Math.max(0, outstanding - available);
        result.push({
          so_line_id: line.so_line_id,
          service_id: line.service_id,
          quantity_ordered: Number(line.quantity_ordered),
          quantity_fulfilled: Number(line.quantity_fulfilled ?? 0),
          available,
          shortfall,
          backordered: shortfall > 0,
        });
      }
      return result;
    });
  },
);

export const cancelSalesOrder = withAuth(
  async (user, { tenant }, soId: string): Promise<ISalesOrder> => {
    await requireSoPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const so = await getSoOrThrow(trx, tenant, soId);
      if (so.status === 'cancelled') return so;
      const lines = await loadLines(trx, tenant, soId);
      // Guard: a sales order with any fulfilled or invoiced quantity cannot be cancelled.
      for (const line of lines) {
        if (Number(line.quantity_fulfilled ?? 0) > 0) throw new Error('Cannot cancel a sales order with fulfilled lines');
        if (Number(line.quantity_invoiced ?? 0) > 0) throw new Error('Cannot cancel a sales order with invoiced lines');
      }
      await releaseAllocations(trx, tenant, so, lines);
      const [updated] = await trx('sales_orders')
        .where({ tenant, so_id: soId })
        .update({ status: 'cancelled', updated_at: trx.fn.now() })
        .returning('*');
      return updated as ISalesOrder;
    });
  },
);

export interface SuggestedPurchaseOrders {
  purchaseOrders: Array<IPurchaseOrder & { lines: IPurchaseOrderLine[] }>;
  /** Backordered lines with no preferred vendor — no PO created, surfaced for manual handling. */
  unassigned: Array<{ so_line_id: string; service_id: string; quantity: number }>;
}

/**
 * Turn an SO's backorder into draft purchase orders, grouped by each product's preferred vendor,
 * with `source_so_line_id` links back to the originating SO line. Creating POs requires
 * `purchase_order:create`; lines without a preferred vendor are returned as `unassigned`.
 */
export const suggestPoFromBackorder = withAuth(
  async (user, { tenant }, soId: string): Promise<SuggestedPurchaseOrders> => {
    await requireSoPerm(user, 'read');
    if (!(await hasPermission(user, 'purchase_order', 'create'))) {
      throw new Error('Permission denied: purchase_order create required');
    }
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const so = await getSoOrThrow(trx, tenant, soId);
      const lines = await loadLines(trx, tenant, soId);

      // Group shortfall lines by preferred vendor.
      const byVendor = new Map<string, Array<{ line: ISalesOrderLine; meta: ProductMeta; quantity: number }>>();
      const unassigned: SuggestedPurchaseOrders['unassigned'] = [];

      for (const line of lines) {
        if (line.fulfillment_type === 'drop_ship') continue;
        const meta = await getProductMeta(trx, tenant, line.service_id);
        if (meta.is_kit) continue;
        const outstanding = Number(line.quantity_ordered) - Number(line.quantity_fulfilled ?? 0);
        const available = await totalAvailable(trx, tenant, line.service_id);
        const shortfall = Math.max(0, outstanding - available);
        if (shortfall <= 0) continue;
        if (!meta.preferred_vendor_id) {
          unassigned.push({ so_line_id: line.so_line_id, service_id: line.service_id, quantity: shortfall });
          continue;
        }
        const bucket = byVendor.get(meta.preferred_vendor_id) ?? [];
        bucket.push({ line, meta, quantity: shortfall });
        byVendor.set(meta.preferred_vendor_id, bucket);
      }

      const purchaseOrders: SuggestedPurchaseOrders['purchaseOrders'] = [];
      for (const [vendorId, items] of byVendor) {
        const r = await trx.raw('SELECT generate_next_number(?::uuid, ?) as number', [tenant, 'PURCHASE_ORDER']);
        const poNumber: string = r.rows[0].number;
        const [po] = await trx('purchase_orders')
          .insert({
            tenant,
            po_number: poNumber,
            vendor_id: vendorId,
            status: 'draft',
            order_date: trx.fn.now(),
            currency_code: so.currency_code,
            is_drop_ship: false,
            notes: `Suggested from backorder on sales order ${so.so_number}`,
            created_by: user.user_id,
          })
          .returning('*');

        const poLines: IPurchaseOrderLine[] = [];
        for (const it of items) {
          const unitCost = it.meta.average_cost ?? it.meta.catalog_cost ?? 0;
          const [row] = await trx('purchase_order_lines')
            .insert({
              tenant,
              po_id: (po as IPurchaseOrder).po_id,
              service_id: it.line.service_id,
              quantity_ordered: it.quantity,
              quantity_received: 0,
              unit_cost: unitCost,
              cost_currency: it.meta.cost_currency ?? so.currency_code,
              source_so_line_id: it.line.so_line_id,
            })
            .returning('*');
          poLines.push(row as IPurchaseOrderLine);
        }
        purchaseOrders.push({ ...(po as IPurchaseOrder), lines: poLines });
      }

      return { purchaseOrders, unassigned };
    });
  },
);
