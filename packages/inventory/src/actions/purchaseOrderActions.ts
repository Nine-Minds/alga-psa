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
import {
  createPurchaseOrderDraftCore,
  publishInventoryEvent,
  queryPurchaseOrder,
  queryPurchaseOrders,
  receivePoLineCore,
  resolvePoLineDefaults,
  timestampPayload,
  type PurchaseOrderQueryRow,
} from '../lib';

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
      case 'Only draft purchase orders can be deleted':
        return actionError('Only draft purchase orders can be deleted. Cancel submitted orders instead.');
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

export const getPurchaseOrder = withAuth(
  async (user, { tenant }, poId: string): Promise<IPurchaseOrder | null | PurchaseOrderActionError> => {
    return withPurchaseOrderActionErrors(async () => {
      await requirePoPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, (trx: Knex.Transaction) => queryPurchaseOrder(trx, tenant, poId));
    });
  },
);

/**
 * A purchase order plus the per-PO line aggregates the list view needs — committed
 * amount (the defining number of a PO), receive progress, and line count — so the grid
 * can answer "how much money / how much still owed" without an N+1 drill-in per row.
 */
export type PurchaseOrderListRow = PurchaseOrderQueryRow;

export const listPurchaseOrders = withAuth(
  async (user, { tenant }, opts?: { status?: PurchaseOrderStatus; vendor_id?: string }): Promise<PurchaseOrderListRow[] | PurchaseOrderActionError> => {
    return withPurchaseOrderActionErrors(async () => {
      await requirePoPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, (trx: Knex.Transaction) => queryPurchaseOrders(trx, tenant, opts));
    });
  },
);

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
      const core = await withTransaction(db, (trx: Knex.Transaction) =>
        createPurchaseOrderDraftCore(trx, tenant, user.user_id, { ...input, currency_code: currency }),
      );

      await publishInventoryEvent(
        'INVENTORY_PURCHASE_ORDER_CREATED',
        timestampPayload(core.purchase_order_created_event),
      );

      return core.purchase_order;
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

export const deletePurchaseOrder = withAuth(
  async (user, { tenant }, poId: string): Promise<{ deleted: boolean } | PurchaseOrderActionError> => {
    return withPurchaseOrderActionErrors(async () => {
      await requirePoPerm(user, 'delete');
      const { knex: db } = await createTenantKnex();
      await withTransaction(db, async (trx: Knex.Transaction) => {
        const po = await getPoOrThrow(trx, tenant, poId, { forUpdate: true });
        if (po.status !== 'draft') throw new Error('Only draft purchase orders can be deleted');
        await trx('purchase_orders').where({ tenant, po_id: poId }).del();
      });
      await publishInventoryEvent('INVENTORY_PURCHASE_ORDER_DELETED', timestampPayload({
        tenant,
        po_id: poId,
        user_id: user.user_id,
      }));
      return { deleted: true };
    });
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
        const mixedLine = await trx('purchase_order_lines')
          .where({ tenant, po_id: poId })
          .andWhere('cost_currency', '<>', po.currency_code)
          .first();
        if (mixedLine) {
          throw new Error(`Line cost_currency (${mixedLine.cost_currency}) must match PO currency_code (${po.currency_code})`);
        }

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
      const { knex: db } = await createTenantKnex();
      const core = await withTransaction(db, (trx: Knex.Transaction) =>
        receivePoLineCore(trx, tenant, user.user_id, {
          ...input,
          po_line_id: poLineId,
        }),
      );

      await publishInventoryEvent('INVENTORY_PO_RECEIVED', core.po_received_event);
      await publishInventoryEvent('INVENTORY_PURCHASE_ORDER_UPDATED', timestampPayload({
        tenant,
        po_id: core.po_line.po_id,
        user_id: user.user_id,
        changed_fields: ['status', 'quantity_received'],
      }));
      for (const unit of core.units) {
        await publishInventoryEvent('INVENTORY_STOCK_UNIT_CREATED', timestampPayload({
          tenant,
          unit_id: unit.unit_id,
          service_id: unit.service_id,
          user_id: user.user_id,
        }));
      }

      const { po_received_event: _pending, ...result } = core;
      return result;
    });
  },
);
