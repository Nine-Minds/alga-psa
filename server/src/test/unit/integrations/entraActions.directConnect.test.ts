import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionMock = vi.fn();
const featureFlagIsEnabledMock = vi.fn();
const resolveMicrosoftCredentialsForTenantMock = vi.fn();
const clearEntraCippCredentialsMock = vi.fn();
const saveEntraCippCredentialsMock = vi.fn();
const clearEntraDirectTokenSetMock = vi.fn();
const getSecretProviderInstanceMock = vi.fn();
const createTenantKnexMock = vi.fn();

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
  saveEntraCippCredentials: saveEntraCippCredentialsMock,
}));

vi.mock('@enterprise/lib/integrations/entra/auth/tokenStore', () => ({
  clearEntraDirectTokenSet: clearEntraDirectTokenSetMock,
}));

vi.mock('@alga-psa/core/secrets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/core/secrets')>();
  return {
    ...actual,
    getSecretProviderInstance: getSecretProviderInstanceMock,
  };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

describe('Entra direct connect action permissions', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    featureFlagIsEnabledMock.mockReset();
    resolveMicrosoftCredentialsForTenantMock.mockReset();
    clearEntraCippCredentialsMock.mockReset();
    saveEntraCippCredentialsMock.mockReset();
    clearEntraDirectTokenSetMock.mockReset();
    getSecretProviderInstanceMock.mockReset();
    createTenantKnexMock.mockReset();
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

  it('T036: CIPP connect validates base URL format and rejects invalid values', async () => {
    hasPermissionMock.mockResolvedValue(true);
    featureFlagIsEnabledMock.mockResolvedValue(true);

    const { connectEntraCipp } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    const result = await connectEntraCipp(
      { user_id: 'user-36', user_type: 'internal' } as any,
      { tenant: 'tenant-36' },
      { baseUrl: 'not a valid url', apiToken: 'token-36' }
    );

    expect(result).toEqual({
      success: false,
      error: 'CIPP base URL must be a valid http(s) URL.',
    });
    expect(clearEntraCippCredentialsMock).not.toHaveBeenCalled();
  });

  it('T037: CIPP connect stores API token via secret provider without plaintext DB token', async () => {
    hasPermissionMock.mockResolvedValue(true);
    featureFlagIsEnabledMock.mockResolvedValue(true);
    clearEntraDirectTokenSetMock.mockResolvedValue(undefined);
    saveEntraCippCredentialsMock.mockResolvedValue(undefined);

    const whereMock = vi.fn().mockReturnThis();
    const updateMock = vi.fn(async () => 1);
    const insertMock = vi.fn(async () => [1]);
    const knexMock = vi.fn(() => ({
      where: whereMock,
      update: updateMock,
      insert: insertMock,
    })) as any;
    knexMock.fn = { now: vi.fn(() => 'db-now') };
    knexMock.raw = vi.fn((value: string) => `RAW(${value})`);
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    const { connectEntraCipp } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    const result = await connectEntraCipp(
      { user_id: 'user-37', user_type: 'internal' } as any,
      { tenant: 'tenant-37' },
      { baseUrl: 'cipp.example.com/base', apiToken: 'cipp-token-37' }
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Expected success, got ${result.error}`);
    }
    expect(result.data.baseUrl).toBe('https://cipp.example.com/base');

    expect(saveEntraCippCredentialsMock).toHaveBeenCalledWith('tenant-37', {
      baseUrl: 'https://cipp.example.com/base',
      apiToken: 'cipp-token-37',
    });

    const insertedRow = insertMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedRow).toMatchObject({
      tenant: 'tenant-37',
      connection_type: 'cipp',
      status: 'connected',
      is_active: true,
      cipp_base_url: 'https://cipp.example.com/base',
      token_secret_ref: 'entra_cipp',
    });
    expect(insertedRow).not.toHaveProperty('apiToken');
    expect(Object.values(insertedRow)).not.toContain('cipp-token-37');
  });

  it('T041: switching direct<->CIPP clears stale credentials from the previous mode', async () => {
    hasPermissionMock.mockResolvedValue(true);
    featureFlagIsEnabledMock.mockResolvedValue(true);

    resolveMicrosoftCredentialsForTenantMock.mockResolvedValue({
      clientId: 'client-id-41',
      clientSecret: 'client-secret-41',
      tenantId: null,
      source: 'tenant-secret',
    });
    getSecretProviderInstanceMock.mockResolvedValue({
      getAppSecret: vi.fn(async () => null),
    });

    const { initiateEntraDirectOAuth, connectEntraCipp } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    await initiateEntraDirectOAuth(
      { user_id: 'user-41a', user_type: 'internal' } as any,
      { tenant: 'tenant-41a' }
    );
    expect(clearEntraCippCredentialsMock).toHaveBeenCalledWith('tenant-41a');

    clearEntraDirectTokenSetMock.mockResolvedValue(undefined);
    saveEntraCippCredentialsMock.mockResolvedValue(undefined);

    const whereMock = vi.fn().mockReturnThis();
    const updateMock = vi.fn(async () => 1);
    const insertMock = vi.fn(async () => [1]);
    const knexMock = vi.fn(() => ({
      where: whereMock,
      update: updateMock,
      insert: insertMock,
    })) as any;
    knexMock.fn = { now: vi.fn(() => 'db-now') };
    knexMock.raw = vi.fn((value: string) => `RAW(${value})`);
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    await connectEntraCipp(
      { user_id: 'user-41b', user_type: 'internal' } as any,
      { tenant: 'tenant-41b' },
      { baseUrl: 'https://cipp.example.com', apiToken: 'token-41b' }
    );

    expect(clearEntraDirectTokenSetMock).toHaveBeenCalledWith('tenant-41b');
  });
});
