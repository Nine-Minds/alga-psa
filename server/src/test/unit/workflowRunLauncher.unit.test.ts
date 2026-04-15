import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  initializeWorkflowRuntimeV2Mock,
  startRunMock,
  executeRunMock,
  startWorkflowRuntimeV2TemporalRunMock,
  getByTriggerFireKeyMock,
  createRunMock,
  updateRunMock,
  getWorkflowByIdMock,
  listWorkflowVersionsMock,
  getWorkflowVersionMock
} = vi.hoisted(() => ({
  initializeWorkflowRuntimeV2Mock: vi.fn(),
  startRunMock: vi.fn(),
  executeRunMock: vi.fn(),
  startWorkflowRuntimeV2TemporalRunMock: vi.fn(),
  getByTriggerFireKeyMock: vi.fn(),
  createRunMock: vi.fn(),
  updateRunMock: vi.fn(),
  getWorkflowByIdMock: vi.fn(),
  listWorkflowVersionsMock: vi.fn(),
  getWorkflowVersionMock: vi.fn()
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowDefinitionModelV2: {
    getById: (...args: unknown[]) => getWorkflowByIdMock(...args)
  },
  WorkflowDefinitionVersionModelV2: {
    listByWorkflow: (...args: unknown[]) => listWorkflowVersionsMock(...args),
    getByWorkflowAndVersion: (...args: unknown[]) => getWorkflowVersionMock(...args)
  },
  WorkflowRunModelV2: {
    create: (...args: unknown[]) => createRunMock(...args),
    getByTriggerFireKey: (...args: unknown[]) => getByTriggerFireKeyMock(...args),
    update: (...args: unknown[]) => updateRunMock(...args)
  }
}));

vi.mock('@alga-psa/workflows/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/workflows/runtime')>();
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
    initializeWorkflowRuntimeV2: () => initializeWorkflowRuntimeV2Mock(),
    WorkflowRuntimeV2: WorkflowRuntimeV2Mock,
    getSchemaRegistry: () => ({
      has: () => false,
      get: () => ({
        safeParse: () => ({ success: true })
      })
    })
  };
});

vi.mock('@alga-psa/workflows/lib/workflowRuntimeV2Temporal', () => ({
  startWorkflowRuntimeV2TemporalRun: (...args: unknown[]) => startWorkflowRuntimeV2TemporalRunMock(...args),
}));

import {
  launchPublishedWorkflowRun,
  recordFailedWorkflowRunLaunch
} from '@alga-psa/workflows/lib/workflowRunLauncher';

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
    initializeWorkflowRuntimeV2Mock.mockReset();
    startRunMock.mockReset();
    executeRunMock.mockReset();
    startWorkflowRuntimeV2TemporalRunMock.mockReset();
    getByTriggerFireKeyMock.mockReset();
    createRunMock.mockReset();
    updateRunMock.mockReset();
    getWorkflowByIdMock.mockReset();
    listWorkflowVersionsMock.mockReset();
    getWorkflowVersionMock.mockReset();

    getWorkflowByIdMock.mockResolvedValue({
      workflow_id: 'workflow-1',
      is_paused: false,
      concurrency_limit: null,
      payload_schema_ref: null
    });
    listWorkflowVersionsMock.mockResolvedValue([{
      workflow_id: 'workflow-1',
      version: 5,
      definition_json: {
        id: 'workflow-1',
        version: 5,
        name: 'Workflow',
        steps: []
      }
    }]);
    getWorkflowVersionMock.mockResolvedValue({
      workflow_id: 'workflow-1',
      version: 5,
      definition_json: {
        id: 'workflow-1',
        version: 5,
        name: 'Workflow',
        steps: []
      }
    });
    createRunMock.mockImplementation(async (_knex: unknown, data: Record<string, unknown>) => ({
      run_id: 'run-created',
      workflow_version: data.workflow_version,
      ...data
    }));
    updateRunMock.mockResolvedValue({});
    startRunMock.mockResolvedValue('run-started');
    startWorkflowRuntimeV2TemporalRunMock.mockImplementation(async ({ runId }: { runId: string }) => ({
      workflowId: `workflow-runtime-v2:run:${runId}`,
      firstExecutionRunId: 'temporal-run-1'
    }));
  });

  it('initializes the workflow runtime before launching a run', async () => {
    const result = await launchPublishedWorkflowRun(knexMock, {
      workflowId: 'workflow-1',
      workflowVersion: 5,
      tenantId: 'tenant-1',
      payload: {},
      execute: true
    });

    expect(result).toEqual({
      runId: 'run-started',
      workflowVersion: 5
    });
    expect(initializeWorkflowRuntimeV2Mock).toHaveBeenCalledTimes(1);
    expect(startRunMock).toHaveBeenCalledTimes(1);
    expect(startWorkflowRuntimeV2TemporalRunMock).toHaveBeenCalledWith({
      runId: 'run-started',
      tenantId: 'tenant-1',
      workflowId: 'workflow-1',
      workflowVersion: 5,
      triggerType: null,
      executionKey: expect.stringMatching(/^launch-workflow-1-/)
    });
    expect(updateRunMock).toHaveBeenCalledWith(
      knexMock,
      'run-started',
      expect.objectContaining({
        engine: 'temporal',
        temporal_workflow_id: 'workflow-runtime-v2:run:run-started',
        temporal_run_id: 'temporal-run-1'
      })
    );
    expect(executeRunMock).not.toHaveBeenCalled();
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
    expect(startWorkflowRuntimeV2TemporalRunMock).not.toHaveBeenCalled();
    expect(executeRunMock).not.toHaveBeenCalled();
    expect(getByTriggerFireKeyMock).toHaveBeenCalledTimes(2);
  });

  it('starts a Temporal runtime workflow for new runs', async () => {
    startRunMock.mockResolvedValue('run-created');

    const result = await launchPublishedWorkflowRun(knexMock, {
      workflowId: 'workflow-1',
      workflowVersion: 5,
      tenantId: 'tenant-1',
      payload: { foo: 'bar' },
      triggerType: 'event',
      eventType: 'PING',
      sourcePayloadSchemaRef: 'payload.WorkflowEvent.v1',
      triggerMappingApplied: false,
      execute: true,
      executionKey: 'exec-1'
    });

    expect(result).toEqual({
      runId: 'run-created',
      workflowVersion: 5
    });
    expect(startWorkflowRuntimeV2TemporalRunMock).toHaveBeenCalledWith({
      runId: 'run-created',
      tenantId: 'tenant-1',
      workflowId: 'workflow-1',
      workflowVersion: 5,
      triggerType: 'event',
      executionKey: 'exec-1'
    });
    expect(startRunMock).toHaveBeenCalledWith(
      knexMock,
      expect.objectContaining({
        workflowId: 'workflow-1',
        version: 5,
        definitionHash: expect.any(String),
        runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        engine: 'temporal'
      })
    );
    expect(updateRunMock).toHaveBeenCalledWith(
      knexMock,
      'run-created',
      expect.objectContaining({
        engine: 'temporal',
        temporal_workflow_id: 'workflow-runtime-v2:run:run-created',
        temporal_run_id: 'temporal-run-1'
      })
    );
    expect(executeRunMock).not.toHaveBeenCalled();
  });

  it('marks the run failed when Temporal start throws after the run row is created', async () => {
    startRunMock.mockResolvedValue('run-created');
    startWorkflowRuntimeV2TemporalRunMock.mockRejectedValueOnce(new Error('temporal unavailable'));

    await expect(launchPublishedWorkflowRun(knexMock, {
      workflowId: 'workflow-1',
      workflowVersion: 5,
      tenantId: 'tenant-1',
      payload: { foo: 'bar' },
      triggerType: 'event',
      execute: true,
      executionKey: 'exec-fail'
    })).rejects.toThrow('temporal unavailable');

    expect(updateRunMock).toHaveBeenCalledWith(
      knexMock,
      'run-created',
      expect.objectContaining({
        status: 'FAILED',
        error_json: expect.objectContaining({
          message: 'temporal unavailable',
          stage: 'launch'
        })
      })
    );
  });

  it('records a failed run row for launch-time payload validation failures', async () => {
    const result = await recordFailedWorkflowRunLaunch(knexMock, {
      workflowId: 'workflow-1',
      workflowVersion: 5,
      tenantId: 'tenant-1',
      payload: { invalid: true },
      triggerType: 'schedule',
      triggerMetadata: { fireKey: 'workflow-schedule-fire:schedule-1:job-1' },
      triggerFireKey: 'workflow-schedule-fire:schedule-1:job-1',
      sourcePayloadSchemaRef: 'payload.Clock.v1',
      message: 'Workflow payload failed validation',
      details: { issues: [{ path: ['foo'], message: 'Required' }] }
    });

    expect(result).toEqual({
      runId: 'run-created',
      workflowVersion: 5
    });
    expect(createRunMock).toHaveBeenCalledWith(
      knexMock,
      expect.objectContaining({
        workflow_id: 'workflow-1',
        workflow_version: 5,
        tenant_id: 'tenant-1',
        status: 'FAILED',
        trigger_type: 'schedule',
        trigger_fire_key: 'workflow-schedule-fire:schedule-1:job-1',
        source_payload_schema_ref: 'payload.Clock.v1',
        input_json: { invalid: true },
        error_json: {
          message: 'Workflow payload failed validation',
          stage: 'launch',
          details: {
            issues: [{ path: ['foo'], message: 'Required' }]
          }
        }
      })
    );
  });
});
