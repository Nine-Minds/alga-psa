import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosGetMock = vi.fn();
const getEntraCippCredentialsMock = vi.fn();

vi.mock('axios', () => ({
  default: {
    get: axiosGetMock,
    isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean } | null)?.isAxiosError),
  },
  get: axiosGetMock,
  isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean } | null)?.isAxiosError),
}));

vi.mock('@ee/lib/integrations/entra/providers/cipp/cippSecretStore', () => ({
  getEntraCippCredentials: getEntraCippCredentialsMock,
}));

describe('CippProviderAdapter normalization', () => {
  beforeEach(() => {
    vi.resetModules();
    axiosGetMock.mockReset();
    getEntraCippCredentialsMock.mockReset();
    getEntraCippCredentialsMock.mockResolvedValue({
      baseUrl: 'https://cipp.example.com',
      apiToken: 'cipp-token',
    });
  });

  it('T050: normalizes CIPP tenant responses into managed-tenant DTO fields', async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        tenants: [
          {
            tenantId: 'managed-tenant-50',
            tenantName: ' Contoso Tenant ',
            primaryDomain: 'contoso.example.com',
            userCount: '7',
          },
        ],
      },
    });

    const { createCippProviderAdapter } = await import(
      '@ee/lib/integrations/entra/providers/cipp/cippProviderAdapter'
    );
    const adapter = createCippProviderAdapter();
    const tenants = await adapter.listManagedTenants({ tenant: 'tenant-50' });

    expect(tenants).toHaveLength(1);
    expect(tenants[0]).toMatchObject({
      entraTenantId: 'managed-tenant-50',
      displayName: 'Contoso Tenant',
      primaryDomain: 'contoso.example.com',
      sourceUserCount: 7,
    });
    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://cipp.example.com/api/listtenants',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer cipp-token',
          'X-API-KEY': 'cipp-token',
        },
      })
    );
  });

  it('T051: normalizes CIPP user responses into canonical sync-user DTO fields', async () => {
    axiosGetMock.mockResolvedValue({
      data: [
        {
          id: 'user-51',
          tenantId: 'managed-tenant-51',
          displayName: ' User Fifty One ',
          givenName: ' User ',
          surname: ' Fifty One ',
          mail: ' user51@contoso.example.com ',
          userPrincipalName: 'upn51@contoso.example.com',
          accountEnabled: 1,
          jobTitle: ' Engineer ',
          mobilePhone: ' +1 555 0051 ',
          businessPhones: [' +1 555 1051 ', ''],
        },
      ],
    });

    const { createCippProviderAdapter } = await import(
      '@ee/lib/integrations/entra/providers/cipp/cippProviderAdapter'
    );
    const adapter = createCippProviderAdapter();
    const users = await adapter.listUsersForTenant({
      tenant: 'tenant-51',
      managedTenantId: 'managed-tenant-51',
    });

    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      entraTenantId: 'managed-tenant-51',
      entraObjectId: 'user-51',
      userPrincipalName: 'upn51@contoso.example.com',
      email: 'user51@contoso.example.com',
      displayName: 'User Fifty One',
      givenName: 'User',
      surname: 'Fifty One',
      accountEnabled: true,
      jobTitle: 'Engineer',
      mobilePhone: '+1 555 0051',
      businessPhones: ['+1 555 1051'],
    });
    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://cipp.example.com/api/listusers?tenantId=managed-tenant-51',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer cipp-token',
          'X-API-KEY': 'cipp-token',
        },
      })
    );
  });
});
