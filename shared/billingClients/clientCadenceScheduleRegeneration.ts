import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
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
} from './billingCycleAnchors';
import { materializeClientCadenceServicePeriods } from './materializeClientCadenceServicePeriods';
import { getClientBillingCycleAnchor } from './billingSchedule';
import {
  backfillRecurringServicePeriods,
  type IRecurringServicePeriodBackfillPlan,
} from './backfillRecurringServicePeriods';
import {
  buildPersistedClientCadencePostDropObligationRef,
  CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE,
} from './postDropRecurringObligationIdentity';

type ClientCadenceRecurringObligationRow = {
  client_contract_line_id: string;
  start_date: unknown;
  end_date: unknown;
  contract_line_type: string | null;
  billing_timing: string | null;
};

const recurringServicePeriodRecordIdFactory = () => uuidv4();

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

async function loadClientBilledLedgerBoundary(
  trx: Knex.Transaction,
  params: { tenant: string; clientId: string },
) {
  const db = tenantDb(trx, params.tenant);
  const query = db.table('recurring_service_periods as rsp');
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_line_id', 'rsp.obligation_id');
  db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cl.contract_id');
  const lastBilled = await query
    .where('rsp.obligation_type', CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE)
    .where('rsp.cadence_owner', 'client')
    .where('ct.owner_client_id', params.clientId)
    .where((builder) => {
      builder.where('rsp.lifecycle_state', 'billed')
        .orWhereNotNull('rsp.invoice_charge_detail_id');
    })
    .orderBy('rsp.service_period_end', 'desc')
    .first()
    .select({ service_period_end: 'rsp.service_period_end' });

  return lastBilled?.service_period_end
    ? normalizeDateOnlyValue(lastBilled.service_period_end)
    : null;
}

async function loadClientCadenceRecurringObligations(
  trx: Knex.Transaction,
  params: { tenant: string; clientId: string },
): Promise<ClientCadenceRecurringObligationRow[]> {
  const db = tenantDb(trx, params.tenant);
  const query = db.table('client_contracts as cc');
  // template_contract_id is provenance only; regeneration must read the
  // client-owned contract that owns the live cloned lines.
  db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cc.contract_id');
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_id', 'ct.contract_id');
  return query
    .andWhere('cc.client_id', params.clientId)
    .where('cc.is_active', true)
    .where((builder) =>
      builder.whereNull('ct.is_system_managed_default').orWhere('ct.is_system_managed_default', false),
    )
    .where('cl.cadence_owner', 'client')
    .whereNotNull('cl.billing_timing')
    .select(
      'cl.contract_line_id as client_contract_line_id',
      'cc.start_date',
      'cc.end_date',
      'cl.contract_line_type',
      'cl.billing_timing',
    );
}

async function loadExistingRecurringServicePeriodRecords(
  trx: Knex.Transaction,
  params: { tenant: string; obligationId: string },
): Promise<IRecurringServicePeriodRecord[]> {
  const rows = await tenantDb(trx, params.tenant).table('recurring_service_periods')
    .where({
      obligation_id: params.obligationId,
      obligation_type: CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE,
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
  const db = tenantDb(trx, params.tenant);
  for (const record of params.recordsToSupersede) {
    await db.table('recurring_service_periods')
      .where({ record_id: record.recordId })
      .update({
        lifecycle_state: record.lifecycleState,
        updated_at: record.updatedAt,
      });
  }

  if (params.recordsToInsert.length > 0) {
    await db.table('recurring_service_periods').insert(
      params.recordsToInsert.map(serializeRecurringServicePeriodRecord),
    );
  }
}

/**
 * A client-cadence obligation that starts or ends inside a schedule period is
 * only active for part of that period. The invoice engine derives coverage
 * (and proration / canonical detail periods) from the persisted activity
 * window, so regeneration must clip the first/last periods to the assignment
 * bounds; otherwise mid-period contract starts are billed for the full period.
 */
function clipRecordActivityWindowToObligationBounds(
  record: IRecurringServicePeriodRecord,
  obligationStart: ISO8601String,
  obligationEnd: ISO8601String | null,
): IRecurringServicePeriodRecord {
  const clipStart =
    compareIsoDateOnly(obligationStart, record.servicePeriod.start) > 0
      ? obligationStart
      : null;
  const clipEnd =
    obligationEnd && compareIsoDateOnly(obligationEnd, record.servicePeriod.end) < 0
      ? obligationEnd
      : null;

  if (!clipStart && !clipEnd) {
    return record;
  }

  return {
    ...record,
    activityWindow: {
      start: clipStart ?? record.servicePeriod.start,
      end: clipEnd ?? record.servicePeriod.end,
      semantics: record.servicePeriod.semantics,
    },
  };
}

type ClientCadenceScheduleChangeParams = {
  tenant: string;
  clientId: string;
  billingCycle: BillingCycleType;
  anchor: NormalizedBillingCycleAnchorSettings;
};

type ClientCadenceObligationRegenerationPlan = {
  obligationId: string;
  scheduleKey: string;
  regenerationStart: ISO8601String;
  plan: IRecurringServicePeriodBackfillPlan;
};

type ClientCadenceRegenerationComputation = {
  billedBoundaryEnd: ISO8601String | null;
  obligationPlans: ClientCadenceObligationRegenerationPlan[];
};

/**
 * Computes the regeneration plan for every client-cadence obligation of a client
 * against a new cadence, without persisting anything. Both the persisting
 * regeneration and the dry-run preview share this so the numbers a user is shown
 * are exactly what will be written.
 */
async function computeClientCadenceRegeneration(
  trx: Knex.Transaction,
  params: ClientCadenceScheduleChangeParams,
): Promise<ClientCadenceRegenerationComputation> {
  const billedBoundaryEnd = await loadClientBilledLedgerBoundary(trx, params);
  const obligations = await loadClientCadenceRecurringObligations(trx, params);
  const materializedAt = new Date().toISOString();
  const sourceRuleVersion = buildScheduleSourceRuleVersion(
    params.billingCycle,
    params.anchor,
  );
  const sourceRunKey = `client-schedule-change:${params.clientId}:${materializedAt}`;

  const obligationPlans: ClientCadenceObligationRegenerationPlan[] = [];

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

    const materialized = materializeClientCadenceServicePeriods({
      asOf: regenerationStart,
      materializedAt,
      billingCycle: params.billingCycle,
      sourceObligation: buildPersistedClientCadencePostDropObligationRef({
        tenant: params.tenant,
        contractLineId: obligation.client_contract_line_id,
        chargeFamily: resolveRecurringChargeFamily(obligation.contract_line_type),
      }),
      duePosition,
      sourceRuleVersion,
      sourceRunKey,
      anchorSettings: params.anchor,
      recordIdFactory: recurringServicePeriodRecordIdFactory,
    });

    const candidateRecords = materialized.records.map((record) =>
      clipRecordActivityWindowToObligationBounds(record, obligationStart, obligationEnd),
    );

    const plan = backfillRecurringServicePeriods({
      candidateRecords,
      existingRecords,
      candidateCoverageEnd: materialized.generationRangeEnd,
      backfilledAt: materializedAt,
      sourceRuleVersion,
      sourceRunKey,
      legacyBilledThroughEnd: billedBoundaryEnd,
      regenerationReasonCode: 'billing_schedule_changed',
      recordIdFactory: recurringServicePeriodRecordIdFactory,
    });

    obligationPlans.push({
      obligationId: obligation.client_contract_line_id,
      scheduleKey: materialized.scheduleKey,
      regenerationStart,
      plan,
    });
  }

  return { billedBoundaryEnd, obligationPlans };
}

export async function regenerateClientCadenceServicePeriodsForScheduleChange(
  trx: Knex.Transaction,
  params: ClientCadenceScheduleChangeParams,
): Promise<void> {
  const { obligationPlans } = await computeClientCadenceRegeneration(trx, params);

  for (const { plan } of obligationPlans) {
    await persistRecurringServicePeriodRegeneration(trx, {
      tenant: params.tenant,
      recordsToSupersede: plan.supersededRecords,
      recordsToInsert: [
        ...plan.backfilledRecords,
        ...plan.realignedRecords,
      ],
    });
  }
}

export type ClientCadenceChangePreview = {
  billingCycle: BillingCycleType;
  unbilledPeriodsToRegenerate: number;
  linesAffected: number;
  regenerationStart: ISO8601String | null;
  billedPeriodsInRange: boolean;
  affectedScheduleKeys: string[];
};

/**
 * Dry-run impact of changing a client's cadence: how many unbilled service
 * periods would be regenerated, across how many lines, from what date, and
 * whether billed periods sit in the affected range. Writes nothing.
 */
export async function previewClientCadenceScheduleChange(
  trx: Knex.Transaction,
  params: ClientCadenceScheduleChangeParams,
): Promise<ClientCadenceChangePreview> {
  const { billedBoundaryEnd, obligationPlans } = await computeClientCadenceRegeneration(trx, params);

  let unbilledPeriodsToRegenerate = 0;
  let linesAffected = 0;
  let regenerationStart: ISO8601String | null = null;
  const affectedScheduleKeys = new Set<string>();

  for (const obligationPlan of obligationPlans) {
    const inserts =
      obligationPlan.plan.backfilledRecords.length + obligationPlan.plan.realignedRecords.length;
    const changed = inserts + obligationPlan.plan.supersededRecords.length;

    if (changed > 0) {
      linesAffected += 1;
      affectedScheduleKeys.add(obligationPlan.scheduleKey);
    }
    unbilledPeriodsToRegenerate += inserts;

    if (
      regenerationStart === null
      || compareIsoDateOnly(obligationPlan.regenerationStart, regenerationStart) < 0
    ) {
      regenerationStart = obligationPlan.regenerationStart;
    }
  }

  return {
    billingCycle: params.billingCycle,
    unbilledPeriodsToRegenerate,
    linesAffected,
    regenerationStart,
    billedPeriodsInRange: billedBoundaryEnd != null,
    affectedScheduleKeys: [...affectedScheduleKeys],
  };
}

export async function retireFutureClientCadenceRowsForLine(
  trx: Knex.Transaction,
  params: {
    tenant: string;
    contractLineId: string;
    retiredAt: string;
  },
): Promise<void> {
  await tenantDb(trx, params.tenant).table('recurring_service_periods')
    .where({
      obligation_id: params.contractLineId,
      obligation_type: CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE,
      cadence_owner: 'client',
    })
    .whereNotIn('lifecycle_state', ['archived', 'superseded', 'billed'])
    .update({
      lifecycle_state: 'superseded',
      updated_at: params.retiredAt,
    });
}

async function loadClientsWithClientCadenceObligations(
  trx: Knex.Transaction,
  tenant: string,
): Promise<string[]> {
  const db = tenantDb(trx, tenant);
  const query = db.table('client_contracts as cc');
  db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cc.contract_id');
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_id', 'ct.contract_id');
  const ids = await query
    .where('cc.is_active', true)
    .where((builder) =>
      builder.whereNull('ct.is_system_managed_default').orWhere('ct.is_system_managed_default', false),
    )
    .where('cl.cadence_owner', 'client')
    .whereNotNull('cl.billing_timing')
    .distinct('cc.client_id')
    .pluck('cc.client_id');

  return (ids as Array<string | null>).filter((id): id is string => Boolean(id));
}

export type RepairAllClientCadenceServicePeriodsSummary = {
  clientsScanned: number;
  clientsRepaired: number;
  schedulesRepaired: number;
  rowsBackfilled: number;
  rowsRealigned: number;
  rowsSuperseded: number;
};

/**
 * Re-materializes every client-cadence schedule in a tenant against each
 * client's current cadence, healing any ledger that drifted out of sync (for
 * example after a billing-cycle change that did not re-materialize). Billed
 * periods are preserved by the shared regeneration. Idempotent: a client whose
 * ledger already matches its cadence produces no changes.
 */
export async function repairAllClientCadenceServicePeriodsForTenant(
  trx: Knex.Transaction,
  params: { tenant: string },
): Promise<RepairAllClientCadenceServicePeriodsSummary> {
  const clientIds = await loadClientsWithClientCadenceObligations(trx, params.tenant);

  const summary: RepairAllClientCadenceServicePeriodsSummary = {
    clientsScanned: clientIds.length,
    clientsRepaired: 0,
    schedulesRepaired: 0,
    rowsBackfilled: 0,
    rowsRealigned: 0,
    rowsSuperseded: 0,
  };

  for (const clientId of clientIds) {
    const schedule = await getClientBillingCycleAnchor(trx, params.tenant, clientId);
    const { obligationPlans } = await computeClientCadenceRegeneration(trx, {
      tenant: params.tenant,
      clientId,
      billingCycle: schedule.billingCycle,
      anchor: schedule.anchor,
    });

    let clientChanged = false;
    for (const obligationPlan of obligationPlans) {
      const { plan } = obligationPlan;
      const changed =
        plan.backfilledRecords.length + plan.realignedRecords.length + plan.supersededRecords.length;
      if (changed === 0) {
        continue;
      }

      clientChanged = true;
      summary.schedulesRepaired += 1;
      summary.rowsBackfilled += plan.backfilledRecords.length;
      summary.rowsRealigned += plan.realignedRecords.length;
      summary.rowsSuperseded += plan.supersededRecords.length;

      await persistRecurringServicePeriodRegeneration(trx, {
        tenant: params.tenant,
        recordsToSupersede: plan.supersededRecords,
        recordsToInsert: [...plan.backfilledRecords, ...plan.realignedRecords],
      });
    }

    if (clientChanged) {
      summary.clientsRepaired += 1;
    }
  }

  return summary;
}
