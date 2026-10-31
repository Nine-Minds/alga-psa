import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  licenseState: vi.fn(),
  tenantLicense: vi.fn(),
  hosted: vi.fn(),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => Object.assign(() => ({ first: mocks.licenseState }), {}),
}));
vi.mock('@temporalio/activity', async () => {
  const actual = await vi.importActual<typeof import('@temporalio/activity')>('@temporalio/activity');
  return { ...actual, Context: { current: () => ({ log: { info() {}, error() {}, warn() {}, debug() {} } }) } };
});
vi.mock('../../db/product-upgrade-operations.js', () => ({}));
vi.mock('../../db/co-managed-upgrade-operations.js', () => ({ upgradeCoManagedWorkspaceWithTenantLicense: mocks.tenantLicense }));
vi.mock('../../db/co-managed-hosted-upgrade.js', () => ({ upgradeCoManagedWorkspaceWithHostedSubscription: mocks.hosted }));

import { ApplicationFailure } from '@temporalio/activity';
import { product_upgrade_co_managed } from '../product-upgrade-activities.js';

const command = { actor: { kind: 'session', tenant: 't', userId: 'u', sessionId: 's' },
  target: { customerTenant: 't', relationshipId: 'r' }, request: { operationId: 'o', expectedRevision: 1 } } as any;

describe('product_upgrade_co_managed', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('selects the self-host path exactly when license_state exists', async () => {
    mocks.licenseState.mockResolvedValue({ id: 1 });
    await product_upgrade_co_managed(command);
    expect(mocks.tenantLicense).toHaveBeenCalledOnce();
    expect(mocks.hosted).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.licenseState.mockResolvedValue(undefined);
    await product_upgrade_co_managed(command);
    expect(mocks.hosted).toHaveBeenCalledOnce();
    expect(mocks.tenantLicense).not.toHaveBeenCalled();
  });

  it.each(['CO_MANAGED_SHARED_WORK_FORBIDDEN', 'INVALID_UPGRADE', 'UPGRADE_CHANGED', 'PAID_ENTITLEMENT_REQUIRED', 'INSUFFICIENT_PSA_SEATS'])(
    '%s is non-retryable', async code => {
      mocks.licenseState.mockResolvedValue(undefined);
      mocks.hosted.mockRejectedValue(Object.assign(new Error(code), { code }));
      const error = await product_upgrade_co_managed(command).catch(e => e);
      expect(error).toBeInstanceOf(ApplicationFailure);
      expect(error.nonRetryable).toBe(true);
      expect(error.type).toBe(code);
    });

  it('leaves unknown errors retryable', async () => {
    mocks.licenseState.mockResolvedValue(undefined);
    mocks.hosted.mockRejectedValue(new Error('network'));
    const error = await product_upgrade_co_managed(command).catch(e => e);
    expect(error).not.toBeInstanceOf(ApplicationFailure);
  });
});
