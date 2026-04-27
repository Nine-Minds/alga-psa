import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { computeWorkDateFields, resolveUserTimeZone } from '@alga-psa/db';
import { Temporal } from '@js-temporal/polyfill';
import { toISODate, toPlainDate } from '@alga-psa/core';

export type WorkflowTimeDomainErrorCategory = 'ValidationError' | 'ActionError' | 'TransientError';

export class WorkflowTimeDomainError extends Error {
  public readonly category: WorkflowTimeDomainErrorCategory;
  public readonly code: string;
  public readonly details: Record<string, unknown> | null;

  constructor(params: {
    category: WorkflowTimeDomainErrorCategory;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = 'WorkflowTimeDomainError';
    this.category = params.category;
    this.code = params.code;
    this.details = params.details ?? null;
  }
}

export type WorkflowTimeCreateEntryInput = {
  user_id: string;
  start: string;
  end?: string;
  duration_minutes?: number;
  billable?: boolean;
  billable_duration_minutes?: number;
  link?: {
    type: 'ticket' | 'project' | 'project_task' | 'interaction' | 'ad_hoc' | 'non_billable_category';
    id: string;
  };
  service_id: string;
  contract_line_id?: string | null;
  tax_rate_id?: string | null;
  notes?: string;
  time_sheet_id?: string | null;
  attach_to_timesheet?: boolean;
};

type ContractLineCandidate = {
  client_contract_line_id: string;
  bucket_overlay?: {
    config_id: string;
  } | null;
};

type BucketUsagePeriod = {
  periodStart: string;
  periodEnd: string;
};

export type WorkflowTimeCreatedEntrySummary = {
  entry_id: string;
  user_id: string;
  work_item_id: string | null;
  work_item_type: string | null;
  service_id: string;
  contract_line_id: string | null;
  time_sheet_id: string | null;
  start_time: string;
  end_time: string;
  total_minutes: number;
  billable_minutes: number;
  work_date: string;
  work_timezone: string;
  approval_status: string;
  invoiced: boolean;
  notes: string | null;
};

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toDateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function ensureValidDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new WorkflowTimeDomainError({
      category: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: `${field} must be a valid ISO timestamp`,
      details: { field, value },
    });
  }
  return date;
}

function assertPositiveOrZeroMinutes(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new WorkflowTimeDomainError({
      category: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: `${field} must be an integer greater than or equal to zero`,
      details: { field, value },
    });
  }
}

async function getWorkItemClientContext(
  trx: Knex.Transaction,
  tenantId: string,
  link: WorkflowTimeCreateEntryInput['link']
): Promise<{ clientId: string | null; ticketAssignedTo?: string | null; taskAssignedTo?: string | null }> {
  if (!link) {
    return { clientId: null };
  }

  switch (link.type) {
    case 'ticket': {
      const ticket = await trx('tickets')
        .where({ tenant: tenantId, ticket_id: link.id })
        .select('ticket_id', 'client_id', 'assigned_to')
        .first();

      if (!ticket) {
        throw new WorkflowTimeDomainError({
          category: 'ActionError',
          code: 'NOT_FOUND',
          message: 'Ticket not found',
          details: { ticket_id: link.id },
        });
      }

      return {
        clientId: (ticket.client_id as string | null) ?? null,
        ticketAssignedTo: (ticket.assigned_to as string | null) ?? null,
      };
    }
    case 'project_task': {
      const task = await trx('project_tasks as pt')
        .join('project_phases as pp', function joinPhases() {
          this.on('pt.phase_id', '=', 'pp.phase_id').andOn('pt.tenant', '=', 'pp.tenant');
        })
        .join('projects as p', function joinProjects() {
          this.on('pp.project_id', '=', 'p.project_id').andOn('pp.tenant', '=', 'p.tenant');
        })
        .where({ 'pt.tenant': tenantId, 'pt.task_id': link.id })
        .select('pt.task_id', 'pt.assigned_to', 'p.client_id')
        .first();

      if (!task) {
        throw new WorkflowTimeDomainError({
          category: 'ActionError',
          code: 'NOT_FOUND',
          message: 'Project task not found',
          details: { task_id: link.id },
        });
      }

      return {
        clientId: (task.client_id as string | null) ?? null,
        taskAssignedTo: (task.assigned_to as string | null) ?? null,
      };
    }
    case 'project': {
      const project = await trx('projects')
        .where({ tenant: tenantId, project_id: link.id })
        .select('project_id', 'client_id')
        .first();

      if (!project) {
        throw new WorkflowTimeDomainError({
          category: 'ActionError',
          code: 'NOT_FOUND',
          message: 'Project not found',
          details: { project_id: link.id },
        });
      }

      return { clientId: (project.client_id as string | null) ?? null };
    }
    case 'interaction': {
      const interaction = await trx('interactions')
        .where({ tenant: tenantId, interaction_id: link.id })
        .select('interaction_id', 'client_id')
        .first();

      if (!interaction) {
        throw new WorkflowTimeDomainError({
          category: 'ActionError',
          code: 'NOT_FOUND',
          message: 'Interaction not found',
          details: { interaction_id: link.id },
        });
      }

      return { clientId: (interaction.client_id as string | null) ?? null };
    }
    case 'ad_hoc': {
      const adHoc = await trx('schedule_entries')
        .where({ tenant: tenantId, entry_id: link.id })
        .select('entry_id')
        .first();

      if (!adHoc) {
        throw new WorkflowTimeDomainError({
          category: 'ActionError',
          code: 'NOT_FOUND',
          message: 'Schedule entry not found',
          details: { entry_id: link.id },
        });
      }

      return { clientId: null };
    }
    case 'non_billable_category':
      return { clientId: null };
    default:
      throw new WorkflowTimeDomainError({
        category: 'ValidationError',
        code: 'VALIDATION_ERROR',
        message: 'Unsupported work item type',
        details: { work_item_type: (link as { type?: string }).type ?? null },
      });
  }
}

function resolveDeterministicContractLineSelection(
  eligibleContractLines: ContractLineCandidate[]
): string | null {
  if (eligibleContractLines.length === 0) {
    return null;
  }

  if (eligibleContractLines.length === 1) {
    return eligibleContractLines[0].client_contract_line_id;
  }

  const overlayContractLines = eligibleContractLines.filter((contractLine) => contractLine.bucket_overlay?.config_id);
  if (overlayContractLines.length === 1) {
    return overlayContractLines[0].client_contract_line_id;
  }

  return null;
}

async function determineDefaultContractLineForWorkflow(params: {
  trx: Knex.Transaction;
  tenantId: string;
  clientId: string;
  serviceId: string;
  effectiveDate: string;
}): Promise<string | null> {
  const { trx, tenantId, clientId, serviceId, effectiveDate } = params;

  const rangeStart = `${effectiveDate}T00:00:00.000Z`;
  const rangeEnd = `${effectiveDate}T23:59:59.999Z`;

  const rows = await trx('client_contracts')
    .join('contracts', function joinContracts() {
      this.on('client_contracts.contract_id', '=', 'contracts.contract_id')
        .andOn('contracts.tenant', '=', 'client_contracts.tenant');
    })
    .join('contract_lines', function joinContractLines() {
      this.on('contracts.contract_id', '=', 'contract_lines.contract_id')
        .andOn('contract_lines.tenant', '=', 'contracts.tenant');
    })
    .join('contract_line_services', function joinContractLineServices() {
      this.on('contract_lines.contract_line_id', '=', 'contract_line_services.contract_line_id')
        .andOn('contract_line_services.tenant', '=', 'contract_lines.tenant');
    })
    .leftJoin('contract_line_service_configuration as bucket_config', function joinBucketConfig() {
      this.on('bucket_config.contract_line_id', '=', 'contract_lines.contract_line_id')
        .andOn('bucket_config.tenant', '=', 'contract_lines.tenant')
        .andOn('bucket_config.service_id', '=', 'contract_line_services.service_id')
        .andOnVal('bucket_config.configuration_type', 'Bucket');
    })
    .where({
      'client_contracts.client_id': clientId,
      'client_contracts.is_active': true,
      'client_contracts.tenant': tenantId,
      'contract_line_services.service_id': serviceId,
    })
    .where(function withinRange(this: Knex.QueryBuilder) {
      this.where('client_contracts.start_date', '<=', rangeEnd);
    })
    .where(function notExpired(this: Knex.QueryBuilder) {
      this.whereNull('client_contracts.end_date').orWhere('client_contracts.end_date', '>=', rangeStart);
    })
    .where(function notSystemManaged(this: Knex.QueryBuilder) {
      this.whereNull('contracts.is_system_managed_default').orWhere('contracts.is_system_managed_default', false);
    })
    .select(
      'contract_lines.contract_line_id as client_contract_line_id',
      'bucket_config.config_id as bucket_config_id'
    );

  const candidates: ContractLineCandidate[] = rows.map((row) => ({
    client_contract_line_id: String(row.client_contract_line_id),
    bucket_overlay: row.bucket_config_id ? { config_id: String(row.bucket_config_id) } : null,
  }));

  return resolveDeterministicContractLineSelection(candidates);
}

function calculateAnchoredPeriod(
  targetDate: Temporal.PlainDate,
  anchorDate: Temporal.PlainDate,
  frequency: string
): { periodStart: Temporal.PlainDate; periodEnd: Temporal.PlainDate } {
  switch (frequency) {
    case 'monthly': {
      const monthsDiff = targetDate.since(anchorDate, { largestUnit: 'month' }).months;
      const periodStart = anchorDate.add({ months: monthsDiff });
      return {
        periodStart,
        periodEnd: periodStart.add({ months: 1 }).subtract({ days: 1 }),
      };
    }
    case 'quarterly': {
      const monthsDiff = targetDate.since(anchorDate, { largestUnit: 'month' }).months;
      const quartersDiff = Math.floor(monthsDiff / 3);
      const periodStart = anchorDate.add({ months: quartersDiff * 3 });
      return {
        periodStart,
        periodEnd: periodStart.add({ months: 3 }).subtract({ days: 1 }),
      };
    }
    case 'annually': {
      const yearsDiff = targetDate.since(anchorDate, { largestUnit: 'year' }).years;
      const periodStart = anchorDate.add({ years: yearsDiff });
      return {
        periodStart,
        periodEnd: periodStart.add({ years: 1 }).subtract({ days: 1 }),
      };
    }
    default:
      throw new WorkflowTimeDomainError({
        category: 'ActionError',
        code: 'BUCKET_USAGE_PERIOD_ERROR',
        message: `Unsupported billing frequency for bucket usage: ${frequency}`,
        details: { frequency },
      });
  }
}

async function resolveBucketUsagePeriod(params: {
  trx: Knex.Transaction;
  tenantId: string;
  clientId: string;
  contractLineId: string;
  startTimeIso: string;
}): Promise<BucketUsagePeriod | null> {
  const { trx, tenantId, clientId, contractLineId, startTimeIso } = params;
  const targetDate = toPlainDate(startTimeIso);
  const targetDateIso = toISODate(targetDate);

  const matchingBillingCycle = await trx('client_billing_cycles')
    .where({
      tenant: tenantId,
      client_id: clientId,
    })
    .whereNotNull('period_start_date')
    .whereNotNull('period_end_date')
    .andWhere('period_start_date', '<=', targetDateIso)
    .andWhere('period_end_date', '>', targetDateIso)
    .orderBy('period_start_date', 'desc')
    .first<{ period_start_date: string; period_end_date: string }>('period_start_date', 'period_end_date');

  if (matchingBillingCycle) {
    return {
      periodStart: toISODate(toPlainDate(matchingBillingCycle.period_start_date)),
      periodEnd: toISODate(toPlainDate(matchingBillingCycle.period_end_date).subtract({ days: 1 })),
    };
  }

  const contractAssignment = await trx('client_contract_lines as ccl')
    .join('contract_lines as cl', function joinContractLines() {
      this.on('ccl.contract_line_id', '=', 'cl.contract_line_id').andOn('ccl.tenant', '=', 'cl.tenant');
    })
    .where({
      'ccl.tenant': tenantId,
      'ccl.client_id': clientId,
      'ccl.contract_line_id': contractLineId,
      'ccl.is_active': true,
    })
    .andWhere('ccl.start_date', '<=', targetDateIso)
    .andWhere((query) => {
      query.whereNull('ccl.end_date').orWhere('ccl.end_date', '>=', targetDateIso);
    })
    .orderBy('ccl.start_date', 'desc')
    .select('ccl.start_date', 'cl.billing_frequency')
    .first<{ start_date: string; billing_frequency: string }>();

  if (!contractAssignment) {
    return null;
  }

  const anchorDate = toPlainDate(contractAssignment.start_date);
  const { periodStart, periodEnd } = calculateAnchoredPeriod(
    targetDate,
    anchorDate,
    contractAssignment.billing_frequency
  );

  return {
    periodStart: toISODate(periodStart),
    periodEnd: toISODate(periodEnd),
  };
}

async function findOrCreateBucketUsageForEntry(params: {
  trx: Knex.Transaction;
  tenantId: string;
  clientId: string;
  contractLineId: string;
  serviceId: string;
  startTimeIso: string;
}): Promise<string> {
  const { trx, tenantId, clientId, contractLineId, serviceId, startTimeIso } = params;

  const period = await resolveBucketUsagePeriod({
    trx,
    tenantId,
    clientId,
    contractLineId,
    startTimeIso,
  });

  if (!period) {
    throw new WorkflowTimeDomainError({
      category: 'ActionError',
      code: 'BUCKET_USAGE_PERIOD_NOT_FOUND',
      message: 'Unable to determine bucket usage period for time entry',
      details: { client_id: clientId, contract_line_id: contractLineId, service_id: serviceId, start_time: startTimeIso },
    });
  }

  const existing = await trx('bucket_usage')
    .where({
      tenant: tenantId,
      client_id: clientId,
      contract_line_id: contractLineId,
      service_catalog_id: serviceId,
      period_start: period.periodStart,
      period_end: period.periodEnd,
    })
    .select('usage_id')
    .first<{ usage_id: string }>();

  if (existing?.usage_id) {
    return existing.usage_id;
  }

  const [inserted] = await trx('bucket_usage')
    .insert({
      usage_id: uuidv4(),
      tenant: tenantId,
      client_id: clientId,
      contract_line_id: contractLineId,
      service_catalog_id: serviceId,
      period_start: period.periodStart,
      period_end: period.periodEnd,
      minutes_used: 0,
      overage_minutes: 0,
      rolled_over_minutes: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .returning('usage_id');

  return String(inserted.usage_id);
}

async function applyBucketUsageDeltaForEntry(params: {
  trx: Knex.Transaction;
  tenantId: string;
  clientId: string | null;
  contractLineId: string | null;
  serviceId: string;
  startTimeIso: string;
  minutesDelta: number;
}): Promise<void> {
  const { trx, tenantId, clientId, contractLineId, serviceId, startTimeIso, minutesDelta } = params;

  if (!clientId || !contractLineId || minutesDelta === 0) {
    return;
  }

  const overlayConfig = await trx('contract_line_service_configuration as cfg')
    .join('contract_line_service_bucket_config as bucket_cfg', function joinBucketConfig() {
      this.on('cfg.config_id', '=', 'bucket_cfg.config_id').andOn('cfg.tenant', '=', 'bucket_cfg.tenant');
    })
    .where({
      'cfg.tenant': tenantId,
      'cfg.contract_line_id': contractLineId,
      'cfg.service_id': serviceId,
      'cfg.configuration_type': 'Bucket',
    })
    .select('cfg.config_id', 'bucket_cfg.total_minutes')
    .first<{ config_id: string; total_minutes: number }>();

  if (!overlayConfig?.config_id) {
    return;
  }

  const usageId = await findOrCreateBucketUsageForEntry({
    trx,
    tenantId,
    clientId,
    contractLineId,
    serviceId,
    startTimeIso,
  });

  const usageRecord = await trx('bucket_usage')
    .where({ tenant: tenantId, usage_id: usageId })
    .select('minutes_used', 'rolled_over_minutes')
    .first<{ minutes_used: number; rolled_over_minutes: number }>();

  if (!usageRecord) {
    throw new WorkflowTimeDomainError({
      category: 'ActionError',
      code: 'BUCKET_USAGE_NOT_FOUND',
      message: 'Bucket usage record could not be loaded for update',
      details: { usage_id: usageId, contract_line_id: contractLineId, service_id: serviceId },
    });
  }

  const newMinutesUsed = Number(usageRecord.minutes_used ?? 0) + minutesDelta;
  const totalAvailableMinutes = Number(overlayConfig.total_minutes ?? 0) + Number(usageRecord.rolled_over_minutes ?? 0);
  const newOverageMinutes = Math.max(0, newMinutesUsed - totalAvailableMinutes);

  await trx('bucket_usage')
    .where({ tenant: tenantId, usage_id: usageId })
    .update({
      minutes_used: newMinutesUsed,
      overage_minutes: newOverageMinutes,
      updated_at: new Date().toISOString(),
    });
}

async function resolveOrCreateTimeSheet(params: {
  trx: Knex.Transaction;
  tenantId: string;
  userId: string;
  workDate: string;
  startWorkDate: string;
  endWorkDate: string;
  providedTimeSheetId?: string | null;
  attachToTimeSheet: boolean;
}): Promise<string | null> {
  const {
    trx,
    tenantId,
    userId,
    workDate,
    startWorkDate,
    endWorkDate,
    providedTimeSheetId,
    attachToTimeSheet,
  } = params;

  if (providedTimeSheetId) {
    const timeSheet = await trx('time_sheets as ts')
      .join('time_periods as tp', function joinTimePeriods() {
        this.on('ts.period_id', '=', 'tp.period_id').andOn('ts.tenant', '=', 'tp.tenant');
      })
      .where({ 'ts.tenant': tenantId, 'ts.id': providedTimeSheetId })
      .select('ts.id', 'ts.user_id', 'tp.start_date', 'tp.end_date')
      .first();

    if (!timeSheet) {
      throw new WorkflowTimeDomainError({
        category: 'ActionError',
        code: 'NOT_FOUND',
        message: 'Time sheet not found',
        details: { time_sheet_id: providedTimeSheetId },
      });
    }

    if (timeSheet.user_id !== userId) {
      throw new WorkflowTimeDomainError({
        category: 'ValidationError',
        code: 'VALIDATION_ERROR',
        message: 'Time sheet owner must match time entry user',
        details: { time_sheet_id: providedTimeSheetId, user_id: userId },
      });
    }

    const periodStart = toDateOnly(timeSheet.start_date as string | Date);
    const periodEnd = toDateOnly(timeSheet.end_date as string | Date);

    if (startWorkDate < periodStart || startWorkDate >= periodEnd || endWorkDate < periodStart || endWorkDate >= periodEnd) {
      throw new WorkflowTimeDomainError({
        category: 'ValidationError',
        code: 'VALIDATION_ERROR',
        message: 'Time entry must fall within the provided time sheet period',
        details: { time_sheet_id: providedTimeSheetId, period_start: periodStart, period_end: periodEnd },
      });
    }

    return providedTimeSheetId;
  }

  if (!attachToTimeSheet) {
    return null;
  }

  const period = await trx('time_periods')
    .where({ tenant: tenantId, is_closed: false })
    .andWhere('start_date', '<=', workDate)
    .andWhere('end_date', '>', workDate)
    .orderBy('start_date', 'desc')
    .select('period_id')
    .first();

  if (!period?.period_id) {
    throw new WorkflowTimeDomainError({
      category: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'No open time period found for work_date',
      details: { work_date: workDate },
    });
  }

  let timeSheet = await trx('time_sheets')
    .where({ tenant: tenantId, user_id: userId, period_id: period.period_id })
    .select('id')
    .first();

  if (!timeSheet?.id) {
    const inserted = await trx('time_sheets')
      .insert({
        id: uuidv4(),
        tenant: tenantId,
        user_id: userId,
        period_id: period.period_id,
        approval_status: 'DRAFT',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returning('id');

    timeSheet = Array.isArray(inserted) ? inserted[0] : inserted;
  }

  return (timeSheet?.id as string | undefined) ?? null;
}

async function applyTicketAssignmentSideEffects(params: {
  trx: Knex.Transaction;
  tenantId: string;
  actorUserId: string;
  ticketId: string;
  entryUserId: string;
}): Promise<void> {
  const { trx, tenantId, actorUserId, ticketId, entryUserId } = params;

  const existingResource = await trx('ticket_resources')
    .where({ tenant: tenantId, ticket_id: ticketId })
    .where((query) => {
      query.where('assigned_to', entryUserId).orWhere('additional_user_id', entryUserId);
    })
    .first();

  if (existingResource) {
    return;
  }

  const ticket = await trx('tickets')
    .where({ tenant: tenantId, ticket_id: ticketId })
    .select('assigned_to')
    .first();

  if (!ticket) {
    return;
  }

  if (ticket.assigned_to && ticket.assigned_to !== entryUserId) {
    await trx('ticket_resources').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      assigned_to: ticket.assigned_to,
      additional_user_id: entryUserId,
      assigned_at: new Date().toISOString(),
    });
    return;
  }

  if (!ticket.assigned_to) {
    await trx('tickets')
      .where({ tenant: tenantId, ticket_id: ticketId })
      .update({
        assigned_to: entryUserId,
        updated_at: new Date().toISOString(),
        updated_by: actorUserId,
      });
  }
}

async function recalculateProjectTaskActualMinutes(
  trx: Knex.Transaction,
  tenantId: string,
  taskId: string
): Promise<void> {
  const rows = await trx('time_entries')
    .where({ tenant: tenantId, work_item_type: 'project_task', work_item_id: taskId })
    .select('billable_duration');

  const totalMinutes = rows.reduce((acc, row) => acc + Number(row.billable_duration ?? 0), 0);

  await trx('project_tasks')
    .where({ tenant: tenantId, task_id: taskId })
    .update({
      actual_hours: totalMinutes,
      updated_at: new Date().toISOString(),
    });
}

async function applyProjectTaskAssignmentSideEffects(params: {
  trx: Knex.Transaction;
  tenantId: string;
  taskId: string;
  entryUserId: string;
}): Promise<void> {
  const { trx, tenantId, taskId, entryUserId } = params;

  const task = await trx('project_tasks')
    .where({ tenant: tenantId, task_id: taskId })
    .select('assigned_to')
    .first();

  if (!task) {
    return;
  }

  const existingResource = await trx('task_resources')
    .where({ tenant: tenantId, task_id: taskId })
    .where((query) => {
      query.where('assigned_to', entryUserId).orWhere('additional_user_id', entryUserId);
    })
    .first();

  if (task.assigned_to && task.assigned_to !== entryUserId) {
    if (!existingResource) {
      await trx('task_resources').insert({
        tenant: tenantId,
        task_id: taskId,
        assigned_to: task.assigned_to,
        additional_user_id: entryUserId,
        assigned_at: new Date().toISOString(),
      });
    }
    return;
  }

  if (!task.assigned_to) {
    await trx('project_tasks')
      .where({ tenant: tenantId, task_id: taskId })
      .update({
        assigned_to: entryUserId,
        updated_at: new Date().toISOString(),
      });
  }
}

export async function createWorkflowTimeEntry(params: {
  trx: Knex.Transaction;
  tenantId: string;
  actorUserId: string;
  input: WorkflowTimeCreateEntryInput;
}): Promise<WorkflowTimeCreatedEntrySummary> {
  const { trx, tenantId, actorUserId, input } = params;

  const user = await trx('users')
    .where({ tenant: tenantId, user_id: input.user_id })
    .select('user_id')
    .first();

  if (!user) {
    throw new WorkflowTimeDomainError({
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: 'User not found',
      details: { user_id: input.user_id },
    });
  }

  const service = await trx('service_catalog')
    .where({ tenant: tenantId, service_id: input.service_id })
    .select('service_id')
    .first();

  if (!service) {
    throw new WorkflowTimeDomainError({
      category: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'Service is required and must exist',
      details: { service_id: input.service_id },
    });
  }

  const startDate = ensureValidDate(input.start, 'start');
  const endDate = input.end ? ensureValidDate(input.end, 'end') : null;

  if (!endDate && input.duration_minutes === undefined) {
    throw new WorkflowTimeDomainError({
      category: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'Provide end or duration_minutes',
      details: null,
    });
  }

  if (input.duration_minutes !== undefined) {
    assertPositiveOrZeroMinutes(input.duration_minutes, 'duration_minutes');
  }

  const computedEndDate = endDate ?? new Date(startDate.getTime() + (input.duration_minutes as number) * 60 * 1000);
  if (computedEndDate.getTime() < startDate.getTime()) {
    throw new WorkflowTimeDomainError({
      category: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'end must be at or after start',
      details: { start: input.start, end: input.end ?? computedEndDate.toISOString() },
    });
  }

  const totalMinutes = Math.round((computedEndDate.getTime() - startDate.getTime()) / 60000);

  const billableMinutesInput = input.billable_duration_minutes;
  if (billableMinutesInput !== undefined) {
    assertPositiveOrZeroMinutes(billableMinutesInput, 'billable_duration_minutes');
  }

  const billableMinutes = input.billable === false
    ? 0
    : (billableMinutesInput ?? totalMinutes);

  const userTimeZone = await resolveUserTimeZone(trx, tenantId, input.user_id);
  const { work_date, work_timezone } = computeWorkDateFields(startDate.toISOString(), userTimeZone);
  const { work_date: end_work_date } = computeWorkDateFields(computedEndDate.toISOString(), userTimeZone);

  const workItem = await getWorkItemClientContext(trx, tenantId, input.link);

  let contractLineId = input.contract_line_id ?? null;
  if (!contractLineId && workItem.clientId) {
    contractLineId = await determineDefaultContractLineForWorkflow({
      trx,
      tenantId,
      clientId: workItem.clientId,
      serviceId: input.service_id,
      effectiveDate: work_date,
    });
  }

  const timeSheetId = await resolveOrCreateTimeSheet({
    trx,
    tenantId,
    userId: input.user_id,
    workDate: work_date,
    startWorkDate: work_date,
    endWorkDate: end_work_date,
    providedTimeSheetId: input.time_sheet_id,
    attachToTimeSheet: input.attach_to_timesheet !== false,
  });

  const entryId = uuidv4();
  const nowIso = new Date().toISOString();
  const startIso = startDate.toISOString();
  const endIso = computedEndDate.toISOString();

  const inserted = await trx('time_entries')
    .insert({
      tenant: tenantId,
      entry_id: entryId,
      user_id: input.user_id,
      work_item_id: input.link?.id ?? null,
      work_item_type: input.link?.type ?? null,
      service_id: input.service_id,
      contract_line_id: contractLineId,
      tax_rate_id: input.tax_rate_id ?? null,
      start_time: startIso,
      end_time: endIso,
      work_date,
      work_timezone,
      billable_duration: billableMinutes,
      notes: input.notes ?? null,
      approval_status: 'DRAFT',
      time_sheet_id: timeSheetId,
      invoiced: false,
      created_by: actorUserId,
      updated_by: actorUserId,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .returning([
      'entry_id',
      'user_id',
      'work_item_id',
      'work_item_type',
      'service_id',
      'contract_line_id',
      'time_sheet_id',
      'start_time',
      'end_time',
      'billable_duration',
      'work_date',
      'work_timezone',
      'approval_status',
      'invoiced',
      'notes',
    ]);

  const entry = Array.isArray(inserted) ? inserted[0] : inserted;

  if (input.link?.type === 'ticket' && input.link.id) {
    await applyTicketAssignmentSideEffects({
      trx,
      tenantId,
      actorUserId,
      ticketId: input.link.id,
      entryUserId: input.user_id,
    });
  }

  if (input.link?.type === 'project_task' && input.link.id) {
    await recalculateProjectTaskActualMinutes(trx, tenantId, input.link.id);
    await applyProjectTaskAssignmentSideEffects({
      trx,
      tenantId,
      taskId: input.link.id,
      entryUserId: input.user_id,
    });
  }

  await applyBucketUsageDeltaForEntry({
    trx,
    tenantId,
    clientId: workItem.clientId,
    contractLineId: (entry.contract_line_id as string | null) ?? null,
    serviceId: entry.service_id,
    startTimeIso: toIsoString(entry.start_time as string | Date),
    minutesDelta: Number(entry.billable_duration ?? 0),
  });

  return {
    entry_id: entry.entry_id,
    user_id: entry.user_id,
    work_item_id: (entry.work_item_id as string | null) ?? null,
    work_item_type: (entry.work_item_type as string | null) ?? null,
    service_id: entry.service_id,
    contract_line_id: (entry.contract_line_id as string | null) ?? null,
    time_sheet_id: (entry.time_sheet_id as string | null) ?? null,
    start_time: toIsoString(entry.start_time as string | Date),
    end_time: toIsoString(entry.end_time as string | Date),
    total_minutes: totalMinutes,
    billable_minutes: Number(entry.billable_duration ?? 0),
    work_date: toDateOnly(entry.work_date as string | Date),
    work_timezone: String(entry.work_timezone ?? work_timezone),
    approval_status: String(entry.approval_status ?? 'DRAFT'),
    invoiced: Boolean(entry.invoiced),
    notes: (entry.notes as string | null) ?? null,
  };
}
