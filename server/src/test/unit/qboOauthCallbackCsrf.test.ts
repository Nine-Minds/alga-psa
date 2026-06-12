import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(),
}));

vi.mock('axios', () => {
  const post = vi.fn();
  const isAxiosError = vi.fn(() => false);
  return { default: { post, isAxiosError }, post, isAxiosError };
});

import { GET } from '@alga-psa/integrations/routes/api/integrations/qbo/callback';
import {
  QBO_OAUTH_CSRF_COOKIE_NAME,
  qboOauthCsrfTokensMatch,
} from '@alga-psa/integrations/lib/qbo/oauthCsrf';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import axios from 'axios';

const CALLBACK_URL = 'http://localhost:3000/api/integrations/qbo/callback';

function encodeState(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function makeRequest(state: string, csrfCookie?: string): NextRequest {
  const url = `${CALLBACK_URL}?code=auth-code&realmId=realm-1&state=${state}`;
  const headers = csrfCookie
    ? { cookie: `${QBO_OAUTH_CSRF_COOKIE_NAME}=${csrfCookie}` }
    : undefined;
  return new NextRequest(url, { headers });
}

function redirectError(response: Response): string | null {
  const location = response.headers.get('location');
  if (!location) return null;
  return new URL(location).searchParams.get('error');
}

describe('qboOauthCsrfTokensMatch', () => {
  it('accepts identical tokens', () => {
    expect(qboOauthCsrfTokensMatch('a'.repeat(64), 'a'.repeat(64))).toBe(true);
  });

  it('rejects tokens that differ', () => {
    expect(qboOauthCsrfTokensMatch('a'.repeat(64), 'a'.repeat(63) + 'b')).toBe(false);
  });

  it('rejects tokens of different length', () => {
    expect(qboOauthCsrfTokensMatch('a'.repeat(64), 'a'.repeat(32))).toBe(false);
  });
});

describe('QBO OAuth callback CSRF and tenant validation', () => {
  const csrfToken = 'f'.repeat(64);
  const tenantId = 'tenant-a';
  const secretProvider = {
    getAppSecret: vi.fn(async (name: string) =>
      name === 'qbo_client_id' ? 'client-id' : 'client-secret'
    ),
    getTenantSecret: vi.fn(async () => null),
    setTenantSecret: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSecretProviderInstance).mockResolvedValue(secretProvider as any);
    vi.mocked(getCurrentUser).mockResolvedValue({ tenant: tenantId } as any);
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        x_refresh_token_expires_in: 8640000,
      },
    });
  });

  it('rejects a callback without the CSRF cookie', async () => {
    const response = await GET(makeRequest(encodeState({ tenantId, csrf: csrfToken })));
    expect(redirectError(response)).toBe('csrf_mismatch');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects a callback whose state csrf does not match the cookie', async () => {
    const response = await GET(
      makeRequest(encodeState({ tenantId, csrf: 'e'.repeat(64) }), csrfToken)
    );
    expect(redirectError(response)).toBe('csrf_mismatch');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects a callback without an authenticated session', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await GET(
      makeRequest(encodeState({ tenantId, csrf: csrfToken }), csrfToken)
    );
    expect(redirectError(response)).toBe('session_expired');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects a state tenantId that does not match the session tenant', async () => {
    const response = await GET(
      makeRequest(encodeState({ tenantId: 'tenant-victim', csrf: csrfToken }), csrfToken)
    );
    expect(redirectError(response)).toBe('tenant_mismatch');
    expect(axios.post).not.toHaveBeenCalled();
    expect(secretProvider.setTenantSecret).not.toHaveBeenCalled();
  });

  it('rejects a state payload with a non-string csrf value', async () => {
    const response = await GET(
      makeRequest(encodeState({ tenantId, csrf: { bogus: true } }), csrfToken)
    );
    expect(redirectError(response)).toBe('invalid_state');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('completes the exchange and stores credentials when cookie, state, and session agree', async () => {
    const response = await GET(
      makeRequest(encodeState({ tenantId, csrf: csrfToken }), csrfToken)
    );

    const location = response.headers.get('location');
    expect(location).toContain('qbo_status=success');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(secretProvider.setTenantSecret).toHaveBeenCalledTimes(1);
    expect(secretProvider.setTenantSecret.mock.calls[0][0]).toBe(tenantId);

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${QBO_OAUTH_CSRF_COOKIE_NAME}=`);
    expect(setCookie.toLowerCase()).toContain('max-age=0');
  });

  it('clears the CSRF cookie on failure redirects', async () => {
    const response = await GET(makeRequest(encodeState({ tenantId, csrf: csrfToken })));
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${QBO_OAUTH_CSRF_COOKIE_NAME}=`);
    expect(setCookie.toLowerCase()).toContain('max-age=0');
  });
});
