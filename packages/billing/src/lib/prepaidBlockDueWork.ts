import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IRecurringDueWorkRow, ISO8601String } from '@alga-psa/types';
import { DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES } from '@alga-psa/types';
import { buildRecurringDueWorkRow } from '@alga-psa/shared/billingClients/recurringDueWork';
import { getClientBillingCycleAnchor } from '@alga-psa/shared/billingClients/billingSchedule';
import { ensureUtcMidnightIsoDate, getBillingPeriodForDate } from '@alga-psa/shared/billingClients/billingCycleAnchors';
import { buildClientCadenceDueSelectionInput } from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import { Temporal } from '@js-temporal/polyfill';
import { dateOnlyToUtcMidnightIso, toDateOnly as toDateOnlyValue } from './prepaidBlockDates';

/**
 * Due-work listing for scheduled Prepaid Block issuances
 * (contract_line_block_issuances, plan section 5 "Listing"), modelled on
 * fetchUnresolvedNonContractDueWorkRows. Lives outside billingAndTax.ts (a
 * 'use server' module) so it is not exposed as an unauthenticated server action.
 *
 * Each scheduled issuance becomes ONE row (chargeType 'PrepaidBlock', amount =
 * block_price) whose selector rides in a client_cadence_window carrying
 * `schedule:{tenant}:prepaid_block:{issuanceId}`. The window is the invoice
 * window CONTAINING the issuance's due date (half-open [start, end)), derived
 * the way persisted recurring rows derive theirs, never from client_billing_cycles:
 *  - client-cadence lines: a client-cadence recurring_service_periods invoice
 *    window of the client that contains due_date; if the client has none
 *    materialized (e.g. a client whose only live line is a Prepaid Block line),
 *    the window the client's billing schedule (cycle type + anchor) yields for
 *    due_date;
 *  - contract-cadence lines: the contract-cadence recurring_service_periods
 *    invoice window of the same contract that contains due_date (falling back to
 *    the earliest not-yet-invoiced one ending after it).
 *
 * billing_cycle_id decision: block rows carry billingCycleId = null, so a block
 * invoice is created without invoices.billing_cycle_id. A stamped cycle counts as
 * "invoiced", which removed it from the candidate cycles the Invoices screen reads
 * (hiding that window's recurring T&M / arrears work, and starving later
 * issuances of an uninvoiced cycle). A block is a dated one-off that does not
 * settle the cycle, so it must not claim it. The window dates on the invoice
 * (billing_period_start/end) still record where it was issued.
 *
 * Readiness is keyed on the issuance's DUE DATE against `asOf`, which callers set to
 * the tenant business date (resolvePrepaidBlockBusinessDate, the same source as
 * issuance due dates and the server guard), not the window start: the window
 * only groups and selects the row. A row is Ready (dueState 'due', canGenerate)
 * only when due_date <= asOf; while later it is 'early' and not
 * generatable, shaped exactly like an early persisted row. So an expiry/renewal
 * issuance due late in its window is not issuable from the first day of the
 * window (that would start the new block's expiry clock while the old block still
 * has hours), and contract_start / manual issuances due today are Ready in the
 * default view (to = today). The server-side generate path (billing engine's
 * loadPrepaidBlockIssuanceCharges) rejects an issuance whose due date is in the
 * future, so the UI is not the only guard.
 *
 * Listing filter: a row is listed when windowStart <= dateRange.to, mirroring
 * rsp.service_period_start for persisted rows (early rows are shown, flagged
 * early, once their window has started). The
 * range's `from` is not applied: a scheduled issuance stays open until invoiced
 * and must not vanish because the user narrowed the lower bound.
 * The row carries the same grouping scope as the contract's persisted rows
 * (client contract, PO scope, currency, tax source) so it lands in the same
 * invoice candidate as the contract's in-advance Fixed rows.
 */

export interface PrepaidBlockDueWorkGroupingMetadata {
  clientContractId?: string | null;
  purchaseOrderScopeKey?: string | null;
  currencyCode?: string | null;
  taxSource?: string | null;
  exportShapeKey?: string | null;
}

const toDateOnly = (value: unknown): ISO8601String | null => toDateOnlyValue(value) as ISO8601String | null;

/**
 * Longest invoice window the listing can resolve (annual cycle, plus slack). A
 * window containing a due date starts at most this many days before it, so a due
 * date further out than `to` + this can never pass the `windowStart <= to` filter
 * and needs no window resolution at all.
 */
const MAX_INVOICE_WINDOW_DAYS = 370;

/**
 * Client-cadence invoice window containing `dueDate`, without reading
 * client_billing_cycles. Persisted client-cadence recurring_service_periods of the
 * client are authoritative (the same windows its recurring rows invoice in); with
 * none materialized, the client's billing schedule yields the window.
 */
// LEVERAGE: pattern client-cadence-window-for-date — due-work windows are re-derived per consumer (cycle rows here before, rsp rows, schedule anchors); a shared "client invoice window containing date" resolver is missing.
async function resolveClientCadenceWindowContaining(
  trx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  dueDate: ISO8601String,
): Promise<{ start: ISO8601String; end: ISO8601String }> {
  const db = tenantDb(trx, tenant);
  const q = db.table('recurring_service_periods as rsp');
  db.tenantJoin(q, 'contract_lines as rcl', 'rcl.contract_line_id', 'rsp.obligation_id');
  db.tenantJoin(q, 'contracts as rct', 'rct.contract_id', 'rcl.contract_id');
  const persisted = await q
    .where('rct.owner_client_id', clientId)
    .where('rsp.cadence_owner', 'client')
    .whereNotIn('rsp.lifecycle_state', ['archived', 'superseded'])
    .where('rsp.invoice_window_start', '<=', dueDate)
    .where('rsp.invoice_window_end', '>', dueDate)
    .orderBy('rsp.invoice_window_start', 'asc')
    .orderBy('rsp.invoice_window_end', 'asc')
    .first('rsp.invoice_window_start', 'rsp.invoice_window_end') as
    { invoice_window_start: unknown; invoice_window_end: unknown } | undefined;
  if (persisted) {
    return { start: toDateOnly(persisted.invoice_window_start)!, end: toDateOnly(persisted.invoice_window_end)! };
  }

  const { billingCycle, anchor } = await getClientBillingCycleAnchor(trx, tenant, clientId);
  const period = getBillingPeriodForDate(
    // A bare date parses as server-local midnight; ensureUtcMidnightIsoDate then throws on a non-UTC host.
    ensureUtcMidnightIsoDate(dateOnlyToUtcMidnightIso(dueDate)),
    billingCycle,
    anchor,
  );
  return { start: toDateOnly(period.periodStartDate)!, end: toDateOnly(period.periodEndDate)! };
}

export async function fetchPrepaidBlockIssuanceDueWorkRows(
  trx: Knex | Knex.Transaction,
  params: {
    tenant: string;
    asOf: ISO8601String;
    clientTaxSourceById?: Map<string, string | null>;
    options?: { searchTerm?: string; dateRange?: { from?: string; to?: string } };
    groupingMetadataByRecordId?: Map<string, PrepaidBlockDueWorkGroupingMetadata>;
  },
): Promise<IRecurringDueWorkRow[]> {
  const { tenant, asOf } = params;
  const db = tenantDb(trx, tenant);

  const query = db.table('contract_line_block_issuances as iss');
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_line_id', 'iss.contract_line_id');
  db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cl.contract_id');
  db.tenantJoin(query, 'client_contracts as cc', 'cc.client_contract_id', 'iss.client_contract_id');
  db.tenantJoin(query, 'clients as c', 'c.client_id', 'iss.client_id');
  db.tenantJoin(query, 'contract_line_prepaid_blocks as cfg', 'cfg.contract_line_id', 'iss.contract_line_id');
  const issuances = await query
    .where('iss.status', 'scheduled')
    .where('cc.is_active', true)
    .select(
      'iss.issuance_id',
      'iss.contract_line_id',
      'iss.client_contract_id',
      'iss.client_id',
      'iss.trigger_kind',
      'iss.due_date',
      'c.client_name',
      'ct.contract_id',
      'ct.contract_name',
      'ct.currency_code',
      'cl.contract_line_name',
      'cl.cadence_owner',
      'cc.po_required',
      'cfg.block_price',
    ) as Array<Record<string, any>>;
  if (issuances.length === 0) return [];

  const searchTerm = params.options?.searchTerm?.trim().toLowerCase() ?? '';
  const rangeTo = params.options?.dateRange?.to ?? null;
  const rows: IRecurringDueWorkRow[] = [];
  // `asOf` is the business date (callers pass resolvePrepaidBlockBusinessDate, the
  // source the issuance due dates and the billing engine's "not due until" guard
  // use), not the user-chosen range end.
  const businessToday = toDateOnly(asOf)!;

  for (const issuance of issuances) {
    if (searchTerm && !String(issuance.client_name ?? '').toLowerCase().includes(searchTerm)) continue;
    const dueDate = toDateOnly(issuance.due_date);
    if (!dueDate) {
      console.error(`[prepaidBlockDueWork] skipping issuance ${issuance.issuance_id}: unreadable due date`);
      continue;
    }
    // Cheap pre-filter: no window containing this due date can start by `to`.
    if (rangeTo && Temporal.PlainDate.from(dueDate).subtract({ days: MAX_INVOICE_WINDOW_DAYS }).toString() > rangeTo) continue;

    // One bad issuance (unresolvable window, bad anchor data) must not fail the whole
    // Invoices -> Generate list for the tenant: log it and skip the row.
    try {
      const contractCadence = issuance.cadence_owner === 'contract';

      let windowStart: ISO8601String | null = null;
      let windowEnd: ISO8601String | null = null;
      const clientName: string | null = issuance.client_name ?? null;

      if (contractCadence) {
        const baseQuery = () => {
          const q = db.table('recurring_service_periods as rsp');
          db.tenantJoin(q, 'contract_lines as rcl', 'rcl.contract_line_id', 'rsp.obligation_id');
          return q
            .where('rcl.contract_id', issuance.contract_id)
            .where('rsp.cadence_owner', 'contract')
            .whereNotIn('rsp.lifecycle_state', ['archived', 'superseded'])
            .orderBy('rsp.invoice_window_start', 'asc')
            .orderBy('rsp.invoice_window_end', 'asc');
        };
        type WindowRow = { invoice_window_start: unknown; invoice_window_end: unknown } | undefined;
        // The window containing the due date, even when its Fixed rows are already invoiced.
        let window = await baseQuery()
          .where('rsp.invoice_window_start', '<=', dueDate)
          .where('rsp.invoice_window_end', '>', dueDate)
          .first('rsp.invoice_window_start', 'rsp.invoice_window_end') as WindowRow;
        if (!window) {
          window = await baseQuery()
            .whereIn('rsp.lifecycle_state', [...DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES])
            .whereNull('rsp.invoice_charge_detail_id')
            .where('rsp.invoice_window_end', '>', dueDate)
            .first('rsp.invoice_window_start', 'rsp.invoice_window_end') as WindowRow;
        }
        // Contract cadence not materialized yet: no window to list under.
        if (!window) continue;
        windowStart = toDateOnly(window.invoice_window_start);
        windowEnd = toDateOnly(window.invoice_window_end);
      } else {
        const window = await resolveClientCadenceWindowContaining(trx, tenant, issuance.client_id, dueDate);
        windowStart = window.start;
        windowEnd = window.end;
      }
      if (windowStart && rangeTo && windowStart > rangeTo) continue;
      if (!windowStart || !windowEnd) continue;

      const scheduleKey = `schedule:${tenant}:prepaid_block:${issuance.issuance_id}`;
      const periodKey = `period:${windowStart}:${windowEnd}:prepaid_block:${issuance.issuance_id}`;
      const recordId = `prepaid_block:${issuance.issuance_id}`;
      const selectorInput = buildClientCadenceDueSelectionInput({
        clientId: issuance.client_id,
        scheduleKey,
        periodKey,
        windowStart,
        windowEnd,
      });
      const taxSource = params.clientTaxSourceById?.get(issuance.client_id) ?? null;
      const purchaseOrderScopeKey = issuance.po_required ? issuance.client_contract_id : null;

      params.groupingMetadataByRecordId?.set(recordId, {
        clientContractId: issuance.client_contract_id ?? issuance.contract_id ?? null,
        purchaseOrderScopeKey,
        currencyCode: issuance.currency_code ?? null,
        taxSource,
        exportShapeKey: null,
      });

      const dueWorkRow = buildRecurringDueWorkRow({
        selectorInput,
        cadenceSource: contractCadence ? 'contract_anniversary' : 'client_schedule',
        duePosition: 'advance',
        // Deliberately null: see the billing_cycle_id decision in the header.
        billingCycleId: null,
        // A block is a dated one-off: its "service period" is the invoice window.
        servicePeriodStart: windowStart,
        servicePeriodEnd: windowEnd,
        clientName,
        asOf,
        scheduleKey,
        periodKey,
        recordId,
        contractName: issuance.contract_name ?? null,
        contractLineName: issuance.contract_line_name ?? null,
        purchaseOrderScopeKey,
        currencyCode: issuance.currency_code ?? null,
        taxSource,
        exportShapeKey: null,
        attribution: {
          source: 'explicit_contract',
          label: 'Explicit contract',
          isComplete: true,
          missingFields: [],
        },
      });

      // Readiness follows the due date, not the window start (see header).
      const notYetDue = dueDate > businessToday;
      rows.push({
        ...dueWorkRow,
        ...(notYetDue ? { dueState: 'early' as const, isEarly: true, canGenerate: false } : {}),
        // The client-cadence selector carries no contract identity; attribute it
        // here so the candidate header can name the contract. contractLineId stays
        // null on purpose: approval blockers scope hourly time by it and a block
        // charge does not depend on time approval.
        contractId: issuance.contract_id ?? null,
        amountCents: Number(issuance.block_price),
        chargeType: 'PrepaidBlock',
        blockDueDate: dueDate,
        blockTriggerKind: issuance.trigger_kind,
      } as IRecurringDueWorkRow);
    } catch (error) {
      console.error(
        `[prepaidBlockDueWork] skipping issuance ${issuance.issuance_id}: could not resolve its invoice window`,
        error,
      );
    }
  }

  return rows;
}
