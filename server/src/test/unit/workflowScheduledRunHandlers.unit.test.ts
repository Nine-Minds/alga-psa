import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF,
  getSchemaRegistry,
  initializeWorkflowRuntimeV2
} from '@shared/workflow/runtime';

type ScheduleRecord = Record<string, any> | null;

let scheduleRecord: ScheduleRecord = null;

const knexMock = {};
const launchPublishedWorkflowRun = vi.fn();
const updateScheduleState = vi.fn();

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(async (tenantId: string) => ({ knex: knexMock, tenant: tenantId }))
}));

vi.mock('@shared/workflow/persistence/workflowScheduleStateModel', () => ({
  default: {
    getById: vi.fn(async (_knex: unknown, scheduleId: string) => (
      scheduleRecord?.id === scheduleId ? scheduleRecord : null
    )),
    update: vi.fn(async (_knex: unknown, scheduleId: string, data: Record<string, unknown>) => {
      if (!scheduleRecord || scheduleRecord.id !== scheduleId) {
        throw new Error('Schedule not found');
      }
      scheduleRecord = {
        ...scheduleRecord,
        ...data
      };
      updateScheduleState(scheduleId, data);
      return scheduleRecord;
    })
  }
}));

vi.mock('server/src/lib/workflow-runtime-v2/workflowRunLauncher', () => ({
  launchPublishedWorkflowRun: (...args: unknown[]) => launchPublishedWorkflowRun(...args)
}));

import {
  workflowOneTimeScheduledRunHandler,
  workflowRecurringScheduledRunHandler
} from 'server/src/lib/jobs/handlers/workflowScheduledRunHandlers';

describe('Workflow scheduled run handlers', () => {
  beforeEach(() => {
    scheduleRecord = null;
    initializeWorkflowRuntimeV2();
    launchPublishedWorkflowRun.mockReset();
    launchPublishedWorkflowRun.mockResolvedValue({ runId: 'run-1', workflowVersion: 4 });
    updateScheduleState.mockReset();
  });

  it('T008/T026/T035/T037/T038/T043: one-time handler emits the fixed contract, marks the schedule completed, and ignores repeat delivery', async () => {
    scheduleRecord = {
      id: 'schedule-1',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      workflow_version: 4,
      trigger_type: 'schedule',
      run_at: '2026-03-08T14:00:00.000Z',
      cron: null,
      timezone: 'America/New_York',
      enabled: true,
      status: 'scheduled'
    };

    await workflowOneTimeScheduledRunHandler('job-1', {
      tenantId: 'tenant-1',
      workflowId: 'workflow-1',
      scheduleId: 'schedule-1'
    });

    await workflowOneTimeScheduledRunHandler('job-1', {
      tenantId: 'tenant-1',
      workflowId: 'workflow-1',
      scheduleId: 'schedule-1'
    });

    await workflowOneTimeScheduledRunHandler('job-1-retry', {
      tenantId: 'tenant-1',
      workflowId: 'workflow-1',
      scheduleId: 'schedule-1'
    });

    expect(launchPublishedWorkflowRun).toHaveBeenCalledTimes(1);
    const launchCall = launchPublishedWorkflowRun.mock.calls[0];
    const payload = launchCall?.[1]?.payload;

    expect(launchCall?.[1]).toMatchObject({
      workflowId: 'workflow-1',
      workflowVersion: 4,
      tenantId: 'tenant-1',
      triggerType: 'schedule',
      triggerMetadata: expect.objectContaining({
        ...payload,
        fireKey: 'workflow-schedule-fire:schedule-1:job-1'
      }),
      triggerFireKey: 'workflow-schedule-fire:schedule-1:job-1',
      sourcePayloadSchemaRef: WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF,
      execute: true,
      executionKey: 'workflow-schedule-fire:schedule-1:job-1'
    });
    expect(payload).toMatchObject({
      triggerType: 'schedule',
      scheduleId: 'schedule-1',
      scheduledFor: '2026-03-08T14:00:00.000Z',
      timezone: 'America/New_York',
      workflowId: 'workflow-1',
      workflowVersion: 4
    });
    expect(getSchemaRegistry().get(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF).safeParse(payload).success).toBe(true);
    expect(updateScheduleState).toHaveBeenCalledWith(
      'schedule-1',
      expect.objectContaining({
        enabled: false,
        status: 'completed',
        job_id: null,
        runner_schedule_id: null,
        next_fire_at: null,
        last_fire_key: 'workflow-schedule-fire:schedule-1:job-1',
        last_run_status: 'success',
        last_error: null
      })
    );
    expect(scheduleRecord).toMatchObject({
      enabled: false,
      status: 'completed',
      job_id: null,
      runner_schedule_id: null
    });
  });

  it('normalizes one-time schedule timestamps to ISO strings before launch', async () => {
    scheduleRecord = {
      id: 'schedule-date',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-iso',
      workflow_version: 2,
      trigger_type: 'schedule',
      run_at: new Date('2026-03-08T14:00:00.000Z'),
      cron: null,
      timezone: 'UTC',
      enabled: true,
      status: 'scheduled'
    };

    await workflowOneTimeScheduledRunHandler('job-date', {
      tenantId: 'tenant-1',
      workflowId: 'workflow-iso',
      scheduleId: 'schedule-date'
    });

    const payload = launchPublishedWorkflowRun.mock.calls[0]?.[1]?.payload;
    expect(payload?.scheduledFor).toBe('2026-03-08T14:00:00.000Z');
    expect(getSchemaRegistry().get(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF).safeParse(payload).success).toBe(true);
  });

  it('T027/T036/T044: recurring handler launches once per fire, ignores duplicate delivery, and still launches later occurrences', async () => {
    scheduleRecord = {
      id: 'schedule-2',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-2',
      workflow_version: 7,
      trigger_type: 'recurring',
      run_at: null,
      cron: '15 9 * * 1-5',
      timezone: 'UTC',
      enabled: true,
      status: 'scheduled'
    };

    await workflowRecurringScheduledRunHandler('job-service-2', {
      tenantId: 'tenant-1',
      workflowId: 'workflow-2',
      scheduleId: 'schedule-2',
      jobExecutionId: 'fire-1'
    });

    await workflowRecurringScheduledRunHandler('job-service-2', {
      tenantId: 'tenant-1',
      workflowId: 'workflow-2',
      scheduleId: 'schedule-2',
      jobExecutionId: 'fire-1'
    });

    await workflowRecurringScheduledRunHandler('job-service-2', {
      tenantId: 'tenant-1',
      workflowId: 'workflow-2',
      scheduleId: 'schedule-2',
      jobExecutionId: 'fire-2'
    });

    expect(launchPublishedWorkflowRun).toHaveBeenCalledTimes(2);
    const payload = launchPublishedWorkflowRun.mock.calls[0]?.[1]?.payload;

    expect(launchPublishedWorkflowRun.mock.calls[0]?.[1]).toMatchObject({
      workflowId: 'workflow-2',
      workflowVersion: 7,
      tenantId: 'tenant-1',
      triggerType: 'recurring',
      triggerMetadata: expect.objectContaining({
        ...payload,
        fireKey: 'workflow-schedule-fire:schedule-2:fire-1'
      }),
      triggerFireKey: 'workflow-schedule-fire:schedule-2:fire-1',
      sourcePayloadSchemaRef: WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF,
      execute: true,
      executionKey: 'workflow-schedule-fire:schedule-2:fire-1'
    });
    expect(launchPublishedWorkflowRun.mock.calls[1]?.[1]).toMatchObject({
      triggerFireKey: 'workflow-schedule-fire:schedule-2:fire-2',
      executionKey: 'workflow-schedule-fire:schedule-2:fire-2'
    });
    expect(payload).toMatchObject({
      triggerType: 'recurring',
      scheduleId: 'schedule-2',
      timezone: 'UTC',
      workflowId: 'workflow-2',
      workflowVersion: 7,
      cron: '15 9 * * 1-5'
    });
    expect(typeof payload?.firedAt).toBe('string');
    expect(typeof payload?.scheduledFor).toBe('string');
    expect(getSchemaRegistry().get(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF).safeParse(payload).success).toBe(true);
    expect(updateScheduleState).toHaveBeenCalledWith(
      'schedule-2',
      expect.objectContaining({
        last_fire_key: 'workflow-schedule-fire:schedule-2:fire-2',
        last_run_status: 'success',
        last_error: null
      })
    );
  });
});
