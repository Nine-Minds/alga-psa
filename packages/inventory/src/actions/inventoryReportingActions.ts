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

/**
 * Accounting awareness (F150): surface which Alga products are inventory-tracked,
 * i.e. the Alga-side equivalent of Xero's IsTrackedAsInventory / QBO's "Inventory"
 * item type. Read-only — Alga never dual-writes stock to the accounting system;
 * this report lets an MSP reconcile Alga's tracked SKUs against their books.
 */
export const getAccountingInventoryAlignment = withAuth(
  async (user, { tenant }): Promise<Array<{ service_id: string; service_name: string; sku: string | null; track_stock: boolean; is_serialized: boolean; average_cost: number | null }>> => {
    await requireInvRead(user);
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      return trx('product_inventory_settings as pis')
        .join('service_catalog as sc', function () {
          this.on('pis.service_id', '=', 'sc.service_id').andOn('pis.tenant', '=', 'sc.tenant');
        })
        .where({ 'pis.tenant': tenant, 'pis.track_stock': true })
        .select('pis.service_id', 'sc.service_name', 'sc.sku', 'pis.track_stock', 'pis.is_serialized', 'pis.average_cost')
        .orderBy('sc.service_name', 'asc');
    });
  },
);

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

/** One write-off/adjustment event for the owner's review (Sam review P2). */
export interface WriteOffRow {
  movement_id: string;
  created_at: string;
  movement_type: 'adjust' | 'retire';
  service_name: string | null;
  location_name: string | null;
  serial_number: string | null;
  /** Signed: negative = stock written off/out, positive = found/added. */
  quantity_delta: number;
  /** Signed, same sign as quantity_delta; best-known cost basis (movement, unit, then average). */
  value_cents: number;
  reason: string | null;
  performed_by: string | null;
  performed_by_name: string | null;
  /** Set when the adjustment came from an approved cycle count. */
  count_session_id: string | null;
}

export interface WriteOffByUser {
  user_id: string | null;
  name: string | null;
  events: number;
  losses_cents: number;
  gains_cents: number;
  net_cents: number;
}

export interface WriteOffReportData {
  from: string;
  to: string;
  rows: WriteOffRow[];
  /** True when more events exist than the row cap; totals below still cover the FULL range. */
  truncated: boolean;
  by_user: WriteOffByUser[];
  total_losses_cents: number;
  total_gains_cents: number;
  net_cents: number;
}

const WRITE_OFF_ROW_CAP = 500;
const COUNT_SESSION_REASON_PREFIX = 'cycle_count: session ';

/**
 * Owner's audit-the-auditor report: every manual adjustment, retirement, and count
 * correction in a period, with who did it, why, and the dollars — plus per-user
 * totals so the person holding the approve button is himself reviewable.
 * Signs follow stock: negative = inventory written down.
 */
export const writeOffReport = withAuth(
  async (
    user,
    { tenant },
    opts?: { from?: string | null; to?: string | null },
  ): Promise<WriteOffReportData> => {
    if (!(await hasPermission(user, 'inventory', 'read'))) {
      throw new Error('Permission denied: inventory read required');
    }
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const to = opts?.to ? new Date(opts.to) : new Date();
      const from = opts?.from ? new Date(opts.from) : new Date(to.getTime() - 90 * 86_400_000);
      // End of the 'to' day, so a date-only input includes that whole day.
      const toEnd = new Date(to.getTime() + 86_399_999);

      // Signed delta: adjust honors its to/from direction; retire is always stock-out.
      const deltaExpr = `CASE
        WHEN sm.movement_type = 'retire' THEN -sm.quantity
        WHEN sm.to_location_id IS NOT NULL THEN sm.quantity
        ELSE -sm.quantity
      END`;
      const costExpr = 'COALESCE(sm.unit_cost, su.unit_cost, pis.average_cost, 0)';

      const base = () =>
        trx('stock_movements as sm')
          .leftJoin('stock_units as su', function () {
            this.on('su.unit_id', '=', 'sm.unit_id').andOn('su.tenant', '=', 'sm.tenant');
          })
          .leftJoin('product_inventory_settings as pis', function () {
            this.on('pis.service_id', '=', 'sm.service_id').andOn('pis.tenant', '=', 'sm.tenant');
          })
          .where('sm.tenant', tenant)
          .whereIn('sm.movement_type', ['adjust', 'retire'])
          .whereBetween('sm.created_at', [from.toISOString(), toEnd.toISOString()]);

      const rowsRaw = await base()
        .leftJoin('service_catalog as sc', function () {
          this.on('sc.service_id', '=', 'sm.service_id').andOn('sc.tenant', '=', 'sm.tenant');
        })
        .leftJoin('stock_locations as loc', function () {
          this.on('loc.location_id', '=', trx.raw('COALESCE(sm.from_location_id, sm.to_location_id)')).andOn(
            'loc.tenant',
            '=',
            'sm.tenant',
          );
        })
        .leftJoin('users as u', 'u.user_id', 'sm.performed_by')
        .orderBy('sm.created_at', 'desc')
        .limit(WRITE_OFF_ROW_CAP + 1)
        .select<any[]>(
          'sm.movement_id',
          'sm.created_at',
          'sm.movement_type',
          'sm.reason',
          'sm.performed_by',
          'sc.service_name',
          'loc.name as location_name',
          'su.serial_number',
          trx.raw(`${deltaExpr} as quantity_delta`),
          trx.raw(`(${deltaExpr}) * ${costExpr} as value_cents`),
          trx.raw(
            "COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.username) as performed_by_name",
          ),
        );

      const truncated = rowsRaw.length > WRITE_OFF_ROW_CAP;
      const rows: WriteOffRow[] = rowsRaw.slice(0, WRITE_OFF_ROW_CAP).map((r) => ({
        movement_id: r.movement_id,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        movement_type: r.movement_type,
        service_name: r.service_name ?? null,
        location_name: r.location_name ?? null,
        serial_number: r.serial_number ?? null,
        quantity_delta: Number(r.quantity_delta),
        value_cents: Math.round(Number(r.value_cents)),
        reason: r.reason ?? null,
        performed_by: r.performed_by ?? null,
        performed_by_name: r.performed_by_name ?? null,
        count_session_id: r.reason?.startsWith(COUNT_SESSION_REASON_PREFIX)
          ? r.reason.slice(COUNT_SESSION_REASON_PREFIX.length)
          : null,
      }));

      // Totals aggregate over the FULL range (not the display cap) — a capped list must
      // never quietly understate the money.
      const agg = await base()
        .leftJoin('users as u', 'u.user_id', 'sm.performed_by')
        .groupBy('sm.performed_by', 'u.first_name', 'u.last_name', 'u.username')
        .select<any[]>(
          'sm.performed_by',
          trx.raw(
            "COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.username) as name",
          ),
          trx.raw('COUNT(*) as events'),
          trx.raw(`COALESCE(SUM(CASE WHEN (${deltaExpr}) < 0 THEN (${deltaExpr}) * ${costExpr} ELSE 0 END), 0) as losses_cents`),
          trx.raw(`COALESCE(SUM(CASE WHEN (${deltaExpr}) > 0 THEN (${deltaExpr}) * ${costExpr} ELSE 0 END), 0) as gains_cents`),
        );
      const by_user: WriteOffByUser[] = agg
        .map((a) => ({
          user_id: a.performed_by ?? null,
          name: a.name ?? null,
          events: Number(a.events),
          losses_cents: Math.round(Number(a.losses_cents)),
          gains_cents: Math.round(Number(a.gains_cents)),
          net_cents: Math.round(Number(a.losses_cents)) + Math.round(Number(a.gains_cents)),
        }))
        .sort((a, b) => a.losses_cents - b.losses_cents);

      const total_losses_cents = by_user.reduce((s, u) => s + u.losses_cents, 0);
      const total_gains_cents = by_user.reduce((s, u) => s + u.gains_cents, 0);
      return {
        from: from.toISOString(),
        to: toEnd.toISOString(),
        rows,
        truncated,
        by_user,
        total_losses_cents,
        total_gains_cents,
        net_cents: total_losses_cents + total_gains_cents,
      };
    });
  },
);
