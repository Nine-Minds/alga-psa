import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { toISODate, toPlainDate } from '@alga-psa/core';
import type { ILateHourlyTimeNotice, ILateServicePeriodSource, ISO8601String } from '@alga-psa/types';
import { whereLiveRecurringContractLine } from '@alga-psa/shared/billingClients/liveClientCadenceRecurringLine';
import { joinTimeEntryBillingWorkContext } from './timeEntryWorkContext';

/**
 * Late approved hourly time: approved, uninvoiced time dated inside a service
 * window an earlier invoice already closed.
 *
 * A window is closed exactly when the product will not generate it again: an
 * invoice claims it. That includes drafts — the product cannot regenerate a
 * draft in place (same-window generation is refused; only a destructive
 * reverse-then-generate), and existing drafts must keep their contents — and
 * voided (cancelled) invoices: a void keeps the recurring period's claim and the
 * cycle guard still counts the invoice, so regenerating that window is refused.
 * Treating a voided window as open would strand its late time with nothing to
 * bill it. A reversed draft is deleted and releases its claim, so its window
 * reopens and late time there bills with the regenerated window.
 *
 * The billing engine carries late time onto the line's next invoice; this
 * module is also what tells the operator, so nothing is omitted silently —
 * including time on a line that has no later period to carry it to.
 */
export interface ClosedServiceWindow {
  startInclusive: ISO8601String;
  endExclusive: ISO8601String;
  source: ILateServicePeriodSource;
  closedByInvoiceNumber: string | null;
  closedByInvoiceStatus: string | null;
}

const day = (value: unknown) => toISODate(toPlainDate(value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)));

export function closedWindow(start: ISO8601String, endExclusive: ISO8601String, recordId: string | null,
  invoice: { invoice_id?: string | null; invoice_number?: string | null; status?: string | null } | null): ClosedServiceWindow {
  return {
    startInclusive: start,
    endExclusive,
    source: {
      servicePeriodStart: start,
      servicePeriodEnd: toISODate(toPlainDate(endExclusive).subtract({ days: 1 })),
      servicePeriodRecordId: recordId,
      closedByInvoiceId: invoice?.invoice_id ?? null,
    },
    closedByInvoiceNumber: invoice?.invoice_number ?? null,
    closedByInvoiceStatus: invoice?.status ?? null,
  };
}

/** Closed windows of materialized lines (recurring service periods claimed by an invoice, voided included), keyed by line. */
export async function loadMaterializedClosedWindows(knex: Knex, tenant: string, lineIds: string[]) {
  const db = tenantDb(knex, tenant);
  const materialized = new Set<string>();
  const windows = new Map<string, ClosedServiceWindow[]>();
  if (lineIds.length === 0) return { materialized, windows };
  const live = await db.table('recurring_service_periods').whereIn('obligation_id', lineIds)
    .whereNotIn('lifecycle_state', ['superseded', 'archived']).distinct('obligation_id');
  for (const row of live) materialized.add(row.obligation_id);
  const query = db.table('recurring_service_periods as rsp');
  db.tenantJoin(query, 'invoices as i', 'i.invoice_id', 'rsp.invoice_id');
  const rows = await query.whereIn('rsp.obligation_id', lineIds)
    .whereNotIn('rsp.lifecycle_state', ['superseded', 'archived'])
    .select('rsp.obligation_id', 'rsp.record_id', 'rsp.service_period_start', 'rsp.service_period_end',
      'rsp.activity_window_start', 'rsp.activity_window_end', 'i.invoice_id', 'i.invoice_number', 'i.status');
  for (const row of rows) {
    const list = windows.get(row.obligation_id) ?? [];
    list.push(closedWindow(day(row.activity_window_start ?? row.service_period_start), day(row.activity_window_end ?? row.service_period_end), row.record_id, row));
    windows.set(row.obligation_id, list);
  }
  return { materialized, windows };
}

/** Invoiced billing cycles of a client (any status: the cycle guard refuses to regenerate them), for lines with no materialized periods. */
export async function loadInvoicedClientCycles(knex: Knex, tenant: string, clientId: string) {
  const db = tenantDb(knex, tenant);
  const query = db.table('client_billing_cycles as cbc');
  db.tenantJoin(query, 'invoices as i', 'i.billing_cycle_id', 'cbc.billing_cycle_id');
  return query.where('cbc.client_id', clientId)
    .whereNotNull('cbc.period_start_date').whereNotNull('cbc.period_end_date')
    .select('cbc.billing_cycle_id', 'cbc.billing_cycle', 'cbc.period_start_date', 'cbc.period_end_date', 'i.invoice_id', 'i.invoice_number', 'i.status');
}

export function findWindow(windows: ClosedServiceWindow[], startTime: Date | string): ClosedServiceWindow | undefined {
  const instant = (startTime instanceof Date ? startTime : new Date(startTime)).toISOString();
  return windows.find((window) => instant >= window.startInclusive && instant < window.endExclusive);
}

/**
 * Every late approved hourly entry assigned to a contract line, with what will
 * happen to it. Entries not yet assigned to a line are billed by the
 * unresolved-work path in their own window and are not late time.
 */
export async function findLateApprovedHourlyTime(knex: Knex, tenant: string,
  options: { clientId?: string } = {}): Promise<ILateHourlyTimeNotice[]> {
  const db = tenantDb(knex, tenant);
  const query = db.table<any>('time_entries');
  joinTimeEntryBillingWorkContext(knex, tenant, query);
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_line_id', 'time_entries.contract_line_id');
  db.tenantJoin(query, 'service_catalog as sc', 'sc.service_id', 'time_entries.service_id', { type: 'left' });
  db.tenantJoin(query, 'users as u', 'u.user_id', 'time_entries.user_id', { type: 'left' });
  db.tenantJoin(query, 'clients as c', 'c.client_id', 'billing_work.client_id', { type: 'left' });
  query.where('time_entries.approval_status', 'APPROVED').where('time_entries.invoiced', false)
    .where('time_entries.billable_duration', '>', 0).whereNotNull('time_entries.contract_line_id');
  if (options.clientId) query.where('billing_work.client_id', options.clientId);
  const entries = await query.select('time_entries.entry_id', 'time_entries.start_time', 'time_entries.billable_duration',
    'time_entries.contract_line_id', 'billing_work.client_id', 'c.client_name', 'cl.contract_line_name', 'sc.service_name',
    'billing_work.ticket_number', 'billing_work.ticket_title', 'billing_work.project_task_name', 'billing_work.work_item_name',
    'u.first_name', 'u.last_name');
  if (entries.length === 0) return [];

  const lineIds = [...new Set(entries.map((entry: any) => entry.contract_line_id as string))];
  const { materialized, windows } = await loadMaterializedClosedWindows(knex, tenant, lineIds);
  const liveQuery = db.table<any>('client_contracts as cc');
  db.tenantJoin(liveQuery, 'contracts as ct', 'ct.contract_id', 'cc.contract_id');
  db.tenantJoin(liveQuery, 'contract_lines as cl', 'cl.contract_id', 'ct.contract_id');
  whereLiveRecurringContractLine(liveQuery, { excludeSystemManagedDefault: false }, { cc: 'cc', ct: 'ct', cl: 'cl' });
  const liveLines = new Map<string, { endDate: string | null }>();
  for (const row of await liveQuery.whereIn('cl.contract_line_id', lineIds).select('cl.contract_line_id', 'cc.end_date')) {
    liveLines.set(row.contract_line_id, { endDate: row.end_date ? day(row.end_date) : null });
  }
  const pending = await db.table('recurring_service_periods').whereIn('obligation_id', lineIds)
    .whereNotIn('lifecycle_state', ['superseded', 'archived']).whereNull('invoice_id')
    .select('obligation_id', 'service_period_start');
  const cycleCache = new Map<string, Awaited<ReturnType<typeof loadInvoicedClientCycles>>>();

  const notices: ILateHourlyTimeNotice[] = [];
  for (const entry of entries as any[]) {
    const lineId = entry.contract_line_id as string;
    let lineWindows = windows.get(lineId) ?? [];
    if (!materialized.has(lineId) && entry.client_id) {
      if (!cycleCache.has(entry.client_id)) cycleCache.set(entry.client_id, await loadInvoicedClientCycles(knex, tenant, entry.client_id));
      lineWindows = cycleCache.get(entry.client_id)!.map((cycle: any) =>
        closedWindow(day(cycle.period_start_date), day(cycle.period_end_date), null, cycle));
    }
    const window = findWindow(lineWindows, entry.start_time);
    if (!window) continue;
    const live = liveLines.get(lineId);
    const laterPeriod = materialized.has(lineId)
      ? pending.some((row: any) => row.obligation_id === lineId && day(row.service_period_start) >= window.endExclusive)
      : Boolean(live && (live.endDate === null || live.endDate >= window.endExclusive));
    const workItemLabel = entry.ticket_number
      ? `#${entry.ticket_number}${entry.ticket_title ? ` ${entry.ticket_title}` : ''}`
      : entry.project_task_name ?? entry.work_item_name ?? null;
    notices.push({
      entryId: entry.entry_id, clientId: entry.client_id, clientName: entry.client_name ?? null,
      contractLineId: lineId, contractLineName: entry.contract_line_name ?? null, serviceName: entry.service_name ?? null,
      workItemLabel, technicianName: [entry.first_name, entry.last_name].filter(Boolean).join(' ') || null,
      workDate: day(entry.start_time), billableMinutes: Number(entry.billable_duration),
      closedPeriodStart: window.source.servicePeriodStart, closedPeriodEnd: window.source.servicePeriodEnd,
      closedByInvoiceNumber: window.closedByInvoiceNumber, closedByInvoiceStatus: window.closedByInvoiceStatus,
      disposition: live && laterPeriod ? 'next_invoice' : 'no_later_period',
    });
  }
  return notices.sort((a, b) => (a.disposition === b.disposition ? a.workDate.localeCompare(b.workDate) : a.disposition === 'no_later_period' ? -1 : 1));
}
