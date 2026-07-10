import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createQboOAuthState,
  QBO_OAUTH_STATE_COOKIE
} from '@alga-psa/integrations/lib/qbo/qboOAuthState';

const getSessionMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn());
const createTenantKnexMock = vi.hoisted(() => vi.fn());
const resolveQboOAuthCredentialsMock = vi.hoisted(() => vi.fn());
const getQboRedirectUriMock = vi.hoisted(() => vi.fn());
const getQboOAuthScopesStringMock = vi.hoisted(() => vi.fn());
const upsertStoredQboCredentialsMock = vi.hoisted(() => vi.fn());
const getSecretProviderInstanceMock = vi.hoisted(() => vi.fn());
const axiosPostMock = vi.hoisted(() => vi.fn());
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

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QBO_TOKEN_URL: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  resolveQboOAuthCredentials: resolveQboOAuthCredentialsMock,
  getQboRedirectUri: getQboRedirectUriMock,
  getQboOAuthScopesString: getQboOAuthScopesStringMock,
  upsertStoredQboCredentials: upsertStoredQboCredentialsMock
}));

vi.mock('axios', () => ({
  default: {
    post: axiosPostMock
  }
}));

const SIGNING_SECRET = 'qbo-test-signing-secret';

function buildCallbackRequest(params: {
  query: Record<string, string>;
  cookieValue?: string;
}): Request {
  const url = new URL('https://example.com/api/integrations/qbo/callback');
  for (const [key, value] of Object.entries(params.query)) {
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {};
  if (params.cookieValue) {
    headers.cookie = `${QBO_OAUTH_STATE_COOKIE}=${encodeURIComponent(params.cookieValue)}`;
  }

  return new Request(url, { headers });
}

describe('QBO OAuth routes', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;

  beforeEach(() => {
    vi.resetModules();
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    process.env.NEXTAUTH_SECRET = SIGNING_SECRET;
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
    resolveQboOAuthCredentialsMock.mockResolvedValue({
      clientId: 'tenant-client-id',
      clientSecret: 'tenant-client-secret',
      source: 'tenant'
    });
    getQboRedirectUriMock.mockResolvedValue('https://example.com/api/integrations/qbo/callback');
    getQboOAuthScopesStringMock.mockReturnValue('com.intuit.quickbooks.accounting');
    upsertStoredQboCredentialsMock.mockResolvedValue(undefined);
    axiosPostMock.mockResolvedValue({
      data: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        x_refresh_token_expires_in: 8640000
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();

    for (const [key, original] of [
      ['EDITION', originalEdition],
      ['NEXT_PUBLIC_EDITION', originalPublicEdition],
      ['NEXTAUTH_SECRET', originalNextAuthSecret]
    ] as const) {
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  });

  it('connect route rejects non-enterprise requests before starting OAuth', async () => {
    process.env.EDITION = 'ce';
    process.env.NEXT_PUBLIC_EDITION = 'community';

    const { GET } = await import('@/app/api/integrations/qbo/connect/route');

    const response = await GET();

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: 'QuickBooks Online integration is only available in Enterprise Edition.'
    });
  });

  it('connect route returns a configuration error when neither tenant-owned nor fallback credentials are available', async () => {
    resolveQboOAuthCredentialsMock.mockRejectedValueOnce(
      new Error('QuickBooks client credentials are not configured for this tenant or the application fallback.')
    );

    const { GET } = await import('@/app/api/integrations/qbo/connect/route');

    const response = await GET();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'QuickBooks connection is not configured for this workspace.'
    });
  });

  it('connect route redirects to Intuit with the resolved credentials, sets the state cookie, and never logs secrets', async () => {
    const { GET } = await import('@/app/api/integrations/qbo/connect/route');

    const response = await GET();

    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'user-1',
        user_id: 'user-1'
      }),
      'billing_settings',
      'update'
    );
    expect(resolveQboOAuthCredentialsMock).toHaveBeenCalledWith('tenant-1', {});
    expect(response.status).toBe(307);

    const location = response.headers.get('location');
    expect(location).toContain('https://appcenter.intuit.com/connect/oauth2');
    expect(location).toContain('client_id=tenant-client-id');
    expect(location).toContain('scope=com.intuit.quickbooks.accounting');
    expect(location).toContain(
      encodeURIComponent('https://example.com/api/integrations/qbo/callback')
    );
    expect(location).toContain('state=');

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${QBO_OAUTH_STATE_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/api/integrations/qbo');

    expect(loggerInfoMock).toHaveBeenCalledWith('[qboOAuth] Starting QuickBooks OAuth connect flow', {
      tenantId: 'tenant-1',
      credentialSource: 'tenant'
    });
    expect(JSON.stringify(loggerInfoMock.mock.calls)).not.toContain('tenant-client-secret');
  });

  it('callback rejects non-enterprise requests', async () => {
    process.env.EDITION = 'ce';
    process.env.NEXT_PUBLIC_EDITION = 'community';

    const { GET } = await import('@/app/api/integrations/qbo/callback/route');

    const response = await GET(
      buildCallbackRequest({ query: { code: 'auth-code', state: 'whatever', realmId: 'realm-1' } })
    );

    expect(response.status).toBe(501);
  });

  it('callback exchanges the code with Basic auth and persists credentials for the realm', async () => {
    const { stateParam, cookieValue } = createQboOAuthState({
      tenantId: 'tenant-1',
      secret: SIGNING_SECRET
    });

    const { GET } = await import('@/app/api/integrations/qbo/callback/route');

    const response = await GET(
      buildCallbackRequest({
        query: { code: 'auth-code', state: stateParam, realmId: 'realm-1' },
        cookieValue
      })
    );

    const expectedBasicAuth = `Basic ${Buffer.from('tenant-client-id:tenant-client-secret').toString('base64')}`;
    expect(axiosPostMock).toHaveBeenCalledWith(
      'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      expect.stringContaining('grant_type=authorization_code'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expectedBasicAuth })
      })
    );
    expect(upsertStoredQboCredentialsMock).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        realmId: 'realm-1',
        accessToken: 'access-token',
        refreshToken: 'refresh-token'
      })
    );
    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('qbo_status=success');
    expect(location).toContain('accounting_integration=qbo');

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${QBO_OAUTH_STATE_COOKIE}=`);
    expect(setCookie).toContain('Max-Age=0');
  });

  it('callback rejects a missing state cookie as invalid_state', async () => {
    const { stateParam } = createQboOAuthState({
      tenantId: 'tenant-1',
      secret: SIGNING_SECRET
    });

    const { GET } = await import('@/app/api/integrations/qbo/callback/route');

    const response = await GET(
      buildCallbackRequest({
        query: { code: 'auth-code', state: stateParam, realmId: 'realm-1' }
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('qbo_error=invalid_state');
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it('callback rejects a state param that does not match the cookie as invalid_state', async () => {
    const { cookieValue } = createQboOAuthState({
      tenantId: 'tenant-1',
      secret: SIGNING_SECRET
    });
    const { stateParam: foreignState } = createQboOAuthState({
      tenantId: 'tenant-1',
      secret: SIGNING_SECRET
    });

    const { GET } = await import('@/app/api/integrations/qbo/callback/route');

    const response = await GET(
      buildCallbackRequest({
        query: { code: 'auth-code', state: foreignState, realmId: 'realm-1' },
        cookieValue
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('qbo_error=invalid_state');
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it('callback surfaces an Intuit error param as a failure redirect', async () => {
    const { GET } = await import('@/app/api/integrations/qbo/callback/route');

    const response = await GET(
      buildCallbackRequest({ query: { error: 'access_denied' } })
    );

    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('qbo_status=failure');
    expect(location).toContain('qbo_error=access_denied');
  });

  it('callback requires code, state, and realmId', async () => {
    const { stateParam, cookieValue } = createQboOAuthState({
      tenantId: 'tenant-1',
      secret: SIGNING_SECRET
    });

    const { GET } = await import('@/app/api/integrations/qbo/callback/route');

    const response = await GET(
      buildCallbackRequest({
        query: { code: 'auth-code', state: stateParam },
        cookieValue
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('qbo_error=missing_params');
  });
});
