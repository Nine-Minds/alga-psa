import { beforeEach, describe, expect, it, vi } from 'vitest';

type ScheduleRecord = Record<string, any> | null;

let scheduleRecord: ScheduleRecord = null;

const knexMock = {};
const launchPublishedWorkflowRun = vi.fn();
const updateScheduleState = vi.fn();

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(async (tenantId: string) => ({ knex: knexMock, tenant: tenantId }))
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowScheduleStateModel: {
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

vi.mock('@alga-psa/workflows/lib/workflowRunLauncher', () => ({
  launchPublishedWorkflowRun: (...args: unknown[]) => launchPublishedWorkflowRun(...args)
}));

import {
  workflowOneTimeScheduledRunHandler,
  workflowRecurringScheduledRunHandler
} from '@/lib/jobs/handlers/workflowScheduledRunHandlers';

describe('Workflow scheduled run handlers', () => {
  beforeEach(() => {
    scheduleRecord = null;
    launchPublishedWorkflowRun.mockReset();
    launchPublishedWorkflowRun.mockResolvedValue({ runId: 'run-1', workflowVersion: 4 });
    updateScheduleState.mockReset();
  });

  it('T025/T027: one-time handler launches with the saved schedule payload and preserves schedule provenance metadata', async () => {
    scheduleRecord = {
      id: 'schedule-1',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      workflow_version: 4,
      name: 'Quarterly kickoff',
      trigger_type: 'schedule',
      run_at: '2026-03-08T14:00:00.000Z',
      cron: null,
      timezone: 'America/New_York',
      payload_json: {
        accountId: 'acct-100',
        region: 'east'
      },
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
    const triggerMetadata = launchCall?.[1]?.triggerMetadata;

    expect(launchCall?.[1]).toMatchObject({
      workflowId: 'workflow-1',
      workflowVersion: 4,
      tenantId: 'tenant-1',
      triggerType: 'schedule',
      triggerMetadata: expect.objectContaining({
        scheduleId: 'schedule-1',
        scheduleName: 'Quarterly kickoff',
        triggerType: 'schedule',
        scheduledFor: '2026-03-08T14:00:00.000Z',
        timezone: 'America/New_York',
        workflowId: 'workflow-1',
        workflowVersion: 4,
        fireKey: 'workflow-schedule-fire:schedule-1:job-1'
      }),
      triggerFireKey: 'workflow-schedule-fire:schedule-1:job-1',
      execute: true,
      executionKey: 'workflow-schedule-fire:schedule-1:job-1'
    });
    expect(payload).toEqual({
      accountId: 'acct-100',
      region: 'east'
    });
    expect(typeof triggerMetadata?.firedAt).toBe('string');
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
  });

  it('T026: recurring handler uses the saved schedule payload as workflow input_json and still deduplicates by fire key', async () => {
    scheduleRecord = {
      id: 'schedule-2',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-2',
      workflow_version: 7,
      name: 'Daily digest',
      trigger_type: 'recurring',
      run_at: null,
      cron: '15 9 * * 1-5',
      timezone: 'UTC',
      payload_json: {
        accountId: 'acct-200',
        threshold: 3
      },
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
    const triggerMetadata = launchPublishedWorkflowRun.mock.calls[0]?.[1]?.triggerMetadata;

    expect(launchPublishedWorkflowRun.mock.calls[0]?.[1]).toMatchObject({
      workflowId: 'workflow-2',
      workflowVersion: 7,
      tenantId: 'tenant-1',
      triggerType: 'recurring',
      triggerMetadata: expect.objectContaining({
        scheduleId: 'schedule-2',
        scheduleName: 'Daily digest',
        triggerType: 'recurring',
        timezone: 'UTC',
        workflowId: 'workflow-2',
        workflowVersion: 7,
        cron: '15 9 * * 1-5',
        fireKey: 'workflow-schedule-fire:schedule-2:fire-1'
      }),
      triggerFireKey: 'workflow-schedule-fire:schedule-2:fire-1',
      execute: true,
      executionKey: 'workflow-schedule-fire:schedule-2:fire-1'
    });
    expect(launchPublishedWorkflowRun.mock.calls[1]?.[1]).toMatchObject({
      triggerFireKey: 'workflow-schedule-fire:schedule-2:fire-2',
      executionKey: 'workflow-schedule-fire:schedule-2:fire-2'
    });
    expect(payload).toEqual({
      accountId: 'acct-200',
      threshold: 3
    });
    expect(typeof triggerMetadata?.firedAt).toBe('string');
    expect(typeof triggerMetadata?.scheduledFor).toBe('string');
    expect(updateScheduleState).toHaveBeenCalledWith(
      'schedule-2',
      expect.objectContaining({
        last_fire_key: 'workflow-schedule-fire:schedule-2:fire-2',
        last_run_status: 'success',
        last_error: null
      })
    );
  });

  it('T028: invalid saved payload at fire time does not start execution and records schedule error state', async () => {
    scheduleRecord = {
      id: 'schedule-3',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-3',
      workflow_version: 9,
      name: 'Broken payload schedule',
      trigger_type: 'recurring',
      run_at: null,
      cron: '0 12 * * *',
      timezone: 'UTC',
      payload_json: {
        accountId: 'acct-300'
      },
      enabled: true,
      status: 'scheduled'
    };
    launchPublishedWorkflowRun.mockRejectedValueOnce(new Error('Workflow payload failed validation'));

    await expect(workflowRecurringScheduledRunHandler('job-service-3', {
      tenantId: 'tenant-1',
      workflowId: 'workflow-3',
      scheduleId: 'schedule-3',
      jobExecutionId: 'fire-invalid'
    })).rejects.toThrow('Workflow payload failed validation');

    expect(launchPublishedWorkflowRun).toHaveBeenCalledTimes(1);
    expect(updateScheduleState).toHaveBeenCalledWith(
      'schedule-3',
      expect.objectContaining({
        last_fire_key: 'workflow-schedule-fire:schedule-3:fire-invalid',
        last_run_status: 'error',
        last_error: 'Workflow payload failed validation'
      })
    );
  });
});
