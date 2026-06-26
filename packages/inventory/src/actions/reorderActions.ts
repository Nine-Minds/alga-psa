'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IPurchaseOrder } from '@alga-psa/types';
import { availableQuantity } from '../lib';

async function requireInvPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'inventory', action))) {
    throw new Error(`Permission denied: inventory ${action} required`);
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
export const lowStockReport = withAuth(async (user, { tenant }): Promise<LowStockRow[]> => {
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
export const lowStockAlertTargets = withAuth(async (user, { tenant }): Promise<LowStockAlertTarget[]> => {
  await requireInvPerm(user, 'read');
  const rows = await (lowStockReport as any)();
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
export const createPoFromLowStock = withAuth(async (user, { tenant }): Promise<CreatePoFromLowStockResult> => {
  await requireInvPerm(user, 'create');
  const lowRows = await (lowStockReport as any)() as LowStockRow[];

  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const skipped: LowStockRow[] = [];
    // Group by vendor, then aggregate suggested qty per service across locations.
    const byVendor = new Map<string, Map<string, { row: LowStockRow; qty: number }>>();
    for (const r of lowRows) {
      if (!r.preferred_vendor_id) {
        skipped.push(r);
        continue;
      }
      const suggested =
        r.reorder_quantity != null && r.reorder_quantity > 0
          ? r.reorder_quantity
          : Math.max(0, r.reorder_point - r.available);
      if (suggested <= 0) continue;
      let svcMap = byVendor.get(r.preferred_vendor_id);
      if (!svcMap) {
        svcMap = new Map();
        byVendor.set(r.preferred_vendor_id, svcMap);
      }
      const existing = svcMap.get(r.service_id);
      if (existing) existing.qty += suggested;
      else svcMap.set(r.service_id, { row: r, qty: suggested });
    }

    const created: IPurchaseOrder[] = [];
    for (const [vendorId, svcMap] of byVendor) {
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
          currency_code: 'USD',
          notes: 'Auto-suggested from low-stock report',
          created_by: user.user_id,
        })
        .returning('*');

      for (const [serviceId, { qty }] of svcMap) {
        // Cost basis for the suggested line: product average cost, else catalog cost, else 0.
        const pis = await trx('product_inventory_settings')
          .where({ tenant, service_id: serviceId })
          .select('average_cost', 'cost_currency')
          .first();
        const sc = await trx('service_catalog')
          .where({ tenant, service_id: serviceId })
          .select('cost', 'cost_currency')
          .first();
        const unitCost = Number(pis?.average_cost ?? sc?.cost ?? 0);
        const costCurrency = pis?.cost_currency ?? sc?.cost_currency ?? (po as IPurchaseOrder).currency_code ?? 'USD';

        await trx('purchase_order_lines').insert({
          tenant,
          po_id: (po as IPurchaseOrder).po_id,
          service_id: serviceId,
          quantity_ordered: qty,
          quantity_received: 0,
          unit_cost: unitCost,
          cost_currency: costCurrency,
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
