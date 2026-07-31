import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@alga-psa/auth', () => ({
  getSession: vi.fn(),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(),
}));

vi.mock('axios', () => {
  const post = vi.fn();
  const isAxiosError = vi.fn(() => false);
  return { default: { post, isAxiosError }, post, isAxiosError };
});

// The callback no longer talks to the secret provider directly for credential
// resolution/storage; it delegates to qboClientService helpers. Mock those so
// the success-path token exchange is deterministic and isolated from the DB.
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', async () => {
  const actual = await vi.importActual<any>('@alga-psa/integrations/lib/qbo/qboClientService');
  return {
    ...actual,
    getQboRedirectUri: vi.fn(async () => 'http://localhost:3000/api/integrations/qbo/callback'),
    resolveQboOAuthCredentials: vi.fn(async () => ({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      source: 'tenant',
    })),
    upsertStoredQboCredentials: vi.fn(async () => undefined),
  };
});

import { GET } from '@alga-psa/integrations/routes/api/integrations/qbo/callback';
import { qboOauthCsrfTokensMatch } from '@alga-psa/integrations/lib/qbo/oauthCsrf';
import {
  QBO_OAUTH_STATE_COOKIE,
  createQboOAuthState,
} from '@alga-psa/integrations/lib/qbo/qboOAuthState';
import {
  resolveQboOAuthCredentials,
  upsertStoredQboCredentials,
} from '@alga-psa/integrations/lib/qbo/qboClientService';
import { getSession } from '@alga-psa/auth';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import axios from 'axios';

const CALLBACK_URL = 'http://localhost:3000/api/integrations/qbo/callback';
const SIGNING_SECRET = 'test-qbo-state-signing-secret';

// Enterprise edition is a hard gate on the callback route (CE returns a 501).
const previousEdition = process.env.EDITION;
process.env.EDITION = 'ee';
// getQboStateSigningSecret reads NEXTAUTH_SECRET first.
const previousNextAuthSecret = process.env.NEXTAUTH_SECRET;
process.env.NEXTAUTH_SECRET = SIGNING_SECRET;

afterAll(() => {
  if (previousEdition === undefined) {
    delete process.env.EDITION;
  } else {
    process.env.EDITION = previousEdition;
  }
  if (previousNextAuthSecret === undefined) {
    delete process.env.NEXTAUTH_SECRET;
  } else {
    process.env.NEXTAUTH_SECRET = previousNextAuthSecret;
  }
});

function makeRequest(state: string, stateCookieValue?: string): NextRequest {
  const url = `${CALLBACK_URL}?code=auth-code&realmId=realm-1&state=${state}`;
  const headers = stateCookieValue
    ? { cookie: `${QBO_OAUTH_STATE_COOKIE}=${stateCookieValue}` }
    : undefined;
  return new NextRequest(url, { headers });
}

function redirectError(response: Response): string | null {
  const location = response.headers.get('location');
  if (!location) return null;
  return new URL(location).searchParams.get('qbo_error');
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
  const tenantId = 'tenant-a';
  const secretProvider = {
    getAppSecret: vi.fn(async (name: string) =>
      name === 'qbo_client_id' ? 'client-id' : 'client-secret'
    ),
    getTenantSecret: vi.fn(async () => null),
    setTenantSecret: vi.fn(async () => undefined),
  };

  // A correctly signed state/cookie pair for `tenantId`.
  const validState = createQboOAuthState({ tenantId, secret: SIGNING_SECRET });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSecretProviderInstance).mockResolvedValue(secretProvider as any);
    vi.mocked(getSession).mockResolvedValue({ user: { tenant: tenantId } } as any);
    vi.mocked(resolveQboOAuthCredentials).mockResolvedValue({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      source: 'tenant',
    } as any);
    vi.mocked(upsertStoredQboCredentials).mockResolvedValue(undefined);
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        x_refresh_token_expires_in: 8640000,
      },
    });
  });

  it('rejects a callback without the signed state cookie', async () => {
    const response = await GET(makeRequest(validState.stateParam));
    expect(redirectError(response)).toBe('invalid_state');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects a callback whose state cookie signature does not match', async () => {
    const tampered = createQboOAuthState({ tenantId, secret: 'a-different-secret' });
    const response = await GET(makeRequest(validState.stateParam, tampered.cookieValue));
    expect(redirectError(response)).toBe('invalid_state');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects a callback without an authenticated session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const response = await GET(makeRequest(validState.stateParam, validState.cookieValue));
    expect(redirectError(response)).toBe('session_expired');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects a state tenantId that does not match the session tenant', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { tenant: 'tenant-victim' } } as any);
    const response = await GET(makeRequest(validState.stateParam, validState.cookieValue));
    expect(redirectError(response)).toBe('tenant_mismatch');
    expect(axios.post).not.toHaveBeenCalled();
    expect(upsertStoredQboCredentials).not.toHaveBeenCalled();
  });

  it('rejects a state param that is not valid base64 JSON', async () => {
    const response = await GET(makeRequest('not-a-valid-state', validState.cookieValue));
    expect(redirectError(response)).toBe('invalid_state');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('completes the exchange and stores credentials when cookie, state, and session agree', async () => {
    const response = await GET(makeRequest(validState.stateParam, validState.cookieValue));

    const location = response.headers.get('location');
    expect(location).toContain('qbo_status=success');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(upsertStoredQboCredentials).toHaveBeenCalledTimes(1);
    expect(vi.mocked(upsertStoredQboCredentials).mock.calls[0][0]).toBe(tenantId);

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${QBO_OAUTH_STATE_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain('max-age=0');
  });

  it('clears the state cookie on failure redirects', async () => {
    const response = await GET(makeRequest(validState.stateParam));
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${QBO_OAUTH_STATE_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain('max-age=0');
  });
});
