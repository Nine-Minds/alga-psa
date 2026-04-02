import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAdminConnectionMock = vi.fn();
const listSchedulesMock = vi.fn();
const workflowRecurringScheduledRunHandlerMock = vi.fn();

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: () => getAdminConnectionMock(),
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowScheduleStateModel: {
    list: (...args: unknown[]) => listSchedulesMock(...args),
  },
}));

vi.mock('@/lib/jobs/handlers/workflowScheduledRunHandlers', () => ({
  workflowRecurringScheduledRunHandler: (...args: unknown[]) =>
    workflowRecurringScheduledRunHandlerMock(...args),
}));

import { reconcileWorkflowSchedulePgBossHandlers } from '@/lib/jobs/reconcileWorkflowSchedulePgBossHandlers';

describe('reconcileWorkflowSchedulePgBossHandlers', () => {
  beforeEach(() => {
    getAdminConnectionMock.mockReset();
    listSchedulesMock.mockReset();
    workflowRecurringScheduledRunHandlerMock.mockReset();
  });

  it('re-registers only missing recurring workflow schedule queues for PG Boss', async () => {
    const adminKnex = {};
    const registerHandler = vi.fn();
    const hasHandler = vi.fn((jobName: string) => jobName === 'workflow-schedule:workflow-2:schedule-2');
    const runner = {
      getRunnerType: () => 'pgboss' as const,
      hasHandler,
      registerHandler,
    };

    getAdminConnectionMock.mockResolvedValue(adminKnex);
    listSchedulesMock.mockResolvedValue([
      {
        id: 'schedule-1',
        tenant_id: 'tenant-1',
        workflow_id: 'workflow-1',
        workflow_version: 1,
        name: 'Daily 1',
        trigger_type: 'recurring',
        cron: '0 9 * * *',
        timezone: 'UTC',
        enabled: true,
        status: 'scheduled',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'schedule-2',
        tenant_id: 'tenant-1',
        workflow_id: 'workflow-2',
        workflow_version: 1,
        name: 'Daily 2',
        trigger_type: 'recurring',
        cron: '15 10 * * *',
        timezone: 'UTC',
        enabled: true,
        status: 'scheduled',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'schedule-3',
        tenant_id: 'tenant-1',
        workflow_id: 'workflow-3',
        workflow_version: 1,
        name: 'Disabled',
        trigger_type: 'recurring',
        cron: '0 11 * * *',
        timezone: 'UTC',
        enabled: false,
        status: 'paused',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'schedule-4',
        tenant_id: 'tenant-1',
        workflow_id: 'workflow-4',
        workflow_version: 1,
        name: 'One-time',
        trigger_type: 'schedule',
        run_at: '2099-01-01T00:00:00.000Z',
        enabled: true,
        status: 'scheduled',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const result = await reconcileWorkflowSchedulePgBossHandlers(runner as any);

    expect(getAdminConnectionMock).toHaveBeenCalledTimes(1);
    expect(listSchedulesMock).toHaveBeenCalledWith(adminKnex);
    expect(hasHandler).toHaveBeenCalledWith('workflow-schedule:workflow-1:schedule-1');
    expect(hasHandler).toHaveBeenCalledWith('workflow-schedule:workflow-2:schedule-2');
    expect(registerHandler).toHaveBeenCalledTimes(1);

    const handlerConfig = registerHandler.mock.calls[0]?.[0];
    expect(handlerConfig.name).toBe('workflow-schedule:workflow-1:schedule-1');

    await handlerConfig.handler('job-1', {
      tenantId: 'tenant-1',
      workflowId: 'workflow-1',
      scheduleId: 'schedule-1',
    });

    expect(workflowRecurringScheduledRunHandlerMock).toHaveBeenCalledWith('job-1', {
      tenantId: 'tenant-1',
      workflowId: 'workflow-1',
      scheduleId: 'schedule-1',
    });
    expect(result).toEqual({ registered: 1, skipped: 3 });
  });

  it('skips reconciliation for non-PG Boss runners', async () => {
    const runner = {
      getRunnerType: () => 'temporal' as const,
      registerHandler: vi.fn(),
    };

    const result = await reconcileWorkflowSchedulePgBossHandlers(runner as any);

    expect(getAdminConnectionMock).not.toHaveBeenCalled();
    expect(listSchedulesMock).not.toHaveBeenCalled();
    expect(runner.registerHandler).not.toHaveBeenCalled();
    expect(result).toEqual({ registered: 0, skipped: 0 });
  });
});
