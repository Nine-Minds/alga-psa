import type { Knex } from 'knex';
import type {
  BillingCycleType,
  DuePosition,
  IRecurringServicePeriodRecord,
  ISO8601String,
  RecurringChargeFamily,
} from '@alga-psa/types';
import {
  ensureUtcMidnightIsoDate,
  type NormalizedBillingCycleAnchorSettings,
} from '../lib/billing/billingCycleAnchors';
import { materializeClientCadenceServicePeriods } from '@shared/billingClients/materializeClientCadenceServicePeriods';
import { backfillRecurringServicePeriods } from '@shared/billingClients/backfillRecurringServicePeriods';

type ClientCadenceRecurringObligationRow = {
  client_contract_line_id: string;
  start_date: unknown;
  end_date: unknown;
  contract_line_type: string | null;
  billing_timing: string | null;
};

type RecurringServicePeriodDbRow = {
  record_id: string;
  tenant: string;
  schedule_key: string;
  period_key: string;
  revision: number | string;
  obligation_id: string;
  obligation_type: string;
  charge_family: RecurringChargeFamily;
  cadence_owner: 'client' | 'contract';
  due_position: DuePosition;
  lifecycle_state: IRecurringServicePeriodRecord['lifecycleState'];
  service_period_start: unknown;
  service_period_end: unknown;
  invoice_window_start: unknown;
  invoice_window_end: unknown;
  activity_window_start: unknown;
  activity_window_end: unknown;
  timing_metadata: IRecurringServicePeriodRecord['timingMetadata'] | null;
  provenance_kind: IRecurringServicePeriodRecord['provenance']['kind'];
  source_rule_version: string;
  reason_code: IRecurringServicePeriodRecord['provenance']['reasonCode'] | null;
  source_run_key: string | null;
  supersedes_record_id: string | null;
  invoice_id: string | null;
  invoice_charge_id: string | null;
  invoice_charge_detail_id: string | null;
  invoice_linked_at: unknown;
  created_at: unknown;
  updated_at: unknown;
};

function isDateObject(value: unknown): value is Date {
  return Object.prototype.toString.call(value) === '[object Date]';
}

function normalizeDateOnlyValue(value: unknown): ISO8601String | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return `${value}T00:00:00Z` as ISO8601String;
    }
    return ensureUtcMidnightIsoDate(value);
  }

  if (isDateObject(value)) {
    return ensureUtcMidnightIsoDate(value.toISOString());
  }

  return ensureUtcMidnightIsoDate(String(value));
}

function normalizeTimestampValue(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }

  if (isDateObject(value)) {
    return value.toISOString();
  }

  try {
    return new Date(value as string | number).toISOString();
  } catch (_error) {
    return null;
  }
}

function compareIsoDateOnly(left: ISO8601String, right: ISO8601String) {
  return left.slice(0, 10).localeCompare(right.slice(0, 10));
}

function maxIsoDateOnly(left: ISO8601String, right: ISO8601String) {
  return compareIsoDateOnly(left, right) >= 0 ? left : right;
}

function resolveRecurringChargeFamily(contractLineType: string | null): RecurringChargeFamily {
  switch ((contractLineType ?? 'fixed').toLowerCase()) {
    case 'fixed':
      return 'fixed';
    case 'time':
    case 'hourly':
      return 'hourly';
    case 'usage':
      return 'usage';
    case 'bucket':
      return 'bucket';
    case 'product':
      return 'product';
    case 'license':
      return 'license';
    default:
      return 'fixed';
  }
}

function mapRecurringServicePeriodRow(row: RecurringServicePeriodDbRow): IRecurringServicePeriodRecord {
  return {
    kind: 'persisted_service_period_record',
    recordId: row.record_id,
    scheduleKey: row.schedule_key,
    periodKey: row.period_key,
    revision: Number(row.revision),
    sourceObligation: {
      tenant: row.tenant,
      obligationId: row.obligation_id,
      obligationType: row.obligation_type as IRecurringServicePeriodRecord['sourceObligation']['obligationType'],
      chargeFamily: row.charge_family,
    },
    cadenceOwner: row.cadence_owner,
    duePosition: row.due_position,
    lifecycleState: row.lifecycle_state,
    servicePeriod: {
      start: normalizeDateOnlyValue(row.service_period_start)!,
      end: normalizeDateOnlyValue(row.service_period_end)!,
      semantics: 'half_open',
    },
    invoiceWindow: {
      start: normalizeDateOnlyValue(row.invoice_window_start)!,
      end: normalizeDateOnlyValue(row.invoice_window_end)!,
      semantics: 'half_open',
    },
    activityWindow:
      row.activity_window_start && row.activity_window_end
        ? {
            start: normalizeDateOnlyValue(row.activity_window_start)!,
            end: normalizeDateOnlyValue(row.activity_window_end)!,
            semantics: 'half_open',
          }
        : null,
    timingMetadata: row.timing_metadata ?? undefined,
    provenance: {
      kind: row.provenance_kind,
      sourceRuleVersion: row.source_rule_version,
      reasonCode: row.reason_code ?? null,
      sourceRunKey: row.source_run_key ?? null,
      supersedesRecordId: row.supersedes_record_id ?? null,
    } as IRecurringServicePeriodRecord['provenance'],
    invoiceLinkage:
      row.invoice_id && row.invoice_charge_id && row.invoice_charge_detail_id && row.invoice_linked_at
        ? {
            invoiceId: row.invoice_id,
            invoiceChargeId: row.invoice_charge_id,
            invoiceChargeDetailId: row.invoice_charge_detail_id,
            linkedAt: normalizeTimestampValue(row.invoice_linked_at)!,
          }
        : null,
    createdAt: normalizeTimestampValue(row.created_at)!,
    updatedAt: normalizeTimestampValue(row.updated_at)!,
  };
}

function serializeRecurringServicePeriodRecord(record: IRecurringServicePeriodRecord) {
  return {
    record_id: record.recordId,
    tenant: record.sourceObligation.tenant,
    schedule_key: record.scheduleKey,
    period_key: record.periodKey,
    revision: record.revision,
    obligation_id: record.sourceObligation.obligationId,
    obligation_type: record.sourceObligation.obligationType,
    charge_family: record.sourceObligation.chargeFamily,
    cadence_owner: record.cadenceOwner,
    due_position: record.duePosition,
    lifecycle_state: record.lifecycleState,
    service_period_start: record.servicePeriod.start,
    service_period_end: record.servicePeriod.end,
    invoice_window_start: record.invoiceWindow.start,
    invoice_window_end: record.invoiceWindow.end,
    activity_window_start: record.activityWindow?.start ?? null,
    activity_window_end: record.activityWindow?.end ?? null,
    timing_metadata: record.timingMetadata ?? null,
    provenance_kind: record.provenance.kind,
    source_rule_version: record.provenance.sourceRuleVersion,
    reason_code: record.provenance.reasonCode ?? null,
    source_run_key: 'sourceRunKey' in record.provenance ? record.provenance.sourceRunKey ?? null : null,
    supersedes_record_id:
      'supersedesRecordId' in record.provenance ? record.provenance.supersedesRecordId ?? null : null,
    invoice_id: record.invoiceLinkage?.invoiceId ?? null,
    invoice_charge_id: record.invoiceLinkage?.invoiceChargeId ?? null,
    invoice_charge_detail_id: record.invoiceLinkage?.invoiceChargeDetailId ?? null,
    invoice_linked_at: record.invoiceLinkage?.linkedAt ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function buildScheduleSourceRuleVersion(
  billingCycle: BillingCycleType,
  anchor: NormalizedBillingCycleAnchorSettings,
) {
  return [
    'client_schedule',
    billingCycle,
    `dom:${anchor.dayOfMonth ?? 'none'}`,
    `moy:${anchor.monthOfYear ?? 'none'}`,
    `dow:${anchor.dayOfWeek ?? 'none'}`,
    `ref:${anchor.referenceDate ?? 'none'}`,
  ].join('|');
}

async function loadLastInvoicedClientBillingBoundary(
  trx: Knex.Transaction,
  params: { tenant: string; clientId: string },
) {
  const lastInvoiced = await trx('client_billing_cycles as cbc')
    .join('invoices as i', function () {
      this.on('i.billing_cycle_id', '=', 'cbc.billing_cycle_id').andOn('i.tenant', '=', 'cbc.tenant');
    })
    .where('cbc.tenant', params.tenant)
    .andWhere('cbc.client_id', params.clientId)
    .orderBy('cbc.period_end_date', 'desc')
    .first()
    .select('cbc.period_end_date');

  return lastInvoiced?.period_end_date
    ? normalizeDateOnlyValue(lastInvoiced.period_end_date)
    : null;
}

async function loadClientCadenceRecurringObligations(
  trx: Knex.Transaction,
  params: { tenant: string; clientId: string },
): Promise<ClientCadenceRecurringObligationRow[]> {
  return trx('client_contract_lines as ccl')
    .join('contract_lines as cl', function () {
      this.on('cl.contract_line_id', '=', 'ccl.contract_line_id')
        .andOn('cl.tenant', '=', 'ccl.tenant');
    })
    .where('ccl.tenant', params.tenant)
    .andWhere('ccl.client_id', params.clientId)
    .where('cl.cadence_owner', 'client')
    .whereNotNull('cl.billing_timing')
    .select(
      'ccl.client_contract_line_id',
      'ccl.start_date',
      'ccl.end_date',
      'cl.contract_line_type',
      'cl.billing_timing',
    );
}

async function loadExistingRecurringServicePeriodRecords(
  trx: Knex.Transaction,
  params: { tenant: string; obligationId: string },
): Promise<IRecurringServicePeriodRecord[]> {
  const rows = await trx('recurring_service_periods')
    .where({
      tenant: params.tenant,
      obligation_id: params.obligationId,
      obligation_type: 'client_contract_line',
      cadence_owner: 'client',
    })
    .orderBy('service_period_start', 'asc')
    .orderBy('revision', 'asc')
    .select(
      'record_id',
      'tenant',
      'schedule_key',
      'period_key',
      'revision',
      'obligation_id',
      'obligation_type',
      'charge_family',
      'cadence_owner',
      'due_position',
      'lifecycle_state',
      'service_period_start',
      'service_period_end',
      'invoice_window_start',
      'invoice_window_end',
      'activity_window_start',
      'activity_window_end',
      'timing_metadata',
      'provenance_kind',
      'source_rule_version',
      'reason_code',
      'source_run_key',
      'supersedes_record_id',
      'invoice_id',
      'invoice_charge_id',
      'invoice_charge_detail_id',
      'invoice_linked_at',
      'created_at',
      'updated_at',
    ) as RecurringServicePeriodDbRow[];

  return rows.map(mapRecurringServicePeriodRow);
}

async function persistRecurringServicePeriodRegeneration(
  trx: Knex.Transaction,
  params: {
    tenant: string;
    recordsToSupersede: IRecurringServicePeriodRecord[];
    recordsToInsert: IRecurringServicePeriodRecord[];
  },
) {
  for (const record of params.recordsToSupersede) {
    await trx('recurring_service_periods')
      .where({ tenant: params.tenant, record_id: record.recordId })
      .update({
        lifecycle_state: record.lifecycleState,
        updated_at: record.updatedAt,
      });
  }

  if (params.recordsToInsert.length > 0) {
    await trx('recurring_service_periods').insert(
      params.recordsToInsert.map(serializeRecurringServicePeriodRecord),
    );
  }
}

export async function regenerateClientCadenceServicePeriodsForScheduleChange(
  trx: Knex.Transaction,
  params: {
    tenant: string;
    clientId: string;
    billingCycle: BillingCycleType;
    anchor: NormalizedBillingCycleAnchorSettings;
  },
): Promise<void> {
  const billedBoundaryEnd = await loadLastInvoicedClientBillingBoundary(trx, params);
  const obligations = await loadClientCadenceRecurringObligations(trx, params);
  const materializedAt = new Date().toISOString();
  const sourceRuleVersion = buildScheduleSourceRuleVersion(
    params.billingCycle,
    params.anchor,
  );
  const sourceRunKey = `client-schedule-change:${params.clientId}:${materializedAt}`;

  for (const obligation of obligations) {
    const obligationStart =
      normalizeDateOnlyValue(obligation.start_date) ?? ensureUtcMidnightIsoDate(materializedAt);
    const regenerationStart = billedBoundaryEnd
      ? maxIsoDateOnly(obligationStart, billedBoundaryEnd)
      : obligationStart;
    const obligationEnd = normalizeDateOnlyValue(obligation.end_date);

    if (obligationEnd && compareIsoDateOnly(obligationEnd, regenerationStart) <= 0) {
      continue;
    }

    const duePosition: DuePosition =
      obligation.billing_timing === 'advance' ? 'advance' : 'arrears';
    const existingRecords = await loadExistingRecurringServicePeriodRecords(trx, {
      tenant: params.tenant,
      obligationId: obligation.client_contract_line_id,
    });

    const candidateRecords = materializeClientCadenceServicePeriods({
      asOf: regenerationStart,
      materializedAt,
      billingCycle: params.billingCycle,
      sourceObligation: {
        tenant: params.tenant,
        obligationId: obligation.client_contract_line_id,
        obligationType: 'client_contract_line',
        chargeFamily: resolveRecurringChargeFamily(obligation.contract_line_type),
      },
      duePosition,
      sourceRuleVersion,
      sourceRunKey,
      anchorSettings: params.anchor,
    }).records;

    const regenerationPlan = backfillRecurringServicePeriods({
      candidateRecords,
      existingRecords,
      backfilledAt: materializedAt,
      sourceRuleVersion,
      sourceRunKey,
      legacyBilledThroughEnd: billedBoundaryEnd,
      regenerationReasonCode: 'billing_schedule_changed',
    });

    await persistRecurringServicePeriodRegeneration(trx, {
      tenant: params.tenant,
      recordsToSupersede: regenerationPlan.supersededRecords,
      recordsToInsert: [
        ...regenerationPlan.backfilledRecords,
        ...regenerationPlan.realignedRecords,
      ],
    });
  }
}
