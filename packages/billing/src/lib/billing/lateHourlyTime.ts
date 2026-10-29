import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { toISODate, toPlainDate } from '@alga-psa/core';
import type { ILateHourlyTimeNotice, ILateServicePeriodSource, ISO8601String } from '@alga-psa/types';

/**
 * Late approved hourly time: approved, uninvoiced time dated inside a service
 * window that an earlier invoice already claimed.
 *
 * The billing engine only reads time dated inside the service period it is
 * pricing, and a claimed window can never be generated again (the
 * duplicate-window guard), so such time falls between windows and is never
 * billed. It is carried onto the contract line's next invoice instead, exactly
 * once, via the `invoiced` flag.
 *
 * A window is CLOSED only when the invoice that claims it is an issued invoice
 * (CLOSED_INVOICE_STATUSES). Closed windows are the only ones labelled "late"
 * on the invoice line. A window whose invoice was voided/cancelled, or is still
 * a draft, is not closed: time dated there is carried the same way (nothing
 * else can bill it) but as ordinary time, with no late flag and no suffix.
 * The window is always joined on the invoice STATE, never on whether an invoice
 * row exists.
 */

/** How far back from the end of the invoice period late time is still billed. Applied here only. */
export const LATE_TIME_LOOKBACK_DAYS = 90;

/** Invoice statuses that mean "issued": the only statuses that close a service window. */
export const CLOSED_INVOICE_STATUSES: ReadonlyArray<string> = [
  'finalized',
  'sent',
  'paid',
  'partially_paid',
  // main's name for a partially paid invoice
  'partially_applied',
  'overdue',
];

export const isClosedInvoiceStatus = (status: string | null | undefined): boolean =>
  Boolean(status) && CLOSED_INVOICE_STATUSES.includes(String(status));

/** A service window claimed by an invoice (any status). `closed` is true only for issued invoices. */
export interface ClaimedServiceWindow {
  startInclusive: ISO8601String;
  endExclusive: ISO8601String;
  closed: boolean;
  source: ILateServicePeriodSource;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
}

// pg parses `date` columns to a local-midnight Date; strings pass through.
const day = (value: unknown): ISO8601String => {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return toISODate(toPlainDate(String(value).slice(0, 10)));
};

const startDay = (value: Date | string): ISO8601String =>
  (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);

/** First day (inclusive) whose time is still inside the lookback for an invoice period ending at `periodEndExclusive`. */
export function lookbackCutoff(periodEndExclusive: ISO8601String): ISO8601String {
  return toISODate(toPlainDate(periodEndExclusive).subtract({ days: LATE_TIME_LOOKBACK_DAYS }));
}

/**
 * Windows claimed by an invoice, keyed by contract-line obligation id. One
 * window per live recurring service period: a period has exactly one invoice
 * claim, so a period that was voided and re-issued contributes only the live
 * invoice. Superseded/archived periods are ignored.
 */
export async function loadInvoiceClaimedWindows(
  knex: Knex,
  tenant: string,
  obligationIds: string[],
): Promise<Map<string, ClaimedServiceWindow[]>> {
  const windows = new Map<string, ClaimedServiceWindow[]>();
  if (obligationIds.length === 0) return windows;
  const db = tenantDb(knex, tenant);
  const query = db.table('recurring_service_periods as rsp');
  db.tenantJoin(query, 'invoices as i', 'i.invoice_id', 'rsp.invoice_id');
  const rows = await query
    .whereIn('rsp.obligation_id', obligationIds)
    .select(
      'rsp.obligation_id',
      'rsp.lifecycle_state',
      'rsp.service_period_start',
      'rsp.service_period_end',
      'rsp.activity_window_start',
      'rsp.activity_window_end',
      'i.invoice_id',
      'i.invoice_number',
      'i.status',
    );
  for (const row of rows as any[]) {
    if (row.lifecycle_state === 'superseded' || row.lifecycle_state === 'archived') continue;
    const start = day(row.activity_window_start ?? row.service_period_start);
    const endExclusive = day(row.activity_window_end ?? row.service_period_end);
    const list = windows.get(row.obligation_id) ?? [];
    list.push({
      startInclusive: start,
      endExclusive,
      closed: isClosedInvoiceStatus(row.status),
      source: {
        servicePeriodStart: start,
        servicePeriodEnd: toISODate(toPlainDate(endExclusive).subtract({ days: 1 })),
        closedByInvoiceId: row.invoice_id ?? null,
      },
      invoiceNumber: row.invoice_number ?? null,
      invoiceStatus: row.status ?? null,
    });
    windows.set(row.obligation_id, list);
  }
  return windows;
}

/**
 * The single window an entry falls in. If more than one matches (overlapping
 * claims), the closed one wins so an entry never carries two windows.
 */
export function findWindow(windows: ClaimedServiceWindow[], startTime: Date | string): ClaimedServiceWindow | undefined {
  const entryDay = startDay(startTime);
  const matches = windows.filter((w) => entryDay >= w.startInclusive && entryDay < w.endExclusive);
  return matches.find((w) => w.closed) ?? matches[0];
}

/**
 * Windows the engine must also read time from when pricing the period
 * [`before`, `periodEndExclusive`): every earlier invoice-claimed window of the
 * line, clipped to end at `before` and to start no earlier than the lookback
 * cutoff. This is the only place the lookback is applied for billing.
 */
export async function loadCarriedForwardWindows(
  knex: Knex,
  tenant: string,
  params: { obligationIds: string[]; before: ISO8601String; periodEndExclusive: ISO8601String },
): Promise<ClaimedServiceWindow[]> {
  const cutoff = lookbackCutoff(params.periodEndExclusive);
  const byLine = await loadInvoiceClaimedWindows(knex, tenant, params.obligationIds);
  const carried: ClaimedServiceWindow[] = [];
  for (const list of byLine.values()) {
    for (const window of list) {
      const start = window.startInclusive > cutoff ? window.startInclusive : cutoff;
      const end = window.endExclusive < params.before ? window.endExclusive : params.before;
      if (start >= end) continue;
      carried.push({ ...window, startInclusive: start, endExclusive: end });
    }
  }
  return carried.sort((a, b) => a.startInclusive.localeCompare(b.startInclusive));
}

/**
 * Approved, uninvoiced hourly entries assigned to a contract line and dated in a
 * CLOSED window: those that will bill on the next invoice, and those older than
 * the lookback (listed as `outside_lookback`; they are not billed).
 */
export async function findLateApprovedHourlyTime(
  knex: Knex,
  tenant: string,
  options: { clientId?: string; today?: ISO8601String } = {},
): Promise<ILateHourlyTimeNotice[]> {
  const db = tenantDb(knex, tenant);
  const query = db.table<any>('time_entries');
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_line_id', 'time_entries.contract_line_id');
  db.tenantJoin(query, 'service_catalog as sc', 'sc.service_id', 'time_entries.service_id', { type: 'left' });
  db.tenantJoin(query, 'users as u', 'u.user_id', 'time_entries.user_id', { type: 'left' });
  // Client attribution as the billing engine reads it: the ticket's client, or the project task's project client.
  db.tenantJoin(query, 'tickets as t', 'time_entries.work_item_id', 't.ticket_id', { type: 'left' });
  db.tenantJoin(query, 'project_tasks as pt', 'time_entries.work_item_id', 'pt.task_id', { type: 'left' });
  db.tenantJoin(query, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id', { type: 'left' });
  db.tenantJoin(query, 'projects as p', 'pp.project_id', 'p.project_id', { type: 'left' });
  query.whereRaw('COALESCE(t.client_id, p.client_id) IS NOT NULL');
  db.tenantJoin(query, 'clients as c', 'c.client_id', knex.raw('COALESCE(t.client_id, p.client_id)') as unknown as string, { type: 'left', rootTenantColumn: 'time_entries.tenant' });
  query
    .where('time_entries.approval_status', 'APPROVED')
    .where('time_entries.invoiced', false)
    .where('time_entries.billable_duration', '>', 0)
    .whereNotNull('time_entries.contract_line_id');
  if (options.clientId) {
    query.whereRaw('COALESCE(t.client_id, p.client_id) = ?', [options.clientId]);
  }
  const entries = (await query.select(
    'time_entries.entry_id',
    'time_entries.start_time',
    'time_entries.billable_duration',
    'time_entries.contract_line_id',
    knex.raw('COALESCE(t.client_id, p.client_id) as client_id'),
    'c.client_name',
    'cl.contract_line_name',
    'sc.service_name',
    't.ticket_number',
    't.title as ticket_title',
    'pt.task_name as project_task_name',
    'u.first_name',
    'u.last_name',
  )) as any[];
  if (entries.length === 0) return [];

  const lineIds = [...new Set(entries.map((entry) => entry.contract_line_id as string))];
  const windows = await loadInvoiceClaimedWindows(knex, tenant, lineIds);

  // The invoice period the entry will be billed on: the line's earliest unclaimed period.
  const pending = await db
    .table('recurring_service_periods')
    .whereIn('obligation_id', lineIds)
    .whereNotIn('lifecycle_state', ['superseded', 'archived'])
    .whereNull('invoice_id')
    .select('obligation_id', 'service_period_start', 'service_period_end', 'activity_window_end');
  const pendingByLine = new Map<string, Array<{ start: ISO8601String; endExclusive: ISO8601String }>>();
  for (const row of pending as any[]) {
    const list = pendingByLine.get(row.obligation_id) ?? [];
    list.push({ start: day(row.service_period_start), endExclusive: day(row.activity_window_end ?? row.service_period_end) });
    pendingByLine.set(row.obligation_id, list);
  }
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  const notices: ILateHourlyTimeNotice[] = [];
  for (const entry of entries) {
    const lineId = entry.contract_line_id as string;
    const window = findWindow(windows.get(lineId) ?? [], entry.start_time);
    if (!window || !window.closed) continue;
    const billedOn = (pendingByLine.get(lineId) ?? [])
      .filter((period) => period.start >= window.endExclusive)
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    const cutoff = lookbackCutoff(billedOn?.endExclusive ?? today);
    const workItemLabel = entry.ticket_number
      ? `#${entry.ticket_number}${entry.ticket_title ? ` ${entry.ticket_title}` : ''}`
      : entry.project_task_name ?? null;
    notices.push({
      entryId: entry.entry_id,
      clientId: entry.client_id,
      clientName: entry.client_name ?? null,
      contractLineId: lineId,
      contractLineName: entry.contract_line_name ?? null,
      serviceName: entry.service_name ?? null,
      workItemLabel,
      technicianName: [entry.first_name, entry.last_name].filter(Boolean).join(' ') || null,
      workDate: startDay(entry.start_time),
      billableMinutes: Number(entry.billable_duration),
      closedPeriodStart: window.source.servicePeriodStart,
      closedPeriodEnd: window.source.servicePeriodEnd,
      closedByInvoiceNumber: window.invoiceNumber,
      closedByInvoiceStatus: window.invoiceStatus,
      disposition: startDay(entry.start_time) >= cutoff ? 'next_invoice' : 'outside_lookback',
    });
  }
  return notices.sort((a, b) =>
    a.disposition === b.disposition ? a.workDate.localeCompare(b.workDate) : a.disposition === 'next_invoice' ? -1 : 1,
  );
}
