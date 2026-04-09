import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  workerCreateMock,
  workerRunMock,
  workerShutdownMock,
  connectionConnectMock,
  connectionCloseMock,
} = vi.hoisted(() => ({
  workerCreateMock: vi.fn(),
  workerRunMock: vi.fn(async () => undefined),
  workerShutdownMock: vi.fn(async () => undefined),
  connectionConnectMock: vi.fn(),
  connectionCloseMock: vi.fn(async () => undefined),
}));

vi.mock('@temporalio/worker', () => ({
  NativeConnection: {
    connect: (...args: unknown[]) => connectionConnectMock(...args),
  },
  Worker: {
    create: (...args: unknown[]) => workerCreateMock(...args),
  },
}));

describe('WorkflowRuntimeV2TemporalWorker', () => {
  beforeEach(() => {
    vi.resetModules();
    workerCreateMock.mockReset();
    workerRunMock.mockReset();
    workerShutdownMock.mockReset();
    connectionConnectMock.mockReset();
    connectionCloseMock.mockReset();

    connectionConnectMock.mockResolvedValue({
      close: connectionCloseMock,
    });

    workerCreateMock.mockResolvedValue({
      run: workerRunMock,
      shutdown: workerShutdownMock,
    });

    delete process.env.WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE;
    delete process.env.WORKFLOW_RUNTIME_V2_TEMPORAL_WORKFLOWS_PATH;
    delete process.env.WORKFLOW_RUNTIME_V2_TEMPORAL_ACTIVITIES_PATH;
  });

  it('starts Temporal polling for the authored queue and shuts down cleanly', async () => {
    process.env.WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE = 'workflow-runtime-v2';
    process.env.WORKFLOW_RUNTIME_V2_TEMPORAL_WORKFLOWS_PATH = './src/v2/WorkflowRuntimeV2TemporalWorker.test.activities.mjs';
    process.env.WORKFLOW_RUNTIME_V2_TEMPORAL_ACTIVITIES_PATH = './src/v2/WorkflowRuntimeV2TemporalWorker.test.activities.mjs';

    const { WorkflowRuntimeV2TemporalWorker } = await import('./WorkflowRuntimeV2TemporalWorker.js');
    const worker = new WorkflowRuntimeV2TemporalWorker('temporal-test-worker');

    await worker.start();

    expect(connectionConnectMock).toHaveBeenCalledTimes(1);
    expect(workerCreateMock).toHaveBeenCalledTimes(1);
    expect(workerCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskQueue: 'workflow-runtime-v2',
        workflowsPath: path.resolve(process.cwd(), './src/v2/WorkflowRuntimeV2TemporalWorker.test.activities.mjs'),
      }),
    );
    expect(workerRunMock).toHaveBeenCalledTimes(1);

    await worker.stop();

    expect(workerShutdownMock).toHaveBeenCalledTimes(1);
    expect(connectionCloseMock).toHaveBeenCalledTimes(1);
  });
});
