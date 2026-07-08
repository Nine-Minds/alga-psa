import { Knex } from 'knex';
import { queryGhostUsageReport } from './ghostUsage';

/**
 * Query layer for the redesigned Inventory dashboard ("money before lunch").
 * Implements the data-derivation decisions D1–D9 of
 * docs/plans/2026-07-06-inventory-dashboard-ui-plan.md. Every join is
 * tenant-qualified; all monetary values are integer cents. Callers run these
 * inside the dashboard action's single transaction.
 */

type Db = Knex | Knex.Transaction;

const OPEN_PO_STATUSES = ['draft', 'open', 'partially_received'];
/** SO statuses that still carry outstanding (bookable/fulfillable) value. */
const OPEN_SO_STATUSES = ['draft', 'confirmed', 'partially_fulfilled', 'fulfilled'];
/** Quote statuses that are still in play (D2/D9; this schema has no pending_approval). */
const OPEN_QUOTE_STATUSES = ['draft', 'sent', 'accepted'];

function num(v: unknown): number {
  return Math.round(Number(v ?? 0));
}

/* ------------------------------ D1 deployments ------------------------------ */

export type DeploymentStatus = 'at_risk' | 'ready' | 'staging';

export interface DeploymentFeeder {
  po_id: string;
  po_number: string;
  vendor_name: string | null;
  /** PO expected_date (ISO) — null when the PO has no ETA (treated as at-risk). */
  eta: string | null;
  /** Whole days between the feeder ETA and the SO ship date (negative = lands after). */
  slack_days: number | null;
}

export interface DeploymentRow {
  so_id: string;
  so_number: string;
  client_id: string | null;
  client_name: string | null;
  ship_date: string;
  days_out: number;
  ordered: number;
  done: number;
  staged: number;
  provisioned: number;
  backordered: number;
  readiness_pct: number;
  status: DeploymentStatus;
  /** Largest line, for the "24× Yealink T54W" scope text. */
  top_line: { qty: number; service_name: string | null } | null;
  /** Riskiest open feeder PO (least slack), when any line is backordered. */
  feeder: DeploymentFeeder | null;
}

function daysBetween(a: Date, b: Date): number {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(b) - day(a)) / 86_400_000);
}

/**
 * D1 — the next 7 days of dated deployments (top 3 by ship date).
 * staged = allocated stock_units; provisioned = staged with a MAC;
 * backordered counts only shortfall covered by an open feeder PO line.
 */
export async function queryDeployments(db: Db, tenant: string): Promise<DeploymentRow[]> {
  const sos = await db('sales_orders as so')
    .leftJoin('clients as c', function () {
      this.on('so.client_id', '=', 'c.client_id').andOn('so.tenant', '=', 'c.tenant');
    })
    .where({ 'so.tenant': tenant })
    .whereIn('so.status', ['confirmed', 'partially_fulfilled'])
    .whereNotNull('so.expected_ship_date')
    .andWhereRaw("so.expected_ship_date >= date_trunc('day', now())")
    .andWhereRaw("so.expected_ship_date < date_trunc('day', now()) + interval '8 days'")
    .orderBy('so.expected_ship_date', 'asc')
    .limit(3)
    .select<any[]>(
      'so.so_id as so_id',
      'so.so_number as so_number',
      'so.expected_ship_date as ship_date',
      'so.client_id as client_id',
      'c.client_name as client_name',
    );
  if (sos.length === 0) return [];
  const soIds = sos.map((s) => s.so_id);

  const lines = await db('sales_order_lines as l')
    .leftJoin('service_catalog as sc', function () {
      this.on('l.service_id', '=', 'sc.service_id').andOn('l.tenant', '=', 'sc.tenant');
    })
    .where('l.tenant', tenant)
    .whereIn('l.so_id', soIds)
    .select<any[]>(
      'l.so_line_id as so_line_id',
      'l.so_id as so_id',
      'l.quantity_ordered as quantity_ordered',
      'l.quantity_fulfilled as quantity_fulfilled',
      'sc.service_name as service_name',
    );
  const lineIds = lines.map((l) => l.so_line_id);

  const allocRows = lineIds.length
    ? await db('stock_units')
        .where({ tenant, status: 'allocated' })
        .whereIn('allocated_so_line_id', lineIds)
        .groupBy('allocated_so_line_id')
        .select<any[]>(
          'allocated_so_line_id',
          db.raw('COUNT(*) as staged'),
          db.raw('COUNT(*) FILTER (WHERE mac_address IS NOT NULL) as provisioned'),
        )
    : [];
  const allocByLine = new Map(allocRows.map((r) => [r.allocated_so_line_id, { staged: num(r.staged), provisioned: num(r.provisioned) }]));

  const feederRows = lineIds.length
    ? await db('purchase_order_lines as pol')
        .join('purchase_orders as po', function () {
          this.on('pol.po_id', '=', 'po.po_id').andOn('pol.tenant', '=', 'po.tenant');
        })
        .leftJoin('vendors as v', function () {
          this.on('po.vendor_id', '=', 'v.vendor_id').andOn('po.tenant', '=', 'v.tenant');
        })
        .where('pol.tenant', tenant)
        .whereIn('pol.source_so_line_id', lineIds)
        .whereIn('po.status', OPEN_PO_STATUSES)
        .whereRaw('pol.quantity_received < pol.quantity_ordered')
        .select<any[]>(
          'pol.source_so_line_id as so_line_id',
          'po.po_id as po_id',
          'po.po_number as po_number',
          'po.expected_date as expected_date',
          'v.vendor_name as vendor_name',
        )
    : [];
  const feedersByLine = new Map<string, any[]>();
  for (const f of feederRows) {
    const list = feedersByLine.get(f.so_line_id) ?? [];
    list.push(f);
    feedersByLine.set(f.so_line_id, list);
  }

  const now = new Date();
  return sos.map((so): DeploymentRow => {
    const soLines = lines.filter((l) => l.so_id === so.so_id);
    const shipDate = new Date(so.ship_date);
    let ordered = 0;
    let done = 0;
    let staged = 0;
    let provisioned = 0;
    let backordered = 0;
    let topLine: { qty: number; service_name: string | null } | null = null;
    let feeder: DeploymentFeeder | null = null;
    let atRisk = false;

    for (const l of soLines) {
      const qo = Number(l.quantity_ordered ?? 0);
      const qf = Number(l.quantity_fulfilled ?? 0);
      const alloc = allocByLine.get(l.so_line_id) ?? { staged: 0, provisioned: 0 };
      ordered += qo;
      done += qf;
      staged += alloc.staged;
      provisioned += alloc.provisioned;
      if (!topLine || qo > topLine.qty) topLine = { qty: qo, service_name: l.service_name ?? null };

      const lineFeeders = feedersByLine.get(l.so_line_id) ?? [];
      if (lineFeeders.length > 0) {
        backordered += Math.max(qo - qf - alloc.staged, 0);
        for (const f of lineFeeders) {
          const eta = f.expected_date ? new Date(f.expected_date) : null;
          // Missing ETA or ETA within 1 day of (or past) the ship date → at risk.
          const slack = eta ? daysBetween(eta, shipDate) : null;
          const risky = !eta || eta.getTime() < now.getTime() || slack! <= 1;
          if (risky) atRisk = true;
          if (!feeder || (slack ?? -1) < (feeder.slack_days ?? Number.MAX_SAFE_INTEGER)) {
            feeder = {
              po_id: f.po_id,
              po_number: f.po_number,
              vendor_name: f.vendor_name ?? null,
              eta: f.expected_date ? new Date(f.expected_date).toISOString() : null,
              slack_days: slack,
            };
          }
        }
      }
    }

    const readiness = ordered > 0 ? Math.round(((done + staged) / ordered) * 100) : 0;
    const status: DeploymentStatus = atRisk ? 'at_risk' : readiness >= 100 ? 'ready' : 'staging';
    return {
      so_id: so.so_id,
      so_number: so.so_number,
      client_id: so.client_id ?? null,
      client_name: so.client_name ?? null,
      ship_date: shipDate.toISOString(),
      days_out: daysBetween(now, shipDate),
      ordered,
      done,
      staged,
      provisioned,
      backordered,
      readiness_pct: Math.min(readiness, 100),
      status,
      top_line: topLine,
      feeder,
    };
  });
}

/* ------------------------------ D2 price creep ------------------------------ */

export interface PriceCreep {
  /** Σ at-risk across SOs and quotes. */
  total_at_risk: number;
  so: Array<{ so_id: string; so_number: string; at_risk: number }>;
  quotes: { count: number; at_risk: number; numbers: string[] };
}

interface PriceCreepSoQueryRow {
  so_id: string;
  so_number: string;
  at_risk: string | number;
}

interface PriceCreepQuoteQueryRow {
  quote_id: string;
  quote_number: string;
  at_risk: string | number;
}

/**
 * D2 — current cost basis per product = preferred vendor_products.unit_cost,
 * else product_inventory_settings.average_cost.
 *
 * SO side follows the plan: unfulfilled non-cancelled lines whose cost_snapshot
 * sits below the current basis; at-risk = (basis − snapshot) × outstanding qty.
 *
 * Quote side deviates (documented): quote_items carries no cost column in this
 * schema, so "quoted at old cost" is not derivable. Instead we flag open-quote
 * items priced BELOW the current basis (selling under cost after creep);
 * at-risk = (basis − unit_price) × quantity. Same failure mode, honest math.
 */
export async function queryPriceCreep(db: Db, tenant: string): Promise<PriceCreep | null> {
  const basisJoin = (qb: Knex.QueryBuilder, serviceCol: string, tenantCol: string) =>
    qb
      .join('product_inventory_settings as pis', function () {
        this.on(`${serviceCol}`, '=', 'pis.service_id').andOn(`${tenantCol}`, '=', 'pis.tenant');
      })
      .leftJoin('vendor_products as vp', function () {
        this.on(`${serviceCol}`, '=', 'vp.service_id')
          .andOn(`${tenantCol}`, '=', 'vp.tenant')
          .andOn(db.raw('vp.is_preferred = true'));
      });

  const soRows: PriceCreepSoQueryRow[] = await basisJoin(
    db('sales_order_lines as l').join('sales_orders as so', function () {
      this.on('l.so_id', '=', 'so.so_id').andOn('l.tenant', '=', 'so.tenant');
    }),
    'l.service_id',
    'l.tenant',
  )
    .where('l.tenant', tenant)
    .whereIn('so.status', ['draft', 'confirmed', 'partially_fulfilled'])
    .whereNotNull('l.cost_snapshot')
    .whereRaw('l.quantity_ordered > l.quantity_fulfilled')
    .whereRaw('COALESCE(vp.unit_cost, pis.average_cost, 0) > l.cost_snapshot')
    .groupBy('so.so_id', 'so.so_number')
    .select<PriceCreepSoQueryRow[]>(
      'so.so_id as so_id',
      'so.so_number as so_number',
      db.raw(
        'SUM((COALESCE(vp.unit_cost, pis.average_cost) - l.cost_snapshot) * (l.quantity_ordered - l.quantity_fulfilled)) as at_risk',
      ),
    );

  const quoteRows: PriceCreepQuoteQueryRow[] = await basisJoin(
    db('quote_items as qi').join('quotes as q', function () {
      this.on('qi.quote_id', '=', 'q.quote_id').andOn('qi.tenant', '=', 'q.tenant');
    }),
    'qi.service_id',
    'qi.tenant',
  )
    .where('qi.tenant', tenant)
    .whereIn('q.status', OPEN_QUOTE_STATUSES)
    .whereRaw('COALESCE(vp.unit_cost, pis.average_cost, 0) > qi.unit_price')
    .groupBy('q.quote_id', 'q.quote_number')
    .select<PriceCreepQuoteQueryRow[]>(
      'q.quote_id as quote_id',
      'q.quote_number as quote_number',
      db.raw('SUM((COALESCE(vp.unit_cost, pis.average_cost) - qi.unit_price) * qi.quantity) as at_risk'),
    );

  const so = soRows
    .map((r) => ({ so_id: r.so_id, so_number: r.so_number, at_risk: num(r.at_risk) }))
    .filter((r) => r.at_risk > 0)
    .sort((a, b) => b.at_risk - a.at_risk);
  const quoteAtRisk = quoteRows.reduce((s, r) => s + num(r.at_risk), 0);
  const quotes = {
    count: quoteRows.length,
    at_risk: quoteAtRisk,
    numbers: quoteRows.map((r) => String(r.quote_number)).slice(0, 3),
  };
  const total = so.reduce((s, r) => s + r.at_risk, 0) + quoteAtRisk;
  if (total <= 0) return null;
  return { total_at_risk: total, so, quotes };
}

/* ------------------------------ D3 ghost usage ------------------------------ */

export interface GhostWeek {
  /** Ghost candidates (closed with no material) in the trailing 7 days. */
  count: number;
  /** Median billed-materials value per ticket (90d) — null when no baseline. */
  median: number | null;
  /** count × median; null when no baseline (never fabricate). */
  est_total: number | null;
  techs: Array<{ name: string; count: number; est: number | null }>;
}

/**
 * D3 — ghost funnel for the trailing week, attributed per tech (closed_by,
 * falling back to assigned_to). Dollar estimate = median billed ticket_materials
 * value per ticket over the trailing 90 days × count, always labeled "est."
 * by the UI; when no billed baseline exists the estimate is omitted.
 */
export async function queryGhostWeek(db: Db, tenant: string): Promise<GhostWeek> {
  const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const report = await queryGhostUsageReport(db, tenant, { closedFrom: from });

  const medRow = await db
    .from(
      db('ticket_materials as tm')
        .where('tm.tenant', tenant)
        .andWhere('tm.is_billed', true)
        .andWhereRaw("tm.created_at >= now() - interval '90 days'")
        .groupBy('tm.ticket_id')
        .select('tm.ticket_id', db.raw('SUM(tm.rate * tm.quantity) as total'))
        .as('t'),
    )
    .select<{ median: string | null }[]>(db.raw('percentile_cont(0.5) WITHIN GROUP (ORDER BY t.total) as median'))
    .first();
  const median = medRow?.median != null ? Math.round(Number(medRow.median)) : null;

  const byTech = new Map<string, number>();
  for (const row of [...report.candidates, ...report.worklist]) {
    const name = row.closed_by_name ?? row.assigned_to_name;
    if (!name) continue;
    byTech.set(name, (byTech.get(name) ?? 0) + 1);
  }
  const techs = [...byTech.entries()]
    .map(([name, count]) => ({ name, count, est: median != null ? median * count : null }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  const count = report.funnel.candidates;
  return { count, median, est_total: median != null ? median * count : null, techs };
}

/* ------------------------------ D4 unbilled ------------------------------ */

export interface UnbilledSoRow {
  so_id: string;
  so_number: string;
  client_id: string | null;
  client_name: string | null;
  currency_code: string | null;
  amount: number;
  /** Days since the last consume movement for this SO (null when untracked, e.g. drop-ship). */
  shipped_days_ago: number | null;
  line_count: number;
  fully_shipped: boolean;
}

export interface UnbilledBreakdown {
  /** a + b + c (from-stock, drop-ship, ghost est). */
  total: number;
  from_stock: { rows: UnbilledSoRow[]; amount: number };
  dropship: { so_count: number; amount: number };
  ghost: { count: number; amount: number | null };
}

/**
 * D4 — shipped-ahead-of-invoice money, split so the hero tile's three rows sum
 * to the headline without double counting: (a) from-stock lines, (b) drop-ship
 * lines, (c) ghost estimate (passed in from D3).
 */
export async function queryUnbilled(db: Db, tenant: string, ghost: GhostWeek): Promise<UnbilledBreakdown> {
  const perType = async (dropShip: boolean) =>
    db('sales_orders as so')
      .leftJoin('clients as c', function () {
        this.on('so.client_id', '=', 'c.client_id').andOn('so.tenant', '=', 'c.tenant');
      })
      .join('sales_order_lines as l', function () {
        this.on('so.so_id', '=', 'l.so_id').andOn('so.tenant', '=', 'l.tenant');
      })
      .where({ 'so.tenant': tenant })
      .whereNot('so.status', 'cancelled')
      .andWhere('l.fulfillment_type', dropShip ? 'drop_ship' : 'from_stock')
      .groupBy('so.so_id', 'so.so_number', 'so.status', 'so.order_date', 'so.client_id', 'so.currency_code', 'c.client_name')
      .havingRaw('COALESCE(SUM(GREATEST(l.quantity_fulfilled - l.quantity_invoiced, 0)),0) > 0')
      .select<any[]>(
        'so.so_id as so_id',
        'so.so_number as so_number',
        'so.status as so_status',
        'so.client_id as client_id',
        'so.currency_code as currency_code',
        'c.client_name as client_name',
        db.raw('COUNT(*) FILTER (WHERE l.quantity_fulfilled > l.quantity_invoiced) as line_count'),
        db.raw('COALESCE(SUM(GREATEST(l.quantity_fulfilled - l.quantity_invoiced, 0) * l.unit_price),0) as amount'),
      )
      .orderByRaw('COALESCE(SUM(GREATEST(l.quantity_fulfilled - l.quantity_invoiced, 0) * l.unit_price),0) desc');

  const stockRows = await perType(false);
  const dropRows = await perType(true);

  // Ship age only for the SOs the stream will show (all from-stock rows).
  const soIds = stockRows.map((r) => r.so_id);
  const shipAges = new Map<string, number>();
  if (soIds.length) {
    const ships = await db('stock_movements')
      .where({ tenant, movement_type: 'consume', source_doc_type: 'sales_order' })
      .whereIn('source_doc_id', soIds)
      .groupBy('source_doc_id')
      .select<any[]>('source_doc_id', db.raw('MAX(created_at) as shipped_at'));
    for (const s of ships) {
      shipAges.set(s.source_doc_id, Math.max(0, Math.floor((Date.now() - new Date(s.shipped_at).getTime()) / 86_400_000)));
    }
  }

  const rows: UnbilledSoRow[] = stockRows.map((r) => ({
    so_id: r.so_id,
    so_number: r.so_number,
    client_id: r.client_id ?? null,
    client_name: r.client_name ?? null,
    currency_code: r.currency_code ?? null,
    amount: num(r.amount),
    shipped_days_ago: shipAges.get(r.so_id) ?? null,
    line_count: Number(r.line_count ?? 0),
    fully_shipped: r.so_status === 'fulfilled',
  }));
  const fromStockAmount = rows.reduce((s, r) => s + r.amount, 0);
  const dropAmount = dropRows.reduce((s, r) => s + num(r.amount), 0);

  return {
    total: fromStockAmount + dropAmount + (ghost.est_total ?? 0),
    from_stock: { rows, amount: fromStockAmount },
    dropship: { so_count: dropRows.length, amount: dropAmount },
    ghost: { count: ghost.count, amount: ghost.est_total },
  };
}

/* --------------------------- D6 stream sources --------------------------- */

export interface OverdueLoanerRow {
  unit_id: string;
  client_id: string | null;
  client_name: string | null;
  service_name: string | null;
  serial_number: string | null;
  unit_cost: number | null;
  due_at: string;
  overdue_days: number;
}

export async function queryOverdueLoaners(db: Db, tenant: string): Promise<OverdueLoanerRow[]> {
  const rows = await db('stock_units as su')
    .leftJoin('clients as c', function () {
      this.on('su.client_id', '=', 'c.client_id').andOn('su.tenant', '=', 'c.tenant');
    })
    .leftJoin('service_catalog as sc', function () {
      this.on('su.service_id', '=', 'sc.service_id').andOn('su.tenant', '=', 'sc.tenant');
    })
    .where({ 'su.tenant': tenant, 'su.status': 'on_loan' })
    .whereNotNull('su.loan_due_at')
    .andWhereRaw('su.loan_due_at < now()')
    .orderBy('su.loan_due_at', 'asc')
    .select<any[]>(
      'su.unit_id as unit_id',
      'su.client_id as client_id',
      'c.client_name as client_name',
      'sc.service_name as service_name',
      'su.serial_number as serial_number',
      'su.unit_cost as unit_cost',
      'su.loan_due_at as due_at',
    );
  return rows.map((r) => ({
    unit_id: r.unit_id,
    client_id: r.client_id ?? null,
    client_name: r.client_name ?? null,
    service_name: r.service_name ?? null,
    serial_number: r.serial_number ?? null,
    unit_cost: r.unit_cost != null ? Number(r.unit_cost) : null,
    due_at: new Date(r.due_at).toISOString(),
    overdue_days: Math.max(0, Math.floor((Date.now() - new Date(r.due_at).getTime()) / 86_400_000)),
  }));
}

export interface CountApprovalRow {
  session_id: string;
  location_name: string | null;
  counted_by_name: string | null;
  /** Signed net variance in cents over counted lines (counted − expected). */
  variance: number;
}

export async function queryCountApprovals(db: Db, tenant: string): Promise<CountApprovalRow[]> {
  const rows = await db('count_sessions as cs')
    .leftJoin('stock_locations as loc', function () {
      this.on('cs.location_id', '=', 'loc.location_id').andOn('cs.tenant', '=', 'loc.tenant');
    })
    .leftJoin('users as u', function () {
      this.on('cs.created_by', '=', 'u.user_id').andOn('cs.tenant', '=', 'u.tenant');
    })
    .leftJoin('count_lines as cl', function () {
      this.on('cs.session_id', '=', 'cl.session_id').andOn('cs.tenant', '=', 'cl.tenant');
    })
    .leftJoin('product_inventory_settings as pis', function () {
      this.on('cl.service_id', '=', 'pis.service_id').andOn('cl.tenant', '=', 'pis.tenant');
    })
    .where({ 'cs.tenant': tenant, 'cs.status': 'review' })
    .groupBy('cs.session_id', 'cs.submitted_at', 'loc.name', 'u.first_name', 'u.last_name', 'u.username')
    .orderBy('cs.submitted_at', 'asc')
    .select<any[]>(
      'cs.session_id as session_id',
      'loc.name as location_name',
      db.raw("COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username) as counted_by_name"),
      db.raw(
        "COALESCE(SUM((cl.counted_qty - cl.expected_qty) * COALESCE(pis.average_cost, 0)) FILTER (WHERE cl.counted_qty IS NOT NULL), 0) as variance",
      ),
    );
  return rows.map((r) => ({
    session_id: r.session_id,
    location_name: r.location_name ?? null,
    counted_by_name: r.counted_by_name ?? null,
    variance: num(r.variance),
  }));
}

export interface BillCreepRow {
  bill_id: string;
  bill_number: string | null;
  vendor_name: string | null;
  /** Σ positive per-line variance vs the matching PO line (F090 idiom). */
  variance: number;
}

export async function queryBillCreep(db: Db, tenant: string): Promise<BillCreepRow[]> {
  const rows = await db('vendor_bill_lines as vbl')
    .join('vendor_bills as vb', function () {
      this.on('vbl.bill_id', '=', 'vb.bill_id').andOn('vbl.tenant', '=', 'vb.tenant');
    })
    .leftJoin('vendors as v', function () {
      this.on('vb.vendor_id', '=', 'v.vendor_id').andOn('vb.tenant', '=', 'v.tenant');
    })
    .joinRaw(
      `LEFT JOIN LATERAL (
        SELECT pol.unit_cost FROM purchase_order_lines pol
        WHERE pol.tenant = vbl.tenant AND pol.po_id = vb.po_id AND pol.service_id = vbl.service_id
        ORDER BY pol.created_at ASC LIMIT 1
      ) pol ON true`,
    )
    .where('vbl.tenant', tenant)
    .whereIn('vb.status', ['draft', 'open'])
    .whereNotNull('vb.po_id')
    .groupBy('vb.bill_id', 'vb.bill_number', 'v.vendor_name')
    .havingRaw('SUM(GREATEST((vbl.unit_cost - COALESCE(pol.unit_cost, vbl.unit_cost)) * vbl.quantity, 0)) > 0')
    .select<any[]>(
      'vb.bill_id as bill_id',
      'vb.bill_number as bill_number',
      'v.vendor_name as vendor_name',
      db.raw('SUM(GREATEST((vbl.unit_cost - COALESCE(pol.unit_cost, vbl.unit_cost)) * vbl.quantity, 0)) as variance'),
    );
  return rows
    .map((r) => ({
      bill_id: r.bill_id,
      bill_number: r.bill_number ?? null,
      vendor_name: r.vendor_name ?? null,
      variance: num(r.variance),
    }))
    .sort((a, b) => b.variance - a.variance);
}

/* ------------------------------ D7 dead stock ------------------------------ */

export interface DeadStock {
  location_id: string;
  location_name: string | null;
  /** Cents tied up at the worst location. */
  amount: number;
  /** Number of locations with dead stock (worst is surfaced; rest rolled up). */
  location_count: number;
}

/**
 * D7 — value with no stock_movements touching its location in 90 days:
 * non-serialized levels (qty × average_cost, no movement for that service at
 * that location) plus in_stock serialized units received >90d ago with no
 * unit movement since.
 */
export async function queryDeadStock(db: Db, tenant: string): Promise<DeadStock | null> {
  const nonSer = await db('stock_levels as sl')
    .join('product_inventory_settings as pis', function () {
      this.on('sl.service_id', '=', 'pis.service_id').andOn('sl.tenant', '=', 'pis.tenant');
    })
    .where({ 'sl.tenant': tenant, 'pis.is_serialized': false })
    .andWhere('sl.quantity_on_hand', '>', 0)
    .whereNotExists(function () {
      this.select(1)
        .from('stock_movements as sm')
        .whereRaw('sm.tenant = sl.tenant')
        .whereRaw('sm.service_id = sl.service_id')
        .whereRaw('(sm.from_location_id = sl.location_id OR sm.to_location_id = sl.location_id)')
        .whereRaw("sm.created_at >= now() - interval '90 days'");
    })
    .groupBy('sl.location_id')
    .select<any[]>('sl.location_id as location_id', db.raw('SUM(sl.quantity_on_hand * COALESCE(pis.average_cost, 0)) as value'));

  const ser = await db('stock_units as su')
    .where({ 'su.tenant': tenant, 'su.status': 'in_stock' })
    .whereNotNull('su.location_id')
    .andWhereRaw("COALESCE(su.received_at, su.created_at) < now() - interval '90 days'")
    .whereNotExists(function () {
      this.select(1)
        .from('stock_movements as sm')
        .whereRaw('sm.tenant = su.tenant')
        .whereRaw('sm.unit_id = su.unit_id')
        .whereRaw("sm.created_at >= now() - interval '90 days'");
    })
    .groupBy('su.location_id')
    .select<any[]>('su.location_id as location_id', db.raw('SUM(COALESCE(su.unit_cost, 0)) as value'));

  const byLocation = new Map<string, number>();
  for (const r of [...nonSer, ...ser]) {
    byLocation.set(r.location_id, (byLocation.get(r.location_id) ?? 0) + num(r.value));
  }
  const entries = [...byLocation.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  const [locationId, amount] = entries[0];
  const loc = await db('stock_locations').where({ tenant, location_id: locationId }).first<{ name: string }>('name');
  return { location_id: locationId, location_name: loc?.name ?? null, amount, location_count: entries.length };
}

/* --------------------------- D8 van context --------------------------- */

export interface VanContext {
  /** location_id → jobs scheduled today for the van's assigned tech. */
  jobs_today: Map<string, number>;
  /** location_id → inbound dispatched transfer (latest). */
  inbound: Map<string, { from_name: string | null; dispatched_at: string }>;
  /** location_id → assigned tech display name. */
  tech_names: Map<string, string>;
}

/**
 * D8 — context for van-shortage rows: the assigned tech's schedule load today
 * and any dispatched (in-transit) replenishment targeting the van.
 */
export async function queryVanContext(
  db: Db,
  tenant: string,
  vans: Array<{ location_id: string; assigned_user_id: string | null }>,
): Promise<VanContext> {
  const ctx: VanContext = { jobs_today: new Map(), inbound: new Map(), tech_names: new Map() };
  if (vans.length === 0) return ctx;
  const vanIds = vans.map((v) => v.location_id);
  const userIds = [...new Set(vans.map((v) => v.assigned_user_id).filter(Boolean))] as string[];

  if (userIds.length) {
    const users = await db('users')
      .where({ tenant })
      .whereIn('user_id', userIds)
      .select<any[]>('user_id', db.raw("COALESCE(NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), username) as name"));
    const nameById = new Map(users.map((u) => [u.user_id, u.name as string]));
    for (const v of vans) {
      if (v.assigned_user_id && nameById.has(v.assigned_user_id)) {
        ctx.tech_names.set(v.location_id, nameById.get(v.assigned_user_id)!);
      }
    }

    const jobs = await db('schedule_entry_assignees as sea')
      .join('schedule_entries as se', function () {
        this.on('sea.entry_id', '=', 'se.entry_id').andOn('sea.tenant', '=', 'se.tenant');
      })
      .where('sea.tenant', tenant)
      .whereIn('sea.user_id', userIds)
      .andWhereRaw("se.scheduled_start >= date_trunc('day', now())")
      .andWhereRaw("se.scheduled_start < date_trunc('day', now()) + interval '1 day'")
      .groupBy('sea.user_id')
      .select<any[]>('sea.user_id', db.raw('COUNT(*) as c'));
    const jobsByUser = new Map(jobs.map((j) => [j.user_id, Number(j.c)]));
    for (const v of vans) {
      if (v.assigned_user_id) ctx.jobs_today.set(v.location_id, jobsByUser.get(v.assigned_user_id) ?? 0);
    }
  }

  const transfers = await db('stock_transfers as st')
    .leftJoin('stock_locations as fl', function () {
      this.on('st.from_location_id', '=', 'fl.location_id').andOn('st.tenant', '=', 'fl.tenant');
    })
    .where({ 'st.tenant': tenant, 'st.status': 'dispatched' })
    .whereIn('st.to_location_id', vanIds)
    .orderBy('st.dispatched_at', 'desc')
    .select<any[]>('st.to_location_id as to_location_id', 'st.dispatched_at as dispatched_at', 'fl.name as from_name');
  for (const t of transfers) {
    if (!ctx.inbound.has(t.to_location_id)) {
      ctx.inbound.set(t.to_location_id, {
        from_name: t.from_name ?? null,
        dispatched_at: new Date(t.dispatched_at).toISOString(),
      });
    }
  }
  return ctx;
}

/* ------------------------------ D9 pipeline ------------------------------ */

export interface Pipeline {
  quotes: { count: number; amount: number };
  booked: { count: number; draft_count: number; amount: number };
  fulfilling: { count: number; amount: number; blocked_count: number };
  invoiced_week: number;
}

export async function queryPipeline(db: Db, tenant: string): Promise<Pipeline> {
  const quoteRow = await db('quotes')
    .where({ tenant })
    .whereIn('status', ['sent', 'accepted'])
    .select<{ c: string; amount: string }[]>(db.raw('COUNT(*) as c'), db.raw('COALESCE(SUM(total_amount),0) as amount'))
    .first();

  const soAgg = await db('sales_orders as so')
    .leftJoin('sales_order_lines as l', function () {
      this.on('so.so_id', '=', 'l.so_id').andOn('so.tenant', '=', 'l.tenant');
    })
    .where('so.tenant', tenant)
    .whereIn('so.status', OPEN_SO_STATUSES)
    .groupBy('so.so_id', 'so.status')
    .select<any[]>(
      'so.so_id as so_id',
      'so.status as status',
      db.raw('COALESCE(SUM(GREATEST(l.quantity_ordered - l.quantity_invoiced, 0) * l.unit_price),0) as outstanding'),
      db.raw('COALESCE(SUM(GREATEST(l.quantity_fulfilled - l.quantity_invoiced, 0)),0) as shipped_unbilled_qty'),
    );

  const blockedRows = await db('purchase_order_lines as pol')
    .join('purchase_orders as po', function () {
      this.on('pol.po_id', '=', 'po.po_id').andOn('pol.tenant', '=', 'po.tenant');
    })
    .join('sales_order_lines as l', function () {
      this.on('pol.source_so_line_id', '=', 'l.so_line_id').andOn('pol.tenant', '=', 'l.tenant');
    })
    .join('sales_orders as so', function () {
      this.on('l.so_id', '=', 'so.so_id').andOn('l.tenant', '=', 'so.tenant');
    })
    .where('pol.tenant', tenant)
    .whereIn('po.status', OPEN_PO_STATUSES)
    .whereRaw('pol.quantity_received < pol.quantity_ordered')
    .whereIn('so.status', ['confirmed', 'partially_fulfilled'])
    .distinct<any[]>('so.so_id as so_id');
  const blocked = new Set(blockedRows.map((r) => r.so_id));

  const fulfillingSos = soAgg.filter(
    (r) => r.status !== 'draft' && (Number(r.shipped_unbilled_qty) > 0 || blocked.has(r.so_id)),
  );

  const invoicedRow = await db('invoice_charges as ic')
    .join('invoices as i', function () {
      this.on('ic.invoice_id', '=', 'i.invoice_id').andOn('ic.tenant', '=', 'i.tenant');
    })
    .where('ic.tenant', tenant)
    .whereNotNull('ic.so_line_id')
    .andWhereRaw("i.invoice_date >= now() - interval '7 days'")
    .select<{ amount: string }[]>(db.raw('COALESCE(SUM(COALESCE(ic.net_amount, ic.total_price)),0) as amount'))
    .first();

  return {
    quotes: { count: Number(quoteRow?.c ?? 0), amount: num(quoteRow?.amount) },
    booked: {
      count: soAgg.length,
      draft_count: soAgg.filter((r) => r.status === 'draft').length,
      amount: soAgg.reduce((s, r) => s + num(r.outstanding), 0),
    },
    fulfilling: {
      count: fulfillingSos.length,
      amount: fulfillingSos.reduce((s, r) => s + num(r.outstanding), 0),
      blocked_count: blocked.size,
    },
    invoiced_week: num(invoicedRow?.amount),
  };
}

/* --------------------------- footer WoW delta --------------------------- */

/**
 * Footer WoW delta — "value 7 days ago" is approximated as current value minus
 * the net signed movement value of the trailing 7 days, so the delta IS that
 * net movement value. Sign follows the write-off report idiom (to_location
 * gains, from_location loses; internal moves with both legs net to zero);
 * cost basis = movement cost, then unit cost, then average cost. Average-cost
 * drift over the week is accepted as part of the approximation.
 */
export async function queryValueWowDelta(db: Db, tenant: string): Promise<number> {
  const row = await db('stock_movements as sm')
    .leftJoin('stock_units as su', function () {
      this.on('sm.unit_id', '=', 'su.unit_id').andOn('sm.tenant', '=', 'su.tenant');
    })
    .leftJoin('product_inventory_settings as pis', function () {
      this.on('sm.service_id', '=', 'pis.service_id').andOn('sm.tenant', '=', 'pis.tenant');
    })
    .where('sm.tenant', tenant)
    .andWhereRaw("sm.created_at >= now() - interval '7 days'")
    .select<{ delta: string }[]>(
      db.raw(`COALESCE(SUM(
        (CASE
          WHEN sm.movement_type = 'retire' THEN -1
          WHEN sm.to_location_id IS NOT NULL AND sm.from_location_id IS NOT NULL THEN 0
          WHEN sm.to_location_id IS NOT NULL THEN 1
          WHEN sm.from_location_id IS NOT NULL THEN -1
          ELSE 0
        END) * sm.quantity * COALESCE(sm.unit_cost, su.unit_cost, pis.average_cost, 0)
      ), 0) as delta`),
    )
    .first();
  return num(row?.delta);
}

/* --------------------------- RMA receivables --------------------------- */

export interface RmaReceivableRow {
  rma_id: string;
  rma_reference: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  service_name: string | null;
  amount: number | null;
  age_days: number | null;
}

export interface RmaReceivables {
  total: number;
  oldest_days: number | null;
  rows: RmaReceivableRow[];
  more_count: number;
}

/**
 * Units sitting at the vendor age like receivables: everything in
 * status 'sent_to_vendor', aged from the rma_out movement (opened_at fallback),
 * valued at the returned unit's cost.
 */
export async function queryRmaReceivables(db: Db, tenant: string): Promise<RmaReceivables> {
  const rows = await db('rma_cases as r')
    .leftJoin('vendors as v', function () {
      this.on('r.vendor_id', '=', 'v.vendor_id').andOn('r.tenant', '=', 'v.tenant');
    })
    .leftJoin('service_catalog as sc', function () {
      this.on('r.service_id', '=', 'sc.service_id').andOn('r.tenant', '=', 'sc.tenant');
    })
    .leftJoin('stock_units as u', function () {
      this.on('r.returned_unit_id', '=', 'u.unit_id').andOn('r.tenant', '=', 'u.tenant');
    })
    .joinRaw(
      `LEFT JOIN LATERAL (
        SELECT sm.created_at FROM stock_movements sm
        WHERE sm.tenant = r.tenant AND sm.unit_id = r.returned_unit_id AND sm.movement_type = 'rma_out'
        ORDER BY sm.created_at DESC LIMIT 1
      ) sent ON true`,
    )
    .where({ 'r.tenant': tenant, 'r.status': 'sent_to_vendor' })
    .orderByRaw('COALESCE(sent.created_at, r.opened_at) asc')
    .select<any[]>(
      'r.rma_id as rma_id',
      'r.rma_reference as rma_reference',
      'r.vendor_id as vendor_id',
      'v.vendor_name as vendor_name',
      'sc.service_name as service_name',
      'u.unit_cost as unit_cost',
      db.raw('COALESCE(sent.created_at, r.opened_at) as sent_at'),
    );
  const mapped: RmaReceivableRow[] = rows.map((r) => ({
    rma_id: r.rma_id,
    rma_reference: r.rma_reference ?? null,
    vendor_id: r.vendor_id ?? null,
    vendor_name: r.vendor_name ?? null,
    service_name: r.service_name ?? null,
    amount: r.unit_cost != null ? Number(r.unit_cost) : null,
    age_days: r.sent_at ? Math.floor((Date.now() - new Date(r.sent_at).getTime()) / 86_400_000) : null,
  }));
  return {
    total: mapped.reduce((s, r) => s + (r.amount ?? 0), 0),
    oldest_days: mapped.length ? (mapped[0].age_days ?? null) : null,
    rows: mapped.slice(0, 3),
    more_count: Math.max(0, mapped.length - 3),
  };
}

/* --------------------------- warranty breakdown --------------------------- */

export interface WarrantyExpiring {
  count: number;
  /** Top clients by expiring-unit count (deployed/on-loan units carry a client). */
  clients: Array<{ client_id: string; client_name: string; count: number }>;
}

export async function queryWarrantyExpiring(db: Db, tenant: string): Promise<WarrantyExpiring> {
  const totalRow = await db('stock_units')
    .where({ tenant })
    .whereNotNull('warranty_expires_at')
    .whereNot('status', 'retired')
    .andWhereRaw("warranty_expires_at <= now() + interval '30 days'")
    .andWhereRaw('warranty_expires_at >= now()')
    .count<{ c: string }>('* as c')
    .first();
  const clients = await db('stock_units as su')
    .join('clients as c', function () {
      this.on('su.client_id', '=', 'c.client_id').andOn('su.tenant', '=', 'c.tenant');
    })
    .where({ 'su.tenant': tenant })
    .whereNotNull('su.warranty_expires_at')
    .whereNot('su.status', 'retired')
    .andWhereRaw("su.warranty_expires_at <= now() + interval '30 days'")
    .andWhereRaw('su.warranty_expires_at >= now()')
    .groupBy('su.client_id', 'c.client_name')
    .orderByRaw('COUNT(*) desc')
    .limit(3)
    .select<any[]>('su.client_id as client_id', 'c.client_name as client_name', db.raw('COUNT(*) as c'));
  return {
    count: Number(totalRow?.c ?? 0),
    clients: clients.map((r) => ({ client_id: r.client_id, client_name: r.client_name, count: Number(r.c) })),
  };
}
