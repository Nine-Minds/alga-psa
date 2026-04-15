import { beforeEach, describe, expect, it, vi } from 'vitest';

type ScheduleRecord = Record<string, any> | null;

let scheduleRecord: ScheduleRecord = null;

const knexMock = {};
const launchPublishedWorkflowRun = vi.fn();
const updateScheduleState = vi.fn();
const resolveWorkflowBusinessDaySettings = vi.fn();
const isWorkflowOccurrenceEligible = vi.fn();
const normalizeWorkflowDayTypeFilter = vi.fn();
const cancelJob = vi.fn();
const getJobStatus = vi.fn();

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

vi.mock('@alga-psa/workflows/lib/workflowBusinessDayScheduling', () => ({
  resolveWorkflowBusinessDaySettings: (...args: unknown[]) => resolveWorkflowBusinessDaySettings(...args),
  isWorkflowOccurrenceEligible: (...args: unknown[]) => isWorkflowOccurrenceEligible(...args),
  normalizeWorkflowDayTypeFilter: (...args: unknown[]) => normalizeWorkflowDayTypeFilter(...args)
}));

vi.mock('server/src/lib/jobs/JobRunnerFactory', () => ({
  getJobRunner: vi.fn(async () => ({
    cancelJob: (...args: unknown[]) => cancelJob(...args),
    getJobStatus: (...args: unknown[]) => getJobStatus(...args)
  }))
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
    resolveWorkflowBusinessDaySettings.mockReset();
    resolveWorkflowBusinessDaySettings.mockResolvedValue({ ok: true, value: null });
    isWorkflowOccurrenceEligible.mockReset();
    isWorkflowOccurrenceEligible.mockReturnValue(true);
    normalizeWorkflowDayTypeFilter.mockReset();
    normalizeWorkflowDayTypeFilter.mockImplementation((value: unknown) => (
      value === 'business' || value === 'non_business' ? value : 'any'
    ));
    cancelJob.mockReset();
    cancelJob.mockResolvedValue(true);
    getJobStatus.mockReset();
    getJobStatus.mockResolvedValue(null);
  });

  it('T025/T027: one-time handler launches with the saved schedule payload and preserves schedule provenance metadata', async () => {
    scheduleRecord = {
      id: 'schedule-1',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      workflow_version: 4,
      name: 'Quarterly kickoff',
      trigger_type: 'schedule',
      day_type_filter: 'any',
      business_hours_schedule_id: null,
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
      day_type_filter: 'any',
      business_hours_schedule_id: null,
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
      day_type_filter: 'any',
      business_hours_schedule_id: null,
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

  it('T008: recurring business-day schedule launches on an eligible occurrence using scheduled occurrence time', async () => {
    scheduleRecord = {
      id: 'schedule-business-1',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-business-1',
      workflow_version: 11,
      name: 'Business day launch',
      trigger_type: 'recurring',
      day_type_filter: 'business',
      business_hours_schedule_id: null,
      run_at: null,
      cron: '0 9 * * 1-5',
      timezone: 'America/New_York',
      payload_json: { accountId: 'acct-900' },
      enabled: true,
      status: 'scheduled'
    };
    resolveWorkflowBusinessDaySettings.mockResolvedValueOnce({
      ok: true,
      value: {
        scheduleId: 'bh-default',
        scheduleName: 'Default',
        source: 'tenant_default',
        scheduleTimezone: 'America/New_York',
        is24x7: false,
        entries: [],
        holidays: []
      }
    });
    isWorkflowOccurrenceEligible.mockReturnValueOnce(true);

    await workflowRecurringScheduledRunHandler('job-business-1', {
      tenantId: 'tenant-1',
      workflowId: 'workflow-business-1',
      scheduleId: 'schedule-business-1',
      jobExecutionId: 'fire-business-1',
      jobScheduledAt: '2026-04-13T13:00:00.000Z'
    });

    expect(launchPublishedWorkflowRun).toHaveBeenCalledTimes(1);
    expect(isWorkflowOccurrenceEligible).toHaveBeenCalledWith(expect.objectContaining({
      dayTypeFilter: 'business',
      occurrenceTimezone: 'America/New_York'
    }));
  });

  it('T009: recurring business-day schedule skips disallowed holiday occurrences without launching a workflow', async () => {
    scheduleRecord = {
      id: 'schedule-business-2',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-business-2',
      workflow_version: 11,
      name: 'Business day skip',
      trigger_type: 'recurring',
      day_type_filter: 'business',
      business_hours_schedule_id: 'bh-1',
      run_at: null,
      cron: '0 9 * * *',
      timezone: 'UTC',
      payload_json: { accountId: 'acct-901' },
      enabled: true,
      status: 'scheduled'
    };
    resolveWorkflowBusinessDaySettings.mockResolvedValueOnce({
      ok: true,
      value: {
        scheduleId: 'bh-1',
        scheduleName: 'HQ',
        source: 'override',
        scheduleTimezone: 'UTC',
        is24x7: true,
        entries: [],
        holidays: [{ holiday_date: '2026-12-25', is_recurring: false }]
      }
    });
    isWorkflowOccurrenceEligible.mockReturnValueOnce(false);

    await workflowRecurringScheduledRunHandler('job-business-2', {
      tenantId: 'tenant-1',
      workflowId: 'workflow-business-2',
      scheduleId: 'schedule-business-2',
      jobExecutionId: 'fire-business-2',
      jobScheduledAt: '2026-12-25T09:00:00.000Z'
    });

    expect(launchPublishedWorkflowRun).not.toHaveBeenCalled();
    expect(updateScheduleState).toHaveBeenCalledWith(
      'schedule-business-2',
      expect.objectContaining({
        last_fire_key: 'workflow-schedule-fire:schedule-business-2:fire-business-2',
        last_run_status: 'skipped',
        last_error: null
      })
    );
  });

  it('T010: recurring non-business schedule launches on holiday occurrences and skips ordinary business-day occurrences', async () => {
    scheduleRecord = {
      id: 'schedule-non-business-1',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-non-business-1',
      workflow_version: 11,
      name: 'Non-business day mixed',
      trigger_type: 'recurring',
      day_type_filter: 'non_business',
      business_hours_schedule_id: null,
      run_at: null,
      cron: '0 8 * * *',
      timezone: 'UTC',
      payload_json: { accountId: 'acct-902' },
      enabled: true,
      status: 'scheduled'
    };
    resolveWorkflowBusinessDaySettings.mockResolvedValue({
      ok: true,
      value: {
        scheduleId: 'bh-default',
        scheduleName: 'Default',
        source: 'tenant_default',
        scheduleTimezone: 'UTC',
        is24x7: false,
        entries: [],
        holidays: [{ holiday_date: '2026-11-26', is_recurring: false }]
      }
    });
    isWorkflowOccurrenceEligible
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    await workflowRecurringScheduledRunHandler('job-non-business-1', {
      tenantId: 'tenant-1',
      workflowId: 'workflow-non-business-1',
      scheduleId: 'schedule-non-business-1',
      jobExecutionId: 'fire-non-business-1',
      jobScheduledAt: '2026-11-26T08:00:00.000Z'
    });

    await workflowRecurringScheduledRunHandler('job-non-business-1', {
      tenantId: 'tenant-1',
      workflowId: 'workflow-non-business-1',
      scheduleId: 'schedule-non-business-1',
      jobExecutionId: 'fire-non-business-2',
      jobScheduledAt: '2026-11-27T08:00:00.000Z'
    });

    expect(launchPublishedWorkflowRun).toHaveBeenCalledTimes(1);
    expect(updateScheduleState).toHaveBeenCalledWith(
      'schedule-non-business-1',
      expect.objectContaining({
        last_fire_key: 'workflow-schedule-fire:schedule-non-business-1:fire-non-business-2',
        last_run_status: 'skipped'
      })
    );
  });

  it('T011: filtered recurring schedule with unresolved business-hours configuration records actionable runtime error and does not launch', async () => {
    scheduleRecord = {
      id: 'schedule-error-1',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-error-1',
      workflow_version: 11,
      name: 'Missing calendar',
      trigger_type: 'recurring',
      day_type_filter: 'business',
      business_hours_schedule_id: null,
      run_at: null,
      cron: '0 8 * * *',
      timezone: 'UTC',
      job_id: 'job-service-calendar-error',
      runner_schedule_id: 'workflow-schedule:workflow-error-1:schedule-error-1',
      payload_json: { accountId: 'acct-903' },
      enabled: true,
      status: 'scheduled'
    };
    resolveWorkflowBusinessDaySettings.mockResolvedValueOnce({
      ok: false,
      issue: {
        code: 'BUSINESS_HOURS_SCHEDULE_REQUIRED',
        message: 'Business/non-business day filters require a default business-hours schedule or a specific override.'
      }
    });

    await workflowRecurringScheduledRunHandler('job-error-1', {
      tenantId: 'tenant-1',
      workflowId: 'workflow-error-1',
      scheduleId: 'schedule-error-1',
      jobExecutionId: 'fire-error-1'
    });

    expect(launchPublishedWorkflowRun).not.toHaveBeenCalled();
    expect(cancelJob).toHaveBeenCalledWith('job-service-calendar-error', 'tenant-1');
    expect(updateScheduleState).toHaveBeenCalledWith(
      'schedule-error-1',
      expect.objectContaining({
        enabled: false,
        status: 'failed',
        job_id: null,
        runner_schedule_id: null,
        next_fire_at: null,
        last_run_status: 'error',
        last_error: 'Business/non-business day filters require a default business-hours schedule or a specific override.'
      })
    );
  });
});
