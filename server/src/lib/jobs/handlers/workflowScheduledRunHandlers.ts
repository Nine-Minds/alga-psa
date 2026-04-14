import { WorkflowScheduleStateModel } from '@alga-psa/workflows/persistence';
import { computeNextFireAtForSchedule } from '@alga-psa/workflows/lib/computeNextFireAt';
import {
  isWorkflowOccurrenceEligible,
  normalizeWorkflowDayTypeFilter,
  resolveWorkflowBusinessDaySettings
} from '@alga-psa/workflows/lib/workflowBusinessDayScheduling';
import { createTenantKnex } from 'server/src/lib/db';
import { launchPublishedWorkflowRun } from '@alga-psa/workflows/lib/workflowRunLauncher';
import { getJobRunner } from 'server/src/lib/jobs/JobRunnerFactory';
import type { BaseJobData } from '../interfaces';

export interface WorkflowScheduledRunJobData extends BaseJobData {
  workflowId: string;
  scheduleId: string;
}

const buildWorkflowScheduleFireKey = (scheduleId: string, jobId: string): string =>
  `workflow-schedule-fire:${scheduleId}:${jobId}`;

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed']);

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
  scheduledFor?: string | null;
  cron?: string | null;
  timezone?: string | null;
}) => {
  const firedAt = new Date().toISOString();
  const scheduledFor = toIsoDateTime(params.scheduledFor) ?? firedAt;
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

const cancelRecurringWorkflowScheduleRegistration = async (
  jobId: string | null | undefined,
  tenantId: string
): Promise<void> => {
  const stableJobId = typeof jobId === 'string' ? jobId.trim() : '';
  if (!stableJobId) return;

  const runner = await getJobRunner();
  const cancelled = await runner.cancelJob(stableJobId, tenantId);
  if (cancelled) return;

  const current = await runner.getJobStatus(stableJobId, tenantId).catch(() => null);
  if (!current || TERMINAL_JOB_STATUSES.has(String(current.status).toLowerCase())) {
    return;
  }

  throw new Error('Failed to cancel recurring workflow schedule after calendar resolution error');
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
  const scheduledOccurrenceIso = (
    schedule.trigger_type === 'schedule'
      ? toIsoDateTime(schedule.run_at)
      : (toIsoDateTime(data.jobScheduledAt) ?? new Date().toISOString())
  );
  const triggerMetadata = buildScheduleTriggerMetadata({
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    workflowId: schedule.workflow_id,
    workflowVersion: schedule.workflow_version,
    triggerType: schedule.trigger_type,
    scheduledFor: scheduledOccurrenceIso,
    cron: schedule.cron,
    timezone: schedule.timezone
  });

  if (schedule.trigger_type === 'recurring') {
    const dayTypeFilter = normalizeWorkflowDayTypeFilter(schedule.day_type_filter);
    const resolvedBusinessDaySettings = await resolveWorkflowBusinessDaySettings(knex, {
      tenantId: tenant,
      dayTypeFilter,
      businessHoursScheduleId: schedule.business_hours_schedule_id ?? null
    });

    if (resolvedBusinessDaySettings.ok === false) {
      const { issue } = resolvedBusinessDaySettings;
      try {
        await cancelRecurringWorkflowScheduleRegistration(schedule.job_id, tenant);
      } catch (cancelError) {
        const cancellationMessage = cancelError instanceof Error ? cancelError.message : String(cancelError);
        await WorkflowScheduleStateModel.update(knex, schedule.id, {
          last_fire_at: triggerMetadata.firedAt,
          last_run_status: 'error',
          last_error: `${issue.message} (${cancellationMessage})`,
          last_fire_key: fireKey
        }).catch(() => undefined);
        throw cancelError;
      }

      await WorkflowScheduleStateModel.update(knex, schedule.id, {
        enabled: false,
        status: 'failed',
        job_id: null,
        runner_schedule_id: null,
        next_fire_at: null,
        last_fire_at: triggerMetadata.firedAt,
        last_run_status: 'error',
        last_error: issue.message,
        last_fire_key: fireKey
      });
      return;
    }

    const occurrenceIsoForClassification = scheduledOccurrenceIso ?? triggerMetadata.scheduledFor;
    const isEligible = isWorkflowOccurrenceEligible({
      dayTypeFilter,
      occurrence: new Date(occurrenceIsoForClassification),
      occurrenceTimezone: schedule.timezone ?? 'UTC',
      resolution: resolvedBusinessDaySettings.value
    });
    if (!isEligible) {
      await WorkflowScheduleStateModel.update(knex, schedule.id, {
        last_fire_at: triggerMetadata.firedAt,
        last_run_status: 'skipped',
        last_error: null,
        last_fire_key: fireKey,
        next_fire_at: computeNextFireAtForSchedule(schedule)
      });
      return;
    }
  }

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
