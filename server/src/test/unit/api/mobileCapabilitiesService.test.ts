import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTenantProduct: vi.fn(),
  hasPermission: vi.fn(),
  resolveDateFormatCountry: vi.fn(),
}));

vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: mocks.getTenantProduct,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@alga-psa/tenancy/lib/tenantDefaultCountry', () => ({
  resolveDateFormatCountry: mocks.resolveDateFormatCountry,
}));

import { countryDateFormat, SYSTEM_DATE_FORMAT } from '@alga-psa/core/i18n/countryDateFormat';
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
    mocks.resolveDateFormatCountry.mockResolvedValue(null);
  });

  it('T050 enables inventory and opportunities for a PSA user with both read permissions', async () => {
    const service = new MobileCapabilitiesService();

    await expect(service.getMyCapabilities(context)).resolves.toEqual({
      features: {
        inventory: true,
        opportunities: true,
        opportunitiesCreate: true,
      },
      formatting: SYSTEM_DATE_FORMAT,
    });
    expect(mocks.hasPermission).toHaveBeenCalledWith(user, 'inventory', 'read', db);
    expect(mocks.hasPermission).toHaveBeenCalledWith(user, 'opportunities', 'read', db);
    expect(mocks.hasPermission).toHaveBeenCalledWith(user, 'opportunities', 'create', db);
  });

  it('T050 disables both features for an AlgaDesk tenant regardless of RBAC', async () => {
    mocks.getTenantProduct.mockResolvedValue('algadesk');
    const service = new MobileCapabilitiesService();

    await expect(service.getMyCapabilities(context)).resolves.toEqual({
      features: {
        inventory: false,
        opportunities: false,
        opportunitiesCreate: false,
      },
      formatting: SYSTEM_DATE_FORMAT,
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
        opportunitiesCreate: expectedOpportunities,
      },
      formatting: SYSTEM_DATE_FORMAT,
    });
  });

  it('exposes opportunity create permission separately from read access', async () => {
    mocks.hasPermission.mockImplementation(async (_user, resource, action) => (
      resource !== 'opportunities' || action !== 'create'
    ));
    const service = new MobileCapabilitiesService();

    await expect(service.getMyCapabilities(context)).resolves.toEqual({
      features: {
        inventory: true,
        opportunities: true,
        opportunitiesCreate: false,
      },
      formatting: SYSTEM_DATE_FORMAT,
    });
  });

  it("answers the resolved country's date shape so the device locale cannot decide it", async () => {
    mocks.resolveDateFormatCountry.mockResolvedValue({ code: 'AU', name: 'Australia' });
    const service = new MobileCapabilitiesService();

    const capabilities = await service.getMyCapabilities(context);
    expect(capabilities.formatting).toEqual(countryDateFormat('AU'));
    expect(capabilities.formatting.datePattern).toBe('dd/MM/yyyy');
  });

  it('answers the fixed system default when the country cannot be resolved', async () => {
    mocks.resolveDateFormatCountry.mockRejectedValue(new Error('no connection'));
    const service = new MobileCapabilitiesService();

    await expect(service.getMyCapabilities(context)).resolves.toMatchObject({
      formatting: SYSTEM_DATE_FORMAT,
    });
  });
});
