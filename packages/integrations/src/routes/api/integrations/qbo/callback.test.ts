import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';

// Provider doubles: everything the callback touches is deterministic and
// isolated from the DB, Redis, and real provider HTTP.

const mocks = vi.hoisted(() => ({
  getCurrentUserWithRevocationCheck: vi.fn(),
  hasPermission: vi.fn(),
  resolveQboOAuthCredentials: vi.fn(),
  upsertStoredQboCredentials: vi.fn(),
  getQboRedirectUri: vi.fn(),
  axiosPost: vi.fn(),
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

// The callback re-checks the disconnect gate before writing credentials; mock
// the DB and gate so the happy path under test is deterministic.
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {}, tenant: 'tenant-a' }),
}));

vi.mock('../../../../lib/providerDisconnect', () => ({
  isProviderDisconnectActive: vi.fn(async () => false),
  getProviderCredentialWriteDisposition: vi.fn(async () => 'allowed'),
  withProviderCredentialLock: vi.fn(async (_knex, _tenant, _provider, fn) => fn({})),
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

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getQboRedirectUri: mocks.getQboRedirectUri,
  resolveQboOAuthCredentials: mocks.resolveQboOAuthCredentials,
  upsertStoredQboCredentials: mocks.upsertStoredQboCredentials,
  QBO_TOKEN_URL: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
}));

vi.mock('axios', () => {
  const post = vi.fn();
  const isAxiosError = vi.fn(() => false);
  return { default: { post, isAxiosError }, post, isAxiosError };
});

import { GET } from './callback';
import { QBO_OAUTH_STATE_COOKIE, createQboOAuthState } from '../../../../lib/qbo/qboOAuthState';
import { storeAccountingOAuthNonce } from '../../../../lib/accountingOAuthStateStore';
import { upsertStoredQboCredentials } from '../../../../lib/qbo/qboClientService';
import axios from 'axios';

const CALLBACK_URL = 'http://localhost:3000/api/integrations/qbo/callback';
const SIGNING_SECRET = 'test-qbo-state-signing-secret';
const TENANT_ID = 'tenant-a';
const USER_ID = 'user-a';
const OTHER_USER_ID = 'user-b';
const OTHER_TENANT_ID = 'tenant-b';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

const previousEdition = process.env.EDITION;
const previousNextAuthSecret = process.env.NEXTAUTH_SECRET;
process.env.EDITION = 'ee';
process.env.NEXTAUTH_SECRET = SIGNING_SECRET;
process.env.QBO_OAUTH_REVOKE_URL = REVOKE_URL;

afterAll(() => {
  if (previousEdition === undefined) delete process.env.EDITION;
  else process.env.EDITION = previousEdition;
  if (previousNextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = previousNextAuthSecret;
  delete process.env.QBO_OAUTH_REVOKE_URL;
});

const liveUser = { user_id: USER_ID, tenant: TENANT_ID, user_type: 'internal' };

function makeRequest(state: string, stateCookieValue?: string): NextRequest {
  const url = `${CALLBACK_URL}?code=auth-code&realmId=realm-1&state=${state}`;
  const headers = stateCookieValue
    ? { cookie: `${QBO_OAUTH_STATE_COOKIE}=${stateCookieValue}` }
    : undefined;
  return new NextRequest(url, { headers });
}

function redirectParam(response: Response, name: string): string | null {
  const location = response.headers.get('location');
  if (!location) return null;
  return new URL(location).searchParams.get(name);
}

function makeState() {
  const created = createQboOAuthState({ tenantId: TENANT_ID, userId: USER_ID, secret: SIGNING_SECRET });
  return created;
}

async function storeFor(created: ReturnType<typeof makeState>) {
  await storeAccountingOAuthNonce('qbo', created.payload.nonce, {
    tenantId: TENANT_ID,
    initiatedAt: created.payload.initiatedAt,
  });
}

describe('QBO OAuth callback authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUserWithRevocationCheck.mockResolvedValue(liveUser as any);
    mocks.hasPermission.mockResolvedValue(true);
    mocks.resolveQboOAuthCredentials.mockResolvedValue({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      source: 'tenant',
    });
    mocks.getQboRedirectUri.mockResolvedValue(`${CALLBACK_URL}`);
    mocks.upsertStoredQboCredentials.mockResolvedValue(undefined);
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        x_refresh_token_expires_in: 8640000,
      },
    });
  });

  it('allows the same authorized user to complete the flow end-to-end', async () => {
    const created = makeState();
    await storeFor(created);

    const response = await GET(makeRequest(created.stateParam, created.cookieValue));

    expect(redirectParam(response, 'qbo_status')).toBe('success');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(upsertStoredQboCredentials).toHaveBeenCalledTimes(1);
    expect(upsertStoredQboCredentials).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        realmId: 'realm-1',
      }),
      { authorizationFlowStartedAt: created.payload.initiatedAt }
    );
  });

  it('denies when the connection-admin permission is revoked before the callback', async () => {
    const created = makeState();
    await storeFor(created);
    mocks.hasPermission.mockResolvedValue(false);

    const response = await GET(makeRequest(created.stateParam, created.cookieValue));

    expect(redirectParam(response, 'qbo_error')).toBe('forbidden');
    expect(axios.post).not.toHaveBeenCalled();
    expect(upsertStoredQboCredentials).not.toHaveBeenCalled();
  });

  it('denies when the callback is completed by a different user', async () => {
    const created = makeState();
    await storeFor(created);
    mocks.getCurrentUserWithRevocationCheck.mockResolvedValue({
      ...liveUser,
      user_id: OTHER_USER_ID,
    } as any);

    const response = await GET(makeRequest(created.stateParam, created.cookieValue));

    expect(redirectParam(response, 'qbo_error')).toBe('user_mismatch');
    expect(axios.post).not.toHaveBeenCalled();
    expect(upsertStoredQboCredentials).not.toHaveBeenCalled();
  });

  it('denies when the session tenant does not match the state tenant', async () => {
    const created = makeState();
    await storeFor(created);
    mocks.getCurrentUserWithRevocationCheck.mockResolvedValue({
      ...liveUser,
      tenant: OTHER_TENANT_ID,
    } as any);

    const response = await GET(makeRequest(created.stateParam, created.cookieValue));

    expect(redirectParam(response, 'qbo_error')).toBe('tenant_mismatch');
    expect(axios.post).not.toHaveBeenCalled();
    expect(upsertStoredQboCredentials).not.toHaveBeenCalled();
  });

  it('denies when the user is disabled or removed (no live user resolves)', async () => {
    const created = makeState();
    await storeFor(created);
    mocks.getCurrentUserWithRevocationCheck.mockResolvedValue(null);

    const response = await GET(makeRequest(created.stateParam, created.cookieValue));

    expect(redirectParam(response, 'qbo_error')).toBe('session_expired');
    expect(axios.post).not.toHaveBeenCalled();
    expect(upsertStoredQboCredentials).not.toHaveBeenCalled();
  });

  it('denies a second presentation of the same state (replay) with no side effects', async () => {
    const created = makeState();
    await storeFor(created);

    const first = await GET(makeRequest(created.stateParam, created.cookieValue));
    expect(redirectParam(first, 'qbo_status')).toBe('success');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(upsertStoredQboCredentials).toHaveBeenCalledTimes(1);

    const second = await GET(makeRequest(created.stateParam, created.cookieValue));
    expect(redirectParam(second, 'qbo_error')).toBe('state_replayed');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(upsertStoredQboCredentials).toHaveBeenCalledTimes(1);
  });

  it('revokes the obtained grant and stores nothing when a persistence-time denial races the exchange', async () => {
    const created = makeState();
    await storeFor(created);
    // Pre-exchange authorization passes; persistence-time re-check fails.
    mocks.getCurrentUserWithRevocationCheck
      .mockResolvedValueOnce(liveUser as any)
      .mockResolvedValueOnce(null);

    const response = await GET(makeRequest(created.stateParam, created.cookieValue));

    expect(redirectParam(response, 'qbo_error')).toBe('session_expired');
    expect(upsertStoredQboCredentials).not.toHaveBeenCalled();
    // Token exchange call, then a revocation call against the revoke endpoint.
    expect(axios.post).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(axios.post).mock.calls;
    expect(calls[1][0]).toBe(REVOKE_URL);
    expect(calls[1][1]).toEqual({ token: 'refresh-token' });
  });

  it('leaves no reusable state when the provider denies the flow (error param)', async () => {
    const created = makeState();
    await storeFor(created);

    const url = `${CALLBACK_URL}?error=access_denied&state=${created.stateParam}`;
    const request = new NextRequest(url, {
      headers: { cookie: `${QBO_OAUTH_STATE_COOKIE}=${created.cookieValue}` },
    });

    const response = await GET(request);
    expect(redirectParam(response, 'qbo_error')).toBe('access_denied');
    expect(axios.post).not.toHaveBeenCalled();
    expect(upsertStoredQboCredentials).not.toHaveBeenCalled();

    // The same state, presented again with a code, is now burned.
    const replay = await GET(makeRequest(created.stateParam, created.cookieValue));
    expect(redirectParam(replay, 'qbo_error')).toBe('state_replayed');
    expect(axios.post).not.toHaveBeenCalled();
    expect(upsertStoredQboCredentials).not.toHaveBeenCalled();
  });
});
