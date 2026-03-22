import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createRunMock,
  createLogMock
} = vi.hoisted(() => ({
  createRunMock: vi.fn(),
  createLogMock: vi.fn()
}));

vi.mock('@alga-psa/workflows/persistence/workflowRunModelV2', () => ({
  default: {
    create: (...args: unknown[]) => createRunMock(...args)
  }
}));

vi.mock('@alga-psa/workflows/persistence/workflowRunLogModelV2', () => ({
  default: {
    create: (...args: unknown[]) => createLogMock(...args)
  }
}));

import { WorkflowRuntimeV2 } from '@alga-psa/workflows/runtime';

describe('Workflow run trigger provenance', () => {
  const knexMock = {};

  beforeEach(() => {
    createRunMock.mockReset();
    createLogMock.mockReset();
    createRunMock.mockImplementation(async (_knex: unknown, data: Record<string, unknown>) => ({
      run_id: 'run-1',
      ...data
    }));
    createLogMock.mockResolvedValue(undefined);
  });

  it('T039: one-time schedule runs persist trigger provenance fields', async () => {
    const runtime = new WorkflowRuntimeV2();

    await runtime.startRun(knexMock as any, {
      workflowId: 'workflow-1',
      version: 3,
      payload: { triggerType: 'schedule' },
      tenantId: 'tenant-1',
      triggerType: 'schedule',
      triggerMetadata: {
        scheduleId: 'schedule-1',
        scheduledFor: '2026-03-08T14:00:00.000Z',
        firedAt: '2026-03-08T14:00:01.000Z',
        timezone: 'America/New_York',
        workflowId: 'workflow-1',
        workflowVersion: 3
      },
      triggerFireKey: 'workflow-schedule-fire:schedule-1:job-1'
    });

    expect(createRunMock).toHaveBeenCalledWith(
      knexMock,
      expect.objectContaining({
        trigger_type: 'schedule',
        trigger_metadata_json: expect.objectContaining({
          scheduleId: 'schedule-1',
          scheduledFor: '2026-03-08T14:00:00.000Z',
          firedAt: '2026-03-08T14:00:01.000Z'
        }),
        trigger_fire_key: 'workflow-schedule-fire:schedule-1:job-1'
      })
    );
  });

  it('T040: recurring schedule runs persist trigger provenance fields', async () => {
    const runtime = new WorkflowRuntimeV2();

    await runtime.startRun(knexMock as any, {
      workflowId: 'workflow-2',
      version: 7,
      payload: { triggerType: 'recurring' },
      tenantId: 'tenant-1',
      triggerType: 'recurring',
      triggerMetadata: {
        scheduleId: 'schedule-2',
        scheduledFor: '2026-03-09T14:00:00.000Z',
        firedAt: '2026-03-09T14:00:01.000Z',
        timezone: 'UTC',
        workflowId: 'workflow-2',
        workflowVersion: 7,
        cron: '15 9 * * 1-5'
      },
      triggerFireKey: 'workflow-schedule-fire:schedule-2:job-2'
    });

    expect(createRunMock).toHaveBeenCalledWith(
      knexMock,
      expect.objectContaining({
        trigger_type: 'recurring',
        trigger_metadata_json: expect.objectContaining({
          scheduleId: 'schedule-2',
          cron: '15 9 * * 1-5',
          timezone: 'UTC'
        }),
        trigger_fire_key: 'workflow-schedule-fire:schedule-2:job-2'
      })
    );
  });
});
