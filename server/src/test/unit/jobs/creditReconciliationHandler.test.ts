import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runScheduledCreditBalanceValidation: vi.fn(),
  runWithTenant: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/creditReconciliationActions', () => ({
  runScheduledCreditBalanceValidation: mocks.runScheduledCreditBalanceValidation,
}));

vi.mock('@alga-psa/db', () => ({
  runWithTenant: mocks.runWithTenant,
}));

import { creditReconciliationHandler } from '@alga-psa/jobs/handlers/creditReconciliationHandler';

const validationResults = {
  balanceValidCount: 3,
  balanceDiscrepancyCount: 1,
  missingTrackingCount: 0,
  inconsistentTrackingCount: 2,
  errorCount: 0,
};

describe('creditReconciliationHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: runWithTenant simply invokes the supplied callback.
    mocks.runWithTenant.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
    mocks.runScheduledCreditBalanceValidation.mockResolvedValue(validationResults);
  });

  it('should throw when tenantId is missing and not invoke any collaborator', async () => {
    await expect(
      creditReconciliationHandler({ tenantId: '' } as any),
    ).rejects.toThrow('Tenant ID is required for credit reconciliation job');

    expect(mocks.runWithTenant).not.toHaveBeenCalled();
    expect(mocks.runScheduledCreditBalanceValidation).not.toHaveBeenCalled();
  });

  it('should run scheduled validation inside the tenant context for a specific client', async () => {
    await creditReconciliationHandler({ tenantId: 'tenant-1', clientId: 'client-9' });

    expect(mocks.runWithTenant).toHaveBeenCalledTimes(1);
    expect(mocks.runWithTenant).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    expect(mocks.runScheduledCreditBalanceValidation).toHaveBeenCalledTimes(1);
    expect(mocks.runScheduledCreditBalanceValidation).toHaveBeenCalledWith('client-9', 'system');
  });

  it('should run scheduled validation for the whole tenant when no client is provided', async () => {
    await creditReconciliationHandler({ tenantId: 'tenant-1' });

    expect(mocks.runScheduledCreditBalanceValidation).toHaveBeenCalledWith(undefined, 'system');
  });

  it('should not start validation outside the tenant context wrapper', async () => {
    // If runWithTenant never invokes the callback, the validation must not run.
    mocks.runWithTenant.mockResolvedValue(validationResults);

    await creditReconciliationHandler({ tenantId: 'tenant-1' });

    expect(mocks.runScheduledCreditBalanceValidation).not.toHaveBeenCalled();
  });

  it('should re-throw collaborator failures so pg-boss can retry the job', async () => {
    const failure = new Error('validation blew up');
    mocks.runScheduledCreditBalanceValidation.mockRejectedValue(failure);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      creditReconciliationHandler({ tenantId: 'tenant-1' }),
    ).rejects.toThrow('validation blew up');

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
