import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

import type { WorkflowDefinition, WorkflowTimeTrigger } from '@alga-psa/workflows/runtime';
import {
  WorkflowScheduleStateModel,
  type WorkflowScheduleStateRecord,
  type WorkflowScheduleStateStatus
} from '@alga-psa/workflows/persistence';
import {
  getWorkflowScheduleJobRunner,
  type WorkflowScheduleJobResult as ScheduleJobResult
} from './jobRunnerProvider';
import { computeNextFireAtForSchedule } from './computeNextFireAt';

export const WORKFLOW_ONE_TIME_TRIGGER_JOB = 'workflow-time-trigger-once';
export const WORKFLOW_RECURRING_TRIGGER_JOB = 'workflow-time-trigger-recurring';
const LEGACY_INLINE_SCHEDULE_NAME = 'Workflow schedule';

export type DesiredWorkflowSchedule = {
  triggerType: 'schedule' | 'recurring';
  workflowVersion: number;
  runAt?: string | null;
  cron?: string | null;
  timezone?: string | null;
  enabled: boolean;
  status: WorkflowScheduleStateStatus;
};

export type PersistedWorkflowScheduleFields = {
  workflowId: string;
  name: string;
  payloadJson: Record<string, unknown> | unknown[];
  desired: DesiredWorkflowSchedule;
};

export type WorkflowSchedulePayloadValidationResult =
  | { ok: true }
  | { ok: false; message: string };

type WorkflowScheduleJobData = {
  tenantId: string;
  workflowId: string;
  scheduleId: string;
};

export const buildWorkflowScheduleSingletonKey = (workflowId: string, scheduleId: string): string =>
  `workflow-schedule:${workflowId}:${scheduleId}`;

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed']);

const computeNextFireAtForDesired = (desired: DesiredWorkflowSchedule): string | null =>
  computeNextFireAtForSchedule({
    triggerType: desired.triggerType,
    cron: desired.cron,
    timezone: desired.timezone,
    enabled: desired.enabled
  });

const isTimeTriggerDefinition = (trigger: WorkflowDefinition['trigger']): trigger is WorkflowTimeTrigger =>
  trigger?.type === 'schedule' || trigger?.type === 'recurring';

const toDesiredScheduleStatus = (enabled: boolean): WorkflowScheduleStateStatus =>
  enabled ? 'scheduled' : 'paused';

const hasSameRunnerConfiguration = (
  existing: WorkflowScheduleStateRecord,
  desired: DesiredWorkflowSchedule
): boolean => (
  existing.trigger_type === desired.triggerType &&
  (existing.run_at ?? null) === (desired.runAt ?? null) &&
  (existing.cron ?? null) === (desired.cron ?? null) &&
  (existing.timezone ?? null) === (desired.timezone ?? null) &&
  Boolean(existing.enabled) === Boolean(desired.enabled)
);

const buildRestoreDesiredSchedule = (
  existing: WorkflowScheduleStateRecord
): DesiredWorkflowSchedule | null => {
  if (existing.trigger_type === 'schedule' && !existing.run_at) return null;
  if (existing.trigger_type === 'recurring' && !existing.cron) return null;
  return {
    triggerType: existing.trigger_type,
    workflowVersion: existing.workflow_version,
    runAt: existing.run_at ?? null,
    cron: existing.cron ?? null,
    timezone: existing.timezone ?? null,
    enabled: Boolean(existing.enabled),
    status: existing.status
  };
};

const buildDesiredScheduleFromExisting = (
  existing: WorkflowScheduleStateRecord,
  enabled: boolean = Boolean(existing.enabled)
): DesiredWorkflowSchedule | null => {
  if (existing.trigger_type === 'schedule' && !existing.run_at) return null;
  if (existing.trigger_type === 'recurring' && !existing.cron) return null;
  return {
    triggerType: existing.trigger_type,
    workflowVersion: existing.workflow_version,
    runAt: existing.run_at ?? null,
    cron: existing.cron ?? null,
    timezone: existing.timezone ?? null,
    enabled,
    status: toDesiredScheduleStatus(enabled)
  };
};

const buildDesiredScheduleForPublishedWorkflowVersion = (
  existing: WorkflowScheduleStateRecord,
  workflowVersion: number
): DesiredWorkflowSchedule | null => {
  if (existing.trigger_type === 'schedule' && !existing.run_at) return null;
  if (existing.trigger_type === 'recurring' && !existing.cron) return null;

  const enabled = Boolean(existing.enabled);
  const status: WorkflowScheduleStateStatus =
    existing.status === 'completed'
      ? 'completed'
      : existing.status === 'disabled'
        ? 'disabled'
        : enabled
          ? 'scheduled'
          : 'paused';

  return {
    triggerType: existing.trigger_type,
    workflowVersion,
    runAt: existing.run_at ?? null,
    cron: existing.cron ?? null,
    timezone: existing.timezone ?? null,
    enabled,
    status
  };
};

async function scheduleDesiredWorkflow(
  tenantId: string,
  workflowId: string,
  scheduleId: string,
  desired: DesiredWorkflowSchedule
): Promise<ScheduleJobResult | null> {
  if (!desired.enabled) return null;

  const runner = await getWorkflowScheduleJobRunner();
  const jobData: WorkflowScheduleJobData = {
    tenantId,
    workflowId,
    scheduleId
  };
  const singletonKey = buildWorkflowScheduleSingletonKey(workflowId, scheduleId);

  if (desired.triggerType === 'schedule') {
    const runAt = desired.runAt ? new Date(desired.runAt) : null;
    if (!runAt || Number.isNaN(runAt.getTime())) {
      throw new Error('Cannot schedule one-time workflow without a valid runAt value');
    }
    return runner.scheduleJobAt(
      WORKFLOW_ONE_TIME_TRIGGER_JOB,
      jobData,
      runAt,
      {
        singletonKey,
        metadata: {
          kind: 'workflow_schedule',
          scheduleId,
          workflowId,
          triggerType: desired.triggerType
        }
      }
    );
  }

  return runner.scheduleRecurringJob(
    WORKFLOW_RECURRING_TRIGGER_JOB,
    jobData,
    desired.cron ?? '',
    {
      singletonKey,
      metadata: {
        kind: 'workflow_schedule',
        scheduleId,
        workflowId,
        triggerType: desired.triggerType,
        timezone: desired.timezone ?? 'UTC'
      }
    }
  );
}

async function cancelScheduledWorkflow(
  tenantId: string,
  existing: Pick<WorkflowScheduleStateRecord, 'job_id'>
): Promise<void> {
  const jobId = existing.job_id ? String(existing.job_id) : '';
  if (!jobId) return;
  const runner = await getWorkflowScheduleJobRunner();
  const cancelled = await runner.cancelJob(jobId, tenantId);
  if (cancelled) return;

  const current = await runner.getJobStatus(jobId, tenantId).catch(() => null);
  if (!current || TERMINAL_JOB_STATUSES.has(String(current.status).toLowerCase())) {
    return;
  }

  throw new Error('Failed to cancel existing workflow schedule');
}

async function restorePreviousScheduleRegistration(
  knex: Knex,
  existing: WorkflowScheduleStateRecord
): Promise<void> {
  if (!existing.enabled) return;
  const desired = buildRestoreDesiredSchedule(existing);
  if (!desired) return;

  const restored = await scheduleDesiredWorkflow(existing.tenant_id, existing.workflow_id, existing.id, desired);
  await WorkflowScheduleStateModel.update(knex, existing.id, {
    job_id: restored?.jobId ?? null,
    runner_schedule_id: restored?.externalId ?? null,
    enabled: true,
    status: desired.status,
    next_fire_at: computeNextFireAtForDesired(desired)
  });
}

async function persistScheduleCreate(
  knex: Knex,
  params: {
    tenantId: string;
    scheduleId: string;
    record: PersistedWorkflowScheduleFields;
    scheduled: ScheduleJobResult | null;
  }
): Promise<WorkflowScheduleStateRecord> {
  return WorkflowScheduleStateModel.create(knex, {
    id: params.scheduleId,
    tenant_id: params.tenantId,
    workflow_id: params.record.workflowId,
    workflow_version: params.record.desired.workflowVersion,
    name: params.record.name,
    trigger_type: params.record.desired.triggerType,
    run_at: params.record.desired.runAt ?? null,
    cron: params.record.desired.cron ?? null,
    timezone: params.record.desired.timezone ?? null,
    payload_json: params.record.payloadJson,
    enabled: params.record.desired.enabled,
    status: params.record.desired.status,
    job_id: params.scheduled?.jobId ?? null,
    runner_schedule_id: params.scheduled?.externalId ?? null,
    next_fire_at: computeNextFireAtForDesired(params.record.desired),
    last_error: null
  });
}

async function persistScheduleUpdate(
  knex: Knex,
  params: {
    existing: WorkflowScheduleStateRecord;
    record: PersistedWorkflowScheduleFields;
    scheduled: ScheduleJobResult | null;
  }
): Promise<WorkflowScheduleStateRecord> {
  return WorkflowScheduleStateModel.update(knex, params.existing.id, {
    workflow_id: params.record.workflowId,
    workflow_version: params.record.desired.workflowVersion,
    name: params.record.name,
    trigger_type: params.record.desired.triggerType,
    run_at: params.record.desired.runAt ?? null,
    cron: params.record.desired.cron ?? null,
    timezone: params.record.desired.timezone ?? null,
    payload_json: params.record.payloadJson,
    enabled: params.record.desired.enabled,
    status: params.record.desired.status,
    job_id: params.scheduled?.jobId ?? null,
    runner_schedule_id: params.scheduled?.externalId ?? null,
    next_fire_at: computeNextFireAtForDesired(params.record.desired),
    last_error: null
  });
}

export function buildDesiredWorkflowSchedule(
  definition: WorkflowDefinition,
  workflowVersion: number,
  enabled: boolean
): DesiredWorkflowSchedule | null {
  if (!isTimeTriggerDefinition(definition.trigger)) return null;

  if (definition.trigger.type === 'schedule') {
    return {
      triggerType: 'schedule',
      workflowVersion,
      runAt: definition.trigger.runAt,
      enabled,
      status: toDesiredScheduleStatus(enabled)
    };
  }

  return {
    triggerType: 'recurring',
    workflowVersion,
    cron: definition.trigger.cron,
    timezone: definition.trigger.timezone,
    enabled,
    status: toDesiredScheduleStatus(enabled)
  };
}

export async function createExternalWorkflowScheduleState(
  knex: Knex,
  params: {
    tenantId: string;
    record: PersistedWorkflowScheduleFields;
  }
): Promise<WorkflowScheduleStateRecord> {
  const scheduleId = uuidv4();
  const scheduled = await scheduleDesiredWorkflow(
    params.tenantId,
    params.record.workflowId,
    scheduleId,
    params.record.desired
  );

  try {
    return await persistScheduleCreate(knex, {
      tenantId: params.tenantId,
      scheduleId,
      record: params.record,
      scheduled
    });
  } catch (error) {
    if (scheduled?.jobId) {
      await cancelScheduledWorkflow(params.tenantId, { job_id: scheduled.jobId }).catch(() => undefined);
    }
    throw error;
  }
}

export async function updateExternalWorkflowScheduleState(
  knex: Knex,
  params: {
    tenantId: string;
    scheduleId: string;
    record: PersistedWorkflowScheduleFields;
  }
): Promise<WorkflowScheduleStateRecord> {
  const existing = await WorkflowScheduleStateModel.getById(knex, params.scheduleId);
  if (!existing) {
    throw new Error('Workflow schedule not found');
  }

  const runnerConfigUnchanged =
    existing.workflow_id === params.record.workflowId &&
    hasSameRunnerConfiguration(existing, params.record.desired);

  if (runnerConfigUnchanged) {
    return persistScheduleUpdate(knex, {
      existing,
      record: params.record,
      scheduled: existing.job_id
        ? {
            jobId: existing.job_id,
            externalId: existing.runner_schedule_id ?? null
          }
        : null
    });
  }

  const existingSnapshot = { ...existing };
  const needsCancellation = Boolean(existing.job_id);
  let scheduledReplacement: ScheduleJobResult | null = null;

  if (needsCancellation) {
    await cancelScheduledWorkflow(params.tenantId, existing);
  }

  try {
    scheduledReplacement = await scheduleDesiredWorkflow(
      params.tenantId,
      params.record.workflowId,
      existing.id,
      params.record.desired
    );
  } catch (error) {
    if (needsCancellation) {
      await restorePreviousScheduleRegistration(knex, existingSnapshot).catch(() => undefined);
    }
    throw error;
  }

  try {
    return await persistScheduleUpdate(knex, {
      existing,
      record: params.record,
      scheduled: scheduledReplacement
    });
  } catch (error) {
    if (scheduledReplacement?.jobId) {
      await cancelScheduledWorkflow(params.tenantId, { job_id: scheduledReplacement.jobId }).catch(() => undefined);
    }
    if (needsCancellation) {
      await restorePreviousScheduleRegistration(knex, existingSnapshot).catch(async () => {
        await WorkflowScheduleStateModel.update(knex, existing.id, {
          enabled: false,
          status: 'failed',
          job_id: null,
          runner_schedule_id: null,
          last_error: 'Failed to restore workflow schedule after persistence failure'
        }).catch(() => undefined);
      });
    }
    throw error;
  }
}

export async function setExternalWorkflowScheduleEnabled(
  knex: Knex,
  params: {
    tenantId: string;
    scheduleId: string;
    enabled: boolean;
  }
): Promise<WorkflowScheduleStateRecord> {
  const existing = await WorkflowScheduleStateModel.getById(knex, params.scheduleId);
  if (!existing) {
    throw new Error('Workflow schedule not found');
  }

  const desired = buildDesiredScheduleFromExisting(existing, params.enabled);
  if (!desired) {
    throw new Error('Workflow schedule is missing required timing details');
  }

  return updateExternalWorkflowScheduleState(knex, {
    tenantId: params.tenantId,
    scheduleId: existing.id,
    record: {
      workflowId: existing.workflow_id,
      name: existing.name,
      payloadJson: (existing.payload_json ?? {}) as Record<string, unknown> | unknown[],
      desired
    }
  });
}

export async function deleteWorkflowScheduleStateById(
  knex: Knex,
  params: {
    tenantId: string;
    scheduleId: string;
  }
): Promise<void> {
  const existing = await WorkflowScheduleStateModel.getById(knex, params.scheduleId);
  if (!existing) return;

  await cancelScheduledWorkflow(params.tenantId, existing);
  await WorkflowScheduleStateModel.deleteById(knex, params.scheduleId);
}

export async function revalidateExternalWorkflowSchedulesForPublishedVersion(
  knex: Knex,
  params: {
    tenantId: string;
    workflowId: string;
    workflowVersion: number;
    validatePayload: (
      payload: Record<string, unknown> | unknown[]
    ) => Promise<WorkflowSchedulePayloadValidationResult> | WorkflowSchedulePayloadValidationResult;
  }
): Promise<{
  validScheduleIds: string[];
  invalidScheduleIds: string[];
}> {
  const schedules = await WorkflowScheduleStateModel.listByWorkflowId(knex, params.workflowId);
  const validScheduleIds: string[] = [];
  const invalidScheduleIds: string[] = [];

  for (const schedule of schedules) {
    const payload = (schedule.payload_json ?? {}) as Record<string, unknown> | unknown[];
    const validation = await params.validatePayload(payload);

    if (validation.ok === false) {
      await cancelScheduledWorkflow(params.tenantId, schedule).catch(() => undefined);
      await WorkflowScheduleStateModel.update(knex, schedule.id, {
        enabled: false,
        status: 'failed',
        job_id: null,
        runner_schedule_id: null,
        last_error: validation.message
      });
      invalidScheduleIds.push(schedule.id);
      continue;
    }

    const desired = buildDesiredScheduleForPublishedWorkflowVersion(schedule, params.workflowVersion);
    if (!desired) {
      await cancelScheduledWorkflow(params.tenantId, schedule).catch(() => undefined);
      await WorkflowScheduleStateModel.update(knex, schedule.id, {
        enabled: false,
        status: 'failed',
        job_id: null,
        runner_schedule_id: null,
        last_error: 'Workflow schedule is missing required timing details'
      });
      invalidScheduleIds.push(schedule.id);
      continue;
    }

    await updateExternalWorkflowScheduleState(knex, {
      tenantId: params.tenantId,
      scheduleId: schedule.id,
      record: {
        workflowId: schedule.workflow_id,
        name: schedule.name,
        payloadJson: payload,
        desired
      }
    });
    validScheduleIds.push(schedule.id);
  }

  return { validScheduleIds, invalidScheduleIds };
}

export async function syncWorkflowScheduleState(
  knex: Knex,
  params: {
    tenantId: string;
    workflowId: string;
    desired: DesiredWorkflowSchedule | null;
  }
): Promise<WorkflowScheduleStateRecord | null> {
  const existing = await WorkflowScheduleStateModel.getByWorkflowId(knex, params.workflowId);

  if (!params.desired) {
    if (!existing) return null;

    await cancelScheduledWorkflow(params.tenantId, existing);
    try {
      return await WorkflowScheduleStateModel.update(knex, existing.id, {
        enabled: false,
        status: 'disabled',
        name: existing.name ?? LEGACY_INLINE_SCHEDULE_NAME,
        job_id: null,
        runner_schedule_id: null,
        next_fire_at: null
      });
    } catch (error) {
      await restorePreviousScheduleRegistration(knex, existing).catch(() => undefined);
      throw error;
    }
  }

  if (!existing) {
    const scheduleId = uuidv4();
    const scheduled = await scheduleDesiredWorkflow(params.tenantId, params.workflowId, scheduleId, params.desired);
    try {
      return await WorkflowScheduleStateModel.create(knex, {
        id: scheduleId,
        tenant_id: params.tenantId,
        workflow_id: params.workflowId,
        workflow_version: params.desired.workflowVersion,
        name: LEGACY_INLINE_SCHEDULE_NAME,
        trigger_type: params.desired.triggerType,
        run_at: params.desired.runAt ?? null,
        cron: params.desired.cron ?? null,
        timezone: params.desired.timezone ?? null,
        payload_json: {},
        enabled: params.desired.enabled,
        status: params.desired.status,
        job_id: scheduled?.jobId ?? null,
        runner_schedule_id: scheduled?.externalId ?? null,
        next_fire_at: computeNextFireAtForDesired(params.desired)
      });
    } catch (error) {
      if (scheduled?.jobId) {
        await cancelScheduledWorkflow(params.tenantId, { job_id: scheduled.jobId }).catch(() => undefined);
      }
      throw error;
    }
  }

  if (hasSameRunnerConfiguration(existing, params.desired)) {
    return WorkflowScheduleStateModel.update(knex, existing.id, {
      workflow_version: params.desired.workflowVersion,
      name: existing.name ?? LEGACY_INLINE_SCHEDULE_NAME,
      status: params.desired.status,
      next_fire_at: computeNextFireAtForDesired(params.desired)
    });
  }

  const existingSnapshot = { ...existing };
  const needsCancellation = Boolean(existing.job_id);
  let scheduledReplacement: ScheduleJobResult | null = null;

  if (needsCancellation) {
    await cancelScheduledWorkflow(params.tenantId, existing);
  }

  try {
    scheduledReplacement = await scheduleDesiredWorkflow(
      params.tenantId,
      params.workflowId,
      existing.id,
      params.desired
    );
  } catch (error) {
    if (needsCancellation) {
      await restorePreviousScheduleRegistration(knex, existingSnapshot).catch(() => undefined);
    }
    throw error;
  }

  try {
    return await WorkflowScheduleStateModel.update(knex, existing.id, {
      workflow_version: params.desired.workflowVersion,
      name: existing.name ?? LEGACY_INLINE_SCHEDULE_NAME,
      trigger_type: params.desired.triggerType,
      run_at: params.desired.runAt ?? null,
      cron: params.desired.cron ?? null,
      timezone: params.desired.timezone ?? null,
      payload_json: existing.payload_json ?? {},
      enabled: params.desired.enabled,
      status: params.desired.status,
      job_id: scheduledReplacement?.jobId ?? null,
      runner_schedule_id: scheduledReplacement?.externalId ?? null,
      next_fire_at: computeNextFireAtForDesired(params.desired),
      last_error: null
    });
  } catch (error) {
    if (scheduledReplacement?.jobId) {
      await cancelScheduledWorkflow(params.tenantId, { job_id: scheduledReplacement.jobId }).catch(() => undefined);
    }
    if (needsCancellation) {
      await restorePreviousScheduleRegistration(knex, existingSnapshot).catch(async () => {
        await WorkflowScheduleStateModel.update(knex, existing.id, {
          enabled: false,
          status: 'failed',
          job_id: null,
          runner_schedule_id: null,
          last_error: 'Failed to restore workflow schedule after persistence failure'
        }).catch(() => undefined);
      });
    }
    throw error;
  }
}

export async function deleteWorkflowScheduleState(
  knex: Knex,
  params: { tenantId: string; workflowId: string }
): Promise<void> {
  const existing = await WorkflowScheduleStateModel.listByWorkflowId(knex, params.workflowId);
  if (!existing.length) return;

  for (const schedule of existing) {
    await cancelScheduledWorkflow(params.tenantId, schedule);
  }
  await WorkflowScheduleStateModel.deleteByWorkflowId(knex, params.workflowId);
}
