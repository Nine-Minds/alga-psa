import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSecretProviderInstanceMock = vi.fn();

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: getSecretProviderInstanceMock,
}));

describe('resolveMicrosoftCredentialsForTenant precedence', () => {
  const originalClientId = process.env.MICROSOFT_CLIENT_ID;
  const originalClientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const originalTenantId = process.env.MICROSOFT_TENANT_ID;

  beforeEach(() => {
    vi.resetModules();
    getSecretProviderInstanceMock.mockReset();
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
    delete process.env.MICROSOFT_TENANT_ID;
  });

  afterEach(() => {
    if (originalClientId === undefined) {
      delete process.env.MICROSOFT_CLIENT_ID;
    } else {
      process.env.MICROSOFT_CLIENT_ID = originalClientId;
    }

    if (originalClientSecret === undefined) {
      delete process.env.MICROSOFT_CLIENT_SECRET;
    } else {
      process.env.MICROSOFT_CLIENT_SECRET = originalClientSecret;
    }

    if (originalTenantId === undefined) {
      delete process.env.MICROSOFT_TENANT_ID;
    } else {
      process.env.MICROSOFT_TENANT_ID = originalTenantId;
    }
  });

  it('T042: prefers tenant-level Microsoft credentials when tenant id/secret pair exists', async () => {
    process.env.MICROSOFT_CLIENT_ID = 'env-client-id';
    process.env.MICROSOFT_CLIENT_SECRET = 'env-client-secret';
    process.env.MICROSOFT_TENANT_ID = 'env-tenant-id';

    const getTenantSecretMock = vi.fn(async (_tenant: string, key: string) => {
      if (key === 'microsoft_client_id') return 'tenant-client-id';
      if (key === 'microsoft_client_secret') return 'tenant-client-secret';
      if (key === 'microsoft_tenant_id') return 'tenant-tenant-id';
      return null;
    });
    const getAppSecretMock = vi.fn(async () => 'app-fallback');
    getSecretProviderInstanceMock.mockResolvedValue({
      getTenantSecret: getTenantSecretMock,
      getAppSecret: getAppSecretMock,
    });

    const { resolveMicrosoftCredentialsForTenant } = await import(
      '@ee/lib/integrations/entra/auth/microsoftCredentialResolver'
    );
    const credentials = await resolveMicrosoftCredentialsForTenant('tenant-42');

    expect(credentials).toEqual({
      clientId: 'tenant-client-id',
      clientSecret: 'tenant-client-secret',
      tenantId: 'tenant-tenant-id',
      source: 'tenant-secret',
    });
    expect(getAppSecretMock).not.toHaveBeenCalled();
  });

  it('T043: falls back to env credentials when tenant pair is absent', async () => {
    process.env.MICROSOFT_CLIENT_ID = 'env-client-id-43';
    process.env.MICROSOFT_CLIENT_SECRET = 'env-client-secret-43';
    process.env.MICROSOFT_TENANT_ID = 'env-tenant-id-43';

    const getTenantSecretMock = vi.fn(async () => null);
    const getAppSecretMock = vi.fn(async () => 'app-fallback-43');
    getSecretProviderInstanceMock.mockResolvedValue({
      getTenantSecret: getTenantSecretMock,
      getAppSecret: getAppSecretMock,
    });

    const { resolveMicrosoftCredentialsForTenant } = await import(
      '@ee/lib/integrations/entra/auth/microsoftCredentialResolver'
    );
    const credentials = await resolveMicrosoftCredentialsForTenant('tenant-43');

    expect(credentials).toEqual({
      clientId: 'env-client-id-43',
      clientSecret: 'env-client-secret-43',
      tenantId: 'env-tenant-id-43',
      source: 'env',
    });
    expect(getAppSecretMock).not.toHaveBeenCalled();
  });

  it('T044: falls back to app secrets when tenant and env credentials are absent', async () => {
    const getTenantSecretMock = vi.fn(async () => null);
    const getAppSecretMock = vi.fn(async (key: string) => {
      if (key === 'MICROSOFT_CLIENT_ID') return 'app-client-id-44';
      if (key === 'MICROSOFT_CLIENT_SECRET') return 'app-client-secret-44';
      if (key === 'MICROSOFT_TENANT_ID') return 'app-tenant-id-44';
      return null;
    });
    getSecretProviderInstanceMock.mockResolvedValue({
      getTenantSecret: getTenantSecretMock,
      getAppSecret: getAppSecretMock,
    });

    const { resolveMicrosoftCredentialsForTenant } = await import(
      '@ee/lib/integrations/entra/auth/microsoftCredentialResolver'
    );
    const credentials = await resolveMicrosoftCredentialsForTenant('tenant-44');

    expect(credentials).toEqual({
      clientId: 'app-client-id-44',
      clientSecret: 'app-client-secret-44',
      tenantId: 'app-tenant-id-44',
      source: 'app-secret',
    });
  });
});
