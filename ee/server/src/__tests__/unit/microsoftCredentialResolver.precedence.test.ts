import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bindingFirst: vi.fn(),
  profileFirst: vi.fn(),
  getAdminConnection: vi.fn(),
  getSecretProviderInstance: vi.fn(),
}));

vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: mocks.getAdminConnection }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (table: string) => ({
      where: () => ({
        first: () => table === 'microsoft_profile_consumer_bindings'
          ? mocks.bindingFirst()
          : mocks.profileFirst(),
      }),
    }),
  }),
}));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: mocks.getSecretProviderInstance }));

describe('resolveMicrosoftCredentialsForTenant', () => {
  const priorClientId = process.env.MICROSOFT_CLIENT_ID;
  const priorSecret = process.env.MICROSOFT_CLIENT_SECRET;
  beforeEach(() => {
    vi.resetModules();
    mocks.bindingFirst.mockReset();
    mocks.profileFirst.mockReset();
    mocks.getAdminConnection.mockReset().mockResolvedValue({});
    mocks.getSecretProviderInstance.mockReset().mockResolvedValue({
      getTenantSecret: vi.fn().mockResolvedValue('customer-secret'),
    });
  });
  afterEach(() => {
    if (priorClientId === undefined) delete process.env.MICROSOFT_CLIENT_ID; else process.env.MICROSOFT_CLIENT_ID = priorClientId;
    if (priorSecret === undefined) delete process.env.MICROSOFT_CLIENT_SECRET; else process.env.MICROSOFT_CLIENT_SECRET = priorSecret;
  });
  it('uses only the explicit entra binding, ignoring environment credentials', async () => {
    process.env.MICROSOFT_CLIENT_ID = 'vendor-app'; process.env.MICROSOFT_CLIENT_SECRET = 'vendor-secret';
    mocks.bindingFirst.mockResolvedValue({ profile_id: 'profile-1' });
    mocks.profileFirst.mockResolvedValue({
      profile_id: 'profile-1',
      display_name: 'MSP Entra App',
      client_id: 'customer-app',
      tenant_id: 'partner-tenant',
      client_secret_ref: 'profile-1-secret',
      capabilities: ['entra'],
      is_archived: false,
    });
    const { resolveMicrosoftCredentialsForTenant } = await import('@ee/lib/integrations/entra/auth/microsoftCredentialResolver');
    await expect(resolveMicrosoftCredentialsForTenant('tenant-42')).resolves.toEqual({ clientId: 'customer-app', clientSecret: 'customer-secret', tenantId: 'partner-tenant', source: 'profile', profileId: 'profile-1', profileDisplayName: 'MSP Entra App' });
    expect(mocks.bindingFirst).toHaveBeenCalledOnce();
  });
  it.each([
    { binding: undefined },
    { binding: { profile_id: 'gone' }, profile: undefined },
    { binding: { profile_id: 'profile-1' }, profile: { profile_id: 'profile-1', is_archived: true } },
    { binding: { profile_id: 'profile-1' }, profile: { profile_id: 'profile-1', is_archived: false, capabilities: ['email'] } },
    {
      binding: { profile_id: 'profile-1' },
      profile: {
        profile_id: 'profile-1',
        display_name: 'MSP Entra App',
        client_id: ' ',
        tenant_id: 'partner-tenant',
        client_secret_ref: 'profile-1-secret',
        capabilities: ['entra'],
        is_archived: false,
      },
    },
    {
      binding: { profile_id: 'profile-1' },
      profile: {
        profile_id: 'profile-1',
        display_name: 'MSP Entra App',
        client_id: 'customer-app',
        tenant_id: 'partner-tenant',
        client_secret_ref: 'profile-1-secret',
        capabilities: ['entra'],
        is_archived: false,
      },
      secret: ' ',
    },
  ])('returns null for unusable bindings', async ({ binding, profile, secret }) => {
    mocks.bindingFirst.mockResolvedValue(binding);
    mocks.profileFirst.mockResolvedValue(profile);
    if (secret !== undefined) {
      mocks.getSecretProviderInstance.mockResolvedValue({
        getTenantSecret: vi.fn().mockResolvedValue(secret),
      });
    }
    const { resolveMicrosoftCredentialsForTenant } = await import('@ee/lib/integrations/entra/auth/microsoftCredentialResolver');
    await expect(resolveMicrosoftCredentialsForTenant('tenant-42')).resolves.toBeNull();
  });
});
