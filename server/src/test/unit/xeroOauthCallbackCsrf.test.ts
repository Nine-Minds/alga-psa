import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: vi.fn(async () => null),
    getTenantSecret: vi.fn(async () => null),
    setTenantSecret: vi.fn(async () => undefined),
  })),
  getSecret: vi.fn(async () => 'test-verifier-key'),
}));

vi.mock('@alga-psa/event-bus', () => ({
  getRedisConfig: () => ({ url: 'redis://localhost:6379' }),
}));

vi.mock('redis', () => ({
  createClient: vi.fn(() => {
    throw new Error('redis unavailable');
  }),
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
import {
  storeXeroConnectAttempt,
  XERO_CONNECT_ATTEMPT_PROVIDER,
} from '@alga-psa/integrations/lib/xero/xeroOAuthConnectAttemptStore';
import { encryptXeroVerifier } from '@alga-psa/integrations/lib/xero/xeroOAuthVerifierCipher';
import axios from 'axios';

const CALLBACK_URL = 'http://localhost:3000/api/integrations/xero/callback';
const tenantId = 'tenant-a';
const csrfToken = 'a'.repeat(64);

const prevEdition = process.env.EDITION;
process.env.EDITION = 'ee';
afterAll(() => {
  process.env.EDITION = prevEdition;
});

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

async function seedAttempt(overrides: Record<string, unknown> = {}): Promise<string> {
  const nonce = `nonce-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  await storeXeroConnectAttempt(
    nonce,
    {
      verifier: await encryptXeroVerifier('seed-verifier'),
      tenantId,
      userId: 'user-a',
      provider: XERO_CONNECT_ATTEMPT_PROVIDER,
      redirectUri: 'http://localhost:3000/api/integrations/xero/callback',
      csrf: csrfToken,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600 * 1000,
      ...overrides,
    } as any,
    600
  );
  return nonce;
}

describe('Xero OAuth callback CSRF and tenant validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUser).mockResolvedValue({ user_id: 'user-a', tenant: tenantId } as any);
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

  it('rejects a callback without the CSRF cookie without consuming the attempt', async () => {
    const state = await seedAttempt();
    const response = await GET(makeRequest(state));
    expect(redirectError(response)).toBe('csrf_mismatch');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects a callback whose attempt csrf does not match the cookie', async () => {
    const state = await seedAttempt();
    const response = await GET(makeRequest(state, 'b'.repeat(64)));
    expect(redirectError(response)).toBe('csrf_mismatch');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects a callback without an authenticated session', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const state = await seedAttempt();
    const response = await GET(makeRequest(state, csrfToken));
    expect(redirectError(response)).toBe('session_expired');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects a callback completed in a different tenant', async () => {
    const state = await seedAttempt();
    vi.mocked(getCurrentUser).mockResolvedValue({
      user_id: 'user-a',
      tenant: 'tenant-victim',
    } as any);
    const response = await GET(makeRequest(state, csrfToken));
    expect(redirectError(response)).toBe('tenant_mismatch');
    expect(axios.post).not.toHaveBeenCalled();
    expect(vi.mocked(xeroMocks.upsertStoredXeroConnections)).not.toHaveBeenCalled();
  });

  it('completes the exchange when cookie, state, and session agree', async () => {
    const state = await seedAttempt();
    const response = await GET(makeRequest(state, csrfToken));
    const location = response.headers.get('location');
    expect(location).toContain('xero_status=success');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(vi.mocked(xeroMocks.upsertStoredXeroConnections)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(xeroMocks.upsertStoredXeroConnections).mock.calls[0][0]).toBe(tenantId);

    // Replaying the consumed state is rejected before any second exchange.
    const replay = await GET(makeRequest(state, csrfToken));
    expect(redirectError(replay)).toBe('invalid_state');
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});
