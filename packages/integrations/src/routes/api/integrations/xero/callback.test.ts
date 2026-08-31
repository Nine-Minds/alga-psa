import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';

// Provider doubles: everything the callback touches is deterministic and
// isolated from the DB, Redis, and real provider HTTP.

const mocks = vi.hoisted(() => ({
  getCurrentUserWithRevocationCheck: vi.fn(),
  hasPermission: vi.fn(),
  resolveXeroOAuthCredentials: vi.fn(),
  upsertStoredXeroConnections: vi.fn(),
  getXeroRedirectUri: vi.fn(),
  axiosPost: vi.fn(),
  axiosGet: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  getCurrentUserWithRevocationCheck: mocks.getCurrentUserWithRevocationCheck,
  hasPermission: mocks.hasPermission,
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async () => null,
    getTenantSecret: async () => null,
    setTenantSecret: async () => undefined,
  }),
}));

// The callback re-checks the disconnect gate before writing connections; mock
// the DB and gate so the happy path under test is deterministic.
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {}, tenant: 'tenant-a' }),
}));

vi.mock('../../../../lib/providerDisconnect', () => ({
  isProviderDisconnectActive: vi.fn(async () => false),
  PROVIDER_QBO: 'quickbooks_online',
  PROVIDER_XERO: 'xero',
}));

vi.mock('redis', () => ({
  createClient: vi.fn(() => {
    throw new Error('redis unavailable');
  }),
}));

vi.mock('@alga-psa/event-bus', () => ({
  getRedisConfig: () => ({ url: 'redis://localhost:6379' }),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  getXeroRedirectUri: mocks.getXeroRedirectUri,
  resolveXeroOAuthCredentials: mocks.resolveXeroOAuthCredentials,
  upsertStoredXeroConnections: mocks.upsertStoredXeroConnections,
  getXeroTokenUrl: () => 'https://identity.xero.com/connect/token',
  getXeroConnectionsUrl: () => 'https://api.xero.com/connections',
  XERO_TOKEN_URL: 'https://identity.xero.com/connect/token',
}));

vi.mock('axios', () => {
  const post = vi.fn();
  const get = vi.fn();
  return { default: { post, get }, post, get };
});

import { GET } from './callback';
import { XERO_OAUTH_CSRF_COOKIE } from '../../../../lib/xero/oauthCsrf';
import { storeAccountingOAuthNonce } from '../../../../lib/accountingOAuthStateStore';
import { upsertStoredXeroConnections } from '../../../../lib/xero/xeroClientService';
import axios from 'axios';

const CALLBACK_URL = 'http://localhost:3000/api/integrations/xero/callback';
const TENANT_ID = 'tenant-a';
const USER_ID = 'user-a';
const OTHER_USER_ID = 'user-b';
const OTHER_TENANT_ID = 'tenant-b';
const CSRF_TOKEN = 'a'.repeat(64);
const NONCE = 'nonce-1';
const REVOKE_URL = 'https://identity.xero.com/connect/revocation';

const previousEdition = process.env.EDITION;
process.env.EDITION = 'ee';
process.env.XERO_OAUTH_REVOKE_URL = REVOKE_URL;

afterAll(() => {
  if (previousEdition === undefined) delete process.env.EDITION;
  else process.env.EDITION = previousEdition;
  delete process.env.XERO_OAUTH_REVOKE_URL;
});

const liveUser = { user_id: USER_ID, tenant: TENANT_ID, user_type: 'internal' };

function encodeState(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function makeState(overrides: Record<string, unknown> = {}) {
  return encodeState({
    tenantId: TENANT_ID,
    userId: USER_ID,
    csrf: CSRF_TOKEN,
    codeVerifier: 'code-verifier',
    nonce: NONCE,
    ...overrides,
  });
}

function makeRequest(state: string, csrfCookie?: string): NextRequest {
  const url = `${CALLBACK_URL}?code=auth-code&state=${state}`;
  const headers = csrfCookie
    ? { cookie: `${XERO_OAUTH_CSRF_COOKIE.name}=${csrfCookie}` }
    : undefined;
  return new NextRequest(url, { headers });
}

function redirectParam(response: Response, name: string): string | null {
  const location = response.headers.get('location');
  if (!location) return null;
  return new URL(location).searchParams.get(name);
}

describe('Xero OAuth callback authorization', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.getCurrentUserWithRevocationCheck.mockResolvedValue(liveUser as any);
    mocks.hasPermission.mockResolvedValue(true);
    mocks.resolveXeroOAuthCredentials.mockResolvedValue({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      source: 'tenant',
    });
    mocks.getXeroRedirectUri.mockResolvedValue(`${CALLBACK_URL}`);
    mocks.upsertStoredXeroConnections.mockResolvedValue(undefined);
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
    await storeAccountingOAuthNonce('xero', NONCE);
  });

  it('allows the same authorized user to complete the flow end-to-end', async () => {
    const response = await GET(makeRequest(makeState(), CSRF_TOKEN));

    expect(redirectParam(response, 'xero_status')).toBe('success');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(upsertStoredXeroConnections).toHaveBeenCalledTimes(1);
    expect(upsertStoredXeroConnections).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ 'conn-1': expect.objectContaining({ accessToken: 'access-token' }) }),
      expect.anything()
    );
  });

  it('denies when the connection-admin permission is revoked before the callback', async () => {
    mocks.hasPermission.mockResolvedValue(false);

    const response = await GET(makeRequest(makeState(), CSRF_TOKEN));

    expect(redirectParam(response, 'xero_error')).toBe('forbidden');
    expect(axios.post).not.toHaveBeenCalled();
    expect(upsertStoredXeroConnections).not.toHaveBeenCalled();
  });

  it('denies when the callback is completed by a different user', async () => {
    mocks.getCurrentUserWithRevocationCheck.mockResolvedValue({
      ...liveUser,
      user_id: OTHER_USER_ID,
    } as any);

    const response = await GET(makeRequest(makeState(), CSRF_TOKEN));

    expect(redirectParam(response, 'xero_error')).toBe('user_mismatch');
    expect(axios.post).not.toHaveBeenCalled();
    expect(upsertStoredXeroConnections).not.toHaveBeenCalled();
  });

  it('denies when the session tenant does not match the state tenant', async () => {
    mocks.getCurrentUserWithRevocationCheck.mockResolvedValue({
      ...liveUser,
      tenant: OTHER_TENANT_ID,
    } as any);

    const response = await GET(makeRequest(makeState(), CSRF_TOKEN));

    expect(redirectParam(response, 'xero_error')).toBe('tenant_mismatch');
    expect(axios.post).not.toHaveBeenCalled();
    expect(upsertStoredXeroConnections).not.toHaveBeenCalled();
  });

  it('denies when the user is disabled or removed (no live user resolves)', async () => {
    mocks.getCurrentUserWithRevocationCheck.mockResolvedValue(null);

    const response = await GET(makeRequest(makeState(), CSRF_TOKEN));

    expect(redirectParam(response, 'xero_error')).toBe('session_expired');
    expect(axios.post).not.toHaveBeenCalled();
    expect(upsertStoredXeroConnections).not.toHaveBeenCalled();
  });

  it('denies a second presentation of the same state (replay) with no side effects', async () => {
    const first = await GET(makeRequest(makeState(), CSRF_TOKEN));
    expect(redirectParam(first, 'xero_status')).toBe('success');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(upsertStoredXeroConnections).toHaveBeenCalledTimes(1);

    const second = await GET(makeRequest(makeState(), CSRF_TOKEN));
    expect(redirectParam(second, 'xero_error')).toBe('state_replayed');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(upsertStoredXeroConnections).toHaveBeenCalledTimes(1);
  });

  it('revokes the obtained grant and stores nothing when a persistence-time denial races the exchange', async () => {
    // Pre-exchange authorization passes; persistence-time re-check fails.
    mocks.getCurrentUserWithRevocationCheck
      .mockResolvedValueOnce(liveUser as any)
      .mockResolvedValueOnce(null);

    const response = await GET(makeRequest(makeState(), CSRF_TOKEN));

    expect(redirectParam(response, 'xero_error')).toBe('session_expired');
    expect(upsertStoredXeroConnections).not.toHaveBeenCalled();
    // Token exchange, connections fetch, then revocation.
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.get).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(axios.post).mock.calls;
    expect(calls[1][0]).toBe(REVOKE_URL);
    const revokeBody = calls[1][1] as string;
    expect(revokeBody).toContain('token=refresh-token');
    expect(revokeBody).toContain('token_type_hint=refresh_token');
  });

  it('leaves no reusable state when the provider denies the flow (error param)', async () => {
    const url = `${CALLBACK_URL}?error=access_denied&state=${makeState()}`;
    const request = new NextRequest(url, {
      headers: { cookie: `${XERO_OAUTH_CSRF_COOKIE.name}=${CSRF_TOKEN}` },
    });

    const response = await GET(request);
    expect(redirectParam(response, 'xero_error')).toBe('access_denied');
    expect(axios.post).not.toHaveBeenCalled();
    expect(upsertStoredXeroConnections).not.toHaveBeenCalled();

    // The same state, presented again with a code, is now burned.
    const replay = await GET(makeRequest(makeState(), CSRF_TOKEN));
    expect(redirectParam(replay, 'xero_error')).toBe('state_replayed');
    expect(axios.post).not.toHaveBeenCalled();
    expect(upsertStoredXeroConnections).not.toHaveBeenCalled();
  });

  it('does not burn the state on a denial that does not present the CSRF cookie', async () => {
    // An attacker with only the state URL (no CSRF cookie) cannot burn the
    // victim's state; the victim's own callback still succeeds.
    const denial = new NextRequest(`${CALLBACK_URL}?error=access_denied&state=${makeState()}`);
    await GET(denial);

    const response = await GET(makeRequest(makeState(), CSRF_TOKEN));
    expect(redirectParam(response, 'xero_status')).toBe('success');
    expect(upsertStoredXeroConnections).toHaveBeenCalledTimes(1);
  });
});
