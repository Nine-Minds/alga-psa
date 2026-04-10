import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WORKFLOW_RUNTIME_V2_EVENT_SIGNAL,
  WORKFLOW_RUNTIME_V2_HUMAN_TASK_SIGNAL,
  WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE,
  WORKFLOW_RUNTIME_V2_TEMPORAL_WORKFLOW,
  signalWorkflowRuntimeV2Event,
  signalWorkflowRuntimeV2HumanTask,
  startWorkflowRuntimeV2TemporalRun,
} from '../workflowRuntimeV2Temporal';

const {
  connectionConnectMock,
  connectionCloseMock,
  workflowStartMock,
  workflowGetHandleMock,
  workflowSignalMock,
} = vi.hoisted(() => ({
  connectionConnectMock: vi.fn(),
  connectionCloseMock: vi.fn(async () => undefined),
  workflowStartMock: vi.fn(),
  workflowGetHandleMock: vi.fn(),
  workflowSignalMock: vi.fn(async () => undefined),
}));

vi.mock('@temporalio/client', () => {
  class Client {
    workflow = {
      start: workflowStartMock,
      getHandle: workflowGetHandleMock,
    };
  }

  return {
    Connection: {
      connect: connectionConnectMock,
    },
    Client,
  };
});

describe('workflow runtime v2 Temporal contract', () => {
  beforeEach(() => {
    connectionConnectMock.mockReset();
    connectionCloseMock.mockReset();
    workflowStartMock.mockReset();
    workflowGetHandleMock.mockReset();
    workflowSignalMock.mockReset();

    connectionConnectMock.mockResolvedValue({
      close: connectionCloseMock,
    });
    workflowStartMock.mockResolvedValue({
      firstExecutionRunId: 'first-run-id',
    });
    workflowGetHandleMock.mockReturnValue({
      signal: workflowSignalMock,
    });
  });

  it('keeps authored launch targeting queue workflow-runtime-v2', async () => {
    const result = await startWorkflowRuntimeV2TemporalRun({
      runId: 'run-1',
      tenantId: 'tenant-1',
      workflowId: 'wf-1',
      workflowVersion: 2,
      triggerType: 'event',
      executionKey: 'exec-1',
    });

    expect(workflowStartMock).toHaveBeenCalledWith(
      WORKFLOW_RUNTIME_V2_TEMPORAL_WORKFLOW,
      expect.objectContaining({
        taskQueue: WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE,
        workflowId: 'workflow-runtime-v2:run:run-1',
      }),
    );
    expect(result).toEqual({
      workflowId: 'workflow-runtime-v2:run:run-1',
      firstExecutionRunId: 'first-run-id',
    });
  });

  it('keeps authored event/human signaling contract unchanged', async () => {
    await signalWorkflowRuntimeV2Event({
      runId: 'run-2',
      eventId: 'evt-1',
      eventName: 'ticket.updated',
      correlationKey: 'ticket:1',
      payload: { foo: 'bar' },
      receivedAt: '2026-04-09T00:00:00.000Z',
    });
    expect(workflowGetHandleMock).toHaveBeenCalledWith('workflow-runtime-v2:run:run-2');
    expect(workflowSignalMock).toHaveBeenCalledWith(
      WORKFLOW_RUNTIME_V2_EVENT_SIGNAL,
      expect.objectContaining({
        eventId: 'evt-1',
        eventName: 'ticket.updated',
        correlationKey: 'ticket:1',
      }),
    );

    await signalWorkflowRuntimeV2HumanTask({
      runId: 'run-2',
      taskId: 'task-77',
      eventName: 'task.completed',
      payload: { status: 'done' },
    });
    expect(workflowGetHandleMock).toHaveBeenCalledWith('workflow-runtime-v2:run:run-2');
    expect(workflowSignalMock).toHaveBeenCalledWith(
      WORKFLOW_RUNTIME_V2_HUMAN_TASK_SIGNAL,
      {
        taskId: 'task-77',
        eventName: 'task.completed',
        payload: { status: 'done' },
      },
    );
  });
});
