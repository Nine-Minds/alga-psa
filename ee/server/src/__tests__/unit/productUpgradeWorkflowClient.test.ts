import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  start: vi.fn(),
  getHandle: vi.fn(),
}));

vi.mock('@temporalio/client', () => {
  const Client = function Client(this: any) {
    this.workflow = {
      start: mocks.start,
      getHandle: mocks.getHandle,
    };
  } as any;

  return {
    Connection: { connect: mocks.connect },
    Client,
  };
});

const {
  getTenantProductUpgradeStatus,
  startTenantProductUpgradeWorkflow,
} = await import('../../lib/tenant-management/workflowClient');

describe('tenant product upgrade workflow client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.close.mockResolvedValue(undefined);
    mocks.connect.mockResolvedValue({ close: mocks.close });
  });

  it('starts the workflow on the tenant queue with a deterministic ID', async () => {
    mocks.start.mockResolvedValue({
      workflowId: 'tenant-product-upgrade-tenant-1',
      firstExecutionRunId: 'run-1',
    });

    await expect(
      startTenantProductUpgradeWorkflow({
        tenantId: 'tenant-1',
        requestedByUserId: 'user-1',
      })
    ).resolves.toEqual({
      available: true,
      workflowId: 'tenant-product-upgrade-tenant-1',
      runId: 'run-1',
      alreadyRunning: false,
    });

    expect(mocks.start).toHaveBeenCalledWith('tenantProductUpgradeWorkflow', {
      args: [{ tenantId: 'tenant-1', requestedByUserId: 'user-1' }],
      taskQueue: 'tenant-workflows',
      workflowId: 'tenant-product-upgrade-tenant-1',
    });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('returns the existing execution when Temporal rejects a duplicate start', async () => {
    const duplicate = new Error('already started');
    duplicate.name = 'WorkflowExecutionAlreadyStartedError';
    mocks.start.mockRejectedValue(duplicate);
    mocks.getHandle.mockReturnValue({
      describe: vi.fn().mockResolvedValue({ runId: 'run-1' }),
    });

    await expect(
      startTenantProductUpgradeWorkflow({
        tenantId: 'tenant-1',
        requestedByUserId: 'user-1',
      })
    ).resolves.toEqual({
      available: true,
      workflowId: 'tenant-product-upgrade-tenant-1',
      runId: 'run-1',
      alreadyRunning: true,
    });

    expect(mocks.getHandle).toHaveBeenCalledWith('tenant-product-upgrade-tenant-1');
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('returns idle when no workflow execution exists', async () => {
    const notFound = new Error('not found');
    notFound.name = 'WorkflowNotFoundError';
    mocks.getHandle.mockReturnValue({
      describe: vi.fn().mockRejectedValue(notFound),
    });

    await expect(getTenantProductUpgradeStatus('tenant-1')).resolves.toEqual({
      available: true,
      data: { state: 'idle' },
    });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('maps running progress and closed outcomes to the status contract', async () => {
    const describe = vi.fn();
    const query = vi.fn();
    const result = vi.fn();
    mocks.getHandle.mockReturnValue({ describe, query, result });

    describe.mockResolvedValueOnce({ status: { name: 'RUNNING' } });
    query.mockResolvedValueOnce({
      currentStep: 'product_upgrade_rbac_delta',
      completedSteps: ['product_upgrade_preflight', 'product_upgrade_backfill_seeds'],
    });
    await expect(getTenantProductUpgradeStatus('tenant-1')).resolves.toEqual({
      available: true,
      data: {
        state: 'running',
        workflowId: 'tenant-product-upgrade-tenant-1',
        currentStep: 'product_upgrade_rbac_delta',
        completedSteps: ['product_upgrade_preflight', 'product_upgrade_backfill_seeds'],
      },
    });

    describe.mockResolvedValueOnce({ status: { name: 'COMPLETED' } });
    await expect(getTenantProductUpgradeStatus('tenant-1')).resolves.toEqual({
      available: true,
      data: {
        state: 'completed',
        workflowId: 'tenant-product-upgrade-tenant-1',
      },
    });

    describe.mockResolvedValueOnce({ status: { name: 'FAILED' } });
    result.mockRejectedValueOnce(
      Object.assign(new Error('Workflow execution failed'), {
        cause: new Error('Stripe subscription is not active'),
      })
    );
    await expect(getTenantProductUpgradeStatus('tenant-1')).resolves.toEqual({
      available: true,
      data: {
        state: 'failed',
        workflowId: 'tenant-product-upgrade-tenant-1',
        error: 'Stripe subscription is not active',
      },
    });

    expect(query).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledTimes(3);
  });
});
