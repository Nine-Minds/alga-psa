import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETING_FLIP_DUE_POSTS_JOB } from '@alga-psa/marketing/lib/marketingJobContract';

const listMarketingTenantIdsMock = vi.fn();
const runMarketingJobForTenantMock = vi.fn();
const logInfoMock = vi.fn();

class MockApplicationFailure extends Error {
  type: string;
  nonRetryable: boolean;
  details: unknown[];

  constructor(message: string, type: string, details: unknown[]) {
    super(message);
    this.type = type;
    this.nonRetryable = true;
    this.details = details;
  }
}

vi.mock('@temporalio/workflow', () => ({
  proxyActivities: vi.fn((options: { startToCloseTimeout: string }) => (
    options.startToCloseTimeout === '1m'
      ? { listMarketingTenantIds: listMarketingTenantIdsMock }
      : { runMarketingJobForTenant: runMarketingJobForTenantMock }
  )),
  log: {
    info: logInfoMock,
  },
  ApplicationFailure: {
    nonRetryable: (message: string, type: string, ...details: unknown[]) =>
      new MockApplicationFailure(message, type, details),
  },
}));

function successfulResult(tenantId: string) {
  return {
    jobName: MARKETING_FLIP_DUE_POSTS_JOB,
    tenantId,
    operation: { flipped: 1 },
    completedAt: '2026-07-23T12:00:00.000Z',
  };
}

describe('marketingFanoutWorkflow', () => {
  beforeEach(() => {
    listMarketingTenantIdsMock.mockReset();
    runMarketingJobForTenantMock.mockReset();
    logInfoMock.mockReset();
  });

  it('invokes every discovered tenant exactly once and returns aggregate counts', async () => {
    listMarketingTenantIdsMock.mockResolvedValue(['tenant-1', 'tenant-2', 'tenant-3']);
    runMarketingJobForTenantMock.mockImplementation(async ({ tenantId }) => successfulResult(tenantId));
    const { marketingFanoutWorkflow } = await import('../marketing-fanout-workflow');

    const summary = await marketingFanoutWorkflow({
      jobName: MARKETING_FLIP_DUE_POSTS_JOB,
    });

    expect(runMarketingJobForTenantMock).toHaveBeenCalledTimes(3);
    expect(runMarketingJobForTenantMock.mock.calls.map(([input]) => input.tenantId).sort())
      .toEqual(['tenant-1', 'tenant-2', 'tenant-3']);
    expect(summary).toMatchObject({
      jobName: MARKETING_FLIP_DUE_POSTS_JOB,
      total: 3,
      succeeded: 3,
      failed: 0,
    });
  });

  it('never runs more than ten tenant activities concurrently', async () => {
    const tenantIds = Array.from({ length: 24 }, (_, index) => `tenant-${index + 1}`);
    listMarketingTenantIdsMock.mockResolvedValue(tenantIds);
    let active = 0;
    let peak = 0;
    runMarketingJobForTenantMock.mockImplementation(async ({ tenantId }) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return successfulResult(tenantId);
    });
    const { marketingFanoutWorkflow } = await import('../marketing-fanout-workflow');

    await marketingFanoutWorkflow({ jobName: MARKETING_FLIP_DUE_POSTS_JOB });

    expect(peak).toBe(10);
  });

  it('attempts later tenants and throws with the full summary after a tenant exhausts retries', async () => {
    listMarketingTenantIdsMock.mockResolvedValue(['tenant-1', 'tenant-2', 'tenant-3']);
    runMarketingJobForTenantMock.mockImplementation(async ({ tenantId }) => {
      if (tenantId === 'tenant-1') {
        throw new Error('database unavailable');
      }
      return successfulResult(tenantId);
    });
    const { marketingFanoutWorkflow } = await import('../marketing-fanout-workflow');

    await expect(marketingFanoutWorkflow({
      jobName: MARKETING_FLIP_DUE_POSTS_JOB,
    })).rejects.toMatchObject({
      type: 'MarketingFanoutFailure',
      nonRetryable: true,
      details: [{
        jobName: MARKETING_FLIP_DUE_POSTS_JOB,
        total: 3,
        succeeded: 2,
        failed: 1,
        results: [
          { tenantId: 'tenant-1', status: 'failed', error: 'database unavailable' },
          { tenantId: 'tenant-2', status: 'succeeded' },
          { tenantId: 'tenant-3', status: 'succeeded' },
        ],
      }],
    });
    expect(runMarketingJobForTenantMock).toHaveBeenCalledTimes(3);
  });
});
