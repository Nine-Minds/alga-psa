import { Knex } from 'knex';
import {
  IPurchaseOrder,
  IPurchaseOrderLine,
  IStockUnit,
  PurchaseOrderStatus,
} from '@alga-psa/types';
import { recordStockMovement } from './movements';
import { assertLocationWritable } from './scope';
import { resolveTenantCurrency } from './tenantCurrency';

export type PurchaseOrderQueryRow = IPurchaseOrder & {
  total_amount: number;
  qty_ordered: number;
  qty_received: number;
  line_count: number;
  vendor_name: string | null;
};

export interface PurchaseOrderWithLines extends IPurchaseOrder {
  lines: IPurchaseOrderLine[];
}

export interface CreatePurchaseOrderDraftInput {
  vendor_id: string;
  currency_code?: string;
  ship_to_location_id?: string | null;
  expected_date?: string | Date | null;
  order_date?: string | Date | null;
  is_drop_ship?: boolean;
  drop_ship_client_id?: string | null;
  drop_ship_address?: Record<string, unknown> | null;
  notes?: string | null;
  lines?: Array<{
    service_id: string;
    quantity_ordered: number;
    unit_cost?: number | null;
    cost_currency?: string;
  }>;
}

export interface PurchaseOrderCreatedEventPayload {
  tenant: string;
  po_id: string;
  user_id: string;
}

export interface CreatePurchaseOrderDraftCoreResult {
  purchase_order: PurchaseOrderWithLines;
  /** Publish INVENTORY_PURCHASE_ORDER_CREATED only after commit. */
  purchase_order_created_event: PurchaseOrderCreatedEventPayload;
}

export async function resolvePoLineDefaults(
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
  const settings = await trx('product_inventory_settings')
    .where({ tenant, service_id: serviceId })
    .select('average_cost')
    .first();
  const service = await trx('service_catalog')
    .where({ tenant, service_id: serviceId })
    .select('cost')
    .first();
  return { unit_cost: Number(settings?.average_cost ?? service?.cost ?? 0), vendor_sku: vendorSku };
}

/** Session-free draft creation path shared by web and workflow callers. */
export async function createPurchaseOrderDraftCore(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  input: CreatePurchaseOrderDraftInput,
): Promise<CreatePurchaseOrderDraftCoreResult> {
  if (!input.vendor_id) throw new Error('vendor_id is required');
  const currency = (input.currency_code ?? await resolveTenantCurrency(trx, tenant)).trim();
  if (!currency) throw new Error('currency_code is required');

  const vendor = await trx('vendors').where({ tenant, vendor_id: input.vendor_id }).first();
  if (!vendor) throw new Error('Vendor not found');

  const numberResult = await trx.raw(
    'SELECT generate_next_number(?::uuid, ?) as number',
    [tenant, 'PURCHASE_ORDER'],
  );
  const poNumber: string | undefined = numberResult.rows?.[0]?.number;
  if (!poNumber) throw new Error('Failed to generate purchase order number');

  const [po] = (await trx('purchase_orders')
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
      created_by: userId,
    })
    .returning('*')) as IPurchaseOrder[];

  const lines: IPurchaseOrderLine[] = [];
  for (const line of input.lines ?? []) {
    const lineCurrency = (line.cost_currency ?? currency).trim();
    if (lineCurrency !== currency) {
      throw new Error(`Line cost_currency (${lineCurrency}) must match PO currency_code (${currency})`);
    }
    if (!(Number(line.quantity_ordered) > 0)) {
      throw new Error('quantity_ordered must be greater than 0');
    }
    const defaults = await resolvePoLineDefaults(
      trx,
      tenant,
      input.vendor_id,
      line.service_id,
      currency,
      line.unit_cost,
    );
    const [createdLine] = (await trx('purchase_order_lines')
      .insert({
        tenant,
        po_id: po.po_id,
        service_id: line.service_id,
        quantity_ordered: line.quantity_ordered,
        quantity_received: 0,
        unit_cost: defaults.unit_cost,
        vendor_sku: defaults.vendor_sku,
        cost_currency: lineCurrency,
      })
      .returning('*')) as IPurchaseOrderLine[];
    lines.push(createdLine);
  }

  return {
    purchase_order: { ...po, lines },
    purchase_order_created_event: { tenant, po_id: po.po_id, user_id: userId },
  };
}

export async function queryPurchaseOrder(
  trx: Knex.Transaction,
  tenant: string,
  poId: string,
): Promise<PurchaseOrderWithLines | null> {
  const po = await trx('purchase_orders').where({ tenant, po_id: poId }).first();
  if (!po) return null;
  const lines = (await trx('purchase_order_lines')
    .where({ tenant, po_id: poId })
    .orderBy('created_at', 'asc')) as IPurchaseOrderLine[];
  return { ...(po as IPurchaseOrder), lines };
}

export async function queryPurchaseOrders(
  trx: Knex.Transaction,
  tenant: string,
  opts?: { status?: PurchaseOrderStatus; vendor_id?: string },
): Promise<PurchaseOrderQueryRow[]> {
  const lineAgg = trx('purchase_order_lines')
    .where({ tenant })
    .groupBy('po_id')
    .select('po_id')
    .select(trx.raw('COALESCE(SUM(unit_cost * quantity_ordered), 0) as total_amount'))
    .select(trx.raw('COALESCE(SUM(quantity_ordered), 0) as qty_ordered'))
    .select(trx.raw('COALESCE(SUM(quantity_received), 0) as qty_received'))
    .select(trx.raw('COUNT(*) as line_count'))
    .as('la');

  const query = trx('purchase_orders as po')
    .leftJoin(lineAgg, 'la.po_id', 'po.po_id')
    .leftJoin('vendors as v', function () {
      this.on('v.vendor_id', '=', 'po.vendor_id').andOn('v.tenant', '=', 'po.tenant');
    })
    .where({ 'po.tenant': tenant });
  if (opts?.status) query.andWhere({ 'po.status': opts.status });
  if (opts?.vendor_id) query.andWhere({ 'po.vendor_id': opts.vendor_id });

  const rows = await query
    .select('po.*')
    .select('v.vendor_name')
    .select(trx.raw('COALESCE(la.total_amount, 0)::bigint as total_amount'))
    .select(trx.raw('COALESCE(la.qty_ordered, 0)::int as qty_ordered'))
    .select(trx.raw('COALESCE(la.qty_received, 0)::int as qty_received'))
    .select(trx.raw('COALESCE(la.line_count, 0)::int as line_count'))
    .orderBy('po.order_date', 'desc');

  return rows.map((row: any) => ({
    ...row,
    total_amount: Number(row.total_amount),
    qty_ordered: Number(row.qty_ordered),
    qty_received: Number(row.qty_received),
    line_count: Number(row.line_count),
  })) as PurchaseOrderQueryRow[];
}

async function getPoOrThrow(
  trx: Knex.Transaction,
  tenant: string,
  poId: string,
  forUpdate = false,
): Promise<IPurchaseOrder> {
  const query = trx('purchase_orders').where({ tenant, po_id: poId });
  if (forUpdate) query.forUpdate();
  const po = await query.first();
  if (!po) throw new Error('Purchase order not found');
  return po as IPurchaseOrder;
}

async function getPoLineOrThrow(
  trx: Knex.Transaction,
  tenant: string,
  poLineId: string,
): Promise<IPurchaseOrderLine> {
  const line = await trx('purchase_order_lines').where({ tenant, po_line_id: poLineId }).first();
  if (!line) throw new Error('Purchase order line not found');
  return line as IPurchaseOrderLine;
}

async function recomputePoStatus(
  trx: Knex.Transaction,
  tenant: string,
  poId: string,
): Promise<PurchaseOrderStatus> {
  const po = await getPoOrThrow(trx, tenant, poId);
  if (po.status === 'draft' || po.status === 'cancelled') return po.status;
  const lines = (await trx('purchase_order_lines').where({ tenant, po_id: poId })) as IPurchaseOrderLine[];
  let anyReceived = false;
  let allComplete = lines.length > 0;
  for (const line of lines) {
    if (Number(line.quantity_received) > 0) anyReceived = true;
    if (Number(line.quantity_received) < Number(line.quantity_ordered)) allComplete = false;
  }
  const next: PurchaseOrderStatus = allComplete ? 'received' : anyReceived ? 'partially_received' : 'open';
  if (next !== po.status) {
    await trx('purchase_orders').where({ tenant, po_id: poId }).update({ status: next, updated_at: trx.fn.now() });
  }
  return next;
}

export interface ReceivePoLineInput {
  po_line_id: string;
  location_id: string;
  quantity: number;
  serials?: Array<{
    serial_number: string;
    mac_address?: string | null;
    warranty_expires_at?: string | Date | null;
    warranty_term?: string | null;
  }>;
}

export interface PoReceivedEventPayload {
  tenant: string;
  po_id: string;
  po_number: string;
  vendor_id: string | null;
  vendor_name: string | null;
  received_line_count: number;
}

export interface ReceivePoLineCoreResult {
  po_line: IPurchaseOrderLine;
  po_status: PurchaseOrderStatus;
  units: IStockUnit[];
  over_receipt: boolean;
  /** Publish INVENTORY_PO_RECEIVED only after commit. */
  po_received_event: PoReceivedEventPayload;
}

/** Session-free PO-line receipt core, including receiving-location write scope. */
export async function receivePoLineCore(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  input: ReceivePoLineInput,
): Promise<ReceivePoLineCoreResult> {
  const qty = Number(input.quantity);
  if (!(qty > 0)) throw new Error('quantity must be greater than 0');
  if (!input.location_id) throw new Error('location_id is required');

  const lineProbe = await getPoLineOrThrow(trx, tenant, input.po_line_id);
  const po = await getPoOrThrow(trx, tenant, lineProbe.po_id, true);
  const line = (await trx('purchase_order_lines')
    .where({ tenant, po_line_id: input.po_line_id })
    .forUpdate()
    .first()) as IPurchaseOrderLine;
  if (po.status === 'draft') throw new Error('Cannot receive against a draft purchase order; submit it first');
  if (po.status === 'cancelled') throw new Error('Cannot receive against a cancelled purchase order');
  if (line.cost_currency !== po.currency_code) {
    throw new Error(`Line cost_currency (${line.cost_currency}) must match PO currency_code (${po.currency_code})`);
  }

  // Plan-approved behavior change: PO receipts now enforce the same van scope as other writes.
  await assertLocationWritable(trx, tenant, userId, input.location_id);
  const location = await trx('stock_locations').where({ tenant, location_id: input.location_id }).first();
  if (!location) throw new Error('Stock location not found');

  const settings = await trx('product_inventory_settings')
    .where({ tenant, service_id: line.service_id })
    .forUpdate()
    .first();
  if (!settings) throw new Error('Inventory is not enabled for this product');
  if (!settings.track_stock) throw new Error('Inventory tracking is disabled for this product');

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
  const units: IStockUnit[] = [];

  if (isSerialized) {
    const serials = input.serials ?? [];
    if (serials.length !== qty) {
      throw new Error(`Serialized receipt requires exactly ${qty} serial(s); got ${serials.length}`);
    }
    const seenSerials = new Set<string>();
    const seenMacs = new Set<string>();
    for (const serialInput of serials) {
      const serial = (serialInput.serial_number ?? '').trim();
      if (!serial) throw new Error('Each serialized unit requires a serial_number');
      if (seenSerials.has(serial)) throw new Error(`Duplicate serial_number in batch: ${serial}`);
      seenSerials.add(serial);
      const existingSerial = await trx('stock_units')
        .where({ tenant, service_id: line.service_id, serial_number: serial })
        .first();
      if (existingSerial) throw new Error(`Serial number already exists: ${serial}`);
      const mac = serialInput.mac_address ? String(serialInput.mac_address).trim() : null;
      if (mac) {
        if (seenMacs.has(mac)) throw new Error(`Duplicate mac_address in batch: ${mac}`);
        seenMacs.add(mac);
        const existingMac = await trx('stock_units').where({ tenant, mac_address: mac }).first();
        if (existingMac) throw new Error(`MAC address already exists: ${mac}`);
      }
    }

    for (const serialInput of serials) {
      const [unit] = (await trx('stock_units')
        .insert({
          tenant,
          service_id: line.service_id,
          serial_number: (serialInput.serial_number ?? '').trim(),
          mac_address: serialInput.mac_address ? String(serialInput.mac_address).trim() : null,
          status: 'in_stock',
          location_id: input.location_id,
          unit_cost: unitCost,
          cost_currency: currency,
          warranty_expires_at: serialInput.warranty_expires_at ?? null,
          warranty_term: serialInput.warranty_term ?? null,
          received_at: trx.fn.now(),
          source_po_id: po.po_id,
        })
        .returning('*')) as IStockUnit[];
      await recordStockMovement(trx, tenant, {
        movement_type: 'receipt',
        service_id: line.service_id,
        quantity: 1,
        unit_id: unit.unit_id,
        to_location_id: input.location_id,
        unit_cost: unitCost,
        cost_currency: currency,
        source_doc_type: 'purchase_order',
        source_doc_id: po.po_id,
        performed_by: userId,
      });
      units.push(unit);
    }
  } else {
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
      performed_by: userId,
    });
    const denom = oldQty + qty;
    const newAvg = denom > 0 ? Math.round((oldQty * oldAvg + qty * unitCost) / denom) : unitCost;
    await trx('product_inventory_settings')
      .where({ tenant, service_id: line.service_id })
      .update({ average_cost: newAvg, cost_currency: currency, updated_at: trx.fn.now() });
  }

  const [updatedLine] = await trx('purchase_order_lines')
    .where({ tenant, po_line_id: input.po_line_id })
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
}
