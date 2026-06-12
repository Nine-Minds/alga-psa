import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  workflowGetByIdMock,
  listByWorkflowMock,
  getByTriggerFireKeyMock,
  workflowRunUpdateMock,
  startRunMock,
  initializeWorkflowRuntimeV2Mock,
  startWorkflowRuntimeV2TemporalRunMock,
} = vi.hoisted(() => ({
  workflowGetByIdMock: vi.fn(),
  listByWorkflowMock: vi.fn(),
  getByTriggerFireKeyMock: vi.fn(),
  workflowRunUpdateMock: vi.fn(),
  startRunMock: vi.fn(),
  initializeWorkflowRuntimeV2Mock: vi.fn(),
  startWorkflowRuntimeV2TemporalRunMock: vi.fn(),
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowDefinitionModelV2: {
    getById: workflowGetByIdMock,
  },
  WorkflowDefinitionVersionModelV2: {
    listByWorkflow: listByWorkflowMock,
    getByWorkflowAndVersion: vi.fn(),
  },
  WorkflowRunModelV2: {
    getByTriggerFireKey: getByTriggerFireKeyMock,
    update: workflowRunUpdateMock,
    create: vi.fn(),
  },
}));

vi.mock('@alga-psa/workflows/runtime/core', () => ({
  WorkflowRuntimeV2: class {
    startRun = startRunMock;
  },
  getSchemaRegistry: () => ({
    has: () => false,
  }),
  initializeWorkflowRuntimeV2: initializeWorkflowRuntimeV2Mock,
}));

vi.mock('../workflowRuntimeV2Temporal', () => ({
  startWorkflowRuntimeV2TemporalRun: startWorkflowRuntimeV2TemporalRunMock,
}));

import { launchPublishedWorkflowRun } from '../workflowRunLauncher';

describe('workflowRunLauncher', () => {
  beforeEach(() => {
    workflowGetByIdMock.mockReset();
    listByWorkflowMock.mockReset();
    getByTriggerFireKeyMock.mockReset();
    workflowRunUpdateMock.mockReset();
    startRunMock.mockReset();
    initializeWorkflowRuntimeV2Mock.mockReset();
    startWorkflowRuntimeV2TemporalRunMock.mockReset();

    workflowGetByIdMock.mockResolvedValue({
      workflow_id: 'wf-1',
      is_paused: false,
      concurrency_limit: null,
      payload_schema_ref: null,
    });
    listByWorkflowMock.mockResolvedValue([
      {
        version: 3,
        definition_json: {
          trigger: {
            type: 'event',
            eventName: 'TICKET_CREATED',
          },
        },
      },
    ]);
    getByTriggerFireKeyMock.mockResolvedValue(null);
    startRunMock.mockResolvedValue('run-1');
    startWorkflowRuntimeV2TemporalRunMock.mockResolvedValue({
      workflowId: 'workflow-runtime-v2:run:run-1',
      firstExecutionRunId: 'temporal-run-1',
    });
  });

  it('always starts the Temporal workflow and records the Temporal ids', async () => {
    const result = await launchPublishedWorkflowRun({} as any, {
      workflowId: 'wf-1',
      tenantId: 'tenant-1',
      payload: { ticketId: 'ticket-1' },
      eventType: 'TICKET_CREATED',
    });

    expect(initializeWorkflowRuntimeV2Mock).toHaveBeenCalled();
    expect(startRunMock).toHaveBeenCalledWith(
      {} as any,
      expect.objectContaining({
        workflowId: 'wf-1',
        tenantId: 'tenant-1',
      }),
    );
    expect(startWorkflowRuntimeV2TemporalRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', workflowId: 'wf-1', workflowVersion: 3 }),
    );
    expect(workflowRunUpdateMock).toHaveBeenCalledWith({} as any, 'run-1', {
      temporal_workflow_id: 'workflow-runtime-v2:run:run-1',
      temporal_run_id: 'temporal-run-1',
    });
    expect(result).toEqual({
      runId: 'run-1',
      workflowVersion: 3,
    });
  });

  it('ignores the retired engine-selection env flag', async () => {
    process.env.WORKFLOW_RUNTIME_V2_ENABLE_TEMPORAL_POLLING = 'false';
    try {
      await launchPublishedWorkflowRun({} as any, {
        workflowId: 'wf-1',
        tenantId: 'tenant-1',
        payload: { ticketId: 'ticket-1' },
        eventType: 'TICKET_CREATED',
      });
    } finally {
      delete process.env.WORKFLOW_RUNTIME_V2_ENABLE_TEMPORAL_POLLING;
    }

    expect(startWorkflowRuntimeV2TemporalRunMock).toHaveBeenCalled();
  });

  it('marks the run FAILED and rethrows when the Temporal start fails', async () => {
    startWorkflowRuntimeV2TemporalRunMock.mockRejectedValue(new Error('temporal unreachable'));

    await expect(
      launchPublishedWorkflowRun({} as any, {
        workflowId: 'wf-1',
        tenantId: 'tenant-1',
        payload: { ticketId: 'ticket-1' },
        eventType: 'TICKET_CREATED',
      }),
    ).rejects.toThrow('temporal unreachable');

    expect(workflowRunUpdateMock).toHaveBeenCalledWith(
      {} as any,
      'run-1',
      expect.objectContaining({
        status: 'FAILED',
        error_json: expect.objectContaining({
          message: 'temporal unreachable',
          stage: 'launch',
        }),
      }),
    );
  });
});
