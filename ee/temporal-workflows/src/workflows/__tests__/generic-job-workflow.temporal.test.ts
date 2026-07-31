import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenericJobInput } from '../generic-job-workflow';

type MockActivities = {
  executeJobHandler: ReturnType<typeof vi.fn>;
  updateJobStatus: ReturnType<typeof vi.fn>;
  createJobDetail: ReturnType<typeof vi.fn>;
};

let mockActivities: MockActivities;

vi.mock('@temporalio/workflow', () => ({
  proxyActivities: vi.fn(() => mockActivities),
  defineSignal: vi.fn((name: string) => name),
  defineQuery: vi.fn((name: string) => name),
  setHandler: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  sleep: vi.fn(async () => {}),
  workflowInfo: vi.fn(() => ({ workflowId: 'wf-test-123' })),
  ApplicationFailure: {
    create: vi.fn((opts: { message: string; type?: string; nonRetryable?: boolean }) =>
      Object.assign(new Error(opts.message), opts)
    ),
  },
}));

const loadWorkflow = async () => {
  vi.resetModules();
  return import('../generic-job-workflow');
};

describe('genericJobWorkflow', () => {
  beforeEach(() => {
    mockActivities = {
      executeJobHandler: vi.fn(),
      updateJobStatus: vi.fn(),
      createJobDetail: vi.fn().mockResolvedValue('detail-1'),
    };
  });

  it('marks a job processing then completed and returns handler result', async () => {
    mockActivities.executeJobHandler.mockResolvedValue({
      success: true,
      result: { ok: true, invocationId: 'inv-123' },
    });

    const { genericJobWorkflow } = await loadWorkflow();
    const input: GenericJobInput = {
      jobId: 'job-success-1',
      jobName: 'extension-scheduled-invocation',
      tenantId: 'tenant-1',
      data: { scheduleId: 'sched-1' },
    };

    const result = await genericJobWorkflow(input);

    expect(result.success).toBe(true);
    expect(result.jobId).toBe(input.jobId);
    expect(result.result).toEqual({ ok: true, invocationId: 'inv-123' });
    expect(mockActivities.updateJobStatus).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        jobId: input.jobId,
        tenantId: input.tenantId,
        status: 'processing',
      })
    );
    expect(mockActivities.updateJobStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        jobId: input.jobId,
        tenantId: input.tenantId,
        status: 'completed',
      })
    );
    expect(mockActivities.createJobDetail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        stepName: 'execution_started',
        status: 'processing',
      })
    );
    expect(mockActivities.createJobDetail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        stepName: 'execution_completed',
        status: 'completed',
      })
    );
  });

  it('marks a job failed and fails the workflow when handler returns failure', async () => {
    mockActivities.executeJobHandler.mockResolvedValue({
      success: false,
      error: 'simulated handler failure',
    });

    const { genericJobWorkflow } = await loadWorkflow();
    const input: GenericJobInput = {
      jobId: 'job-failure-1',
      jobName: 'extension-scheduled-invocation',
      tenantId: 'tenant-2',
      data: { scheduleId: 'sched-2' },
    };

    await expect(genericJobWorkflow(input)).rejects.toMatchObject({
      message: 'simulated handler failure',
      type: 'GenericJobFailure',
      nonRetryable: true,
    });

    expect(mockActivities.updateJobStatus).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        jobId: input.jobId,
        tenantId: input.tenantId,
        status: 'processing',
      })
    );
    expect(mockActivities.updateJobStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        jobId: input.jobId,
        tenantId: input.tenantId,
        status: 'failed',
        error: 'simulated handler failure',
      })
    );
    expect(mockActivities.createJobDetail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        stepName: 'execution_started',
        status: 'processing',
      })
    );
    expect(mockActivities.createJobDetail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        stepName: 'execution_failed',
        status: 'failed',
      })
    );
  });

  it('still executes the handler when pre-run bookkeeping fails', async () => {
    mockActivities.updateJobStatus.mockRejectedValueOnce(
      new Error('tracker row missing')
    );
    mockActivities.executeJobHandler.mockResolvedValue({
      success: true,
      result: { ok: true },
    });

    const { genericJobWorkflow } = await loadWorkflow();
    const input: GenericJobInput = {
      jobId: 'job-orphan-1',
      jobName: 'rmm-alert-reconciliation',
      tenantId: 'tenant-3',
      data: { integrationId: 'integ-1' },
    };

    const result = await genericJobWorkflow(input);

    expect(result.success).toBe(true);
    expect(mockActivities.executeJobHandler).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: input.jobId, jobName: input.jobName })
    );
  });
});
