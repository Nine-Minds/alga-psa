import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import type {
  DuePosition,
  IRecurringServicePeriodRecord,
  ISO8601String,
  RecurringChargeFamily,
} from '@alga-psa/types';
import { ensureUtcMidnightIsoDate } from '../lib/billing/billingCycleAnchors';
import { materializeContractCadenceServicePeriods } from '@shared/billingClients/materializeContractCadenceServicePeriods';
import { backfillRecurringServicePeriods } from '@shared/billingClients/backfillRecurringServicePeriods';

type ContractCadenceBillingCycle = 'monthly' | 'quarterly' | 'semi-annually' | 'annually';

const recurringServicePeriodRecordIdFactory = () => uuidv4();

type ContractCadenceObligationRow = {
  contract_line_id: string;
  contract_line_type: string | null;
  cadence_owner: string | null;
  billing_frequency: string | null;
  billing_timing: string | null;
  assignment_start_date: unknown;
  assignment_end_date: unknown;
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

  const toUtcMidnightDateOnly = (date: Date): ISO8601String =>
    `${date.toISOString().slice(0, 10)}T00:00:00Z` as ISO8601String;

  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return `${value}T00:00:00Z` as ISO8601String;
    }
    try {
      return ensureUtcMidnightIsoDate(value);
    } catch (_error) {
      // DB date columns can be hydrated as timezone-shifted midnight timestamps
      // (for example, 2026-03-08T05:00:00.000Z for America/New_York). Treat these
      // as date-only values and normalize to canonical UTC midnight.
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return toUtcMidnightDateOnly(parsed);
      }
      throw _error;
    }
  }

  if (isDateObject(value)) {
    return toUtcMidnightDateOnly(value);
  }

  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) {
    return toUtcMidnightDateOnly(parsed);
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

function normalizeContractCadenceBillingCycle(value: string | null): ContractCadenceBillingCycle | null {
  switch ((value ?? '').toLowerCase()) {
    case 'monthly':
      return 'monthly';
    case 'quarterly':
      return 'quarterly';
    case 'semi-annually':
    case 'semiannually':
      return 'semi-annually';
    case 'annually':
    case 'annual':
      return 'annually';
    default:
      return null;
  }
}

async function loadExistingRecurringServicePeriodRecords(
  trx: Knex.Transaction,
  params: { tenant: string; contractLineId: string },
): Promise<IRecurringServicePeriodRecord[]> {
  const rows = await trx('recurring_service_periods')
    .where({
      tenant: params.tenant,
      obligation_id: params.contractLineId,
      obligation_type: 'contract_line',
      cadence_owner: 'contract',
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

async function retireFutureContractCadenceRowsForLine(
  trx: Knex.Transaction,
  params: { tenant: string; contractLineId: string; retiredAt: string },
) {
  await trx('recurring_service_periods')
    .where({
      tenant: params.tenant,
      obligation_id: params.contractLineId,
      obligation_type: 'contract_line',
      cadence_owner: 'contract',
    })
    .whereNotIn('lifecycle_state', ['archived', 'superseded', 'billed'])
    .update({
      lifecycle_state: 'superseded',
      updated_at: params.retiredAt,
    });
}

async function loadContractCadenceObligations(
  trx: Knex.Transaction,
  params: { tenant: string; contractId?: string; contractLineId?: string },
): Promise<ContractCadenceObligationRow[]> {
  const query = trx('contract_lines as cl')
    .join('client_contracts as cc', function () {
      this.on('cc.contract_id', '=', 'cl.contract_id')
        .andOn('cc.tenant', '=', 'cl.tenant');
    })
    .where('cl.tenant', params.tenant)
    .where('cc.is_active', true)
    .whereNotNull('cc.start_date')
    .select(
      'cl.contract_line_id',
      'cl.contract_line_type',
      'cl.cadence_owner',
      'cl.billing_frequency',
      'cl.billing_timing',
      'cc.start_date as assignment_start_date',
      'cc.end_date as assignment_end_date',
    );

  if (params.contractId) {
    query.andWhere('cl.contract_id', params.contractId);
  }

  if (params.contractLineId) {
    query.andWhere('cl.contract_line_id', params.contractLineId);
  }

  return query;
}

async function syncContractCadenceObligation(
  trx: Knex.Transaction,
  params: {
    tenant: string;
    obligation: ContractCadenceObligationRow;
    sourceRunPrefix: string;
  },
) {
  const materializedAt = new Date().toISOString();
  const assignmentStart = normalizeDateOnlyValue(params.obligation.assignment_start_date);
  if (!assignmentStart) {
    await retireFutureContractCadenceRowsForLine(trx, {
      tenant: params.tenant,
      contractLineId: params.obligation.contract_line_id,
      retiredAt: materializedAt,
    });
    return;
  }

  const frequency = normalizeContractCadenceBillingCycle(params.obligation.billing_frequency);
  const cadenceOwner = params.obligation.cadence_owner;
  if (
    cadenceOwner !== 'contract'
    || !frequency
    || (params.obligation.billing_timing !== 'advance' && params.obligation.billing_timing !== 'arrears')
  ) {
    await retireFutureContractCadenceRowsForLine(trx, {
      tenant: params.tenant,
      contractLineId: params.obligation.contract_line_id,
      retiredAt: materializedAt,
    });
    return;
  }

  const assignmentEnd = normalizeDateOnlyValue(params.obligation.assignment_end_date);
  if (assignmentEnd && compareIsoDateOnly(assignmentEnd, assignmentStart) <= 0) {
    await retireFutureContractCadenceRowsForLine(trx, {
      tenant: params.tenant,
      contractLineId: params.obligation.contract_line_id,
      retiredAt: materializedAt,
    });
    return;
  }

  const duePosition: DuePosition =
    params.obligation.billing_timing === 'advance' ? 'advance' : 'arrears';
  const sourceRuleVersion = [
    'contract_cadence',
    `billing_cycle:${frequency}`,
    `anchor:${assignmentStart.slice(0, 10)}`,
    `due:${duePosition}`,
  ].join('|');
  const sourceRunKey = `${params.sourceRunPrefix}:${params.obligation.contract_line_id}:${materializedAt}`;
  const existingRecords = await loadExistingRecurringServicePeriodRecords(trx, {
    tenant: params.tenant,
    contractLineId: params.obligation.contract_line_id,
  });
  const billedBoundaryEnd = existingRecords
    .filter((record) => record.lifecycleState === 'billed' || record.invoiceLinkage != null)
    .map((record) => record.servicePeriod.end)
    .sort((left, right) => compareIsoDateOnly(right, left))[0] ?? null;
  const regenerationStart = billedBoundaryEnd
    ? maxIsoDateOnly(assignmentStart, billedBoundaryEnd)
    : assignmentStart;

  const candidateRecords = materializeContractCadenceServicePeriods({
    asOf: regenerationStart,
    materializedAt,
    billingCycle: frequency,
    anchorDate: assignmentStart,
    sourceObligation: {
      tenant: params.tenant,
      obligationId: params.obligation.contract_line_id,
      obligationType: 'contract_line',
      chargeFamily: resolveRecurringChargeFamily(params.obligation.contract_line_type),
    },
    duePosition,
    sourceRuleVersion,
    sourceRunKey,
    recordIdFactory: recurringServicePeriodRecordIdFactory,
  }).records.filter((record) => {
    if (!assignmentEnd) {
      return true;
    }
    return compareIsoDateOnly(record.servicePeriod.start, assignmentEnd) < 0;
  });

  const regenerationPlan = backfillRecurringServicePeriods({
    candidateRecords,
    existingRecords,
    backfilledAt: materializedAt,
    sourceRuleVersion,
    sourceRunKey,
    legacyBilledThroughEnd: billedBoundaryEnd,
    regenerationReasonCode: 'source_rule_changed',
    recordIdFactory: recurringServicePeriodRecordIdFactory,
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

export async function materializeContractCadenceServicePeriodsForContract(
  trx: Knex.Transaction,
  params: {
    tenant: string;
    contractId: string;
    sourceRunPrefix: string;
  },
): Promise<void> {
  const obligations = await loadContractCadenceObligations(trx, {
    tenant: params.tenant,
    contractId: params.contractId,
  });

  for (const obligation of obligations) {
    await syncContractCadenceObligation(trx, {
      tenant: params.tenant,
      obligation,
      sourceRunPrefix: params.sourceRunPrefix,
    });
  }
}

export async function materializeContractCadenceServicePeriodsForContractLine(
  trx: Knex.Transaction,
  params: {
    tenant: string;
    contractLineId: string;
    sourceRunPrefix: string;
  },
): Promise<void> {
  const obligations = await loadContractCadenceObligations(trx, {
    tenant: params.tenant,
    contractLineId: params.contractLineId,
  });

  if (obligations.length === 0) {
    await retireFutureContractCadenceRowsForLine(trx, {
      tenant: params.tenant,
      contractLineId: params.contractLineId,
      retiredAt: new Date().toISOString(),
    });
    return;
  }

  for (const obligation of obligations) {
    await syncContractCadenceObligation(trx, {
      tenant: params.tenant,
      obligation,
      sourceRunPrefix: params.sourceRunPrefix,
    });
  }
}
