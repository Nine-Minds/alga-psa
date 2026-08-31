import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getCurrentUserWithRevocationCheckMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn());
const createTenantKnexMock = vi.hoisted(() => vi.fn());
const resolveXeroOAuthCredentialsMock = vi.hoisted(() => vi.fn());
const getXeroRedirectUriMock = vi.hoisted(() => vi.fn());
const getXeroOAuthScopesStringMock = vi.hoisted(() => vi.fn());
const getXeroOAuthScopeConfigMock = vi.hoisted(() => vi.fn());
const upsertStoredXeroConnectionsMock = vi.hoisted(() => vi.fn());
const getSecretProviderInstanceMock = vi.hoisted(() => vi.fn());
const isProviderDisconnectActiveMock = vi.hoisted(() => vi.fn());
const storeAccountingOAuthNonceMock = vi.hoisted(() => vi.fn());
const consumeAccountingOAuthNonceMock = vi.hoisted(() => vi.fn());
const axiosPostMock = vi.hoisted(() => vi.fn());
const axiosGetMock = vi.hoisted(() => vi.fn());
const loggerInfoMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());

// The connect and callback routes resolve and re-authorize the live user via the
// central accounting-connection policy (getCurrentUserWithRevocationCheck +
// hasPermission), so both must be present on the auth mock.
vi.mock('@alga-psa/auth', () => ({
  getCurrentUserWithRevocationCheck: getCurrentUserWithRevocationCheckMock,
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

// The single-use OAuth state store is Redis-backed in production; here it is a
// deterministic double so the connect route can issue a nonce and the callback
// can consume it exactly once.
vi.mock('@alga-psa/integrations/lib/accountingOAuthStateStore', () => ({
  storeAccountingOAuthNonce: storeAccountingOAuthNonceMock,
  consumeAccountingOAuthNonce: consumeAccountingOAuthNonceMock
}));

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  XERO_TOKEN_URL: 'https://identity.xero.com/connect/token',
  getXeroTokenUrl: () => 'https://identity.xero.com/connect/token',
  getXeroConnectionsUrl: () => 'https://api.xero.com/connections',
  resolveXeroOAuthCredentials: resolveXeroOAuthCredentialsMock,
  getXeroRedirectUri: getXeroRedirectUriMock,
  getXeroOAuthScopesString: getXeroOAuthScopesStringMock,
  getXeroOAuthScopeConfig: getXeroOAuthScopeConfigMock,
  upsertStoredXeroConnections: upsertStoredXeroConnectionsMock
}));

vi.mock('@alga-psa/integrations/lib/providerDisconnect', () => ({
  isProviderDisconnectActive: isProviderDisconnectActiveMock,
  getProviderDisconnectStatusInfo: vi.fn(async () => null),
  getProviderCredentialWriteDisposition: vi.fn(async (knex, tenant, provider) =>
    (await isProviderDisconnectActiveMock(knex, tenant, provider)) ? 'disconnect_in_progress' : 'allowed'
  ),
  withProviderCredentialLock: vi.fn(async (_knex, _tenant, _provider, fn) => fn({})),
  PROVIDER_QBO: 'quickbooks_online',
  PROVIDER_XERO: 'xero'
}));

vi.mock('axios', () => ({
  default: {
    post: axiosPostMock,
    get: axiosGetMock
  }
}));

const XERO_CSRF_COOKIE = 'alga_xero_oauth_csrf';

const liveUser = {
  id: 'user-1',
  user_id: 'user-1',
  tenant: 'tenant-1',
  user_type: 'internal',
  roles: ['admin']
};

// The Xero OAuth state is an unsigned base64url JSON payload bound to the
// initiating tenant + user, carrying the PKCE verifier, CSRF token, and the
// single-use nonce.
function buildXeroState(overrides: Partial<{
  tenantId: string;
  userId: string;
  csrf: string;
  codeVerifier: string;
  nonce: string;
  initiatedAt: string;
}> = {}): string {
  const payload = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    csrf: 'csrf-token',
    codeVerifier: 'verifier-123',
    nonce: 'nonce-123',
    initiatedAt: '2026-08-31T12:00:00.000Z',
    ...overrides
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function buildCallbackRequest(params: {
  state: string;
  csrfCookie?: string;
  code?: string;
}): NextRequest {
  const search = new URLSearchParams();
  if (params.code !== undefined) {
    search.set('code', params.code);
  }
  search.set('state', params.state);
  const headers = params.csrfCookie
    ? { cookie: `${XERO_CSRF_COOKIE}=${params.csrfCookie}` }
    : undefined;
  return new NextRequest(
    `https://example.com/api/integrations/xero/callback?${search.toString()}`,
    { headers }
  );
}

describe('Xero OAuth routes', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.resetModules();
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    getCurrentUserWithRevocationCheckMock.mockResolvedValue({ ...liveUser });
    hasPermissionMock.mockResolvedValue(true);
    createTenantKnexMock.mockResolvedValue({ tenant: 'tenant-1', knex: {} });
    getSecretProviderInstanceMock.mockResolvedValue({});
    storeAccountingOAuthNonceMock.mockResolvedValue(undefined);
    consumeAccountingOAuthNonceMock.mockResolvedValue({
      tenantId: 'tenant-1',
      initiatedAt: '2026-08-31T12:00:00.000Z'
    });
    resolveXeroOAuthCredentialsMock.mockResolvedValue({
      clientId: 'tenant-client-id',
      clientSecret: 'tenant-client-secret',
      source: 'tenant'
    });
    getXeroRedirectUriMock.mockResolvedValue('https://example.com/api/integrations/xero/callback');
    getXeroOAuthScopesStringMock.mockReturnValue(
      'offline_access accounting.settings.read accounting.invoices accounting.contacts'
    );
    getXeroOAuthScopeConfigMock.mockReturnValue({
      scopes: ['offline_access', 'accounting.settings.read', 'accounting.invoices', 'accounting.contacts'],
      source: 'default'
    });
    upsertStoredXeroConnectionsMock.mockResolvedValue({});
    isProviderDisconnectActiveMock.mockResolvedValue(false);
    axiosPostMock.mockResolvedValue({
      data: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 1800,
        refresh_token_expires_in: 3600,
        scope: 'offline_access accounting.settings.read accounting.invoices accounting.contacts'
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
      error: 'Xero connection is not configured for this workspace.'
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

  it('connect route requires the accounting connection-admin permission', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const { GET } = await import('@/app/api/integrations/xero/connect/route');

    const response = await GET();

    expect(response.status).toBe(403);
    expect(axiosPostMock).not.toHaveBeenCalled();
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
    expect(resolveXeroOAuthCredentialsMock).toHaveBeenCalledWith('tenant-1', expect.anything());
    expect(response.status).toBe(307);

    const location = response.headers.get('location');
    expect(location).toContain('https://login.xero.com/identity/connect/authorize');
    expect(location).toContain('client_id=tenant-client-id');
    // URLSearchParams form-encodes spaces as '+'.
    expect(location).toContain(
      'scope=offline_access+accounting.settings.read+accounting.invoices+accounting.contacts'
    );
    expect(location).not.toContain('banktransactions');
    expect(location).not.toContain('accounting.payments');
    expect(location).toContain(
      encodeURIComponent('https://example.com/api/integrations/xero/callback')
    );

    // The nonce backing the issued state is registered for single use.
    expect(storeAccountingOAuthNonceMock).toHaveBeenCalledWith(
      'xero',
      expect.any(String),
      expect.objectContaining({ tenantId: 'tenant-1', initiatedAt: expect.any(String) })
    );

    expect(loggerInfoMock).toHaveBeenCalledWith('[xeroOAuth] Starting Xero OAuth connect flow', {
      tenantId: 'tenant-1',
      userId: 'user-1',
      credentialSource: 'tenant',
      scopeSource: 'default',
      scopes: ['offline_access', 'accounting.settings.read', 'accounting.invoices', 'accounting.contacts']
    });
    expect(JSON.stringify(loggerInfoMock.mock.calls)).not.toContain('tenant-client-secret');
  });

  it('T012: callback exchanges the code with tenant-owned credentials and persists returned Xero connections', async () => {
    const { GET } = await import('@/app/api/integrations/xero/callback/route');

    const response = await GET(
      buildCallbackRequest({ state: buildXeroState(), csrfCookie: 'csrf-token', code: 'auth-code' })
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
      {
        prioritize: ['connection-1'],
        authorizationFlowStartedAt: '2026-08-31T12:00:00.000Z'
      }
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('xero_status=success');
  });

  it('callback denies and stores nothing when the connection-admin permission was revoked', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const { GET } = await import('@/app/api/integrations/xero/callback/route');

    const response = await GET(
      buildCallbackRequest({ state: buildXeroState(), csrfCookie: 'csrf-token', code: 'auth-code' })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('xero_error=forbidden');
    expect(axiosPostMock).not.toHaveBeenCalled();
    expect(upsertStoredXeroConnectionsMock).not.toHaveBeenCalled();
  });

  it('callback denies and stores nothing when a different user completes the flow', async () => {
    getCurrentUserWithRevocationCheckMock.mockResolvedValue({ ...liveUser, id: 'user-2', user_id: 'user-2' });

    const { GET } = await import('@/app/api/integrations/xero/callback/route');

    const response = await GET(
      buildCallbackRequest({ state: buildXeroState(), csrfCookie: 'csrf-token', code: 'auth-code' })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('xero_error=user_mismatch');
    expect(axiosPostMock).not.toHaveBeenCalled();
    expect(upsertStoredXeroConnectionsMock).not.toHaveBeenCalled();
  });

  it('callback denies a replayed state (already consumed) with no side effects', async () => {
    consumeAccountingOAuthNonceMock.mockResolvedValue(null);

    const { GET } = await import('@/app/api/integrations/xero/callback/route');

    const response = await GET(
      buildCallbackRequest({ state: buildXeroState(), csrfCookie: 'csrf-token', code: 'auth-code' })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('xero_error=state_replayed');
    expect(axiosPostMock).not.toHaveBeenCalled();
    expect(upsertStoredXeroConnectionsMock).not.toHaveBeenCalled();
  });

  it('callback rejects a CSRF cookie that does not match the state token', async () => {
    const { GET } = await import('@/app/api/integrations/xero/callback/route');

    const response = await GET(
      buildCallbackRequest({ state: buildXeroState(), csrfCookie: 'a-different-token', code: 'auth-code' })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('xero_error=csrf_mismatch');
    expect(axiosPostMock).not.toHaveBeenCalled();
    expect(upsertStoredXeroConnectionsMock).not.toHaveBeenCalled();
  });

  it('T013: callback redirects with a usable error when Xero returns no connections', async () => {
    axiosGetMock.mockResolvedValueOnce({ data: [] });

    const { GET } = await import('@/app/api/integrations/xero/callback/route');

    const response = await GET(
      buildCallbackRequest({ state: buildXeroState(), csrfCookie: 'csrf-token', code: 'auth-code' })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('xero_error=no_connections');
  });

  it('T032: callback rejects with disconnect_in_progress while a Xero disconnect is active and never stores connections', async () => {
    isProviderDisconnectActiveMock.mockResolvedValue(true);
    // The connect route registered the state nonce for single use.
    consumeAccountingOAuthNonceMock.mockResolvedValue({
      tenantId: 'tenant-1',
      initiatedAt: '2026-08-31T12:00:00.000Z'
    });

    const { GET } = await import('@/app/api/integrations/xero/callback/route');
    const state = buildXeroState();

    const response = await GET(
      new NextRequest(`https://example.com/api/integrations/xero/callback?code=auth-code&state=${state}`, {
        headers: { cookie: 'alga_xero_oauth_csrf=csrf-token' }
      })
    );

    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('xero_status=failure');
    expect(location).toContain('xero_error=disconnect_in_progress');
    expect(axiosPostMock).not.toHaveBeenCalled();
    expect(upsertStoredXeroConnectionsMock).not.toHaveBeenCalled();
    expect(isProviderDisconnectActiveMock).toHaveBeenCalledTimes(1);
    expect(isProviderDisconnectActiveMock.mock.calls[0]).toEqual(
      expect.arrayContaining(['tenant-1', 'xero'])
    );
  });
});
