import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionMock = vi.fn();
const featureFlagIsEnabledMock = vi.fn();
const resolveMicrosoftCredentialsForTenantMock = vi.fn();
const clearEntraCippCredentialsMock = vi.fn();
const getSecretProviderInstanceMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('server/src/lib/feature-flags/featureFlags', () => ({
  featureFlags: {
    isEnabled: featureFlagIsEnabledMock,
  },
}));

vi.mock('@enterprise/lib/integrations/entra/auth/microsoftCredentialResolver', () => ({
  resolveMicrosoftCredentialsForTenant: resolveMicrosoftCredentialsForTenantMock,
}));

vi.mock('@enterprise/lib/integrations/entra/providers/cipp/cippSecretStore', () => ({
  clearEntraCippCredentials: clearEntraCippCredentialsMock,
}));

vi.mock('@alga-psa/core/secrets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/core/secrets')>();
  return {
    ...actual,
    getSecretProviderInstance: getSecretProviderInstanceMock,
  };
});

describe('Entra direct connect action permissions', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    featureFlagIsEnabledMock.mockReset();
    resolveMicrosoftCredentialsForTenantMock.mockReset();
    clearEntraCippCredentialsMock.mockReset();
    getSecretProviderInstanceMock.mockReset();
  });

  it('T031: direct connect initiation rejects users lacking update permission', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const { initiateEntraDirectOAuth } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    const result = await initiateEntraDirectOAuth(
      { user_id: 'user-1', user_type: 'internal' } as any,
      { tenant: 'tenant-1' }
    );

    expect(result).toEqual({
      success: false,
      error: 'Forbidden: insufficient permissions to configure Entra integration',
    });
    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'system_settings',
      'update'
    );
  });

  it('T032: direct connect initiation returns OAuth URL with encoded nonce/state', async () => {
    hasPermissionMock.mockResolvedValue(true);
    featureFlagIsEnabledMock.mockResolvedValue(true);
    resolveMicrosoftCredentialsForTenantMock.mockResolvedValue({
      clientId: 'client-id-1',
      clientSecret: 'client-secret-1',
      tenantId: null,
      source: 'tenant-secret',
    });
    clearEntraCippCredentialsMock.mockResolvedValue(undefined);
    getSecretProviderInstanceMock.mockResolvedValue({
      getAppSecret: vi.fn(async () => null),
    });

    const { initiateEntraDirectOAuth } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    const result = await initiateEntraDirectOAuth(
      { user_id: 'user-7', user_type: 'internal' } as any,
      { tenant: 'tenant-7' }
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Expected success, got ${result.error}`);
    }

    const authUrl = new URL(result.data.authUrl);
    const encodedState = result.data.state;
    const stateFromAuthUrl = authUrl.searchParams.get('state');
    const decodedState = JSON.parse(Buffer.from(encodedState, 'base64').toString('utf8'));

    expect(authUrl.origin).toBe('https://login.microsoftonline.com');
    expect(authUrl.pathname).toBe('/common/oauth2/v2.0/authorize');
    expect(authUrl.searchParams.get('client_id')).toBe('client-id-1');
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('scope')).toContain('offline_access');
    expect(stateFromAuthUrl).toBe(encodedState);

    expect(decodedState).toMatchObject({
      tenant: 'tenant-7',
      userId: 'user-7',
      provider: 'microsoft',
      integration: 'entra',
      connectionType: 'direct',
    });
    expect(typeof decodedState.timestamp).toBe('number');
    expect(typeof decodedState.nonce).toBe('string');
    expect(decodedState.nonce.length).toBeGreaterThan(0);
    expect(typeof decodedState.redirectUri).toBe('string');
    expect(decodedState.redirectUri).toContain('/api/auth/microsoft/entra/callback');
  });
});
