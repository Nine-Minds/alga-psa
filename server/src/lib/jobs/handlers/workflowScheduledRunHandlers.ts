import { WorkflowScheduleStateModel } from '@alga-psa/workflows/persistence';
import { computeNextFireAtForSchedule } from '@alga-psa/workflows/lib/computeNextFireAt';
import { createTenantKnex } from 'server/src/lib/db';
import { launchPublishedWorkflowRun } from '@alga-psa/workflows/lib/workflowRunLauncher';
import type { BaseJobData } from '../interfaces';

export interface WorkflowScheduledRunJobData extends BaseJobData {
  workflowId: string;
  scheduleId: string;
}

const buildWorkflowScheduleFireKey = (scheduleId: string, jobId: string): string =>
  `workflow-schedule-fire:${scheduleId}:${jobId}`;

const toIsoDateTime = (value: unknown): string | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
};

const buildScheduleTriggerMetadata = (params: {
  scheduleId: string;
  scheduleName: string;
  workflowId: string;
  workflowVersion: number;
  triggerType: 'schedule' | 'recurring';
  runAt?: string | null;
  cron?: string | null;
  timezone?: string | null;
}) => {
  const firedAt = new Date().toISOString();
  const scheduledFor = toIsoDateTime(params.runAt) ?? firedAt;
  return {
    triggerType: params.triggerType,
    scheduleId: params.scheduleId,
    scheduleName: params.scheduleName,
    scheduledFor,
    firedAt,
    timezone: params.timezone ?? 'UTC',
    workflowId: params.workflowId,
    workflowVersion: params.workflowVersion,
    ...(params.triggerType === 'recurring' && params.cron ? { cron: params.cron } : {})
  };
};

async function runScheduledWorkflow(
  expectedTriggerType: 'schedule' | 'recurring',
  jobId: string,
  data: WorkflowScheduledRunJobData
): Promise<void> {
  const { knex, tenant } = await createTenantKnex(data.tenantId);
  const schedule = await WorkflowScheduleStateModel.getById(knex, data.scheduleId);
  if (!schedule || schedule.workflow_id !== data.workflowId || schedule.tenant_id !== tenant) {
    return;
  }
  if (!schedule.enabled || schedule.trigger_type !== expectedTriggerType) {
    return;
  }

  const fireExecutionId =
    typeof data.jobExecutionId === 'string' && data.jobExecutionId.trim().length > 0
      ? data.jobExecutionId.trim()
      : jobId;
  const fireKey = buildWorkflowScheduleFireKey(schedule.id, fireExecutionId);
  if (schedule.last_fire_key === fireKey && schedule.last_run_status === 'success') {
    return;
  }

  const payload = (schedule.payload_json ?? {}) as Record<string, unknown>;
  const triggerMetadata = buildScheduleTriggerMetadata({
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    workflowId: schedule.workflow_id,
    workflowVersion: schedule.workflow_version,
    triggerType: schedule.trigger_type,
    runAt: schedule.run_at,
    cron: schedule.cron,
    timezone: schedule.timezone
  });

  try {
    await launchPublishedWorkflowRun(knex, {
      workflowId: schedule.workflow_id,
      workflowVersion: schedule.workflow_version,
      tenantId: tenant,
      payload,
      triggerType: schedule.trigger_type,
      triggerMetadata: {
        ...triggerMetadata,
        fireKey
      },
      triggerFireKey: fireKey,
      execute: true,
      executionKey: fireKey
    });

    const successState = schedule.trigger_type === 'schedule'
      ? {
          enabled: false,
          status: 'completed' as const,
          job_id: null,
          runner_schedule_id: null,
          next_fire_at: null
        }
      : {
          status: schedule.status,
          next_fire_at: computeNextFireAtForSchedule(schedule)
        };

    await WorkflowScheduleStateModel.update(knex, schedule.id, {
      last_fire_at: triggerMetadata.firedAt,
      last_run_status: 'success',
      last_error: null,
      last_fire_key: fireKey,
      ...successState
    });
  } catch (error) {
    await WorkflowScheduleStateModel.update(knex, schedule.id, {
      last_fire_at: triggerMetadata.firedAt,
      last_run_status: 'error',
      last_error: error instanceof Error ? error.message : String(error),
      last_fire_key: fireKey
    }).catch(() => undefined);
    throw error;
  }
}

export async function workflowOneTimeScheduledRunHandler(
  jobId: string,
  data: WorkflowScheduledRunJobData
): Promise<void> {
  await runScheduledWorkflow('schedule', jobId, data);
}

export async function workflowRecurringScheduledRunHandler(
  jobId: string,
  data: WorkflowScheduledRunJobData
): Promise<void> {
  await runScheduledWorkflow('recurring', jobId, data);
}
