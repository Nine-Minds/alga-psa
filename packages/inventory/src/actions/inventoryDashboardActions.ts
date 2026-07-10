'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  permissionError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  queryBillCreep,
  queryCountApprovals,
  queryDeadStock,
  queryDeployments,
  queryGhostWeek,
  queryOverdueLoaners,
  queryPipeline,
  queryPriceCreep,
  queryRmaReceivables,
  queryUnbilled,
  queryValueWowDeltaByCurrency,
  queryVanContext,
  queryWarrantyExpiring,
  type DeadStock,
  type DeploymentRow,
  type MoneyByCurrency,
  type Pipeline,
  type RmaReceivables,
  type UnbilledSoRow,
  totalMoneyByCurrency,
} from '../lib/dashboardQueries';
import { resolveTenantCurrency } from '../lib/tenantCurrency';

/**
 * Consolidated data feed for the Inventory dashboard ("money before lunch").
 * One permission check, one transaction. All monetary values are integer cents.
 * Composition + derivations: docs/plans/2026-07-06-inventory-dashboard-ui-plan.md
 * (widget catalogue in design §8 / PRD §9).
 *
 * Attention rows are STRUCTURED (kind + params), never pre-rendered English —
 * the client composes the copy through i18n. Adding a row source means adding
 * a kind here and its templates in features/inventory locales.
 */

export type AttentionBand = 'red' | 'amber' | 'info';
export type AttentionCategory = 'money' | 'fulfillment' | 'field' | 'ops';

export type AttentionKind =
  | 'unbilled_so'
  | 'unbilled_dropship'
  | 'cutover'
  | 'van_shortage'
  | 'overdue_loaner'
  | 'ghost_tech'
  | 'rma_vendor'
  | 'rma_client'
  | 'price_creep_so'
  | 'price_creep_quotes'
  | 'price_creep_bill'
  | 'bills_overdue'
  | 'count_approval'
  | 'stock_low'
  | 'stock_out'
  | 'po_partial'
  | 'warranty'
  | 'dead_stock';

export type AttentionActionKey =
  | 'invoice'
  | 'viewSo'
  | 'trackTransfer'
  | 'recall'
  | 'review'
  | 'chase'
  | 'openStaging'
  | 'requote'
  | 'reviewBill'
  | 'approve'
  | 'reorder'
  | 'createPo'
  | 'receive'
  | 'shipReplacement'
  | 'view';

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  band: AttentionBand;
  category: AttentionCategory;
  /** Linked entity leading the row (client / vendor / tech / van / SO# / location). */
  name: string | null;
  /** Where the name links to; null renders the name as plain text. */
  href: string | null;
  /** Kind-specific interpolation values for the title/meta templates. */
  params: Record<string, string | number>;
  amount_cents: number | null;
  age_days: number | null;
  action: { key: AttentionActionKey; href: string; primary?: boolean };
}

export interface ReceivingPo {
  po_id: string;
  po_number: string;
  vendor_name: string | null;
  status: string;
  ordered: number;
  received: number;
  total_value: number;
  outstanding_value: number;
  expected_date: string | null;
}

export interface InventoryDashboardData {
  /** Tenant default billing currency (ISO 4217) for money formatting. */
  currency_code: string;
  header: {
    branch_count: number;
    van_count: number;
    tech_count: number;
    attention_count: number;
    urgent_count: number;
    /** D5 — Σ red-band row dollars + unbilled total (unbilled rows counted once). */
    in_play_cents: number;
  };
  unbilled: {
    total: number;
    top_so: UnbilledSoRow | null;
    other_so: { count: number; amount: number };
    dropship: { so_count: number; amount: number };
    ghost: { count: number; amount: number | null };
  };
  margin_mtd: {
    revenue: number;
    cogs: number;
    margin: number;
    margin_pct: number;
    /** Same MTD window shifted one month back; null when last month had no revenue. */
    prev_month_pct: number | null;
    price_creep: { at_risk: number; quote_count: number; so_numbers: string[] } | null;
  };
  rma_receivables: RmaReceivables;
  attention: AttentionItem[];
  deployments: DeploymentRow[];
  pipeline: Pipeline;
  receiving_today: {
    count: number;
    amount: number;
    more_week: number;
    pos: Array<{ po_id: string; po_number: string; vendor_name: string | null; amount: number; hot: boolean }>;
    /** Feeder PO landing with ≤1 day of slack before a cutover. */
    flag: { po_number: string; client_name: string | null; client_id: string | null; slack_days: number } | null;
  };
  ghost_week: {
    count: number;
    est_total: number | null;
    techs: Array<{ name: string; count: number; est: number | null }>;
  };
  footer: {
    /** Legacy total; use value_by_currency for display so non-2-decimal currencies keep their scale. */
    value: number;
    value_by_currency: MoneyByCurrency[];
    /** Legacy total; use wow_delta_by_currency for display. */
    wow_delta: number;
    wow_delta_by_currency: MoneyByCurrency[];
    on_hand_units: number;
    serialized_units: number;
    dead_stock: DeadStock | null;
    week: { received: number; deployed: number; transfers: number; rmas: number };
  };
}

const OPEN_PO_STATUSES = ['draft', 'open', 'partially_received'];

export type InventoryDashboardActionError = ActionPermissionError;

function etaLabel(expected: Date | string | null | undefined): string | null {
  if (!expected) return null;
  const d = new Date(expected);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  const days = Math.round((d.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'ETA today';
  if (days === 1) return 'ETA tomorrow';
  return `ETA ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

const ROUTES = {
  salesOrders: '/msp/inventory/sales-orders',
  salesOrdersInvoiceable: '/msp/inventory/sales-orders?attention=invoiceable',
  purchaseOrders: '/msp/inventory/purchase-orders',
  purchaseOrdersPartial: '/msp/inventory/purchase-orders?status=partially_received',
  rma: '/msp/inventory/rma',
  rmaVendorCredits: '/msp/inventory/rma?status=sent_to_vendor',
  rmaDeadUnitsOwed: '/msp/inventory/rma?status=dead_unit_owed',
  loaners: '/msp/inventory/loaners',
  transfers: '/msp/inventory/transfers',
  ghostUsage: '/msp/inventory/ghost-usage',
  vendorBills: '/msp/inventory/vendor-bills',
  counts: '/msp/inventory/counts',
  units: '/msp/inventory/units',
  stock: '/msp/inventory/stock',
  stockAttention: '/msp/inventory/stock?attention=1',
  quotes: '/msp/billing?tab=quotes',
  client: (id: string) => `/msp/clients/${id}`,
} as const;

function mergeMoneyBuckets(rows: Array<{ currency_code: string | null; amount: unknown }>, fallbackCurrency: string): MoneyByCurrency[] {
  const byCurrency = new Map<string, number>();
  for (const row of rows) {
    const currency = row.currency_code?.trim() || fallbackCurrency;
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + Math.round(Number(row.amount ?? 0)));
  }
  return [...byCurrency.entries()]
    .map(([currency_code, amount]) => ({ currency_code, amount }))
    .filter((row) => row.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.currency_code.localeCompare(b.currency_code));
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export const getInventoryDashboardData = withAuth(async (user, { tenant }): Promise<InventoryDashboardData | InventoryDashboardActionError> => {
  if (!(await hasPermission(user, 'inventory', 'read'))) {
    return permissionError('Permission denied: inventory read required');
  }
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    /* ---- locations / header counts ---- */
    const locations = await trx('stock_locations')
      .where({ tenant, is_active: true })
      .select<{ location_id: string; name: string; location_type: string; assigned_user_id: string | null }[]>(
        'location_id',
        'name',
        'location_type',
        'assigned_user_id',
      );
    const vans = locations.filter((l) => l.location_type === 'van');
    const branch_count = locations.length - vans.length;

    const techRow = await trx('users')
      .where({ tenant, user_type: 'internal', is_inactive: false })
      .count<{ c: string }>('* as c')
      .first();
    const tech_count = Number(techRow?.c ?? 0);

    /* ---- tenant default billing currency (money formatting) ---- */
    const currency_code = await resolveTenantCurrency(trx, tenant);

    /* ---- on-hand value + units (footer) ---- */
    const settingsCurrency = trx.raw("COALESCE(NULLIF(pis.cost_currency, ''), ?) as currency_code", [currency_code]);
    const nonSerValueRows = await trx('stock_levels as sl')
      .join('product_inventory_settings as pis', function () {
        this.on('sl.service_id', '=', 'pis.service_id').andOn('sl.tenant', '=', 'pis.tenant');
      })
      .where({ 'sl.tenant': tenant, 'pis.is_serialized': false })
      .andWhere('sl.quantity_on_hand', '>', 0)
      .groupBy('currency_code')
      .select<{ currency_code: string | null; value: string }[]>(
        settingsCurrency,
        trx.raw('COALESCE(SUM(sl.quantity_on_hand * COALESCE(pis.average_cost, 0)),0) as value'),
      );
    const unitCurrency = trx.raw("COALESCE(NULLIF(su.cost_currency, ''), NULLIF(pis.cost_currency, ''), ?) as currency_code", [currency_code]);
    const serValueRows = await trx('stock_units as su')
      .leftJoin('product_inventory_settings as pis', function () {
        this.on('su.service_id', '=', 'pis.service_id').andOn('su.tenant', '=', 'pis.tenant');
      })
      .where({ 'su.tenant': tenant, 'su.status': 'in_stock' })
      .whereNotNull('su.location_id')
      .groupBy('currency_code')
      .select<{ currency_code: string | null; value: string }[]>(
        unitCurrency,
        trx.raw('COALESCE(SUM(COALESCE(su.unit_cost,0)),0) as value'),
      );
    const footerValueByCurrency = mergeMoneyBuckets(
      [
        ...nonSerValueRows.map((row) => ({ currency_code: row.currency_code, amount: row.value })),
        ...serValueRows.map((row) => ({ currency_code: row.currency_code, amount: row.value })),
      ],
      currency_code,
    );
    const footerValue = totalMoneyByCurrency(footerValueByCurrency);

    const onHandRow = await trx('stock_levels').where({ tenant }).sum<{ s: string }>('quantity_on_hand as s').first();
    const serCountRow = await trx('stock_units').where({ tenant, status: 'in_stock' }).count<{ c: string }>('* as c').first();

    /* ---- open POs (receiving) ---- */
    const poRows = await trx('purchase_orders as po')
      .leftJoin('vendors as v', function () {
        this.on('po.vendor_id', '=', 'v.vendor_id').andOn('po.tenant', '=', 'v.tenant');
      })
      .leftJoin('purchase_order_lines as l', function () {
        this.on('po.po_id', '=', 'l.po_id').andOn('po.tenant', '=', 'l.tenant');
      })
      .where({ 'po.tenant': tenant })
      .whereIn('po.status', OPEN_PO_STATUSES)
      .groupBy('po.po_id', 'po.po_number', 'po.status', 'po.expected_date', 'po.order_date', 'v.vendor_name')
      .orderBy('po.order_date', 'desc')
      .select<any[]>(
        'po.po_id as po_id',
        'po.po_number as po_number',
        'po.status as status',
        'po.expected_date as expected_date',
        'v.vendor_name as vendor_name',
        trx.raw('COALESCE(SUM(l.quantity_ordered),0) as ordered'),
        trx.raw('COALESCE(SUM(l.quantity_received),0) as received'),
        trx.raw('COALESCE(SUM(l.quantity_ordered * l.unit_cost),0) as total_value'),
        trx.raw('COALESCE(SUM((l.quantity_ordered - l.quantity_received) * l.unit_cost),0) as outstanding_value'),
      );
    const openPos: ReceivingPo[] = poRows.map((r) => ({
      po_id: r.po_id,
      po_number: r.po_number,
      vendor_name: r.vendor_name ?? null,
      status: r.status,
      ordered: Number(r.ordered),
      received: Number(r.received),
      total_value: Number(r.total_value),
      outstanding_value: Number(r.outstanding_value),
      expected_date: r.expected_date ? new Date(r.expected_date).toISOString() : null,
    }));

    /* ---- margin MTD + previous MTD ---- */
    // Consume movements carry the SO id (not the line id) in source_doc_id, so the line
    // price is resolved by (so_id, service_id). LATERAL … LIMIT 1 prevents fan-out when
    // an SO repeats a service across lines (the movement can't tell them apart anyway).
    const marginQuery = (fromExpr: string, toExpr: string | null) => {
      let q = trx('stock_movements as sm')
        .joinRaw(
          `LEFT JOIN LATERAL (
            SELECT l.unit_price FROM sales_order_lines l
            WHERE l.tenant = sm.tenant AND l.so_id = sm.source_doc_id AND l.service_id = sm.service_id
            ORDER BY l.created_at ASC LIMIT 1
          ) sol ON true`,
        )
        .where({ 'sm.tenant': tenant, 'sm.movement_type': 'consume', 'sm.source_doc_type': 'sales_order' })
        .andWhereRaw(`sm.created_at >= ${fromExpr}`);
      if (toExpr) q = q.andWhereRaw(`sm.created_at < ${toExpr}`);
      return q
        .select<{ revenue: string; cogs: string }[]>(
          trx.raw('COALESCE(SUM(sm.quantity * COALESCE(sol.unit_price,0)),0) as revenue'),
          trx.raw('COALESCE(SUM(COALESCE(sm.cogs_cost,0)),0) as cogs'),
        )
        .first();
    };
    const marginRow = await marginQuery("date_trunc('month', now())", null);
    // "vs last mo" compares like-for-like: the same month-to-date window, one month back.
    const prevMarginRow = await marginQuery("date_trunc('month', now()) - interval '1 month'", "now() - interval '1 month'");
    const revenue = Math.round(Number(marginRow?.revenue ?? 0));
    const cogs = Math.round(Number(marginRow?.cogs ?? 0));
    const margin = revenue - cogs;
    const margin_pct = revenue > 0 ? (margin / revenue) * 100 : 0;
    const prevRevenue = Math.round(Number(prevMarginRow?.revenue ?? 0));
    const prev_month_pct = prevRevenue > 0 ? ((prevRevenue - Math.round(Number(prevMarginRow?.cogs ?? 0))) / prevRevenue) * 100 : null;

    /* ---- week activity (footer) ---- */
    const wk = await trx('stock_movements')
      .where({ tenant })
      .andWhereRaw("created_at >= now() - interval '7 days'")
      .select<{ received: string; deployed: string; transfers: string }[]>(
        trx.raw("COALESCE(SUM(quantity) FILTER (WHERE movement_type='receipt'),0) as received"),
        trx.raw("COALESCE(SUM(quantity) FILTER (WHERE movement_type='consume'),0) as deployed"),
        trx.raw("COUNT(*) FILTER (WHERE movement_type='transfer_out') as transfers"),
      )
      .first();
    const rmaWkRow = await trx('rma_cases')
      .where({ tenant })
      .andWhereRaw("opened_at >= now() - interval '7 days'")
      .count<{ c: string }>('* as c')
      .first();

    /* ---- D1–D9 derivations ---- */
    const ghost_week = await queryGhostWeek(trx, tenant);
    const unbilled = await queryUnbilled(trx, tenant, ghost_week);
    const priceCreep = await queryPriceCreep(trx, tenant);
    const rma_receivables = await queryRmaReceivables(trx, tenant);
    const deployments = await queryDeployments(trx, tenant);
    const pipeline = await queryPipeline(trx, tenant);
    const deadStock = await queryDeadStock(trx, tenant, currency_code);
    const wowDeltaByCurrency = await queryValueWowDeltaByCurrency(trx, tenant, currency_code);
    const wowDelta = totalMoneyByCurrency(wowDeltaByCurrency);
    const overdueLoaners = await queryOverdueLoaners(trx, tenant);
    const countApprovals = await queryCountApprovals(trx, tenant);
    const billCreep = await queryBillCreep(trx, tenant);
    const warranty = await queryWarrantyExpiring(trx, tenant);

    /* ---- low / out of stock (existing signal, now split van vs branch) ---- */
    const lowRows = await trx('stock_levels as sl')
      .join('product_inventory_settings as pis', function () {
        this.on('sl.service_id', '=', 'pis.service_id').andOn('sl.tenant', '=', 'pis.tenant');
      })
      .join('service_catalog as sc', function () {
        this.on('sl.service_id', '=', 'sc.service_id').andOn('sl.tenant', '=', 'sc.tenant');
      })
      .leftJoin('stock_locations as loc', function () {
        this.on('sl.location_id', '=', 'loc.location_id').andOn('sl.tenant', '=', 'loc.tenant');
      })
      .where({ 'sl.tenant': tenant, 'pis.track_stock': true })
      .whereRaw('COALESCE(sl.reorder_point, pis.reorder_point) IS NOT NULL')
      .whereRaw('(sl.quantity_on_hand - sl.reserved_quantity - sl.held_quantity) <= COALESCE(sl.reorder_point, pis.reorder_point)')
      .select<any[]>(
        'sc.service_name as service_name',
        'loc.name as location_name',
        'loc.location_type as location_type',
        trx.raw('(sl.quantity_on_hand - sl.reserved_quantity - sl.held_quantity) as available'),
        trx.raw('COALESCE(sl.reorder_point, pis.reorder_point) as reorder_point'),
        'sl.service_id as service_id',
        'sl.location_id as location_id',
      )
      .orderByRaw('(sl.quantity_on_hand - sl.reserved_quantity - sl.held_quantity) asc');
    const vanShortages = lowRows.filter((r) => r.location_type === 'van');
    const branchShortages = lowRows.filter((r) => r.location_type !== 'van');
    const vanCtx = await queryVanContext(
      trx,
      tenant,
      vans.filter((v) => vanShortages.some((s) => s.location_id === v.location_id)),
    );

    /* ---- dead units owed to clients (advance replacement) ---- */
    const deadOwedRows = await trx('rma_cases as r')
      .leftJoin('clients as c', function () {
        this.on('r.client_id', '=', 'c.client_id').andOn('r.tenant', '=', 'c.tenant');
      })
      .leftJoin('service_catalog as sc', function () {
        this.on('r.service_id', '=', 'sc.service_id').andOn('r.tenant', '=', 'sc.tenant');
      })
      .where({ 'r.tenant': tenant, 'r.status': 'dead_unit_owed' })
      .select<any[]>(
        'r.rma_id as rma_id',
        'r.rma_reference as rma_reference',
        'r.dead_unit_due_date as due',
        'r.client_id as client_id',
        'c.client_name as client_name',
        'sc.service_name as service_name',
      )
      .orderBy('r.dead_unit_due_date', 'asc');

    /* ---- open vendor bills aging (widget demoted to a stream row) ---- */
    const billRows = await trx('vendor_bills')
      .where({ tenant })
      .whereIn('status', ['draft', 'open'])
      .select<{ total_amount: string; due_date: string | null }[]>('total_amount', 'due_date');
    const nowMs = Date.now();
    let overdueBillCount = 0;
    let overdueBillTotal = 0;
    let oldestOverdueDays = 0;
    for (const b of billRows) {
      if (b.due_date && new Date(b.due_date).getTime() < nowMs) {
        overdueBillCount += 1;
        overdueBillTotal += Number(b.total_amount ?? 0);
        oldestOverdueDays = Math.max(oldestOverdueDays, Math.floor((nowMs - new Date(b.due_date).getTime()) / 86_400_000));
      }
    }

    /* ---- attention stream assembly ---- */
    const attention: AttentionItem[] = [];

    // Unbilled shipments — every from-stock SO with goods out ahead of the invoice.
    for (const so of unbilled.from_stock.rows) {
      attention.push({
        id: `so-${so.so_id}`,
        kind: 'unbilled_so',
        band: 'red',
        category: 'money',
        name: so.client_name ?? so.so_number,
        href: so.client_id ? ROUTES.client(so.client_id) : ROUTES.salesOrders,
        params: {
          so_number: so.so_number,
          line_count: so.line_count,
          fully_shipped: so.fully_shipped ? 1 : 0,
          ...(so.shipped_days_ago != null ? { shipped_days_ago: so.shipped_days_ago } : {}),
        },
        amount_cents: so.amount,
        age_days: so.shipped_days_ago,
        action: { key: 'invoice', href: ROUTES.salesOrdersInvoiceable, primary: true },
      });
    }
    if (unbilled.dropship.so_count > 0) {
      attention.push({
        id: 'unbilled-dropship',
        kind: 'unbilled_dropship',
        band: 'red',
        category: 'money',
        name: null,
        href: null,
        params: { so_count: unbilled.dropship.so_count },
        amount_cents: unbilled.dropship.amount,
        age_days: null,
        action: { key: 'invoice', href: ROUTES.salesOrdersInvoiceable, primary: true },
      });
    }

    // Cutovers (D1) — at-risk are red, staging amber; ready stays out of the stream.
    for (const dep of deployments) {
      if (dep.status === 'ready') continue;
      attention.push({
        id: `cutover-${dep.so_id}`,
        kind: 'cutover',
        band: dep.status === 'at_risk' ? 'red' : 'amber',
        category: 'fulfillment',
        name: dep.client_name ?? dep.so_number,
        href: dep.client_id ? ROUTES.client(dep.client_id) : ROUTES.salesOrders,
        params: {
          so_number: dep.so_number,
          ship_date: dep.ship_date,
          days_out: dep.days_out,
          ordered: dep.ordered,
          staged: dep.staged,
          done: dep.done,
          backordered: dep.backordered,
          readiness_pct: dep.readiness_pct,
          at_risk: dep.status === 'at_risk' ? 1 : 0,
          ...(dep.feeder
            ? {
                po_number: dep.feeder.po_number,
                ...(dep.feeder.eta ? { feeder_eta: dep.feeder.eta } : {}),
                ...(dep.feeder.slack_days != null ? { slack_days: dep.feeder.slack_days } : {}),
              }
            : {}),
        },
        amount_cents: null,
        age_days: dep.days_out,
        action:
          dep.status === 'at_risk'
            ? { key: 'viewSo', href: ROUTES.salesOrders }
            : { key: 'openStaging', href: ROUTES.salesOrders },
      });
    }

    // Van shortages (D8) — red when the van is dry and the tech has jobs today.
    for (const s of vanShortages) {
      const avail = Number(s.available);
      const jobs = vanCtx.jobs_today.get(s.location_id) ?? 0;
      const inbound = vanCtx.inbound.get(s.location_id) ?? null;
      const tech = vanCtx.tech_names.get(s.location_id) ?? null;
      attention.push({
        id: `van-${s.service_id}-${s.location_id}`,
        kind: 'van_shortage',
        band: avail <= 0 && jobs > 0 ? 'red' : 'amber',
        category: 'field',
        name: tech ? `${s.location_name} · ${tech}` : (s.location_name ?? null),
        href: ROUTES.stockAttention,
        params: {
          service_name: s.service_name,
          available: avail,
          reorder_point: Number(s.reorder_point),
          jobs_today: jobs,
          in_transit: inbound ? 1 : 0,
          ...(inbound?.from_name ? { transfer_from: inbound.from_name } : {}),
          ...(inbound ? { dispatched_at: inbound.dispatched_at } : {}),
        },
        amount_cents: null,
        age_days: null,
        action: inbound ? { key: 'trackTransfer', href: ROUTES.transfers } : { key: 'reorder', href: ROUTES.stockAttention },
      });
    }

    // Overdue loaners (D6) — chargeable metal sitting at a client past its date.
    for (const l of overdueLoaners) {
      attention.push({
        id: `loaner-${l.unit_id}`,
        kind: 'overdue_loaner',
        band: 'red',
        category: 'money',
        name: l.client_name,
        href: l.client_id ? ROUTES.client(l.client_id) : ROUTES.loaners,
        params: {
          service_name: l.service_name ?? '',
          due_at: l.due_at,
          overdue_days: l.overdue_days,
          ...(l.serial_number ? { serial_number: l.serial_number } : {}),
        },
        amount_cents: l.unit_cost,
        age_days: l.overdue_days,
        action: { key: 'recall', href: ROUTES.loaners },
      });
    }

    // Ghost usage (D3) — the top tech this week gets a row; the tile has the rest.
    const topGhostTech = ghost_week.techs[0];
    if (topGhostTech) {
      attention.push({
        id: 'ghost-top-tech',
        kind: 'ghost_tech',
        band: 'amber',
        category: 'money',
        name: topGhostTech.name,
        href: ROUTES.ghostUsage,
        params: { count: topGhostTech.count },
        amount_cents: topGhostTech.est,
        age_days: null,
        action: { key: 'review', href: ROUTES.ghostUsage },
      });
    }

    // Vendor-owed RMAs — nothing owed sits quiet; oldest first.
    for (const r of [...rma_receivables.rows]) {
      attention.push({
        id: `rma-vendor-${r.rma_id}`,
        kind: 'rma_vendor',
        band: 'amber',
        category: 'money',
        name: r.vendor_name,
        href: ROUTES.rmaVendorCredits,
        params: {
          ...(r.rma_reference ? { rma_reference: r.rma_reference } : {}),
          ...(r.service_name ? { service_name: r.service_name } : {}),
          ...(r.age_days != null ? { age_days: r.age_days } : {}),
        },
        amount_cents: r.amount,
        age_days: r.age_days,
        action: { key: 'chase', href: ROUTES.rmaVendorCredits },
      });
    }

    // Dead units owed to clients (advance replacement clock).
    for (const r of deadOwedRows) {
      const daysRemaining = r.due ? Math.ceil((new Date(r.due).getTime() - nowMs) / 86_400_000) : null;
      const urgent = daysRemaining != null && daysRemaining <= 2;
      attention.push({
        id: `rma-client-${r.rma_id}`,
        kind: 'rma_client',
        band: urgent ? 'red' : 'amber',
        category: 'fulfillment',
        name: r.client_name,
        href: r.client_id ? ROUTES.client(r.client_id) : ROUTES.rma,
        params: {
          ...(r.rma_reference ? { rma_reference: r.rma_reference } : {}),
          ...(r.service_name ? { service_name: r.service_name } : {}),
          ...(daysRemaining != null ? { days_remaining: daysRemaining } : {}),
        },
        amount_cents: null,
        age_days: daysRemaining != null && daysRemaining < 0 ? Math.abs(daysRemaining) : null,
        action: { key: 'shipReplacement', href: ROUTES.rmaDeadUnitsOwed },
      });
    }

    // Price creep (D2) — signed SOs first (cap 3), then one rolled-up quotes row.
    if (priceCreep) {
      for (const so of priceCreep.so.slice(0, 3)) {
        attention.push({
          id: `creep-so-${so.so_id}`,
          kind: 'price_creep_so',
          band: 'amber',
          category: 'money',
          name: so.so_number,
          href: ROUTES.salesOrders,
          params: { so_number: so.so_number },
          amount_cents: so.at_risk,
          age_days: null,
          action: { key: 'requote', href: ROUTES.salesOrders },
        });
      }
      if (priceCreep.quotes.count > 0) {
        attention.push({
          id: 'creep-quotes',
          kind: 'price_creep_quotes',
          band: 'amber',
          category: 'money',
          name: null,
          href: null,
          params: { count: priceCreep.quotes.count, numbers: priceCreep.quotes.numbers.join(' · ') },
          amount_cents: priceCreep.quotes.at_risk,
          age_days: null,
          action: { key: 'requote', href: ROUTES.quotes },
        });
      }
    }

    // Vendor-bill price creep (F090 rollup) + overdue bills (widget demoted here).
    for (const b of billCreep.slice(0, 3)) {
      attention.push({
        id: `creep-bill-${b.bill_id}`,
        kind: 'price_creep_bill',
        band: 'amber',
        category: 'money',
        name: b.vendor_name,
        href: ROUTES.vendorBills,
        params: { ...(b.bill_number ? { bill_number: b.bill_number } : {}) },
        amount_cents: b.variance,
        age_days: null,
        action: { key: 'reviewBill', href: ROUTES.vendorBills },
      });
    }
    if (overdueBillCount > 0) {
      attention.push({
        id: 'bills-overdue',
        kind: 'bills_overdue',
        band: 'amber',
        category: 'money',
        name: null,
        href: null,
        params: { count: overdueBillCount },
        amount_cents: overdueBillTotal,
        age_days: oldestOverdueDays,
        action: { key: 'reviewBill', href: ROUTES.vendorBills },
      });
    }

    // Count sessions waiting on the four-eyes approver.
    for (const c of countApprovals) {
      attention.push({
        id: `count-${c.session_id}`,
        kind: 'count_approval',
        band: 'amber',
        category: 'ops',
        name: c.location_name,
        href: ROUTES.counts,
        params: { ...(c.counted_by_name ? { counted_by: c.counted_by_name } : {}) },
        amount_cents: c.variance,
        age_days: null,
        action: { key: 'approve', href: ROUTES.counts },
      });
    }

    // Branch low/out of stock (vans handled above).
    for (const s of branchShortages) {
      const avail = Number(s.available);
      const out = avail <= 0;
      attention.push({
        id: `low-${s.service_id}-${s.location_id}`,
        kind: out ? 'stock_out' : 'stock_low',
        band: out ? 'red' : 'amber',
        category: 'ops',
        name: s.location_name ?? null,
        href: ROUTES.stockAttention,
        params: { service_name: s.service_name, available: avail, reorder_point: Number(s.reorder_point) },
        amount_cents: null,
        age_days: null,
        action: { key: 'reorder', href: ROUTES.stockAttention, primary: out },
      });
    }

    // Partially received POs.
    for (const po of openPos.filter((p) => p.status === 'partially_received')) {
      attention.push({
        id: `po-${po.po_id}`,
        kind: 'po_partial',
        band: 'amber',
        category: 'ops',
        name: po.po_number,
        href: ROUTES.purchaseOrdersPartial,
        params: {
          po_number: po.po_number,
          vendor_name: po.vendor_name ?? '',
          received: po.received,
          ordered: po.ordered,
        },
        amount_cents: null,
        age_days: null,
        action: { key: 'receive', href: ROUTES.purchaseOrdersPartial },
      });
    }

    // Warranty horizon (aggregate) + dead stock — the "keep an eye on" tier.
    if (warranty.count > 0) {
      attention.push({
        id: 'warranties',
        kind: 'warranty',
        band: 'info',
        category: 'field',
        name: null,
        href: null,
        params: {
          count: warranty.count,
          client_count: warranty.clients.length,
          clients: warranty.clients.map((c) => `${c.client_name} ${c.count}`).join(' · '),
        },
        amount_cents: null,
        age_days: null,
        action: { key: 'view', href: ROUTES.units },
      });
    }
    if (deadStock) {
      attention.push({
        id: `dead-stock-${deadStock.location_id}`,
        kind: 'dead_stock',
        band: 'info',
        category: 'ops',
        name: deadStock.location_name,
        href: ROUTES.stock,
        params: { location_count: deadStock.location_count },
        amount_cents: deadStock.amount,
        age_days: 90,
        action: { key: 'review', href: ROUTES.stock },
      });
    }

    // Rank: red → amber → info, then by dollar impact (rows without dollars last).
    const bandRank: Record<AttentionBand, number> = { red: 0, amber: 1, info: 2 };
    attention.sort(
      (a, b) => bandRank[a.band] - bandRank[b.band] || (b.amount_cents ?? -1) - (a.amount_cents ?? -1),
    );

    /* ---- header stats (D5) ---- */
    // in_play = unbilled total + red-band dollars; unbilled rows are already inside
    // the unbilled total, so they're excluded from the row sum (no double count).
    const redRowDollars = attention
      .filter((a) => a.band === 'red' && a.kind !== 'unbilled_so' && a.kind !== 'unbilled_dropship')
      .reduce((s, a) => s + (a.amount_cents ?? 0), 0);
    const urgent_count = attention.filter((a) => a.band === 'red').length;

    /* ---- receiving today (rail) ---- */
    const now = new Date();
    const withEta = openPos.filter((p) => p.expected_date != null);
    const todayPos = withEta.filter((p) => sameLocalDay(new Date(p.expected_date!), now));
    const weekAhead = withEta.filter((p) => {
      const d = new Date(p.expected_date!);
      return !sameLocalDay(d, now) && d.getTime() > now.getTime() && d.getTime() <= now.getTime() + 7 * 86_400_000;
    });
    const hotFeeders = new Set(
      deployments
        .filter((d) => d.feeder && d.feeder.slack_days != null && d.feeder.slack_days <= 1)
        .map((d) => d.feeder!.po_id),
    );
    const receivingList = [...todayPos, ...weekAhead]
      .slice(0, 3)
      .map((p) => ({
        po_id: p.po_id,
        po_number: p.po_number,
        vendor_name: p.vendor_name,
        amount: p.outstanding_value,
        hot: hotFeeders.has(p.po_id),
      }));
    const flagDep = deployments.find(
      (d) => d.feeder && d.feeder.slack_days != null && d.feeder.slack_days <= 1 && d.feeder.eta != null,
    );

    return {
      currency_code,
      header: {
        branch_count,
        van_count: vans.length,
        tech_count,
        attention_count: attention.length,
        urgent_count,
        in_play_cents: unbilled.total + redRowDollars,
      },
      unbilled: {
        total: unbilled.total,
        top_so: unbilled.from_stock.rows[0] ?? null,
        other_so: {
          count: Math.max(0, unbilled.from_stock.rows.length - 1),
          amount: unbilled.from_stock.rows.slice(1).reduce((s, r) => s + r.amount, 0),
        },
        dropship: unbilled.dropship,
        ghost: unbilled.ghost,
      },
      margin_mtd: {
        revenue,
        cogs,
        margin,
        margin_pct,
        prev_month_pct,
        price_creep: priceCreep
          ? {
              at_risk: priceCreep.total_at_risk,
              quote_count: priceCreep.quotes.count,
              so_numbers: priceCreep.so.slice(0, 2).map((s) => s.so_number),
            }
          : null,
      },
      rma_receivables,
      attention,
      deployments,
      pipeline,
      receiving_today: {
        count: todayPos.length,
        amount: todayPos.reduce((s, p) => s + p.outstanding_value, 0),
        more_week: weekAhead.length,
        pos: receivingList,
        flag: flagDep
          ? {
              po_number: flagDep.feeder!.po_number,
              client_name: flagDep.client_name,
              client_id: flagDep.client_id,
              slack_days: flagDep.feeder!.slack_days!,
            }
          : null,
      },
      ghost_week: { count: ghost_week.count, est_total: ghost_week.est_total, techs: ghost_week.techs },
      footer: {
        value: footerValue,
        value_by_currency: footerValueByCurrency,
        wow_delta: wowDelta,
        wow_delta_by_currency: wowDeltaByCurrency,
        on_hand_units: Number(onHandRow?.s ?? 0),
        serialized_units: Number(serCountRow?.c ?? 0),
        dead_stock: deadStock,
        week: {
          received: Number(wk?.received ?? 0),
          deployed: Number(wk?.deployed ?? 0),
          transfers: Number(wk?.transfers ?? 0),
          rmas: Number(rmaWkRow?.c ?? 0),
        },
      },
    };
  });
});
