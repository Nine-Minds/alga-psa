'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex, tenantDb } from '@alga-psa/db';
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
      const scopedDb = tenantDb(trx, tenant);
      const query = scopedDb.table('product_inventory_settings as pis');
      scopedDb.tenantJoin(query, 'service_catalog as sc', 'pis.service_id', 'sc.service_id');
      return query
        .where({ 'pis.track_stock': true })
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
    const scopedDb = tenantDb(trx, tenant);
    const valueByLocation = new Map<string, number>();

    // Non-serialized: on-hand × average_cost from stock_levels joined to settings.
    const nonSerializedQuery = scopedDb.table('stock_levels as sl');
    scopedDb.tenantJoin(nonSerializedQuery, 'product_inventory_settings as pis', 'sl.service_id', 'pis.service_id');
    const nonSerialized = await nonSerializedQuery
      .where('pis.is_serialized', false)
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
    const serialized = await scopedDb.table('stock_units')
      .where({ status: 'in_stock' })
      .whereNotNull('location_id')
      .select<{ location_id: string; value: string }[]>(
        'location_id',
        trx.raw('SUM(COALESCE(unit_cost, 0)) as value'),
      )
      .groupBy('location_id');
    for (const r of serialized) {
      valueByLocation.set(r.location_id, (valueByLocation.get(r.location_id) ?? 0) + Number(r.value ?? 0));
    }

    const locations = await scopedDb.table('stock_locations')
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
  sku: string | null;
  qty_sold: number;
  revenue_cents: number;
  cogs_cents: number;
  margin_cents: number;
  /** Percentage points, e.g. 42.5 for 42.5%; null when revenue is zero. */
  margin_pct: number | null;
}

export interface MarginReport {
  rows: MarginReportRow[];
  total_revenue_cents: number;
  total_cogs_cents: number;
  total_margin_cents: number;
  total_margin_pct: number | null;
  currency_code: string;
}

function normalizeReportBoundary(value: string | Date | undefined, endExclusive: boolean): string | Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (endExclusive && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const date = new Date(`${trimmed}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString();
  }
  return trimmed;
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
      const scopedDb = tenantDb(trx, tenant);
      const from = normalizeReportBoundary(filter?.from, false);
      const toExclusive = normalizeReportBoundary(filter?.to, true);
      // LATERAL joins are inexpressible through tenantJoin's column-pair API; the raw
      // SQL already carries the tenant distribution-key equality (sol.tenant = sm.tenant).
      const q = scopedDb.table('stock_movements as sm')
        .joinRaw(
          `LEFT JOIN LATERAL (
            SELECT sol.unit_price
            FROM sales_order_lines sol
            WHERE sol.tenant = sm.tenant
              AND sol.so_id = sm.source_doc_id
              AND sol.service_id = sm.service_id
            ORDER BY sol.created_at ASC, sol.so_line_id ASC
            LIMIT 1
          ) sol ON true`,
        );
      scopedDb.tenantJoin(q, 'service_catalog as sc', 'sm.service_id', 'sc.service_id', { type: 'left' });
      q.where({ 'sm.movement_type': 'consume', 'sm.source_doc_type': 'sales_order' });
      if (from) q.andWhere('sm.created_at', '>=', from);
      if (toExclusive) q.andWhere('sm.created_at', '<', toExclusive);

      const grouped = await q
        .select<{ service_id: string; service_name: string | null; sku: string | null; qty_sold: string; revenue_cents: string; cogs_cents: string }[]>(
          'sm.service_id as service_id',
          'sc.service_name as service_name',
          'sc.sku as sku',
          trx.raw('SUM(sm.quantity) as qty_sold'),
          trx.raw('SUM(sm.quantity * COALESCE(sol.unit_price, 0)) as revenue_cents'),
          trx.raw('SUM(COALESCE(sm.cogs_cost, 0)) as cogs_cents'),
        )
        .groupBy('sm.service_id', 'sc.service_name', 'sc.sku')
        .orderBy('sc.service_name', 'asc');

      const rows: MarginReportRow[] = grouped.map((r) => {
        const revenue = Math.round(Number(r.revenue_cents ?? 0));
        const cogs = Math.round(Number(r.cogs_cents ?? 0));
        const margin = revenue - cogs;
        return {
          service_id: r.service_id,
          service_name: r.service_name ?? null,
          sku: r.sku ?? null,
          qty_sold: Number(r.qty_sold ?? 0),
          revenue_cents: revenue,
          cogs_cents: cogs,
          margin_cents: margin,
          margin_pct: revenue === 0 ? null : (margin / revenue) * 100,
        };
      });

      const total_revenue_cents = rows.reduce((s, r) => s + r.revenue_cents, 0);
      const total_cogs_cents = rows.reduce((s, r) => s + r.cogs_cents, 0);
      const total_margin_cents = total_revenue_cents - total_cogs_cents;
      const billingSettingsRow = await trx('default_billing_settings')
        .where({ tenant })
        .select<{ default_currency_code: string | null }>('default_currency_code')
        .first();
      const currency_code = billingSettingsRow?.default_currency_code || 'USD';
      return {
        rows,
        total_revenue_cents,
        total_cogs_cents,
        total_margin_cents,
        total_margin_pct: total_revenue_cents === 0 ? null : (total_margin_cents / total_revenue_cents) * 100,
        currency_code,
      };
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
      const scopedDb = tenantDb(trx, tenant);
      const query = scopedDb.table('stock_units as su');
      scopedDb.tenantJoin(query, 'service_catalog as sc', 'su.service_id', 'sc.service_id', { type: 'left' });
      const rows = await query
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
    const scopedDb = tenantDb(trx, tenant);
    const purchase_orders = (await scopedDb.table('purchase_orders')
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
    const scopedDb = tenantDb(trx, tenant);
    const sales_orders = (await scopedDb.table('sales_orders')
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
    await requireInvRead(user);
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
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

      const base = () => {
        const q = scopedDb.table('stock_movements as sm');
        scopedDb.tenantJoin(q, 'stock_units as su', 'su.unit_id', 'sm.unit_id', { type: 'left' });
        scopedDb.tenantJoin(q, 'product_inventory_settings as pis', 'pis.service_id', 'sm.service_id', { type: 'left' });
        return q
          .whereIn('sm.movement_type', ['adjust', 'retire'])
          .whereBetween('sm.created_at', [from.toISOString(), toEnd.toISOString()]);
      };

      const rowsQuery = base();
      scopedDb.tenantJoin(rowsQuery, 'service_catalog as sc', 'sc.service_id', 'sm.service_id', { type: 'left' });
      // A movement references at most one of from/to location; two joins + COALESCE
      // replace a single join on COALESCE(from, to), which tenantJoin cannot express.
      scopedDb.tenantJoin(rowsQuery, 'stock_locations as floc', 'floc.location_id', 'sm.from_location_id', { type: 'left' });
      scopedDb.tenantJoin(rowsQuery, 'stock_locations as tloc', 'tloc.location_id', 'sm.to_location_id', { type: 'left' });
      scopedDb.tenantJoin(rowsQuery, 'users as u', 'u.user_id', 'sm.performed_by', { type: 'left' });
      const rowsRaw = await rowsQuery
        .orderBy('sm.created_at', 'desc')
        .limit(WRITE_OFF_ROW_CAP + 1)
        .select<any[]>(
          'sm.movement_id',
          'sm.created_at',
          'sm.movement_type',
          'sm.reason',
          'sm.performed_by',
          'sc.service_name',
          trx.raw('COALESCE(floc.name, tloc.name) as location_name'),
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
      const aggQuery = base();
      scopedDb.tenantJoin(aggQuery, 'users as u', 'u.user_id', 'sm.performed_by', { type: 'left' });
      const agg = await aggQuery
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
