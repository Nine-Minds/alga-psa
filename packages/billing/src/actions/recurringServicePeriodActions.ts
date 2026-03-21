'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type {
  IRecurringServicePeriodGovernanceRequirement,
  IRecurringServicePeriodInvoiceLinkage,
  IRecurringServicePeriodRecord,
  RecurringChargeFamily,
  RecurringObligationType,
} from '@alga-psa/types';
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
} from '@alga-psa/shared/billingClients/postDropRecurringObligationIdentity';

const RECURRING_SERVICE_PERIOD_PERMISSION_RESOURCE = 'billing.recurring_service_periods';

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
};

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
  summary: RecurringServicePeriodManagementSummary;
  rows: RecurringServicePeriodManagementRow[];
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
      );

    return {
      client_id: row?.client_id ?? null,
      client_name: row?.client_name ?? null,
      contract_id: row?.contract_id ?? null,
      contract_name: row?.contract_name ?? null,
      contract_line_id: row?.contract_line_id ?? null,
      contract_line_name: row?.contract_line_name ?? null,
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
      );

    return {
      client_id: row?.client_id ?? null,
      client_name: row?.client_name ?? null,
      contract_id: row?.contract_id ?? null,
      contract_name: row?.contract_name ?? null,
      contract_line_id: row?.contract_line_id ?? null,
      contract_line_name: row?.contract_line_name ?? null,
    };
  }

  return {
    client_id: null,
    client_name: null,
    contract_id: null,
    contract_name: null,
    contract_line_id: null,
    contract_line_name: null,
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
    const baseRows = await trx('recurring_service_periods')
      .where({
        tenant,
        schedule_key: normalizedScheduleKey,
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
      .orderBy('revision', 'asc') as DbRecordRow[];

    if (baseRows.length === 0) {
      throw new Error(`No recurring service periods found for schedule ${normalizedScheduleKey}.`);
    }

    const firstRow = baseRows[0]!;
    const context = await loadObligationContext({
      trx,
      tenant,
      obligationType: firstRow.obligation_type,
      obligationId: firstRow.obligation_id,
    });

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
      summary: buildManagementSummary(rows),
      rows,
    } satisfies RecurringServicePeriodManagementView;
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
      .leftJoin('contract_lines as cl', function () {
        this.on('cl.contract_line_id', '=', 'rsp.obligation_id')
          .andOn('cl.tenant', '=', 'rsp.tenant');
      })
      .leftJoin('contracts as ct', function () {
        this.on('ct.contract_id', '=', 'cl.contract_id')
          .andOn('ct.tenant', '=', 'cl.tenant');
      })
      .leftJoin('clients as c', function () {
        this.on('c.client_id', '=', 'ct.owner_client_id')
          .andOn('c.tenant', '=', 'ct.tenant');
      })
      .where('rsp.tenant', tenant)
      .whereIn('rsp.obligation_type', [...POST_DROP_RECURRING_OBLIGATION_TYPES])
      .whereNotIn('rsp.lifecycle_state', ['superseded', 'archived'])
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
