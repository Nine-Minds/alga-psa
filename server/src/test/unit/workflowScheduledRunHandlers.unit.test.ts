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

  it('T008/T026: one-time handler launches through the shared launcher with the fixed clock payload contract', async () => {
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

    expect(launchPublishedWorkflowRun).toHaveBeenCalledTimes(1);
    const launchCall = launchPublishedWorkflowRun.mock.calls[0];
    const payload = launchCall?.[1]?.payload;

    expect(launchCall?.[1]).toMatchObject({
      workflowId: 'workflow-1',
      workflowVersion: 4,
      tenantId: 'tenant-1',
      sourcePayloadSchemaRef: WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF,
      execute: true
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
        last_run_status: 'success',
        last_error: null
      })
    );
  });

  it('T027: recurring handler launches through the shared launcher with recurring clock metadata', async () => {
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

    await workflowRecurringScheduledRunHandler('job-2', {
      tenantId: 'tenant-1',
      workflowId: 'workflow-2',
      scheduleId: 'schedule-2'
    });

    expect(launchPublishedWorkflowRun).toHaveBeenCalledTimes(1);
    const payload = launchPublishedWorkflowRun.mock.calls[0]?.[1]?.payload;

    expect(launchPublishedWorkflowRun.mock.calls[0]?.[1]).toMatchObject({
      workflowId: 'workflow-2',
      workflowVersion: 7,
      tenantId: 'tenant-1',
      sourcePayloadSchemaRef: WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF,
      execute: true
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
        last_run_status: 'success',
        last_error: null
      })
    );
  });
});
