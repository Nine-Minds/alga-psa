import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTenantProduct: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: mocks.getTenantProduct,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: mocks.hasPermission,
}));

import { MobileCapabilitiesService } from '../../../lib/api/services/MobileCapabilitiesService';

const db = {} as any;
const user = {
  user_id: 'user-1',
  user_type: 'internal' as const,
  tenant: 'tenant-1',
};
const context = {
  tenant: 'tenant-1',
  userId: 'user-1',
  user,
  db,
};

describe('MobileCapabilitiesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTenantProduct.mockResolvedValue('psa');
    mocks.hasPermission.mockResolvedValue(true);
  });

  it('T050 enables inventory and opportunities for a PSA user with both read permissions', async () => {
    const service = new MobileCapabilitiesService();

    await expect(service.getMyCapabilities(context)).resolves.toEqual({
      features: {
        inventory: true,
        opportunities: true,
      },
    });
    expect(mocks.hasPermission).toHaveBeenCalledWith(user, 'inventory', 'read', db);
    expect(mocks.hasPermission).toHaveBeenCalledWith(user, 'opportunities', 'read', db);
  });

  it('T050 disables both features for an AlgaDesk tenant regardless of RBAC', async () => {
    mocks.getTenantProduct.mockResolvedValue('algadesk');
    const service = new MobileCapabilitiesService();

    await expect(service.getMyCapabilities(context)).resolves.toEqual({
      features: {
        inventory: false,
        opportunities: false,
      },
    });
    expect(mocks.hasPermission).not.toHaveBeenCalled();
  });

  it.each([
    ['inventory', false, true],
    ['opportunities', true, false],
  ] as const)('T050 disables only %s when that read permission is missing', async (
    missingResource,
    expectedInventory,
    expectedOpportunities,
  ) => {
    mocks.hasPermission.mockImplementation(async (_user, resource) => resource !== missingResource);
    const service = new MobileCapabilitiesService();

    await expect(service.getMyCapabilities(context)).resolves.toEqual({
      features: {
        inventory: expectedInventory,
        opportunities: expectedOpportunities,
      },
    });
  });
});
