import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn());
const createTenantKnexMock = vi.hoisted(() => vi.fn());
const resolveXeroOAuthCredentialsMock = vi.hoisted(() => vi.fn());
const getXeroRedirectUriMock = vi.hoisted(() => vi.fn());
const getXeroOAuthScopesStringMock = vi.hoisted(() => vi.fn());
const upsertStoredXeroConnectionsMock = vi.hoisted(() => vi.fn());
const getSecretProviderInstanceMock = vi.hoisted(() => vi.fn());
const axiosPostMock = vi.hoisted(() => vi.fn());
const axiosGetMock = vi.hoisted(() => vi.fn());
const loggerInfoMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth', () => ({
  getSession: getSessionMock
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: getSecretProviderInstanceMock
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock
  }
}));

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  XERO_TOKEN_URL: 'https://identity.xero.com/connect/token',
  resolveXeroOAuthCredentials: resolveXeroOAuthCredentialsMock,
  getXeroRedirectUri: getXeroRedirectUriMock,
  getXeroOAuthScopesString: getXeroOAuthScopesStringMock,
  upsertStoredXeroConnections: upsertStoredXeroConnectionsMock
}));

vi.mock('axios', () => ({
  default: {
    post: axiosPostMock,
    get: axiosGetMock
  }
}));

describe('Xero OAuth routes', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.resetModules();
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    getSessionMock.mockResolvedValue({
      user: {
        id: 'user-1',
        tenant: 'tenant-1',
        user_type: 'internal',
        roles: ['admin']
      }
    });
    hasPermissionMock.mockResolvedValue(true);
    createTenantKnexMock.mockResolvedValue({ tenant: 'tenant-1' });
    getSecretProviderInstanceMock.mockResolvedValue({});
    resolveXeroOAuthCredentialsMock.mockResolvedValue({
      clientId: 'tenant-client-id',
      clientSecret: 'tenant-client-secret',
      source: 'tenant'
    });
    getXeroRedirectUriMock.mockResolvedValue('https://example.com/api/integrations/xero/callback');
    getXeroOAuthScopesStringMock.mockReturnValue(
      'offline_access accounting.settings accounting.transactions accounting.contacts'
    );
    upsertStoredXeroConnectionsMock.mockResolvedValue({});
    axiosPostMock.mockResolvedValue({
      data: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 1800,
        refresh_token_expires_in: 3600,
        scope: 'offline_access accounting.transactions'
      }
    });
    axiosGetMock.mockResolvedValue({
      data: [
        {
          id: 'connection-1',
          tenantId: 'xero-tenant-1',
          tenantName: 'Acme Holdings'
        }
      ]
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalEdition === undefined) {
      delete process.env.EDITION;
    } else {
      process.env.EDITION = originalEdition;
    }

    if (originalPublicEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalPublicEdition;
    }
  });

  it('T010: connect route returns a configuration error when neither tenant-owned nor fallback credentials are available', async () => {
    resolveXeroOAuthCredentialsMock.mockRejectedValueOnce(
      new Error('Xero client credentials are not configured for this tenant or the application fallback.')
    );

    const { GET } = await import('@/app/api/integrations/xero/connect/route');

    const response = await GET();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Xero client credentials are not configured for this tenant or the application fallback.'
    });
  });

  it('T025: connect route rejects non-enterprise requests before starting OAuth', async () => {
    process.env.EDITION = 'ce';
    process.env.NEXT_PUBLIC_EDITION = 'community';

    const { GET } = await import('@/app/api/integrations/xero/connect/route');

    const response = await GET();

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: 'Xero integration is only available in Enterprise Edition.'
    });
  });

  it('T011/T032/T033: connect route uses tenant-owned credentials and logs tenant context plus credential source without secret values', async () => {
    const { GET } = await import('@/app/api/integrations/xero/connect/route');

    const response = await GET();

    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'user-1',
        user_id: 'user-1'
      }),
      'billing_settings',
      'update'
    );
    expect(resolveXeroOAuthCredentialsMock).toHaveBeenCalledWith('tenant-1', {});
    expect(response.status).toBe(307);

    const location = response.headers.get('location');
    expect(location).toContain('https://login.xero.com/identity/connect/authorize');
    expect(location).toContain('client_id=tenant-client-id');
    expect(location).toContain(
      encodeURIComponent('https://example.com/api/integrations/xero/callback')
    );
    expect(loggerInfoMock).toHaveBeenCalledWith('[xeroOAuth] Starting Xero OAuth connect flow', {
      tenantId: 'tenant-1',
      credentialSource: 'tenant'
    });
    expect(JSON.stringify(loggerInfoMock.mock.calls)).not.toContain('tenant-client-secret');
  });

  it('T012: callback exchanges the code with tenant-owned credentials and persists returned Xero connections', async () => {
    const { GET } = await import('@/app/api/integrations/xero/callback/route');
    const state = Buffer.from(
      JSON.stringify({
        tenantId: 'tenant-1',
        csrf: 'csrf-token',
        codeVerifier: 'verifier-123'
      })
    ).toString('base64url');

    const response = await GET(
      new Request(`https://example.com/api/integrations/xero/callback?code=auth-code&state=${state}`)
    );

    expect(axiosPostMock).toHaveBeenCalledWith(
      'https://identity.xero.com/connect/token',
      expect.stringContaining('client_id=tenant-client-id'),
      expect.any(Object)
    );
    expect(axiosPostMock).toHaveBeenCalledWith(
      'https://identity.xero.com/connect/token',
      expect.stringContaining('client_secret=tenant-client-secret'),
      expect.any(Object)
    );
    expect(upsertStoredXeroConnectionsMock).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        'connection-1': expect.objectContaining({
          connectionId: 'connection-1',
          xeroTenantId: 'xero-tenant-1',
          tenantName: 'Acme Holdings',
          accessToken: 'access-token',
          refreshToken: 'refresh-token'
        })
      }),
      { prioritize: ['connection-1'] }
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('xero_status=success');
  });

  it('T013: callback redirects with a usable error when Xero returns no connections', async () => {
    axiosGetMock.mockResolvedValueOnce({ data: [] });

    const { GET } = await import('@/app/api/integrations/xero/callback/route');
    const state = Buffer.from(
      JSON.stringify({
        tenantId: 'tenant-1',
        csrf: 'csrf-token',
        codeVerifier: 'verifier-123'
      })
    ).toString('base64url');

    const response = await GET(
      new Request(`https://example.com/api/integrations/xero/callback?code=auth-code&state=${state}`)
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('xero_error=no_connections');
  });
});
