import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

import type { ScheduleJobResult } from 'server/src/lib/jobs/interfaces/IJobRunner';
import { initializeJobRunner } from 'server/src/lib/jobs/initializeJobRunner';
import type { WorkflowDefinition, WorkflowTimeTrigger } from '@shared/workflow/runtime';
import WorkflowScheduleStateModel, {
  type WorkflowScheduleStateRecord,
  type WorkflowScheduleStateStatus
} from '@shared/workflow/persistence/workflowScheduleStateModel';

export const WORKFLOW_ONE_TIME_TRIGGER_JOB = 'workflow-time-trigger-once';
export const WORKFLOW_RECURRING_TRIGGER_JOB = 'workflow-time-trigger-recurring';

export type DesiredWorkflowSchedule = {
  triggerType: 'schedule' | 'recurring';
  workflowVersion: number;
  runAt?: string | null;
  cron?: string | null;
  timezone?: string | null;
  enabled: boolean;
  status: WorkflowScheduleStateStatus;
};

type WorkflowScheduleJobData = {
  tenantId: string;
  workflowId: string;
  scheduleId: string;
};

const workflowScheduleSingletonKey = (workflowId: string, scheduleId: string): string =>
  `workflow-schedule:${workflowId}:${scheduleId}`;

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed']);

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

async function scheduleDesiredWorkflow(
  tenantId: string,
  workflowId: string,
  scheduleId: string,
  desired: DesiredWorkflowSchedule
): Promise<ScheduleJobResult | null> {
  if (!desired.enabled) return null;

  const runner = await initializeJobRunner();
  const jobData: WorkflowScheduleJobData = {
    tenantId,
    workflowId,
    scheduleId
  };
  const singletonKey = workflowScheduleSingletonKey(workflowId, scheduleId);

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
  const runner = await initializeJobRunner();
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
    status: desired.status
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
        job_id: null,
        runner_schedule_id: null
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
        trigger_type: params.desired.triggerType,
        run_at: params.desired.runAt ?? null,
        cron: params.desired.cron ?? null,
        timezone: params.desired.timezone ?? null,
        enabled: params.desired.enabled,
        status: params.desired.status,
        job_id: scheduled?.jobId ?? null,
        runner_schedule_id: scheduled?.externalId ?? null
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
      status: params.desired.status
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
      trigger_type: params.desired.triggerType,
      run_at: params.desired.runAt ?? null,
      cron: params.desired.cron ?? null,
      timezone: params.desired.timezone ?? null,
      enabled: params.desired.enabled,
      status: params.desired.status,
      job_id: scheduledReplacement?.jobId ?? null,
      runner_schedule_id: scheduledReplacement?.externalId ?? null,
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
  const existing = await WorkflowScheduleStateModel.getByWorkflowId(knex, params.workflowId);
  if (!existing) return;

  await cancelScheduledWorkflow(params.tenantId, existing);
  await WorkflowScheduleStateModel.deleteByWorkflowId(knex, params.workflowId);
}
