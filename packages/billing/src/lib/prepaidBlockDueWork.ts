import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IRecurringDueWorkRow, ISO8601String } from '@alga-psa/types';
import { DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES } from '@alga-psa/types';
import { buildRecurringDueWorkRow } from '@alga-psa/shared/billingClients/recurringDueWork';
import { buildClientCadenceDueSelectionInput } from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';

/**
 * Due-work listing for scheduled Prepaid Block issuances
 * (contract_line_block_issuances, plan section 5 "Listing"), modelled on
 * fetchUnresolvedNonContractDueWorkRows. Lives outside billingAndTax.ts (a
 * 'use server' module) so it is not exposed as an unauthenticated server action.
 *
 * Each scheduled issuance becomes ONE row (chargeType 'PrepaidBlock', amount =
 * block_price) whose selector rides in a client_cadence_window carrying
 * `schedule:{tenant}:prepaid_block:{issuanceId}`. The window is:
 *  - client-cadence lines: the client billing cycle containing due_date if it is
 *    uninvoiced, else the earliest uninvoiced cycle after it (cycles are
 *    half-open [start, end), so "end > due_date" covers both);
 *  - contract-cadence lines: the earliest not-yet-invoiced contract-cadence
 *    invoice window of the same contract that ends after due_date.
 * The row carries the same grouping scope as the contract's persisted rows
 * (client contract, PO scope, currency, tax source) so it lands in the same
 * invoice candidate as the contract's in-advance Fixed rows.
 */

export interface PrepaidBlockDueWorkPeriod {
  client_id: string;
  client_name: string;
  billing_cycle_id?: string | null;
  period_start_date: ISO8601String;
  period_end_date: ISO8601String;
}

export interface PrepaidBlockDueWorkGroupingMetadata {
  clientContractId?: string | null;
  purchaseOrderScopeKey?: string | null;
  currencyCode?: string | null;
  taxSource?: string | null;
  exportShapeKey?: string | null;
}

const toDateOnly = (value: unknown): ISO8601String | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10) as ISO8601String;
  return String(value).slice(0, 10) as ISO8601String;
};

export async function fetchPrepaidBlockIssuanceDueWorkRows(
  trx: Knex | Knex.Transaction,
  params: {
    tenant: string;
    asOf: ISO8601String;
    /** Uninvoiced client billing cycles that survived the screen's search/date filters. */
    candidateBillingPeriods: PrepaidBlockDueWorkPeriod[];
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
  const rangeFrom = params.options?.dateRange?.from ?? null;
  const rangeTo = params.options?.dateRange?.to ?? null;
  const rows: IRecurringDueWorkRow[] = [];

  for (const issuance of issuances) {
    if (searchTerm && !String(issuance.client_name ?? '').toLowerCase().includes(searchTerm)) continue;
    const dueDate = toDateOnly(issuance.due_date)!;
    const contractCadence = issuance.cadence_owner === 'contract';

    let windowStart: ISO8601String | null = null;
    let windowEnd: ISO8601String | null = null;
    let billingCycleId: string | null = null;
    let clientName: string | null = issuance.client_name ?? null;

    if (contractCadence) {
      const rspQuery = db.table('recurring_service_periods as rsp');
      db.tenantJoin(rspQuery, 'contract_lines as rcl', 'rcl.contract_line_id', 'rsp.obligation_id');
      const window = await rspQuery
        .where('rcl.contract_id', issuance.contract_id)
        .where('rsp.cadence_owner', 'contract')
        .whereIn('rsp.lifecycle_state', [...DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES])
        .whereNull('rsp.invoice_charge_detail_id')
        .where('rsp.invoice_window_end', '>', dueDate)
        .orderBy('rsp.invoice_window_start', 'asc')
        .orderBy('rsp.invoice_window_end', 'asc')
        .first('rsp.invoice_window_start', 'rsp.invoice_window_end') as
        { invoice_window_start: unknown; invoice_window_end: unknown } | undefined;
      // Contract cadence not materialized yet: no window to list under.
      if (!window) continue;
      windowStart = toDateOnly(window.invoice_window_start);
      windowEnd = toDateOnly(window.invoice_window_end);
      if (windowEnd && ((rangeFrom && windowEnd < rangeFrom) || (rangeTo && windowEnd > rangeTo))) continue;
    } else {
      // Earliest uninvoiced cycle ending after the due date. Resolved against ALL
      // uninvoiced cycles (not only the screen-filtered candidates) so a filtered
      // range cannot make a later cycle masquerade as the block's window.
      const cycleQuery = db.table('client_billing_cycles as cbc');
      db.tenantJoin(cycleQuery, 'invoices as i', 'i.billing_cycle_id', 'cbc.billing_cycle_id', { type: 'left' });
      const cycle = await cycleQuery
        .where('cbc.client_id', issuance.client_id)
        .whereNotNull('cbc.period_end_date')
        .whereNull('i.invoice_id')
        .where('cbc.period_end_date', '>', dueDate)
        .orderBy('cbc.period_start_date', 'asc')
        .orderBy('cbc.billing_cycle_id', 'asc')
        .first('cbc.billing_cycle_id', 'cbc.period_start_date', 'cbc.period_end_date') as
        { billing_cycle_id: string; period_start_date: unknown; period_end_date: unknown } | undefined;
      if (!cycle) continue;
      const candidate = params.candidateBillingPeriods.find(
        (period) => period.billing_cycle_id === cycle.billing_cycle_id,
      );
      if (!candidate) continue;
      windowStart = toDateOnly(cycle.period_start_date);
      windowEnd = toDateOnly(cycle.period_end_date);
      billingCycleId = cycle.billing_cycle_id;
      clientName = candidate.client_name ?? clientName;
    }
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
      billingCycleId,
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

    rows.push({
      ...dueWorkRow,
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
  }

  return rows;
}
