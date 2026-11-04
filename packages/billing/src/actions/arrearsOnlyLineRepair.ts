import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import type { IRecurringServicePeriodRecord, ISO8601String } from '@alga-psa/types';
import { getClientBillingCycleAnchor } from '@shared/billingClients/billingSchedule';
import { materializeClientCadenceServicePeriods } from '@shared/billingClients/materializeClientCadenceServicePeriods';
import { materializeContractCadenceServicePeriods } from '@shared/billingClients/materializeContractCadenceServicePeriods';
import { buildScheduleSourceRuleVersion } from '@shared/billingClients/clientCadenceScheduleRegeneration';
import {
  isAdvanceTimingAllowedForLineType,
  contractLineOwnStream,
} from '@shared/billingClients/contractLineTimingRule';
import { normalizeCadenceBillingCycle } from '../lib/cadenceVocabulary';
import { syncRecurringServicePeriodsForContractLine } from './recurringServicePeriodSync';

/**
 * Repairs Hourly/Usage contract lines that were saved as "bill in advance".
 *
 * Hourly and usage lines bill work after it happens, so an advance schedule on them
 * claims a period as billed on its first day, before any work exists. Time logged later
 * in that period is never billed because the loaders read by service period only.
 *
 * Per affected line this:
 *  1. flips a stored `advance` timing to `arrears`;
 *  2. supersedes unbilled generated/locked advance rows;
 *  3. regenerates the schedule (arrears, from the billed boundary);
 *  4. re-homes `edited` / `skipped` advance rows onto the arrears schedule;
 *  5. adds a sibling arrears "catch-up" row for each billed advance period that may hold
 *     unbilled work. The billed advance row itself is never modified;
 *  6. adds an arrears catch-up row for each retired (superseded) unbilled advance period
 *     that the regenerated schedule does not cover, i.e. unbilled periods before the billed
 *     boundary.
 *
 * Idempotent: a second run finds nothing to do.
 */

export const HOURLY_USAGE_ARREARS_REPAIR_REASON = 'hourly_usage_arrears_repair';
export const STRANDED_ADVANCE_CATCH_UP_REASON = 'stranded_advance_catch_up';

const REPAIR_SOURCE_RUN_PREFIX = 'arrears-only-line-repair';
const ARREARS_ONLY_TYPE_VARIANTS = ['Hourly', 'Usage', 'hourly', 'usage', 'Time', 'time'];
const CHUNK = 500;

export type ArrearsOnlyLineRepairManualReview = {
  contractLineId: string;
  recordId: string;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  reason:
    | 'charged_period_with_bucket_or_period_total'
    | 'edited_period_without_arrears_counterpart'
    | 'catch_up_window_unavailable';
};

export type ArrearsOnlyLineRepairSummary = {
  linesScanned: number;
  timingFlipped: number;
  advanceRowsSuperseded: number;
  rowsRehomed: number;
  catchUpRowsCreated: number;
  manualReview: ArrearsOnlyLineRepairManualReview[];
};

type LineRow = {
  contract_line_id: string;
  contract_id: string;
  contract_line_type: string | null;
  billing_timing: string | null;
  cadence_owner: string | null;
  billing_frequency: string | null;
  owner_client_id: string | null;
  assignment_start_date: unknown;
};

type PeriodRow = Record<string, any> & {
  record_id: string;
  obligation_id: string;
  schedule_key: string;
  period_key: string;
  revision: number | string;
  cadence_owner: 'client' | 'contract';
  lifecycle_state: string;
  service_period_start: unknown;
  service_period_end: unknown;
  invoice_id: string | null;
  invoice_charge_detail_id: string | null;
};

const dateOnly = (value: unknown): string => {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
};

const chunks = <T,>(items: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
};

const periodSpanKey = (row: { service_period_start: unknown; service_period_end: unknown }) =>
  `${dateOnly(row.service_period_start)}|${dateOnly(row.service_period_end)}`;

async function loadAffectedLines(
  trx: Knex.Transaction,
  tenant: string,
  advanceRows: PeriodRow[],
): Promise<LineRow[]> {
  const db = tenantDb(trx, tenant);
  const ids = new Set<string>(advanceRows.map((row) => row.obligation_id));

  const stale = await db.table('contract_lines')
    .where('billing_timing', 'advance')
    .whereIn('contract_line_type', ARREARS_ONLY_TYPE_VARIANTS)
    .pluck('contract_line_id');
  (stale as string[]).forEach((id) => ids.add(id));

  const lines: LineRow[] = [];
  for (const batch of chunks([...ids])) {
    const query = db.table('contract_lines as cl');
    db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cl.contract_id', { type: 'left' });
    db.tenantJoin(query, 'client_contracts as cc', 'cc.contract_id', 'cl.contract_id', { type: 'left' });
    const rows = (await query
      .whereIn('cl.contract_line_id', batch)
      .select(
        'cl.contract_line_id as contract_line_id',
        'cl.contract_id as contract_id',
        'cl.contract_line_type as contract_line_type',
        'cl.billing_timing as billing_timing',
        'cl.cadence_owner as cadence_owner',
        'cl.billing_frequency as billing_frequency',
        'ct.owner_client_id as owner_client_id',
        'cc.start_date as assignment_start_date',
      )) as LineRow[];
    lines.push(...rows.filter((row) => !isAdvanceTimingAllowedForLineType(row.contract_line_type)));
  }
  return lines;
}

async function lineHasBucketOrPeriodTotal(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
): Promise<boolean> {
  const db = tenantDb(trx, tenant);
  const bucketQuery = db.table('contract_line_service_configuration as c');
  db.tenantJoin(bucketQuery, 'contract_line_service_bucket_config as b', 'b.config_id', 'c.config_id');
  const bucket = await bucketQuery.where('c.contract_line_id', contractLineId).first('c.config_id');
  if (bucket) return true;

  const usageQuery = db.table('contract_line_service_configuration as c');
  db.tenantJoin(usageQuery, 'contract_line_service_usage_config as u', 'u.config_id', 'c.config_id');
  const periodTotal = await usageQuery
    .where('c.contract_line_id', contractLineId)
    .where('u.measurement_mode', 'period_total')
    .first('c.config_id');
  return Boolean(periodTotal);
}

/**
 * Whether approved/unbilled work may sit inside [start, end) for the line. Deliberately
 * over-inclusive (no client scoping): a needless catch-up row bills nothing, a missing one
 * would leave work unbilled.
 */
export async function hasUninvoicedActivity(
  trx: Knex | Knex.Transaction,
  tenant: string,
  contractLineId: string,
  chargeFamily: string,
  start: string,
  end: string,
): Promise<boolean> {
  const db = tenantDb(trx, tenant);
  const serviceIds = (await db.table('contract_line_service_configuration')
    .where('contract_line_id', contractLineId)
    .pluck('service_id')) as string[];
  if (serviceIds.length === 0) return false;

  if (chargeFamily === 'usage') {
    const row = await db.table('usage_tracking')
      .where('invoiced', false)
      .whereIn('service_id', serviceIds)
      .where('usage_date', '>=', start)
      .where('usage_date', '<', end)
      .where((builder) => builder.where('contract_line_id', contractLineId).orWhereNull('contract_line_id'))
      .first('usage_id');
    return Boolean(row);
  }

  const row = await db.table('time_entries')
    .where('invoiced', false)
    .where('approval_status', 'APPROVED')
    .where('billable_duration', '>', 0)
    .whereIn('service_id', serviceIds)
    .where('start_time', '>=', start)
    .where('end_time', '<', end)
    .where((builder) => builder.where('contract_line_id', contractLineId).orWhereNull('contract_line_id'))
    .first('entry_id');
  return Boolean(row);
}

async function loadArrearsCandidateForServicePeriod(
  trx: Knex.Transaction,
  tenant: string,
  line: LineRow,
  period: PeriodRow,
  materializedAt: string,
): Promise<IRecurringServicePeriodRecord | null> {
  const start = `${dateOnly(period.service_period_start)}T00:00:00Z` as ISO8601String;
  const end = dateOnly(period.service_period_end);
  const sourceObligation = {
    tenant,
    obligationId: line.contract_line_id,
    chargeFamily: contractLineOwnStream(line).family,
  };
  const sourceRunKey = `${REPAIR_SOURCE_RUN_PREFIX}:${line.contract_line_id}:${materializedAt}`;
  const recordIdFactory = () => uuidv4();

  if (period.cadence_owner === 'client') {
    if (!line.owner_client_id) return null;
    const schedule = await getClientBillingCycleAnchor(trx, tenant, line.owner_client_id);
    const plan = materializeClientCadenceServicePeriods({
      asOf: start,
      materializedAt: materializedAt as ISO8601String,
      billingCycle: schedule.billingCycle,
      sourceObligation,
      duePosition: 'arrears',
      sourceRuleVersion: buildScheduleSourceRuleVersion(schedule.billingCycle, schedule.anchor),
      sourceRunKey,
      anchorSettings: schedule.anchor,
      recordIdFactory,
    });
    return plan.records.find(
      (record) =>
        record.servicePeriod.start.slice(0, 10) === start.slice(0, 10)
        && record.servicePeriod.end.slice(0, 10) === end,
    ) ?? null;
  }

  const frequency = normalizeCadenceBillingCycle(line.billing_frequency);
  const anchor = line.assignment_start_date ? dateOnly(line.assignment_start_date) : null;
  if (!frequency || !anchor) return null;
  const plan = materializeContractCadenceServicePeriods({
    asOf: start,
    materializedAt: materializedAt as ISO8601String,
    billingCycle: frequency as 'monthly' | 'quarterly' | 'semi-annually' | 'annually',
    anchorDate: `${anchor}T00:00:00Z` as ISO8601String,
    sourceObligation,
    duePosition: 'arrears',
    sourceRuleVersion: [
      'contract_cadence',
      `billing_cycle:${frequency}`,
      `anchor:${anchor}`,
      'due:arrears',
    ].join('|'),
    sourceRunKey,
    recordIdFactory,
  });
  return plan.records.find(
    (record) =>
      record.servicePeriod.start.slice(0, 10) === start.slice(0, 10)
      && record.servicePeriod.end.slice(0, 10) === end,
  ) ?? null;
}

async function insertCatchUpRow(
  trx: Knex.Transaction,
  tenant: string,
  line: LineRow,
  candidate: IRecurringServicePeriodRecord,
  nowIso: string,
): Promise<void> {
  await tenantDb(trx, tenant).table('recurring_service_periods').insert({
    record_id: uuidv4(),
    tenant,
    schedule_key: candidate.scheduleKey,
    period_key: candidate.periodKey,
    revision: 1,
    obligation_id: line.contract_line_id,
    charge_family: candidate.sourceObligation.chargeFamily,
    cadence_owner: candidate.cadenceOwner,
    due_position: 'arrears',
    lifecycle_state: 'generated',
    service_period_start: candidate.servicePeriod.start.slice(0, 10),
    service_period_end: candidate.servicePeriod.end.slice(0, 10),
    invoice_window_start: candidate.invoiceWindow.start.slice(0, 10),
    invoice_window_end: candidate.invoiceWindow.end.slice(0, 10),
    activity_window_start: candidate.activityWindow?.start?.slice(0, 10) ?? null,
    activity_window_end: candidate.activityWindow?.end?.slice(0, 10) ?? null,
    timing_metadata: candidate.timingMetadata ?? null,
    provenance_kind: 'repair',
    source_rule_version: candidate.provenance.sourceRuleVersion,
    reason_code: STRANDED_ADVANCE_CATCH_UP_REASON,
    source_run_key: `${REPAIR_SOURCE_RUN_PREFIX}:${line.contract_line_id}:${nowIso}`,
    supersedes_record_id: null,
    created_at: nowIso,
    updated_at: nowIso,
  });
}

export async function repairArrearsOnlyLineSchedulesForTenant(
  trx: Knex.Transaction,
  params: { tenant: string; now?: Date },
): Promise<ArrearsOnlyLineRepairSummary> {
  const { tenant } = params;
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);
  const db = tenantDb(trx, tenant);

  const summary: ArrearsOnlyLineRepairSummary = {
    linesScanned: 0,
    timingFlipped: 0,
    advanceRowsSuperseded: 0,
    rowsRehomed: 0,
    catchUpRowsCreated: 0,
    manualReview: [],
  };

  const advanceRows = (await db.table('recurring_service_periods')
    .where('due_position', 'advance')
    .whereIn('charge_family', ['hourly', 'usage'])
    .whereNotIn('lifecycle_state', ['superseded', 'archived'])
    .select('*')) as PeriodRow[];

  const lines = await loadAffectedLines(trx, tenant, advanceRows);
  summary.linesScanned = lines.length;

  for (const line of lines) {
    // 1. Stored timing.
    if (line.billing_timing === 'advance') {
      await db.table('contract_lines')
        .where({ contract_line_id: line.contract_line_id })
        .update({ billing_timing: 'arrears' });
      line.billing_timing = 'arrears';
      summary.timingFlipped += 1;
    }

    const rows = advanceRows.filter((row) => row.obligation_id === line.contract_line_id);
    const isBilled = (row: PeriodRow) => row.lifecycle_state === 'billed' || row.invoice_id != null;
    const billedRows = rows.filter(isBilled);
    const editedRows = rows.filter(
      (row) => !isBilled(row) && (row.lifecycle_state === 'edited' || row.lifecycle_state === 'skipped'),
    );
    const unbilledIds = rows
      .filter((row) => !isBilled(row) && (row.lifecycle_state === 'generated' || row.lifecycle_state === 'locked'))
      .map((row) => row.record_id);

    // 2. Unbilled generated/locked advance rows can never be due again.
    for (const batch of chunks(unbilledIds)) {
      await db.table('recurring_service_periods')
        .whereIn('record_id', batch)
        .whereNull('invoice_id')
        .update({
          lifecycle_state: 'superseded',
          reason_code: HOURLY_USAGE_ARREARS_REPAIR_REASON,
          updated_at: nowIso,
        });
    }
    summary.advanceRowsSuperseded += unbilledIds.length;

    // 3. Arrears schedule from the billed boundary.
    await syncRecurringServicePeriodsForContractLine(trx, {
      tenant,
      contractLineId: line.contract_line_id,
      sourceRunPrefix: REPAIR_SOURCE_RUN_PREFIX,
    });

    const arrearsRows = async () =>
      (await db.table('recurring_service_periods')
        .where({ obligation_id: line.contract_line_id, due_position: 'arrears' })
        .whereNotIn('lifecycle_state', ['superseded', 'archived'])
        .select('*')) as PeriodRow[];

    // 4. Edited / skipped advance rows move onto the arrears schedule.
    //    The sync above does not materialize an arrears twin for a span that an edited advance
    //    row still occupies, so retire the edited rows first (their content is carried onto the
    //    re-homed row) and sync again before looking for counterparts.
    if (editedRows.length > 0) {
      for (const edited of editedRows) {
        await db.table('recurring_service_periods')
          .where({ record_id: edited.record_id })
          .update({
            lifecycle_state: 'superseded',
            reason_code: HOURLY_USAGE_ARREARS_REPAIR_REASON,
            updated_at: nowIso,
          });
      }
      await syncRecurringServicePeriodsForContractLine(trx, {
        tenant,
        contractLineId: line.contract_line_id,
        sourceRunPrefix: REPAIR_SOURCE_RUN_PREFIX,
      });
    }

    for (const edited of editedRows) {
      const counterpart = (await arrearsRows()).find(
        (row) =>
          periodSpanKey(row) === periodSpanKey(edited)
          && !isBilled(row)
          && (row.lifecycle_state === 'generated' || row.lifecycle_state === 'locked'),
      );

      if (counterpart) {
        const { record_id: _drop, ...carried } = counterpart;
        await db.table('recurring_service_periods')
          .where({ record_id: counterpart.record_id })
          .update({ lifecycle_state: 'superseded', updated_at: nowIso });
        await db.table('recurring_service_periods').insert({
          ...carried,
          record_id: uuidv4(),
          revision: Number(counterpart.revision) + 1,
          lifecycle_state: edited.lifecycle_state,
          timing_metadata: edited.timing_metadata ?? counterpart.timing_metadata ?? null,
          provenance_kind: 'repair',
          reason_code: HOURLY_USAGE_ARREARS_REPAIR_REASON,
          supersedes_record_id: edited.record_id,
          created_at: nowIso,
          updated_at: nowIso,
        });
        summary.rowsRehomed += 1;
      } else if (edited.lifecycle_state === 'edited') {
        summary.manualReview.push({
          contractLineId: line.contract_line_id,
          recordId: edited.record_id,
          servicePeriodStart: dateOnly(edited.service_period_start),
          servicePeriodEnd: dateOnly(edited.service_period_end),
          reason: 'edited_period_without_arrears_counterpart',
        });
      }

    }

    // 5. Catch-up rows for billed advance periods.
    const coveredSpans = new Set((await arrearsRows()).map(periodSpanKey));
    const chargeFamily = contractLineOwnStream(line).family;
    let bucketOrTotal: boolean | null = null;

    for (const billed of [...billedRows].sort((a, b) =>
      dateOnly(a.service_period_start).localeCompare(dateOnly(b.service_period_start)),
    )) {
      const span = periodSpanKey(billed);
      if (coveredSpans.has(span)) continue;

      const start = dateOnly(billed.service_period_start);
      const end = dateOnly(billed.service_period_end);
      const review = (reason: ArrearsOnlyLineRepairManualReview['reason']) =>
        summary.manualReview.push({
          contractLineId: line.contract_line_id,
          recordId: billed.record_id,
          servicePeriodStart: start,
          servicePeriodEnd: end,
          reason,
        });

      if (billed.invoice_charge_detail_id != null) {
        bucketOrTotal ??= await lineHasBucketOrPeriodTotal(trx, tenant, line.contract_line_id);
        if (bucketOrTotal) {
          review('charged_period_with_bucket_or_period_total');
          continue;
        }
      }

      const stillOpen = end > today;
      if (!stillOpen && !(await hasUninvoicedActivity(trx, tenant, line.contract_line_id, chargeFamily, start, end))) {
        continue;
      }

      const candidate = await loadArrearsCandidateForServicePeriod(trx, tenant, line, billed, nowIso);
      if (!candidate) {
        review('catch_up_window_unavailable');
        continue;
      }

      await insertCatchUpRow(trx, tenant, line, candidate, nowIso);
      coveredSpans.add(span);
      summary.catchUpRowsCreated += 1;
    }

    // 6. Unbilled advance periods that step 2 retired and the arrears sync did not cover.
    //    The sync only generates arrears rows from the billed boundary, so an unbilled advance
    //    period before that boundary (e.g. unbilled Aug beside a billed Sept) would otherwise be
    //    left with no row and its work could never be invoiced. Superseded rows from an earlier
    //    run are included, so the repair also heals lines an earlier pass left behind.
    const billedSpans = new Set(billedRows.map(periodSpanKey));
    const retiredAdvanceRows = (await db.table('recurring_service_periods')
      .where({
        obligation_id: line.contract_line_id,
        due_position: 'advance',
        lifecycle_state: 'superseded',
        reason_code: HOURLY_USAGE_ARREARS_REPAIR_REASON,
      })
      .whereNull('invoice_id')
      .select('*')) as PeriodRow[];
    for (const retired of [...retiredAdvanceRows].sort((a, b) =>
      dateOnly(a.service_period_start).localeCompare(dateOnly(b.service_period_start)),
    )) {
      const span = periodSpanKey(retired);
      if (coveredSpans.has(span) || billedSpans.has(span)) continue;

      const candidate = await loadArrearsCandidateForServicePeriod(trx, tenant, line, retired, nowIso);
      if (!candidate) {
        summary.manualReview.push({
          contractLineId: line.contract_line_id,
          recordId: retired.record_id,
          servicePeriodStart: dateOnly(retired.service_period_start),
          servicePeriodEnd: dateOnly(retired.service_period_end),
          reason: 'catch_up_window_unavailable',
        });
        continue;
      }
      await insertCatchUpRow(trx, tenant, line, candidate, nowIso);
      coveredSpans.add(span);
      summary.catchUpRowsCreated += 1;
    }
  }

  return summary;
}
