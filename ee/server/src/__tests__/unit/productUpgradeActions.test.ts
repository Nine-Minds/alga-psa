import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkAccountManagementPermission: vi.fn(),
  getTenantProduct: vi.fn(),
  isConfigured: vi.fn(),
  previewProductUpgrade: vi.fn(),
  startTenantProductUpgradeWorkflow: vi.fn(),
  getTenantProductUpgradeStatus: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  getSession: mocks.getSession,
}));

vi.mock('@alga-psa/auth/actions', () => ({
  checkAccountManagementPermission: mocks.checkAccountManagementPermission,
}));

vi.mock('server/src/lib/productAccess', () => ({
  getTenantProduct: mocks.getTenantProduct,
}));

vi.mock('../../lib/stripe/StripeService', () => ({
  getStripeService: () => ({
    isConfigured: mocks.isConfigured,
    previewProductUpgrade: mocks.previewProductUpgrade,
  }),
}));

vi.mock('../../lib/tenant-management/workflowClient', () => ({
  startTenantProductUpgradeWorkflow: mocks.startTenantProductUpgradeWorkflow,
  getTenantProductUpgradeStatus: mocks.getTenantProductUpgradeStatus,
}));

const {
  getProductUpgradeStatusAction,
  previewProductUpgradeAction,
  startProductUpgradeAction,
} = await import('../../lib/actions/product-upgrade-actions');

describe('product upgrade actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1', tenant: 'tenant-1' },
    });
    mocks.checkAccountManagementPermission.mockResolvedValue(true);
    mocks.getTenantProduct.mockResolvedValue('algadesk');
    mocks.isConfigured.mockResolvedValue(true);
    mocks.getTenantProductUpgradeStatus.mockResolvedValue({
      available: true,
      data: { state: 'idle' },
    });
  });

  it('T047: denies a non-admin user on all three actions', async () => {
    mocks.checkAccountManagementPermission.mockResolvedValue(false);

    await expect(previewProductUpgradeAction()).rejects.toThrow(
      'You do not have permission to change the subscription plan'
    );
    await expect(startProductUpgradeAction()).rejects.toThrow(
      'You do not have permission to change the subscription plan'
    );
    await expect(getProductUpgradeStatusAction()).rejects.toThrow(
      'You do not have permission to change the subscription plan'
    );

    expect(mocks.getTenantProduct).not.toHaveBeenCalled();
    expect(mocks.previewProductUpgrade).not.toHaveBeenCalled();
    expect(mocks.startTenantProductUpgradeWorkflow).not.toHaveBeenCalled();
    expect(mocks.getTenantProductUpgradeStatus).not.toHaveBeenCalled();
  });

  it('T048: denies a PSA tenant on preview/start but permits status polling', async () => {
    mocks.getTenantProduct.mockResolvedValue('psa');
    mocks.getTenantProductUpgradeStatus.mockResolvedValue({
      available: true,
      data: {
        state: 'completed',
        workflowId: 'tenant-product-upgrade-tenant-1',
      },
    });

    await expect(previewProductUpgradeAction()).rejects.toThrow(
      'Product upgrade is only available to AlgaDesk tenants'
    );
    await expect(startProductUpgradeAction()).rejects.toThrow(
      'Product upgrade is only available to AlgaDesk tenants'
    );
    await expect(getProductUpgradeStatusAction()).resolves.toEqual({
      state: 'completed',
      workflowId: 'tenant-product-upgrade-tenant-1',
    });

    expect(mocks.getTenantProduct).toHaveBeenCalledTimes(2);
    expect(mocks.getTenantProductUpgradeStatus).toHaveBeenCalledWith('tenant-1');
  });

  it('T049: returns the product upgrade pricing preview contract', async () => {
    const preview = {
      currentProduct: 'algadesk',
      targetProduct: 'psa',
      seatCount: 12,
      billingInterval: 'month',
      currentPerSeat: 29,
      targetPerSeat: 59,
      prorationAmount: 147.5,
      currency: 'usd',
    } as const;
    mocks.previewProductUpgrade.mockResolvedValue(preview);

    await expect(previewProductUpgradeAction()).resolves.toEqual(preview);

    expect(mocks.getTenantProduct).toHaveBeenCalledWith('tenant-1');
    expect(mocks.isConfigured).toHaveBeenCalledOnce();
    expect(mocks.previewProductUpgrade).toHaveBeenCalledWith('tenant-1');
  });

  it('T050: returns the deterministic workflow ID and reports a repeated start', async () => {
    mocks.getTenantProductUpgradeStatus
      .mockResolvedValueOnce({
        available: true,
        data: { state: 'idle' },
      })
      .mockResolvedValueOnce({
        available: true,
        data: {
          state: 'running',
          workflowId: 'tenant-product-upgrade-tenant-1',
          currentStep: 'product_upgrade_preflight',
          completedSteps: [],
        },
      });
    mocks.startTenantProductUpgradeWorkflow.mockResolvedValueOnce({
      available: true,
      workflowId: 'tenant-product-upgrade-tenant-1',
      runId: 'run-1',
      alreadyRunning: false,
    });

    await expect(startProductUpgradeAction()).resolves.toEqual({
      workflowId: 'tenant-product-upgrade-tenant-1',
      alreadyRunning: false,
    });
    await expect(startProductUpgradeAction()).resolves.toEqual({
      workflowId: 'tenant-product-upgrade-tenant-1',
      alreadyRunning: true,
    });

    expect(mocks.getTenantProductUpgradeStatus).toHaveBeenCalledTimes(2);
    expect(mocks.startTenantProductUpgradeWorkflow).toHaveBeenCalledOnce();
    expect(mocks.startTenantProductUpgradeWorkflow).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      requestedByUserId: 'user-1',
    });
  });
});
