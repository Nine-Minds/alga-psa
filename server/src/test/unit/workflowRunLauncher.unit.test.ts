import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  startRunMock,
  executeRunMock,
  getByTriggerFireKeyMock
} = vi.hoisted(() => ({
  startRunMock: vi.fn(),
  executeRunMock: vi.fn(),
  getByTriggerFireKeyMock: vi.fn()
}));

vi.mock('@shared/workflow/persistence/workflowDefinitionModelV2', () => ({
  default: {
    getById: vi.fn(async () => ({
      workflow_id: 'workflow-1',
      is_paused: false,
      concurrency_limit: null,
      payload_schema_ref: null
    }))
  }
}));

vi.mock('@shared/workflow/persistence/workflowDefinitionVersionModelV2', () => ({
  default: {
    listByWorkflow: vi.fn(async () => ([{
      workflow_id: 'workflow-1',
      version: 5,
      definition_json: {
        id: 'workflow-1',
        version: 5,
        name: 'Workflow',
        steps: []
      }
    }])),
    getByWorkflowAndVersion: vi.fn(async () => ({
      workflow_id: 'workflow-1',
      version: 5,
      definition_json: {
        id: 'workflow-1',
        version: 5,
        name: 'Workflow',
        steps: []
      }
    }))
  }
}));

vi.mock('@shared/workflow/persistence/workflowRunModelV2', () => ({
  default: {
    getByTriggerFireKey: (...args: unknown[]) => getByTriggerFireKeyMock(...args)
  }
}));

vi.mock('@shared/workflow/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/workflow/runtime')>();
  class WorkflowRuntimeV2Mock {
    async startRun(...args: unknown[]) {
      return startRunMock(...args);
    }

    async executeRun(...args: unknown[]) {
      return executeRunMock(...args);
    }
  }

  return {
    ...actual,
    WorkflowRuntimeV2: WorkflowRuntimeV2Mock
  };
});

import { launchPublishedWorkflowRun } from 'server/src/lib/workflow-runtime-v2/workflowRunLauncher';

describe('Workflow run launcher', () => {
  const knexMock: any = vi.fn((table: string) => {
    if (table === 'workflow_runs') {
      return {
        where: vi.fn().mockReturnThis(),
        whereIn: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ count: '0' })
      };
    }
    throw new Error(`Unexpected table access: ${table}`);
  });

  beforeEach(() => {
    startRunMock.mockReset();
    executeRunMock.mockReset();
    getByTriggerFireKeyMock.mockReset();
  });

  it('T044: duplicate recurring fire keys return the existing run without executing twice', async () => {
    startRunMock.mockRejectedValue({
      code: '23505',
      constraint: 'workflow_runs_trigger_fire_key_unique'
    });
    getByTriggerFireKeyMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        run_id: 'run-existing',
        workflow_version: 5
      });

    const result = await launchPublishedWorkflowRun(knexMock, {
      workflowId: 'workflow-1',
      workflowVersion: 5,
      tenantId: 'tenant-1',
      payload: {
        triggerType: 'recurring',
        scheduleId: 'schedule-2',
        scheduledFor: '2026-03-09T14:00:00.000Z',
        firedAt: '2026-03-09T14:00:01.000Z',
        timezone: 'UTC',
        workflowId: 'workflow-1',
        workflowVersion: 5,
        cron: '15 9 * * 1-5'
      },
      triggerType: 'recurring',
      triggerMetadata: {
        fireKey: 'workflow-schedule-fire:schedule-2:job-2'
      },
      triggerFireKey: 'workflow-schedule-fire:schedule-2:job-2',
      execute: true
    });

    expect(result).toEqual({
      runId: 'run-existing',
      workflowVersion: 5
    });
    expect(startRunMock).toHaveBeenCalledTimes(1);
    expect(executeRunMock).not.toHaveBeenCalled();
    expect(getByTriggerFireKeyMock).toHaveBeenCalledTimes(2);
  });
});
