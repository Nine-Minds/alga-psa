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

    delete process.env.WORKFLOW_RUNTIME_V2_ENABLE_TEMPORAL_POLLING;

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
  });

  it('uses the DB engine and skips Temporal launch when Temporal polling is disabled', async () => {
    process.env.WORKFLOW_RUNTIME_V2_ENABLE_TEMPORAL_POLLING = 'false';

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
        engine: 'db',
      }),
    );
    expect(startWorkflowRuntimeV2TemporalRunMock).not.toHaveBeenCalled();
    expect(workflowRunUpdateMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      runId: 'run-1',
      workflowVersion: 3,
    });
  });
});
