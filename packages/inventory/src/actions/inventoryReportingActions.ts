'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IPurchaseOrder, ISalesOrder } from '@alga-psa/types';

/**
 * Read-only inventory reporting + dashboard widgets. See design doc §10 / §11.
 * All monetary values are integer cents.
 */

async function requireInvRead(user: any): Promise<void> {
  if (!(await hasPermission(user, 'inventory', 'read'))) {
    throw new Error('Permission denied: inventory read required');
  }
}

export interface InventoryValueLocationRow {
  location_id: string;
  location_name: string;
  total_value: number;
}

export interface InventoryValueReport {
  by_location: InventoryValueLocationRow[];
  grand_total: number;
}

/**
 * Σ(quantity_on_hand × cost) per location plus a grand total.
 * cost = product_inventory_settings.average_cost for non-serialized products;
 * for serialized products it is the sum of each in_stock unit's unit_cost.
 */
export const inventoryValueReport = withAuth(async (user, { tenant }): Promise<InventoryValueReport> => {
  await requireInvRead(user);
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const valueByLocation = new Map<string, number>();

    // Non-serialized: on-hand × average_cost from stock_levels joined to settings.
    const nonSerialized = await trx('stock_levels as sl')
      .join('product_inventory_settings as pis', function () {
        this.on('sl.service_id', '=', 'pis.service_id').andOn('sl.tenant', '=', 'pis.tenant');
      })
      .where({ 'sl.tenant': tenant, 'pis.is_serialized': false })
      .andWhere('sl.quantity_on_hand', '>', 0)
      .select<{ location_id: string; value: string }[]>(
        'sl.location_id as location_id',
        trx.raw('SUM(sl.quantity_on_hand * COALESCE(pis.average_cost, 0)) as value'),
      )
      .groupBy('sl.location_id');
    for (const r of nonSerialized) {
      valueByLocation.set(r.location_id, (valueByLocation.get(r.location_id) ?? 0) + Number(r.value ?? 0));
    }

    // Serialized: sum of in_stock units' unit_cost at each location.
    const serialized = await trx('stock_units')
      .where({ tenant, status: 'in_stock' })
      .whereNotNull('location_id')
      .select<{ location_id: string; value: string }[]>(
        'location_id',
        trx.raw('SUM(COALESCE(unit_cost, 0)) as value'),
      )
      .groupBy('location_id');
    for (const r of serialized) {
      valueByLocation.set(r.location_id, (valueByLocation.get(r.location_id) ?? 0) + Number(r.value ?? 0));
    }

    const locations = await trx('stock_locations')
      .where({ tenant })
      .select<{ location_id: string; name: string }[]>('location_id', 'name');
    const nameById = new Map(locations.map((l) => [l.location_id, l.name]));

    const by_location: InventoryValueLocationRow[] = [...valueByLocation.entries()]
      .map(([location_id, total_value]) => ({
        location_id,
        location_name: nameById.get(location_id) ?? location_id,
        total_value: Math.round(total_value),
      }))
      .sort((a, b) => a.location_name.localeCompare(b.location_name));

    const grand_total = by_location.reduce((sum, r) => sum + r.total_value, 0);
    return { by_location, grand_total };
  });
});

export interface MarginReportRow {
  service_id: string;
  service_name: string | null;
  quantity: number;
  revenue: number;
  cogs: number;
  margin: number;
}

export interface MarginReport {
  rows: MarginReportRow[];
  total_revenue: number;
  total_cogs: number;
  total_margin: number;
}

/**
 * Margin from sales-driven consume movements over an optional date window.
 * revenue = sold quantity × sales_order_lines.unit_price (joined via source_doc_id),
 * cogs = Σ(cogs_cost) on the consume movement, margin = revenue − cogs.
 */
export const marginReport = withAuth(
  async (user, { tenant }, filter?: { from?: string | Date; to?: string | Date }): Promise<MarginReport> => {
    await requireInvRead(user);
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const q = trx('stock_movements as sm')
        .leftJoin('sales_order_lines as sol', function () {
          this.on('sm.source_doc_id', '=', 'sol.so_line_id').andOn('sm.tenant', '=', 'sol.tenant');
        })
        .leftJoin('service_catalog as sc', function () {
          this.on('sm.service_id', '=', 'sc.service_id').andOn('sm.tenant', '=', 'sc.tenant');
        })
        .where({ 'sm.tenant': tenant, 'sm.movement_type': 'consume', 'sm.source_doc_type': 'sales_order' });
      if (filter?.from) q.andWhere('sm.created_at', '>=', filter.from);
      if (filter?.to) q.andWhere('sm.created_at', '<=', filter.to);

      const grouped = await q
        .select<{ service_id: string; service_name: string | null; quantity: string; revenue: string; cogs: string }[]>(
          'sm.service_id as service_id',
          'sc.service_name as service_name',
          trx.raw('SUM(sm.quantity) as quantity'),
          trx.raw('SUM(sm.quantity * COALESCE(sol.unit_price, 0)) as revenue'),
          trx.raw('SUM(COALESCE(sm.cogs_cost, 0)) as cogs'),
        )
        .groupBy('sm.service_id', 'sc.service_name')
        .orderBy('sc.service_name', 'asc');

      const rows: MarginReportRow[] = grouped.map((r) => {
        const revenue = Math.round(Number(r.revenue ?? 0));
        const cogs = Math.round(Number(r.cogs ?? 0));
        return {
          service_id: r.service_id,
          service_name: r.service_name ?? null,
          quantity: Number(r.quantity ?? 0),
          revenue,
          cogs,
          margin: revenue - cogs,
        };
      });

      const total_revenue = rows.reduce((s, r) => s + r.revenue, 0);
      const total_cogs = rows.reduce((s, r) => s + r.cogs, 0);
      return { rows, total_revenue, total_cogs, total_margin: total_revenue - total_cogs };
    });
  },
);

export interface ExpiringWarrantyRow {
  unit_id: string;
  service_id: string;
  service_name: string | null;
  serial_number: string;
  mac_address: string | null;
  status: string;
  location_id: string | null;
  client_id: string | null;
  asset_id: string | null;
  warranty_expires_at: string | Date;
  warranty_term: string | null;
}

/**
 * Serialized units whose warranty expires within `withinDays` from now
 * (deployed or in stock). Already-retired units are excluded.
 */
export const expiringWarrantyReport = withAuth(
  async (user, { tenant }, withinDays: number): Promise<ExpiringWarrantyRow[]> => {
    await requireInvRead(user);
    const days = Number.isFinite(withinDays) ? Math.max(0, Math.floor(withinDays)) : 0;
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const rows = await trx('stock_units as su')
        .leftJoin('service_catalog as sc', function () {
          this.on('su.service_id', '=', 'sc.service_id').andOn('su.tenant', '=', 'sc.tenant');
        })
        .where({ 'su.tenant': tenant })
        .whereNotNull('su.warranty_expires_at')
        .whereNot('su.status', 'retired')
        .andWhereRaw("su.warranty_expires_at <= (now() + (? || ' days')::interval)", [days])
        .select<ExpiringWarrantyRow[]>(
          'su.unit_id as unit_id',
          'su.service_id as service_id',
          'sc.service_name as service_name',
          'su.serial_number as serial_number',
          'su.mac_address as mac_address',
          'su.status as status',
          'su.location_id as location_id',
          'su.client_id as client_id',
          'su.asset_id as asset_id',
          'su.warranty_expires_at as warranty_expires_at',
          'su.warranty_term as warranty_term',
        )
        .orderBy('su.warranty_expires_at', 'asc');
      return rows;
    });
  },
);

const OPEN_PO_STATUSES = ['draft', 'open', 'partially_received'] as const;
const OPEN_SO_STATUSES = ['draft', 'confirmed', 'partially_fulfilled', 'fulfilled', 'invoiced'] as const;

export interface OpenPosWidget {
  count: number;
  purchase_orders: IPurchaseOrder[];
}

/** Non-terminal purchase orders (not received/cancelled): count + list. */
export const openPosWidget = withAuth(async (user, { tenant }): Promise<OpenPosWidget> => {
  await requireInvRead(user);
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const purchase_orders = (await trx('purchase_orders')
      .where({ tenant })
      .whereIn('status', OPEN_PO_STATUSES as unknown as string[])
      .orderBy('order_date', 'desc')) as IPurchaseOrder[];
    return { count: purchase_orders.length, purchase_orders };
  });
});

export interface OpenSosWidget {
  count: number;
  sales_orders: ISalesOrder[];
}

/** Non-terminal sales orders (not closed/cancelled): count + list. */
export const openSosWidget = withAuth(async (user, { tenant }): Promise<OpenSosWidget> => {
  await requireInvRead(user);
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const sales_orders = (await trx('sales_orders')
      .where({ tenant })
      .whereIn('status', OPEN_SO_STATUSES as unknown as string[])
      .orderBy('order_date', 'desc')) as ISalesOrder[];
    return { count: sales_orders.length, sales_orders };
  });
});
