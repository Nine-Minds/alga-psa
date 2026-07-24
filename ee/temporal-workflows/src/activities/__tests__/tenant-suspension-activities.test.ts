import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAdminConnection: vi.fn(),
  suspendTenant: vi.fn(),
  resumeTenant: vi.fn(),
}));

vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: mocks.getAdminConnection,
}));

vi.mock('@alga-psa/db', () => ({
  suspendTenant: mocks.suspendTenant,
  resumeTenant: mocks.resumeTenant,
}));

import {
  resumeTenantBackgroundActivity,
  suspendTenantBackgroundActivity,
} from '../tenant-suspension-activities.js';

describe('tenant suspension activities', () => {
  const tenantId = 'tenant-1';
  const knex = { connection: 'admin' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminConnection.mockResolvedValue(knex);
  });

  it('T009: suspends an unsuspended tenant with the cancellation reason', async () => {
    mocks.suspendTenant.mockResolvedValue(true);

    await expect(suspendTenantBackgroundActivity(tenantId)).resolves.toEqual({
      suspended: true,
    });
    expect(mocks.suspendTenant).toHaveBeenCalledWith(knex, tenantId, 'tenant_cancelled');
  });

  it('T010: is a no-op on rerun and contains helper errors without rejecting', async () => {
    mocks.suspendTenant.mockResolvedValueOnce(false);
    await expect(suspendTenantBackgroundActivity(tenantId)).resolves.toEqual({
      suspended: false,
    });

    mocks.suspendTenant.mockRejectedValueOnce(new Error('db down'));
    await expect(suspendTenantBackgroundActivity(tenantId)).resolves.toEqual({
      suspended: false,
    });
  });

  it('T012: resumes a cancellation-owned suspension and propagates query failures', async () => {
    mocks.resumeTenant.mockResolvedValueOnce(true);
    await expect(resumeTenantBackgroundActivity(tenantId)).resolves.toEqual({
      resumed: true,
    });
    expect(mocks.resumeTenant).toHaveBeenCalledWith(knex, tenantId, 'tenant_cancelled');

    mocks.resumeTenant.mockRejectedValueOnce(new Error('connection refused'));
    await expect(resumeTenantBackgroundActivity(tenantId)).rejects.toThrow('connection refused');
  });

  it('T013: resume reports false when only a non-matching suspension exists', async () => {
    mocks.resumeTenant.mockResolvedValue(false);

    await expect(resumeTenantBackgroundActivity(tenantId)).resolves.toEqual({
      resumed: false,
    });
  });
});
