'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { v4 as uuidv4 } from 'uuid';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type {
  BillingCycleType,
  IRecurringServicePeriodGovernanceRequirement,
  IRecurringServicePeriodInvoiceLinkage,
  IRecurringServicePeriodRecord,
  ISO8601String,
  RecurringChargeFamily,
  RecurringObligationType,
} from '@alga-psa/types';
import { ensureUtcMidnightIsoDate } from '../lib/billing/billingCycleAnchors';
import {
  getRecurringServicePeriodDisplayState,
} from '@alga-psa/shared/billingClients/recurringServicePeriodDisplayState';
import {
  getRecurringServicePeriodGovernanceRequirement,
  listRecurringServicePeriodGovernanceRequirements,
} from '@alga-psa/shared/billingClients/recurringServicePeriodGovernance';
import {
  type IRecurringServicePeriodRegenerationPlan,
  regenerateRecurringServicePeriods,
} from '@alga-psa/shared/billingClients/regenerateRecurringServicePeriods';
import {
  isClientCadencePostDropObligationType,
  POST_DROP_RECURRING_OBLIGATION_TYPES,
  buildPersistedClientCadencePostDropObligationRef,
} from '@alga-psa/shared/billingClients/postDropRecurringObligationIdentity';
import { getClientBillingCycleAnchor } from '@shared/billingClients/billingSchedule';
import { backfillRecurringServicePeriods } from '@shared/billingClients/backfillRecurringServicePeriods';
import { materializeClientCadenceServicePeriods } from '@shared/billingClients/materializeClientCadenceServicePeriods';
import { materializeContractCadenceServicePeriods } from '@shared/billingClients/materializeContractCadenceServicePeriods';

const RECURRING_SERVICE_PERIOD_PERMISSION_RESOURCE = 'billing.recurring_service_periods';
const recurringServicePeriodRecordIdFactory = () => uuidv4();
type SupportedContractCadenceBillingCycle = 'monthly' | 'quarterly' | 'semi-annually' | 'annually';

type DbRecordRow = {
  record_id: string;
  tenant: string;
  schedule_key: string;
  period_key: string;
  revision: number | string;
  obligation_id: string;
  obligation_type: RecurringObligationType;
  charge_family: RecurringChargeFamily;
  cadence_owner: IRecurringServicePeriodRecord['cadenceOwner'];
  due_position: IRecurringServicePeriodRecord['duePosition'];
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

type ObligationContextRow = {
  client_id: string | null;
  client_name: string | null;
  contract_id: string | null;
  contract_name: string | null;
  contract_line_id: string | null;
  contract_line_name: string | null;
  is_system_managed_default: boolean;
};

type LiveScheduleContextRow = ObligationContextRow & {
  contract_line_type: string | null;
  cadence_owner: 'client' | 'contract' | null;
  billing_frequency: string | null;
  billing_timing: 'advance' | 'arrears' | null;
  assignment_start_date: unknown;
  assignment_end_date: unknown;
};

interface ParsedRecurringServicePeriodScheduleKey {
  scheduleKey: string;
  tenant: string;
  obligationType: RecurringObligationType;
  obligationId: string;
  cadenceOwner: IRecurringServicePeriodRecord['cadenceOwner'];
  duePosition: IRecurringServicePeriodRecord['duePosition'];
}

export interface RecurringServicePeriodManagementRow {
  record: IRecurringServicePeriodRecord;
  displayState: ReturnType<typeof getRecurringServicePeriodDisplayState>;
  governance: IRecurringServicePeriodGovernanceRequirement[];
  clientId: string | null;
  clientName: string | null;
  contractId: string | null;
  contractName: string | null;
  contractLineId: string | null;
  contractLineName: string | null;
}

export interface RecurringServicePeriodManagementSummary {
  totalRows: number;
  exceptionRows: number;
  generatedRows: number;
  editedRows: number;
  skippedRows: number;
  lockedRows: number;
  billedRows: number;
  supersededRows: number;
  archivedRows: number;
}

export interface RecurringServicePeriodManagementView {
  scheduleKey: string;
  obligationId: string;
  obligationType: RecurringObligationType;
  cadenceOwner: IRecurringServicePeriodRecord['cadenceOwner'];
  duePosition: IRecurringServicePeriodRecord['duePosition'];
  chargeFamily: RecurringChargeFamily;
  clientId: string | null;
  clientName: string | null;
  contractId: string | null;
  contractName: string | null;
  contractLineId: string | null;
  contractLineName: string | null;
  status: 'ready' | 'repair_required';
  summary: RecurringServicePeriodManagementSummary;
  rows: RecurringServicePeriodManagementRow[];
}

export interface RepairRecurringServicePeriodMaterializationResult {
  scheduleKey: string;
  repairedAt: string;
  historicalBoundaryEnd: string | null;
  skippedHistoricalCandidates: number;
  backfilledRows: number;
  realignedRows: number;
  supersededRows: number;
  activeRows: number;
}

export interface RecurringServicePeriodScheduleSummary {
  scheduleKey: string;
  cadenceOwner: IRecurringServicePeriodRecord['cadenceOwner'];
  duePosition: IRecurringServicePeriodRecord['duePosition'];
  obligationType: RecurringObligationType;
  obligationId: string;
  clientName: string | null;
  contractName: string | null;
  contractLineName: string | null;
  latestInvoiceWindowEnd: string | null;
}

export interface PreviewRecurringServicePeriodRegenerationInput {
  existingRecords: IRecurringServicePeriodRecord[];
  candidateRecords: IRecurringServicePeriodRecord[];
  regeneratedAt: string;
  sourceRuleVersion: string;
  sourceRunKey: string;
}

export interface PreviewRecurringServicePeriodInvoiceLinkageRepairInput {
  record: IRecurringServicePeriodRecord;
  invoiceLinkage: IRecurringServicePeriodInvoiceLinkage;
  repairedAt: string;
  sourceRuleVersion: string;
  sourceRunKey?: string | null;
}

function isExceptionRow(record: IRecurringServicePeriodRecord) {
  return record.lifecycleState === 'edited'
    || record.lifecycleState === 'skipped'
    || record.lifecycleState === 'locked';
}

function normalizeTimestampValue(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  try {
    return new Date(value as string | number).toISOString();
  } catch (_error) {
    return null;
  }
}

function normalizeDateOnlyValue(value: unknown): string | null {
  const normalizedTimestamp = normalizeTimestampValue(value);
  return normalizedTimestamp ? normalizedTimestamp.slice(0, 10) : null;
}

function normalizeUtcMidnightDateValue(value: unknown): ISO8601String | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return `${value}T00:00:00Z` as ISO8601String;
    }

    try {
      return ensureUtcMidnightIsoDate(value);
    } catch (_error) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return `${parsed.toISOString().slice(0, 10)}T00:00:00Z` as ISO8601String;
      }
      throw _error;
    }
  }

  if (value instanceof Date) {
    return `${value.toISOString().slice(0, 10)}T00:00:00Z` as ISO8601String;
  }

  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.toISOString().slice(0, 10)}T00:00:00Z` as ISO8601String;
  }

  return ensureUtcMidnightIsoDate(String(value));
}

function mapRecurringServicePeriodRowToRecord(row: DbRecordRow): IRecurringServicePeriodRecord {
  return {
    kind: 'persisted_service_period_record',
    recordId: row.record_id,
    scheduleKey: row.schedule_key,
    periodKey: row.period_key,
    revision: Number(row.revision),
    sourceObligation: {
      tenant: row.tenant,
      obligationId: row.obligation_id,
      obligationType: row.obligation_type,
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

function buildManagementSummary(
  rows: RecurringServicePeriodManagementRow[],
): RecurringServicePeriodManagementSummary {
  return rows.reduce<RecurringServicePeriodManagementSummary>(
    (summary, row) => {
      summary.totalRows += 1;
      if (isExceptionRow(row.record)) {
        summary.exceptionRows += 1;
      }

      switch (row.record.lifecycleState) {
        case 'generated':
          summary.generatedRows += 1;
          break;
        case 'edited':
          summary.editedRows += 1;
          break;
        case 'skipped':
          summary.skippedRows += 1;
          break;
        case 'locked':
          summary.lockedRows += 1;
          break;
        case 'billed':
          summary.billedRows += 1;
          break;
        case 'superseded':
          summary.supersededRows += 1;
          break;
        case 'archived':
          summary.archivedRows += 1;
          break;
      }

      return summary;
    },
    {
      totalRows: 0,
      exceptionRows: 0,
      generatedRows: 0,
      editedRows: 0,
      skippedRows: 0,
      lockedRows: 0,
      billedRows: 0,
      supersededRows: 0,
      archivedRows: 0,
    },
  );
}

function buildEmptyManagementSummary(): RecurringServicePeriodManagementSummary {
  return {
    totalRows: 0,
    exceptionRows: 0,
    generatedRows: 0,
    editedRows: 0,
    skippedRows: 0,
    lockedRows: 0,
    billedRows: 0,
    supersededRows: 0,
    archivedRows: 0,
  };
}

function parseRecurringServicePeriodScheduleKey(
  scheduleKey: string,
): ParsedRecurringServicePeriodScheduleKey | null {
  const match = scheduleKey.match(
    /^schedule:([^:]+):([^:]+):([^:]+):(client|contract):(advance|arrears)$/,
  );
  if (!match) {
    return null;
  }

  return {
    scheduleKey,
    tenant: match[1]!,
    obligationType: match[2]! as RecurringObligationType,
    obligationId: match[3]!,
    cadenceOwner: match[4]! as IRecurringServicePeriodRecord['cadenceOwner'],
    duePosition: match[5]! as IRecurringServicePeriodRecord['duePosition'],
  };
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

function normalizeContractCadenceBillingCycle(value: string | null): SupportedContractCadenceBillingCycle | null {
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

function buildScheduleSourceRuleVersion(
  billingCycle: BillingCycleType,
  anchor: Awaited<ReturnType<typeof getClientBillingCycleAnchor>>['anchor'],
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

async function loadObligationContext(input: {
  trx: any;
  tenant: string;
  obligationType: RecurringObligationType;
  obligationId: string;
}): Promise<ObligationContextRow> {
  const { trx, tenant, obligationType, obligationId } = input;

  if (obligationType === 'contract_line') {
    const row = await trx('contract_lines as cl')
      .join('contracts as ct', function joinContracts(this: any) {
        this.on('ct.contract_id', '=', 'cl.contract_id')
          .andOn('ct.tenant', '=', 'cl.tenant');
      })
      .join('clients as c', function joinClients(this: any) {
        this.on('c.client_id', '=', 'ct.owner_client_id')
          .andOn('c.tenant', '=', 'ct.tenant');
      })
      .where('cl.tenant', tenant)
      .where('cl.contract_line_id', obligationId)
      .first(
        'c.client_id',
        'c.client_name',
        'ct.contract_id',
        'ct.contract_name',
        'cl.contract_line_id',
        'cl.contract_line_name',
        'ct.is_system_managed_default',
      );

    return {
      client_id: row?.client_id ?? null,
      client_name: row?.client_name ?? null,
      contract_id: row?.contract_id ?? null,
      contract_name: row?.contract_name ?? null,
      contract_line_id: row?.contract_line_id ?? null,
      contract_line_name: row?.contract_line_name ?? null,
      is_system_managed_default: row?.is_system_managed_default === true,
    };
  }

  if (isClientCadencePostDropObligationType(obligationType)) {
    const row = await trx('contract_lines as cl')
      .join('contracts as ct', function joinContracts(this: any) {
        this.on('ct.contract_id', '=', 'cl.contract_id')
          .andOn('ct.tenant', '=', 'cl.tenant');
      })
      .join('clients as c', function joinClients(this: any) {
        this.on('c.client_id', '=', 'ct.owner_client_id')
          .andOn('c.tenant', '=', 'ct.tenant');
      })
      .where('cl.tenant', tenant)
      .where('cl.contract_line_id', obligationId)
      .first(
        'c.client_id',
        'c.client_name',
        'ct.contract_id',
        'ct.contract_name',
        'cl.contract_line_id',
        'cl.contract_line_name',
        'ct.is_system_managed_default',
      );

    return {
      client_id: row?.client_id ?? null,
      client_name: row?.client_name ?? null,
      contract_id: row?.contract_id ?? null,
      contract_name: row?.contract_name ?? null,
      contract_line_id: row?.contract_line_id ?? null,
      contract_line_name: row?.contract_line_name ?? null,
      is_system_managed_default: row?.is_system_managed_default === true,
    };
  }

  return {
    client_id: null,
    client_name: null,
    contract_id: null,
    contract_name: null,
    contract_line_id: null,
    contract_line_name: null,
    is_system_managed_default: false,
  };
}

async function loadLiveScheduleContext(input: {
  trx: any;
  tenant: string;
  obligationType: RecurringObligationType;
  obligationId: string;
}): Promise<LiveScheduleContextRow> {
  const { trx, tenant, obligationType, obligationId } = input;

  if (obligationType !== 'contract_line' && !isClientCadencePostDropObligationType(obligationType)) {
    return {
      client_id: null,
      client_name: null,
      contract_id: null,
      contract_name: null,
      contract_line_id: null,
      contract_line_name: null,
      is_system_managed_default: false,
      contract_line_type: null,
      cadence_owner: null,
      billing_frequency: null,
      billing_timing: null,
      assignment_start_date: null,
      assignment_end_date: null,
    };
  }

  const row = await trx('contract_lines as cl')
    .join('contracts as ct', function joinContracts(this: any) {
      this.on('ct.contract_id', '=', 'cl.contract_id')
        .andOn('ct.tenant', '=', 'cl.tenant');
    })
    .join('clients as c', function joinClients(this: any) {
      this.on('c.client_id', '=', 'ct.owner_client_id')
        .andOn('c.tenant', '=', 'ct.tenant');
    })
    .leftJoin('client_contracts as cc', function joinClientContracts(this: any) {
      this.on('cc.contract_id', '=', 'ct.contract_id')
        .andOn('cc.tenant', '=', 'ct.tenant')
        .andOn('cc.is_active', '=', trx.raw('?', [true]));
    })
    .where('cl.tenant', tenant)
    .where('cl.contract_line_id', obligationId)
    .first(
      'c.client_id',
      'c.client_name',
      'ct.contract_id',
      'ct.contract_name',
      'cl.contract_line_id',
      'cl.contract_line_name',
      'ct.is_system_managed_default',
      'cl.contract_line_type',
      'cl.cadence_owner',
      'cl.billing_frequency',
      'cl.billing_timing',
      'cc.start_date as assignment_start_date',
      'cc.end_date as assignment_end_date',
    );

  return {
    client_id: row?.client_id ?? null,
    client_name: row?.client_name ?? null,
    contract_id: row?.contract_id ?? null,
    contract_name: row?.contract_name ?? null,
    contract_line_id: row?.contract_line_id ?? null,
    contract_line_name: row?.contract_line_name ?? null,
    is_system_managed_default: row?.is_system_managed_default === true,
    contract_line_type: row?.contract_line_type ?? null,
    cadence_owner: row?.cadence_owner ?? null,
    billing_frequency: row?.billing_frequency ?? null,
    billing_timing: row?.billing_timing ?? null,
    assignment_start_date: row?.assignment_start_date ?? null,
    assignment_end_date: row?.assignment_end_date ?? null,
  };
}

async function loadScheduleRows(input: {
  trx: any;
  tenant: string;
  scheduleKey: string;
}): Promise<DbRecordRow[]> {
  const { trx, tenant, scheduleKey } = input;

  return trx('recurring_service_periods')
    .where({
      tenant,
      schedule_key: scheduleKey,
    })
    .select([
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
    ])
    .orderBy('service_period_start', 'asc')
    .orderBy('revision', 'asc') as Promise<DbRecordRow[]>;
}

async function loadLastInvoicedClientBillingBoundary(
  trx: any,
  params: { tenant: string; clientId: string },
) {
  const lastInvoiced = await trx('client_billing_cycles as cbc')
    .join('invoices as i', function (this: any) {
      this.on('i.billing_cycle_id', '=', 'cbc.billing_cycle_id').andOn('i.tenant', '=', 'cbc.tenant');
    })
    .where('cbc.tenant', params.tenant)
    .andWhere('cbc.client_id', params.clientId)
    .orderBy('cbc.period_end_date', 'desc')
    .first()
    .select('cbc.period_end_date');

  return lastInvoiced?.period_end_date
    ? normalizeUtcMidnightDateValue(lastInvoiced.period_end_date)
    : null;
}

async function persistRecurringServicePeriodRepair(
  trx: any,
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

async function repairScheduleMaterialization(input: {
  trx: any;
  tenant: string;
  schedule: ParsedRecurringServicePeriodScheduleKey;
  context: LiveScheduleContextRow;
  existingRecords: IRecurringServicePeriodRecord[];
}): Promise<RepairRecurringServicePeriodMaterializationResult> {
  const { trx, tenant, schedule, context, existingRecords } = input;
  const repairedAt = new Date().toISOString();
  const chargeFamily = resolveRecurringChargeFamily(context.contract_line_type);

  if (!context.contract_line_id) {
    throw new Error(`Recurring obligation ${schedule.obligationId} no longer exists.`);
  }

  if (schedule.cadenceOwner === 'contract') {
    const assignmentStart =
      normalizeUtcMidnightDateValue(context.assignment_start_date)
      ?? ensureUtcMidnightIsoDate(repairedAt);
    const assignmentEnd = normalizeUtcMidnightDateValue(context.assignment_end_date);
    const billingCycle = normalizeContractCadenceBillingCycle(context.billing_frequency);
    if (!billingCycle || context.billing_timing !== schedule.duePosition) {
      throw new Error('The live contract line no longer matches the requested recurring schedule.');
    }

    if (assignmentEnd && compareIsoDateOnly(assignmentEnd, assignmentStart) <= 0) {
      return {
        scheduleKey: schedule.scheduleKey,
        repairedAt,
        historicalBoundaryEnd: null,
        skippedHistoricalCandidates: 0,
        backfilledRows: 0,
        realignedRows: 0,
        supersededRows: 0,
        activeRows: 0,
      };
    }

    const sourceRuleVersion = [
      'contract_cadence',
      `billing_cycle:${billingCycle}`,
      `anchor:${assignmentStart.slice(0, 10)}`,
      `due:${schedule.duePosition}`,
    ].join('|');
    const sourceRunKey = `operator-repair:${schedule.scheduleKey}:${repairedAt}`;
    const billedBoundaryEnd = existingRecords
      .filter((record) => record.lifecycleState === 'billed' || record.invoiceLinkage != null)
      .map((record) => record.servicePeriod.end)
      .sort((left, right) => compareIsoDateOnly(right, left))[0] ?? null;
    const regenerationStart = billedBoundaryEnd
      ? maxIsoDateOnly(assignmentStart, billedBoundaryEnd)
      : assignmentStart;

    const candidateRecords = materializeContractCadenceServicePeriods({
      asOf: regenerationStart,
      materializedAt: repairedAt,
      billingCycle,
      anchorDate: assignmentStart,
      sourceObligation: {
        tenant,
        obligationId: context.contract_line_id,
        obligationType: 'contract_line',
        chargeFamily,
      },
      duePosition: schedule.duePosition,
      sourceRuleVersion,
      sourceRunKey,
      recordIdFactory: recurringServicePeriodRecordIdFactory,
    }).records.filter((record) => {
      if (!assignmentEnd) {
        return true;
      }
      return compareIsoDateOnly(record.servicePeriod.start, assignmentEnd) < 0;
    });

    const repairPlan = backfillRecurringServicePeriods({
      candidateRecords,
      existingRecords,
      backfilledAt: repairedAt,
      sourceRuleVersion,
      sourceRunKey,
      legacyBilledThroughEnd: billedBoundaryEnd,
      regenerationReasonCode: 'source_rule_changed',
      recordIdFactory: recurringServicePeriodRecordIdFactory,
    });

    await persistRecurringServicePeriodRepair(trx, {
      tenant,
      recordsToSupersede: repairPlan.supersededRecords,
      recordsToInsert: [
        ...repairPlan.backfilledRecords,
        ...repairPlan.realignedRecords,
      ],
    });

    return {
      scheduleKey: schedule.scheduleKey,
      repairedAt,
      historicalBoundaryEnd: repairPlan.historicalBoundaryEnd,
      skippedHistoricalCandidates: repairPlan.skippedHistoricalCandidates.length,
      backfilledRows: repairPlan.backfilledRecords.length,
      realignedRows: repairPlan.realignedRecords.length,
      supersededRows: repairPlan.supersededRecords.length,
      activeRows: repairPlan.activeRecords.length,
    };
  }

  if (!isClientCadencePostDropObligationType(schedule.obligationType)) {
    throw new Error(`Unsupported recurring schedule type ${schedule.obligationType}.`);
  }

  if (!context.client_id) {
    throw new Error('The client cadence source for this schedule could not be resolved.');
  }

  if (context.billing_timing !== schedule.duePosition) {
    throw new Error('The live client-cadence obligation no longer matches the requested schedule timing.');
  }

  const billingSchedule = await getClientBillingCycleAnchor(trx, tenant, context.client_id);
  const billedBoundaryEnd = await loadLastInvoicedClientBillingBoundary(trx, {
    tenant,
    clientId: context.client_id,
  });
  const obligationStart =
    normalizeUtcMidnightDateValue(context.assignment_start_date)
    ?? ensureUtcMidnightIsoDate(repairedAt);
  const regenerationStart = billedBoundaryEnd
    ? maxIsoDateOnly(obligationStart, billedBoundaryEnd)
    : obligationStart;
  const obligationEnd = normalizeUtcMidnightDateValue(context.assignment_end_date);

  if (obligationEnd && compareIsoDateOnly(obligationEnd, regenerationStart) <= 0) {
    return {
      scheduleKey: schedule.scheduleKey,
      repairedAt,
      historicalBoundaryEnd: billedBoundaryEnd,
      skippedHistoricalCandidates: 0,
      backfilledRows: 0,
      realignedRows: 0,
      supersededRows: 0,
      activeRows: existingRecords.length,
    };
  }

  const sourceRuleVersion = buildScheduleSourceRuleVersion(
    billingSchedule.billingCycle,
    billingSchedule.anchor,
  );
  const sourceRunKey = `operator-repair:${schedule.scheduleKey}:${repairedAt}`;
  const candidateRecords = materializeClientCadenceServicePeriods({
    asOf: regenerationStart,
    materializedAt: repairedAt,
    billingCycle: billingSchedule.billingCycle,
    sourceObligation: buildPersistedClientCadencePostDropObligationRef({
      tenant,
      contractLineId: context.contract_line_id,
      chargeFamily,
    }),
    duePosition: schedule.duePosition,
    sourceRuleVersion,
    sourceRunKey,
    anchorSettings: billingSchedule.anchor,
    recordIdFactory: recurringServicePeriodRecordIdFactory,
  }).records;
  const repairPlan = backfillRecurringServicePeriods({
    candidateRecords,
    existingRecords,
    backfilledAt: repairedAt,
    sourceRuleVersion,
    sourceRunKey,
    legacyBilledThroughEnd: billedBoundaryEnd,
    regenerationReasonCode: 'billing_schedule_changed',
    recordIdFactory: recurringServicePeriodRecordIdFactory,
  });

  await persistRecurringServicePeriodRepair(trx, {
    tenant,
    recordsToSupersede: repairPlan.supersededRecords,
    recordsToInsert: [
      ...repairPlan.backfilledRecords,
      ...repairPlan.realignedRecords,
    ],
  });

  return {
    scheduleKey: schedule.scheduleKey,
    repairedAt,
    historicalBoundaryEnd: repairPlan.historicalBoundaryEnd,
    skippedHistoricalCandidates: repairPlan.skippedHistoricalCandidates.length,
    backfilledRows: repairPlan.backfilledRecords.length,
    realignedRows: repairPlan.realignedRecords.length,
    supersededRows: repairPlan.supersededRecords.length,
    activeRows: repairPlan.activeRecords.length,
  };
}

function previewRecurringServicePeriodInvoiceLinkageRepairResult(
  input: PreviewRecurringServicePeriodInvoiceLinkageRepairInput,
) {
  const governance = getRecurringServicePeriodGovernanceRequirement(
    input.record,
    'invoice_linkage_repair',
  );

  if (!governance.allowed) {
    throw new Error(governance.reason);
  }

  return {
    ...input.record,
    lifecycleState: 'billed' as const,
    invoiceLinkage: input.invoiceLinkage,
    provenance: {
      kind: 'repair' as const,
      sourceRuleVersion: input.sourceRuleVersion,
      reasonCode: 'invoice_linkage_repair' as const,
      sourceRunKey: input.sourceRunKey ?? null,
      supersedesRecordId: input.record.recordId,
    },
    updatedAt: input.repairedAt,
  };
}

async function requireRecurringServicePeriodPermission(
  user: unknown,
  action: 'view' | 'regenerate' | 'correct_history',
  message: string,
): Promise<ActionPermissionError | null> {
  if (!await hasPermission(user as any, RECURRING_SERVICE_PERIOD_PERMISSION_RESOURCE, action)) {
    return permissionError(message);
  }

  return null;
}

export const getRecurringServicePeriodManagementView = withAuth(async (
  user,
  { tenant },
  scheduleKey: string,
): Promise<RecurringServicePeriodManagementView | ActionPermissionError> => {
  const denied = await requireRecurringServicePeriodPermission(
    user,
    'view',
    'Permission denied: Cannot view recurring service periods',
  );
  if (denied) {
    return denied;
  }

  const normalizedScheduleKey = scheduleKey.trim();
  if (!normalizedScheduleKey) {
    return permissionError('A schedule key is required to inspect recurring service periods.');
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: any) => {
    const baseRows = await loadScheduleRows({
      trx,
      tenant,
      scheduleKey: normalizedScheduleKey,
    });

    if (baseRows.length === 0) {
      const parsedScheduleKey = parseRecurringServicePeriodScheduleKey(normalizedScheduleKey);
      if (!parsedScheduleKey) {
        throw new Error(`No recurring service periods found for schedule ${normalizedScheduleKey}.`);
      }
      if (parsedScheduleKey.tenant !== tenant) {
        throw new Error(`Schedule ${normalizedScheduleKey} does not belong to tenant ${tenant}.`);
      }

      const context = await loadLiveScheduleContext({
        trx,
        tenant,
        obligationType: parsedScheduleKey.obligationType,
        obligationId: parsedScheduleKey.obligationId,
      });
      if (context.is_system_managed_default) {
        throw new Error(
          'System-managed default contracts are attribution-only and cannot be managed in recurring service period admin tools.',
        );
      }
      if (!context.contract_line_id) {
        throw new Error(`No recurring service periods found for schedule ${normalizedScheduleKey}.`);
      }

      return {
        scheduleKey: normalizedScheduleKey,
        obligationId: parsedScheduleKey.obligationId,
        obligationType: parsedScheduleKey.obligationType,
        cadenceOwner: parsedScheduleKey.cadenceOwner,
        duePosition: parsedScheduleKey.duePosition,
        chargeFamily: resolveRecurringChargeFamily(context.contract_line_type),
        clientId: context.client_id,
        clientName: context.client_name,
        contractId: context.contract_id,
        contractName: context.contract_name,
        contractLineId: context.contract_line_id,
        contractLineName: context.contract_line_name,
        status: 'repair_required',
        summary: buildEmptyManagementSummary(),
        rows: [],
      } satisfies RecurringServicePeriodManagementView;
    }

    const firstRow = baseRows[0]!;
    const context = await loadObligationContext({
      trx,
      tenant,
      obligationType: firstRow.obligation_type,
      obligationId: firstRow.obligation_id,
    });
    if (context.is_system_managed_default) {
      throw new Error(
        'System-managed default contracts are attribution-only and cannot be managed in recurring service period admin tools.',
      );
    }

    const rows = baseRows.map((row: DbRecordRow) => {
      const record = mapRecurringServicePeriodRowToRecord(row);
      return {
        record,
        displayState: getRecurringServicePeriodDisplayState(record),
        governance: listRecurringServicePeriodGovernanceRequirements(record),
        clientId: context.client_id,
        clientName: context.client_name,
        contractId: context.contract_id,
        contractName: context.contract_name,
        contractLineId: context.contract_line_id,
        contractLineName: context.contract_line_name,
      } satisfies RecurringServicePeriodManagementRow;
    });

    return {
      scheduleKey: normalizedScheduleKey,
      obligationId: firstRow.obligation_id,
      obligationType: firstRow.obligation_type,
      cadenceOwner: firstRow.cadence_owner,
      duePosition: firstRow.due_position,
      chargeFamily: firstRow.charge_family,
      clientId: context.client_id,
      clientName: context.client_name,
      contractId: context.contract_id,
      contractName: context.contract_name,
      contractLineId: context.contract_line_id,
      contractLineName: context.contract_line_name,
      status: 'ready',
      summary: buildManagementSummary(rows),
      rows,
    } satisfies RecurringServicePeriodManagementView;
  });
});

export const repairMissingRecurringServicePeriods = withAuth(async (
  user,
  { tenant },
  scheduleKey: string,
): Promise<RepairRecurringServicePeriodMaterializationResult | ActionPermissionError> => {
  const denied = await requireRecurringServicePeriodPermission(
    user,
    'regenerate',
    'Permission denied: Cannot repair recurring service periods',
  );
  if (denied) {
    return denied;
  }

  const normalizedScheduleKey = scheduleKey.trim();
  if (!normalizedScheduleKey) {
    return permissionError('A schedule key is required to repair recurring service periods.');
  }

  const parsedScheduleKey = parseRecurringServicePeriodScheduleKey(normalizedScheduleKey);
  if (!parsedScheduleKey) {
    throw new Error(`Schedule key ${normalizedScheduleKey} is not a supported recurring service-period schedule.`);
  }
  if (parsedScheduleKey.tenant !== tenant) {
    throw new Error(`Schedule ${normalizedScheduleKey} does not belong to tenant ${tenant}.`);
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: any) => {
    const context = await loadLiveScheduleContext({
      trx,
      tenant,
      obligationType: parsedScheduleKey.obligationType,
      obligationId: parsedScheduleKey.obligationId,
    });
    if (context.is_system_managed_default) {
      throw new Error(
        'System-managed default contracts are attribution-only and cannot be repaired in recurring service period admin tools.',
      );
    }

    const existingRecords = (await loadScheduleRows({
      trx,
      tenant,
      scheduleKey: normalizedScheduleKey,
    })).map(mapRecurringServicePeriodRowToRecord);

    return repairScheduleMaterialization({
      trx,
      tenant,
      schedule: parsedScheduleKey,
      context,
      existingRecords,
    });
  });
});

export const listRecurringServicePeriodScheduleSummaries = withAuth(async (
  user,
  { tenant },
  limit: number = 50,
): Promise<RecurringServicePeriodScheduleSummary[] | ActionPermissionError> => {
  const denied = await requireRecurringServicePeriodPermission(
    user,
    'view',
    'Permission denied: Cannot view recurring service periods',
  );
  if (denied) {
    return denied;
  }

  const normalizedLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 200) : 50;
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: any) => {
    const rows = await trx('recurring_service_periods as rsp')
      .leftJoin('contract_lines as cl', function (this: any) {
        this.on('cl.contract_line_id', '=', 'rsp.obligation_id')
          .andOn('cl.tenant', '=', 'rsp.tenant');
      })
      .leftJoin('contracts as ct', function (this: any) {
        this.on('ct.contract_id', '=', 'cl.contract_id')
          .andOn('ct.tenant', '=', 'cl.tenant');
      })
      .leftJoin('clients as c', function (this: any) {
        this.on('c.client_id', '=', 'ct.owner_client_id')
          .andOn('c.tenant', '=', 'ct.tenant');
      })
      .where('rsp.tenant', tenant)
      .whereIn('rsp.obligation_type', [...POST_DROP_RECURRING_OBLIGATION_TYPES])
      .whereNotIn('rsp.lifecycle_state', ['superseded', 'archived'])
      .where((builder: any) =>
        builder.whereNull('ct.is_system_managed_default').orWhere('ct.is_system_managed_default', false),
      )
      .whereNotNull('c.client_name')
      .whereNotNull('ct.contract_name')
      .whereNotNull('cl.contract_line_name')
      .groupBy([
        'rsp.schedule_key',
        'rsp.cadence_owner',
        'rsp.due_position',
        'rsp.obligation_type',
        'rsp.obligation_id',
        'c.client_name',
        'ct.contract_name',
        'cl.contract_line_name',
      ])
      .select(
        'rsp.schedule_key',
        'rsp.cadence_owner',
        'rsp.due_position',
        'rsp.obligation_type',
        'rsp.obligation_id',
        'c.client_name',
        'ct.contract_name',
        'cl.contract_line_name',
      )
      .max('rsp.invoice_window_end as latest_invoice_window_end')
      .orderBy('latest_invoice_window_end', 'desc')
      .limit(normalizedLimit);

    return rows.map((row: any) => ({
      scheduleKey: row.schedule_key,
      cadenceOwner: row.cadence_owner,
      duePosition: row.due_position,
      obligationType: row.obligation_type,
      obligationId: row.obligation_id,
      clientName: row.client_name ?? null,
      contractName: row.contract_name ?? null,
      contractLineName: row.contract_line_name ?? null,
      latestInvoiceWindowEnd: normalizeDateOnlyValue(row.latest_invoice_window_end),
    }));
  });
});

export const previewRecurringServicePeriodRegeneration = withAuth(async (
  user,
  _ctx,
  input: PreviewRecurringServicePeriodRegenerationInput,
): Promise<IRecurringServicePeriodRegenerationPlan | ActionPermissionError> => {
  const denied = await requireRecurringServicePeriodPermission(
    user,
    'regenerate',
    'Permission denied: Cannot regenerate recurring service periods',
  );
  if (denied) {
    return denied;
  }

  return regenerateRecurringServicePeriods(input);
});

export const previewRecurringServicePeriodInvoiceLinkageRepair = withAuth(async (
  user,
  _ctx,
  input: PreviewRecurringServicePeriodInvoiceLinkageRepairInput,
): Promise<IRecurringServicePeriodRecord | ActionPermissionError> => {
  const denied = await requireRecurringServicePeriodPermission(
    user,
    'correct_history',
    'Permission denied: Cannot repair recurring service period history',
  );
  if (denied) {
    return denied;
  }

  return previewRecurringServicePeriodInvoiceLinkageRepairResult(input);
});
