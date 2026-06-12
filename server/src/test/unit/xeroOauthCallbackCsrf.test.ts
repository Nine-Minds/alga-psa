import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: vi.fn(async () => null),
    getTenantSecret: vi.fn(async () => null),
    setTenantSecret: vi.fn(async () => undefined),
  })),
}));

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  getXeroRedirectUri: vi.fn(async () => 'http://localhost:3000/api/integrations/xero/callback'),
  resolveXeroOAuthCredentials: vi.fn(async () => ({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    source: 'tenant',
  })),
  upsertStoredXeroConnections: vi.fn(async () => undefined),
  XERO_TOKEN_URL: 'https://identity.xero.com/connect/token',
}));

vi.mock('axios', () => {
  const post = vi.fn();
  const get = vi.fn();
  return { default: { post, get }, post, get };
});

import { GET } from '@alga-psa/integrations/routes/api/integrations/xero/callback';
import { XERO_OAUTH_CSRF_COOKIE } from '@alga-psa/integrations/lib/xero/oauthCsrf';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import * as xeroMocks from '@alga-psa/integrations/lib/xero/xeroClientService';
import axios from 'axios';

const CALLBACK_URL = 'http://localhost:3000/api/integrations/xero/callback';
const tenantId = 'tenant-a';
const csrfToken = 'a'.repeat(64);

const prevEdition = process.env.EDITION;
process.env.EDITION = 'ee';
afterAll(() => {
  process.env.EDITION = prevEdition;
});

function encodeState(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function makeRequest(state: string, csrfCookie?: string): NextRequest {
  const url = `${CALLBACK_URL}?code=auth-code&state=${state}`;
  const headers = csrfCookie
    ? { cookie: `${XERO_OAUTH_CSRF_COOKIE.name}=${csrfCookie}` }
    : undefined;
  return new NextRequest(url, { headers });
}

function redirectError(response: Response): string | null {
  const location = response.headers.get('location');
  if (!location) return null;
  return new URL(location).searchParams.get('xero_error');
}

describe('Xero OAuth callback CSRF and tenant validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUser).mockResolvedValue({ tenant: tenantId } as any);
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 1800,
        refresh_token_expires_in: 60 * 60 * 24 * 90,
        scope: 'accounting.transactions',
      },
    });
    vi.mocked(axios.get).mockResolvedValue({
      data: [{ id: 'conn-1', tenantId: 'xero-tenant-1', tenantName: 'Acme' }],
    });
  });

  it('rejects a callback without the CSRF cookie', async () => {
    const response = await GET(makeRequest(encodeState({ tenantId, csrf: csrfToken, codeVerifier: 'v' })));
    expect(redirectError(response)).toBe('csrf_mismatch');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects a callback whose state csrf does not match the cookie', async () => {
    const response = await GET(
      makeRequest(encodeState({ tenantId, csrf: 'b'.repeat(64), codeVerifier: 'v' }), csrfToken)
    );
    expect(redirectError(response)).toBe('csrf_mismatch');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects a callback without an authenticated session', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await GET(
      makeRequest(encodeState({ tenantId, csrf: csrfToken, codeVerifier: 'v' }), csrfToken)
    );
    expect(redirectError(response)).toBe('session_expired');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects a state tenantId that does not match the session tenant', async () => {
    const response = await GET(
      makeRequest(encodeState({ tenantId: 'tenant-victim', csrf: csrfToken, codeVerifier: 'v' }), csrfToken)
    );
    expect(redirectError(response)).toBe('tenant_mismatch');
    expect(axios.post).not.toHaveBeenCalled();
    expect(vi.mocked(xeroMocks.upsertStoredXeroConnections)).not.toHaveBeenCalled();
  });

  it('completes the exchange when cookie, state, and session agree', async () => {
    const response = await GET(
      makeRequest(encodeState({ tenantId, csrf: csrfToken, codeVerifier: 'v' }), csrfToken)
    );
    const location = response.headers.get('location');
    expect(location).toContain('xero_status=success');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(vi.mocked(xeroMocks.upsertStoredXeroConnections)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(xeroMocks.upsertStoredXeroConnections).mock.calls[0][0]).toBe(tenantId);

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${XERO_OAUTH_CSRF_COOKIE.name}=`);
    expect(setCookie.toLowerCase()).toContain('max-age=0');
  });
});
