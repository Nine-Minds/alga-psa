'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IPurchaseOrder } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { availableQuantity } from '../lib';

async function requireInvPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'inventory', action))) {
    throw new Error(`Permission denied: inventory ${action} required`);
  }
}

export type ReorderActionError = ActionMessageError | ActionPermissionError;

function reorderActionErrorFrom(error: unknown): ReorderActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }

    switch (error.message) {
      case 'Load list source and destination are required':
        return actionError('Choose both a load destination and a source shelf.');
      case 'Load list source and destination must differ':
        return actionError('Choose different source and destination locations.');
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '23503') {
    return actionError('One of the selected load-list records is no longer valid. Please refresh and try again.');
  }

  return null;
}

async function withReorderActionErrors<T>(work: () => Promise<T>): Promise<T | ReorderActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = reorderActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

export interface LowStockRow {
  service_id: string;
  service_name: string | null;
  sku: string | null;
  location_id: string;
  location_name: string;
  manager_user_id: string | null;
  quantity_on_hand: number;
  reserved_quantity: number;
  held_quantity: number;
  available: number;
  /** Effective threshold: per-location override (stock_levels), else product default. */
  reorder_point: number;
  reorder_quantity: number | null;
  preferred_vendor_id: string | null;
}

/**
 * Low-stock report (design §6.F): for `track_stock` products, per
 * (service_id, location_id), flag rows where available <= effective reorder point.
 * The effective threshold is the per-location override (stock_levels.reorder_point)
 * when present, otherwise the product default (product_inventory_settings.reorder_point).
 * Rows with no threshold on either side are not low-stock and are excluded.
 */
export const lowStockReport = withAuth(async (user, { tenant }): Promise<LowStockRow[] | ReorderActionError> => {
  return withReorderActionErrors(async () => {
    await requireInvPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
    const rows = await trx('stock_levels as sl')
      .join('product_inventory_settings as pis', function () {
        this.on('sl.service_id', '=', 'pis.service_id').andOn('sl.tenant', '=', 'pis.tenant');
      })
      .join('stock_locations as loc', function () {
        this.on('sl.location_id', '=', 'loc.location_id').andOn('sl.tenant', '=', 'loc.tenant');
      })
      .leftJoin('service_catalog as sc', function () {
        this.on('sl.service_id', '=', 'sc.service_id').andOn('sl.tenant', '=', 'sc.tenant');
      })
      .where({ 'sl.tenant': tenant, 'pis.track_stock': true })
      .select(
        'sl.service_id as service_id',
        'sc.service_name as service_name',
        'sc.sku as sku',
        'sl.location_id as location_id',
        'loc.name as location_name',
        'loc.manager_user_id as manager_user_id',
        'sl.quantity_on_hand as quantity_on_hand',
        'sl.reserved_quantity as reserved_quantity',
        'sl.held_quantity as held_quantity',
        trx.raw('COALESCE(sl.reorder_point, pis.reorder_point) as reorder_point'),
        'pis.reorder_quantity as reorder_quantity',
        'pis.preferred_vendor_id as preferred_vendor_id',
      );

    const out: LowStockRow[] = [];
    for (const r of rows as any[]) {
      const threshold = r.reorder_point;
      if (threshold === null || threshold === undefined) continue; // no reorder point configured
      const level = {
        quantity_on_hand: Number(r.quantity_on_hand ?? 0),
        reserved_quantity: Number(r.reserved_quantity ?? 0),
        held_quantity: Number(r.held_quantity ?? 0),
      };
      const available = availableQuantity(level);
      if (available > Number(threshold)) continue;
      out.push({
        service_id: r.service_id,
        service_name: r.service_name ?? null,
        sku: r.sku ?? null,
        location_id: r.location_id,
        location_name: r.location_name,
        manager_user_id: r.manager_user_id ?? null,
        quantity_on_hand: level.quantity_on_hand,
        reserved_quantity: level.reserved_quantity,
        held_quantity: level.held_quantity,
        available,
        reorder_point: Number(threshold),
        reorder_quantity: r.reorder_quantity ?? null,
        preferred_vendor_id: r.preferred_vendor_id ?? null,
      });
    }
    return out;
    });
  });
});

export interface LowStockAlertTarget {
  location_id: string;
  location_name: string;
  /** Recipient for THIS location's low-stock alert. May be null (no manager assigned). */
  manager_user_id: string | null;
  rows: LowStockRow[];
}

/**
 * F134 — low-stock alert routing. Group low-stock rows by location and resolve the
 * recipient to that location's stock_locations.manager_user_id. Routing is strictly
 * per-location: each manager hears only about their own location, never a global blast.
 */
export const lowStockAlertTargets = withAuth(async (user, { tenant }): Promise<LowStockAlertTarget[] | ReorderActionError> => {
  return withReorderActionErrors(async () => {
    await requireInvPerm(user, 'read');
    const rows = await (lowStockReport as any)();
    const expected = reorderActionErrorFrom(rows);
    if (expected) return expected;
    const byLocation = new Map<string, LowStockAlertTarget>();
    for (const r of rows as LowStockRow[]) {
      let target = byLocation.get(r.location_id);
      if (!target) {
        target = {
          location_id: r.location_id,
          location_name: r.location_name,
          manager_user_id: r.manager_user_id,
          rows: [],
        };
        byLocation.set(r.location_id, target);
      }
      target.rows.push(r);
    }
    return Array.from(byLocation.values());
  });
});

export interface CreatePoFromLowStockResult {
  created: IPurchaseOrder[];
  /** Low-stock rows skipped because no preferred vendor is configured. */
  skipped_no_vendor: LowStockRow[];
}

/**
 * F136 — "Create PO from low-stock". Builds DRAFT purchase orders grouped by the
 * product's preferred_vendor_id. Suggested order quantity = reorder_quantity, falling
 * back to (reorder_point - available). Rows with no preferred vendor are skipped and
 * reported back. This is a suggestion only: POs are created in 'draft' for review.
 */
export const createPoFromLowStock = withAuth(async (user, { tenant }): Promise<CreatePoFromLowStockResult | ReorderActionError> => {
  return withReorderActionErrors(async () => {
    await requireInvPerm(user, 'create');
    const lowRows = await (lowStockReport as any)() as LowStockRow[] | ReorderActionError;
    const expected = reorderActionErrorFrom(lowRows);
    if (expected) return expected;

    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
    const skipped: LowStockRow[] = [];

    /**
     * Cost basis for a suggested line: the preferred vendor's price-list offer
     * (contract cost — F058) first, else product average cost, else catalog cost.
     */
    const resolveCost = async (serviceId: string): Promise<{ unitCost: number; currency: string }> => {
      const offer = await trx('vendor_products')
        .where({ tenant, service_id: serviceId, is_preferred: true })
        .first();
      if (offer?.unit_cost != null) {
        return { unitCost: Number(offer.unit_cost), currency: offer.cost_currency ?? 'USD' };
      }
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
        currency: pis?.cost_currency ?? sc?.cost_currency ?? 'USD',
      };
    };

    // Group by (vendor, currency) — one PO per currency so the header always matches
    // its lines and every suggested PO is actually receivable (F043; a hardcoded-USD
    // header made non-USD suggestions fail the receipt currency guard forever).
    const byVendorCurrency = new Map<string, Map<string, { qty: number; unitCost: number }>>();
    for (const r of lowRows as LowStockRow[]) {
      if (!r.preferred_vendor_id) {
        skipped.push(r);
        continue;
      }
      const suggested =
        r.reorder_quantity != null && r.reorder_quantity > 0
          ? r.reorder_quantity
          : Math.max(0, r.reorder_point - r.available);
      if (suggested <= 0) continue;
      const { unitCost, currency } = await resolveCost(r.service_id);
      const key = `${r.preferred_vendor_id} ${currency}`;
      let svcMap = byVendorCurrency.get(key);
      if (!svcMap) {
        svcMap = new Map();
        byVendorCurrency.set(key, svcMap);
      }
      const existing = svcMap.get(r.service_id);
      if (existing) existing.qty += suggested;
      else svcMap.set(r.service_id, { qty: suggested, unitCost });
    }

    const created: IPurchaseOrder[] = [];
    for (const [key, svcMap] of byVendorCurrency) {
      const [vendorId, currency] = key.split(' ');
      const vendor = await trx('vendors').where({ tenant, vendor_id: vendorId }).first();
      if (!vendor) continue;

      const numRes = await trx.raw('SELECT generate_next_number(?::uuid, ?) as number', [tenant, 'PURCHASE_ORDER']);
      const poNumber = numRes.rows[0].number;

      const [po] = await trx('purchase_orders')
        .insert({
          tenant,
          po_number: poNumber,
          vendor_id: vendorId,
          status: 'draft',
          order_date: trx.fn.now(),
          is_drop_ship: false,
          currency_code: currency,
          notes: 'Auto-suggested from low-stock report',
          created_by: user.user_id,
        })
        .returning('*');

      for (const [serviceId, { qty, unitCost }] of svcMap) {
        await trx('purchase_order_lines').insert({
          tenant,
          po_id: (po as IPurchaseOrder).po_id,
          service_id: serviceId,
          quantity_ordered: qty,
          quantity_received: 0,
          unit_cost: unitCost,
          cost_currency: currency,
        });
      }

      const lines = await trx('purchase_order_lines')
        .where({ tenant, po_id: (po as IPurchaseOrder).po_id })
        .orderBy('created_at', 'asc');
      created.push({ ...(po as IPurchaseOrder), lines });
    }

    return { created, skipped_no_vendor: skipped };
    });
  });
});

export interface LoadListRow {
  service_id: string;
  service_name: string | null;
  sku: string | null;
  is_serialized: boolean;
  /** Destination shortfall: reorder_quantity if configured (>0), else reorder_point - available. */
  needed: number;
  /** Available (on_hand - reserved - held) at the SOURCE location. */
  source_available: number;
  /** min(needed, source_available) — what the transfer will actually carry. */
  load_qty: number;
  /** needed - load_qty; > 0 means the source shelf cannot fully cover this line. */
  short_at_source: number;
  /** FIFO-suggested units for serialized products (length === load_qty). */
  units: Array<{ unit_id: string; serial_number: string }>;
}

export interface LoadListResult {
  to_location_id: string;
  from_location_id: string;
  rows: LoadListRow[];
}

export const computeLoadList = withAuth(
  async (
    user,
    { tenant },
    toLocationId: string,
    fromLocationId: string,
  ): Promise<LoadListResult | ReorderActionError> => {
    return withReorderActionErrors(async () => {
      await requireInvPerm(user, 'read');
      if (!toLocationId || !fromLocationId) {
        throw new Error('Load list source and destination are required');
      }
      if (toLocationId === fromLocationId) {
        throw new Error('Load list source and destination must differ');
      }

      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        const lowRows = await trx('stock_levels as sl')
          .join('product_inventory_settings as pis', function () {
            this.on('sl.service_id', '=', 'pis.service_id').andOn('sl.tenant', '=', 'pis.tenant');
          })
          .leftJoin('service_catalog as sc', function () {
            this.on('sl.service_id', '=', 'sc.service_id').andOn('sl.tenant', '=', 'sc.tenant');
          })
          .where({ 'sl.tenant': tenant, 'sl.location_id': toLocationId, 'pis.track_stock': true })
          .select(
            'sl.service_id as service_id',
            'sc.service_name as service_name',
            'sc.sku as sku',
            'sl.quantity_on_hand as quantity_on_hand',
            'sl.reserved_quantity as reserved_quantity',
            'sl.held_quantity as held_quantity',
            trx.raw('COALESCE(sl.reorder_point, pis.reorder_point) as reorder_point'),
            'pis.reorder_quantity as reorder_quantity',
            trx.raw('COALESCE(pis.is_serialized, false) as is_serialized'),
          );

        const rows: LoadListRow[] = [];
        for (const r of lowRows as any[]) {
          const threshold = r.reorder_point;
          if (threshold === null || threshold === undefined) continue;

          const destinationLevel = {
            quantity_on_hand: Number(r.quantity_on_hand ?? 0),
            reserved_quantity: Number(r.reserved_quantity ?? 0),
            held_quantity: Number(r.held_quantity ?? 0),
          };
          const available = availableQuantity(destinationLevel);
          const reorderPoint = Number(threshold);
          if (available > reorderPoint) continue;

          const reorderQuantity = r.reorder_quantity != null ? Number(r.reorder_quantity) : null;
          const needed =
            reorderQuantity != null && reorderQuantity > 0
              ? reorderQuantity
              : Math.max(0, reorderPoint - available);
          if (needed <= 0) continue;

          const sourceLevel = await trx('stock_levels')
            .where({ tenant, service_id: r.service_id, location_id: fromLocationId })
            .select('quantity_on_hand', 'reserved_quantity', 'held_quantity')
            .first();
          const sourceAvailable = sourceLevel
            ? availableQuantity({
                quantity_on_hand: Number(sourceLevel.quantity_on_hand ?? 0),
                reserved_quantity: Number(sourceLevel.reserved_quantity ?? 0),
                held_quantity: Number(sourceLevel.held_quantity ?? 0),
              })
            : 0;
          const sourceAvailableSafe = Math.max(0, sourceAvailable);
          const loadQty = Math.min(needed, sourceAvailableSafe);
          const isSerialized = Boolean(r.is_serialized);
          const units = isSerialized && loadQty > 0
            ? ((await trx('stock_units')
                .where({
                  tenant,
                  service_id: r.service_id,
                  location_id: fromLocationId,
                  status: 'in_stock',
                })
                .select('unit_id', 'serial_number')
                .orderByRaw('received_at ASC NULLS LAST, created_at ASC')
                .limit(loadQty)) as Array<{ unit_id: string; serial_number: string }>)
            : [];

          rows.push({
            service_id: r.service_id,
            service_name: r.service_name ?? null,
            sku: r.sku ?? null,
            is_serialized: isSerialized,
            needed,
            source_available: sourceAvailableSafe,
            load_qty: loadQty,
            short_at_source: needed - loadQty,
            units: units.map((u) => ({ unit_id: u.unit_id, serial_number: u.serial_number })),
          });
        }

        rows.sort((a, b) => {
          const byName = (a.service_name ?? '').localeCompare(b.service_name ?? '');
          return byName !== 0 ? byName : a.service_id.localeCompare(b.service_id);
        });

        return {
          to_location_id: toLocationId,
          from_location_id: fromLocationId,
          rows,
        };
      });
    });
  },
);
