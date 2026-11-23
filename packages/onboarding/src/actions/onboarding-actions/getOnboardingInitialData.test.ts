import { beforeEach, describe, expect, it, vi } from 'vitest';

let locationRow: Record<string, any> | undefined;

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(),
  tenantDb: vi.fn(() => ({
    table: (name: string) => {
      const chain: any = {
        where: () => chain,
        orderBy: () => chain,
        first: async () =>
          name === 'clients' ? { client_id: 'client-1', client_name: 'Acme MSP' } : locationRow,
      };
      return chain;
    },
  })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ first_name: 'Ada', last_name: 'Admin', email: 'ada@example.test' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(),
}));
vi.mock('@alga-psa/shared/lib/contacts/contactEvents', () => ({ trackContactUpdates: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/core/encryption', () => ({ hashPassword: vi.fn() }));
vi.mock('@alga-psa/core', () => ({ isValidEmail: vi.fn() }));
vi.mock('@alga-psa/clients/actions/clientActions', () => ({ createClient: vi.fn() }));
vi.mock('@alga-psa/clients/lib/clientLocationEvents', () => ({
  queueClientLocationCreated: vi.fn(),
  queueClientLocationUpdated: vi.fn(),
}));
vi.mock('@alga-psa/clients/actions/contact-actions/contactActions', () => ({ createClientContact: vi.fn() }));
vi.mock('@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions', () => ({
  updateTenantOnboardingStatus: vi.fn(),
  saveTenantOnboardingProgress: vi.fn(),
}));
vi.mock('@alga-psa/tenancy/server', () => ({ persistTenantOnboardingProgress: vi.fn() }));
vi.mock('@alga-psa/types', () => ({ isLicensedUserType: vi.fn() }));
vi.mock('@alga-psa/licensing/server', () => ({ getLicenseUsage: vi.fn() }));
vi.mock('../../../../users/src/lib/internalUserLicenseGuard', () => ({ countPendingInvitationSeats: vi.fn() }));

import { getOnboardingInitialData } from './onboardingActions';

const location = (overrides: Record<string, any>) => ({
  location_id: 'loc-1',
  address_line1: 'N/A',
  address_line2: null,
  city: 'N/A',
  state_province: null,
  postal_code: null,
  country_code: 'XX',
  country_name: 'Unknown',
  ...overrides,
});

describe('getOnboardingInitialData company address prefill', () => {
  beforeEach(() => {
    locationRow = undefined;
  });

  it('T006: placeholder location returns blank fields and companyAddressPrefilled=false', async () => {
    locationRow = location({});
    const result = await (getOnboardingInitialData as any)();

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      companyLocationId: 'loc-1',
      companyAddressLine1: '',
      companyAddressLine2: '',
      companyCity: '',
      companyStateProvince: '',
      companyPostalCode: '',
      companyCountryCode: '',
      companyCountryName: '',
      companyAddressPrefilled: false,
    });
  });

  it('T007: country and postal code only returns those values and companyAddressPrefilled=true', async () => {
    locationRow = location({ postal_code: '98101', country_code: 'US', country_name: 'United States' });
    const result = await (getOnboardingInitialData as any)();

    expect(result.data).toMatchObject({
      companyAddressLine1: '',
      companyCity: '',
      companyPostalCode: '98101',
      companyCountryCode: 'US',
      companyCountryName: 'United States',
      companyAddressPrefilled: true,
    });
  });

  it('treats an "Unknown" city as blank and a missing location as not prefilled', async () => {
    locationRow = location({ city: 'Unknown' });
    expect((await (getOnboardingInitialData as any)()).data).toMatchObject({
      companyCity: '',
      companyAddressPrefilled: false,
    });

    locationRow = undefined;
    expect((await (getOnboardingInitialData as any)()).data.companyAddressPrefilled).toBe(false);
  });
});
