import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosGetMock = vi.fn();
const getSecretProviderInstanceMock = vi.fn();
const refreshEntraDirectTokenMock = vi.fn();

vi.mock('axios', () => ({
  default: {
    get: axiosGetMock,
    isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean } | null)?.isAxiosError),
  },
  get: axiosGetMock,
  isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean } | null)?.isAxiosError),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: getSecretProviderInstanceMock,
}));

vi.mock('@ee/lib/integrations/entra/auth/refreshDirectToken', () => ({
  refreshEntraDirectToken: refreshEntraDirectTokenMock,
}));

describe('DirectProviderAdapter normalization', () => {
  beforeEach(() => {
    vi.resetModules();
    axiosGetMock.mockReset();
    getSecretProviderInstanceMock.mockReset();
    refreshEntraDirectTokenMock.mockReset();

    const expiresFuture = new Date(Date.now() + 3600_000).toISOString();
    getSecretProviderInstanceMock.mockResolvedValue({
      getTenantSecret: vi.fn(async (_tenant: string, key: string) => {
        if (key === 'entra_direct_access_token') return 'access-token-direct';
        if (key === 'entra_direct_token_expires_at') return expiresFuture;
        return null;
      }),
    });
  });

  it('T048: normalizes direct tenant responses into managed-tenant DTO fields', async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        value: [
          {
            id: 'managed-tenant-1',
            displayName: ' Acme Tenant ',
            defaultDomainName: 'acme.example.com',
            userCount: '42',
          },
        ],
      },
    });

    const { createDirectProviderAdapter } = await import(
      '@ee/lib/integrations/entra/providers/direct/directProviderAdapter'
    );
    const adapter = createDirectProviderAdapter();
    const tenants = await adapter.listManagedTenants({ tenant: 'tenant-48' });

    expect(tenants).toHaveLength(1);
    expect(tenants[0]).toMatchObject({
      entraTenantId: 'managed-tenant-1',
      displayName: 'Acme Tenant',
      primaryDomain: 'acme.example.com',
      sourceUserCount: 42,
    });
    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/tenantRelationships/managedTenants/tenants?$top=999',
      expect.objectContaining({
        headers: { Authorization: 'Bearer access-token-direct' },
      })
    );
    expect(refreshEntraDirectTokenMock).not.toHaveBeenCalled();
  });

  it('T049: normalizes direct user responses into canonical sync-user DTO fields', async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        value: [
          {
            id: 'user-49',
            tenantId: 'managed-tenant-49',
            displayName: ' User Forty Nine ',
            givenName: ' User ',
            surname: ' Forty Nine ',
            mail: null,
            userPrincipalName: 'user49@acme.example.com',
            accountEnabled: 'false',
            jobTitle: ' Engineer ',
            mobilePhone: ' +1 555 0000 ',
            businessPhones: [' +1 555 0001 ', '', '   '],
          },
        ],
      },
    });

    const { createDirectProviderAdapter } = await import(
      '@ee/lib/integrations/entra/providers/direct/directProviderAdapter'
    );
    const adapter = createDirectProviderAdapter();
    const users = await adapter.listUsersForTenant({
      tenant: 'tenant-49',
      managedTenantId: 'managed-tenant-49',
    });

    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      entraTenantId: 'managed-tenant-49',
      entraObjectId: 'user-49',
      userPrincipalName: 'user49@acme.example.com',
      email: 'user49@acme.example.com',
      displayName: 'User Forty Nine',
      givenName: 'User',
      surname: 'Forty Nine',
      accountEnabled: false,
      jobTitle: 'Engineer',
      mobilePhone: '+1 555 0000',
      businessPhones: ['+1 555 0001'],
    });
    expect(refreshEntraDirectTokenMock).not.toHaveBeenCalled();
  });
});
