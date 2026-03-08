import {
  WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF,
  type WorkflowClockTriggerPayload
} from '@shared/workflow/runtime';
import WorkflowScheduleStateModel from '@shared/workflow/persistence/workflowScheduleStateModel';
import { createTenantKnex } from 'server/src/lib/db';
import type { BaseJobData } from '../interfaces';
import { launchPublishedWorkflowRun } from 'server/src/lib/workflow-runtime-v2/workflowRunLauncher';

export interface WorkflowScheduledRunJobData extends BaseJobData {
  workflowId: string;
  scheduleId: string;
}

const buildClockPayload = (params: {
  scheduleId: string;
  workflowId: string;
  workflowVersion: number;
  triggerType: 'schedule' | 'recurring';
  runAt?: string | null;
  cron?: string | null;
  timezone?: string | null;
}): WorkflowClockTriggerPayload => {
  const firedAt = new Date().toISOString();
  return {
    triggerType: params.triggerType,
    scheduleId: params.scheduleId,
    scheduledFor: params.runAt ?? firedAt,
    firedAt,
    timezone: params.timezone ?? 'UTC',
    workflowId: params.workflowId,
    workflowVersion: params.workflowVersion,
    ...(params.triggerType === 'recurring' && params.cron ? { cron: params.cron } : {})
  };
};

async function runScheduledWorkflow(
  expectedTriggerType: 'schedule' | 'recurring',
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

  const payload = buildClockPayload({
    scheduleId: schedule.id,
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
      sourcePayloadSchemaRef: WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF,
      execute: true,
      executionKey: `${expectedTriggerType}-${schedule.id}-${Date.now()}`
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
          status: schedule.status
        };

    await WorkflowScheduleStateModel.update(knex, schedule.id, {
      last_fire_at: payload.firedAt,
      last_run_status: 'success',
      last_error: null,
      ...successState
    });
  } catch (error) {
    await WorkflowScheduleStateModel.update(knex, schedule.id, {
      last_fire_at: payload.firedAt,
      last_run_status: 'error',
      last_error: error instanceof Error ? error.message : String(error)
    }).catch(() => undefined);
    throw error;
  }
}

export async function workflowOneTimeScheduledRunHandler(
  _jobId: string,
  data: WorkflowScheduledRunJobData
): Promise<void> {
  await runScheduledWorkflow('schedule', data);
}

export async function workflowRecurringScheduledRunHandler(
  _jobId: string,
  data: WorkflowScheduledRunJobData
): Promise<void> {
  await runScheduledWorkflow('recurring', data);
}
