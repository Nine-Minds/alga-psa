import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentUserWithRevocationCheck: vi.fn(),
  hasPermission: vi.fn(),
  getSecretProviderInstance: vi.fn(),
  getSecret: vi.fn(),
  createTenantKnex: vi.fn(),
  getXeroRedirectUri: vi.fn(),
  resolveXeroOAuthCredentials: vi.fn(),
  getXeroOAuthScopeConfig: vi.fn(),
  upsertStoredXeroConnections: vi.fn(),
  createClient: vi.fn(),
  axiosPost: vi.fn(),
  axiosGet: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

// The connect and callback routes resolve and re-authorize the live user via the
// central accounting-connection policy (getCurrentUserWithRevocationCheck +
// hasPermission), so both must be present on the auth mock.
vi.mock('@alga-psa/auth', () => ({
  getCurrentUserWithRevocationCheck: mocks.getCurrentUserWithRevocationCheck,
  hasPermission: mocks.hasPermission,
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: mocks.getSecretProviderInstance,
  getSecret: mocks.getSecret,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: mocks.loggerInfo, warn: mocks.loggerWarn, error: mocks.loggerError },
}));

vi.mock('@alga-psa/event-bus', () => ({
  getRedisConfig: () => ({ url: 'redis://localhost:6379' }),
}));

vi.mock('redis', () => ({
  createClient: mocks.createClient,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
}));

vi.mock('axios', () => ({
  default: {
    post: mocks.axiosPost,
    get: mocks.axiosGet,
    isAxiosError: (error: unknown) =>
      typeof error === 'object' && error !== null && (error as any).isAxiosError === true,
  },
}));

vi.mock('../../../../lib/xero/xeroClientService', () => ({
  XERO_TOKEN_URL: 'https://identity.xero.com/connect/token',
  getXeroRedirectUri: mocks.getXeroRedirectUri,
  resolveXeroOAuthCredentials: mocks.resolveXeroOAuthCredentials,
  getXeroOAuthScopeConfig: mocks.getXeroOAuthScopeConfig,
  upsertStoredXeroConnections: mocks.upsertStoredXeroConnections,
}));

import { GET as connectGET } from './connect';
import { GET as callbackGET } from './callback';
import { XERO_OAUTH_CSRF_COOKIE } from '../../../../lib/xero/oauthCsrf';
import {
  consumeXeroConnectAttempt,
  storeXeroConnectAttempt,
  _resetXeroConnectAttemptStoreForTests,
  _peekXeroConnectAttemptForTests,
  XERO_CONNECT_ATTEMPT_PROVIDER,
} from '../../../../lib/xero/xeroOAuthConnectAttemptStore';
import { decryptXeroVerifier, encryptXeroVerifier } from '../../../../lib/xero/xeroOAuthVerifierCipher';

const REDIRECT_URI = 'https://example.com/api/integrations/xero/callback';
// The persistence-time revoke helper targets Xero's revocation endpoint; its
// default value (no env override set here) is asserted directly.
const XERO_REVOKE_URL = 'https://identity.xero.com/connect/revocation';

function connectRequest(cookieHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }
  return new NextRequest('https://example.com/api/integrations/xero/connect', { headers });
}

function callbackRequest(
  state: string,
  opts: { code?: string; cookie?: string; error?: string } = {}
): NextRequest {
  const params = new URLSearchParams();
  if (opts.error) {
    params.set('error', opts.error);
  } else {
    params.set('code', opts.code ?? 'auth-code-1');
  }
  params.set('state', state);
  const url = `https://example.com/api/integrations/xero/callback?${params.toString()}`;
  const headers: Record<string, string> = {};
  if (opts.cookie) {
    headers.cookie = `${XERO_OAUTH_CSRF_COOKIE.name}=${opts.cookie}`;
  }
  return new NextRequest(url, { headers });
}

function locationParams(res: NextResponse): URLSearchParams {
  return new URL(res.headers.get('location')!).searchParams;
}

function loggedText(): string {
  const logged = [
    ...mocks.loggerInfo.mock.calls.flat(),
    ...mocks.loggerWarn.mock.calls.flat(),
    ...mocks.loggerError.mock.calls.flat(),
  ];
  return logged.map((value) => {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }).join('\n');
}

async function startFlow(cookieHeader?: string) {
  const res = await connectGET(connectRequest(cookieHeader));
  const authorizeUrl = new URL(res.headers.get('location')!);
  const cookie = res.cookies.get(XERO_OAUTH_CSRF_COOKIE.name)!.value;
  return {
    state: authorizeUrl.searchParams.get('state')!,
    challenge: authorizeUrl.searchParams.get('code_challenge')!,
    cookie,
  };
}

async function seedAttempt(
  nonce: string,
  overrides: Record<string, unknown> = {}
): Promise<{ nonce: string; csrf: string }> {
  const csrf = (overrides.csrf as string) ?? 'b'.repeat(64);
  await storeXeroConnectAttempt(
    nonce,
    {
      verifier: await encryptXeroVerifier('seed-verifier'),
      tenantId: 'tenant-1',
      userId: 'user-1',
      provider: XERO_CONNECT_ATTEMPT_PROVIDER,
      redirectUri: REDIRECT_URI,
      csrf,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600 * 1000,
      ...overrides,
    } as any,
    600
  );
  return { nonce, csrf };
}

describe('Xero OAuth callback route', () => {
  beforeEach(() => {
    process.env.EDITION = 'ee';
    mocks.getCurrentUserWithRevocationCheck.mockReset();
    mocks.hasPermission.mockReset();
    mocks.getSecretProviderInstance.mockReset();
    mocks.getSecret.mockReset();
    mocks.createTenantKnex.mockReset();
    mocks.getXeroRedirectUri.mockReset();
    mocks.resolveXeroOAuthCredentials.mockReset();
    mocks.getXeroOAuthScopeConfig.mockReset();
    mocks.upsertStoredXeroConnections.mockReset();
    mocks.createClient.mockReset();
    mocks.axiosPost.mockReset();
    mocks.axiosGet.mockReset();
    mocks.loggerInfo.mockClear();
    mocks.loggerWarn.mockClear();
    mocks.loggerError.mockClear();

    _resetXeroConnectAttemptStoreForTests();

    mocks.getCurrentUserWithRevocationCheck.mockResolvedValue({ user_id: 'user-1', tenant: 'tenant-1' });
    mocks.hasPermission.mockResolvedValue(true);
    mocks.getSecretProviderInstance.mockResolvedValue({
      getAppSecret: async () => null,
      getTenantSecret: async () => null,
    });
    mocks.getSecret.mockResolvedValue('test-verifier-key');
    mocks.createTenantKnex.mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
    mocks.getXeroRedirectUri.mockResolvedValue(REDIRECT_URI);
    mocks.resolveXeroOAuthCredentials.mockResolvedValue({
      clientId: 'client-id-1',
      clientSecret: 'client-secret-1',
      source: 'tenant',
    });
    mocks.getXeroOAuthScopeConfig.mockReturnValue({
      scopes: ['offline_access', 'accounting.invoices'],
      source: 'default',
    });
    mocks.createClient.mockImplementation(() => {
      throw new Error('redis unavailable');
    });
    mocks.axiosPost.mockResolvedValue({
      data: {
        access_token: 'access-token-1',
        refresh_token: 'refresh-token-1',
        expires_in: 1800,
        refresh_token_expires_in: 86400,
        scope: 'offline_access',
      },
    });
    mocks.axiosGet.mockResolvedValue({
      data: [{ id: 'conn-1', tenantId: 'xero-tenant-1', tenantName: 'Acme' }],
    });
    mocks.upsertStoredXeroConnections.mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.EDITION;
  });

  it('completes a valid flow, stores tokens once, and rejects replay of the same state', async () => {
    const { state, cookie } = await startFlow();

    const res = await callbackGET(callbackRequest(state, { cookie }));
    expect(locationParams(res).get('xero_status')).toBe('success');

    expect(mocks.upsertStoredXeroConnections).toHaveBeenCalledTimes(1);
    expect(mocks.upsertStoredXeroConnections).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        'conn-1': expect.objectContaining({
          accessToken: 'access-token-1',
          refreshToken: 'refresh-token-1',
        }),
      }),
      { prioritize: ['conn-1'] }
    );

    // The attempt record is consumed on success.
    const attempt = _peekXeroConnectAttemptForTests(state);
    expect(attempt).toBeNull(); // consumed on success

    // Replay of the consumed state is rejected before any second exchange.
    const replay = await callbackGET(callbackRequest(state, { cookie }));
    expect(locationParams(replay).get('xero_error')).toBe('invalid_state');
    expect(mocks.axiosPost).toHaveBeenCalledTimes(1);
  });

  it('exchanges the token using the server-stored verifier (never the browser state)', async () => {
    const { state, cookie } = await startFlow();
    const attempt = _peekXeroConnectAttemptForTests(state)!;
    const verifier = await decryptXeroVerifier(attempt.verifier);

    const res = await callbackGET(callbackRequest(state, { cookie }));
    expect(locationParams(res).get('xero_status')).toBe('success');

    const exchangeBody = mocks.axiosPost.mock.calls[0][1] as string;
    expect(exchangeBody).toContain('grant_type=authorization_code');
    expect(exchangeBody).toContain(`code_verifier=${verifier}`);
  });

  it('rejects a replayed or unknown state before any token exchange', async () => {
    const { state, cookie } = await startFlow();
    // Consume it once via the store as if the user completed it.
    await consumeXeroConnectAttempt(state);

    const res = await callbackGET(callbackRequest(state, { cookie }));
    expect(locationParams(res).get('xero_error')).toBe('invalid_state');
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(mocks.upsertStoredXeroConnections).not.toHaveBeenCalled();
  });

  it('rejects an expired state before any token exchange', async () => {
    // Embedded expiresAt passed while the store TTL is still live: the
    // defensive post-consume expiry check must reject before any exchange.
    const { csrf } = await seedAttempt('nonce-expired', {
      createdAt: Date.now() - 700 * 1000,
      expiresAt: Date.now() - 60 * 1000,
    });

    const res = await callbackGET(callbackRequest('nonce-expired', { cookie: csrf }));
    expect(locationParams(res).get('xero_error')).toBe('expired_state');
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(mocks.upsertStoredXeroConnections).not.toHaveBeenCalled();
  });

  it('rejects a store-expired state as unknown before any token exchange', async () => {
    // Store TTL has also lapsed: the atomic consume finds nothing at all.
    const { csrf } = await seedAttempt('nonce-ttl-expired', {
      createdAt: Date.now() - 700 * 1000,
      expiresAt: Date.now() - 60 * 1000,
    });
    await consumeXeroConnectAttempt('nonce-ttl-expired', { now: Date.now() + 601 * 1000 });

    const res = await callbackGET(callbackRequest('nonce-ttl-expired', { cookie: csrf }));
    expect(locationParams(res).get('xero_error')).toBe('invalid_state');
    expect(mocks.axiosPost).not.toHaveBeenCalled();
  });

  it('rejects a tampered (never-stored) state', async () => {
    const res = await callbackGET(callbackRequest('0000000000000000000000000000000000000000000', { cookie: 'f'.repeat(64) }));
    expect(locationParams(res).get('xero_error')).toBe('invalid_state');
    expect(mocks.axiosPost).not.toHaveBeenCalled();
  });

  it('rejects a callback whose session disappeared mid-flow and consumes the attempt', async () => {
    const { state, cookie } = await startFlow();

    mocks.getCurrentUserWithRevocationCheck.mockResolvedValue(null);
    const res = await callbackGET(callbackRequest(state, { cookie }));
    expect(locationParams(res).get('xero_error')).toBe('session_expired');
    expect(_peekXeroConnectAttemptForTests(state)).toBeNull(); // consumed

    // Even with the session restored, the state can no longer be used.
    mocks.getCurrentUserWithRevocationCheck.mockResolvedValue({ user_id: 'user-1', tenant: 'tenant-1' });
    const retry = await callbackGET(callbackRequest(state, { cookie }));
    expect(locationParams(retry).get('xero_error')).toBe('invalid_state');
    expect(mocks.axiosPost).not.toHaveBeenCalled();
  });

  it('rejects a callback completed by a different user', async () => {
    const { state, cookie } = await startFlow();

    mocks.getCurrentUserWithRevocationCheck.mockResolvedValue({ user_id: 'user-2', tenant: 'tenant-1' });
    const res = await callbackGET(callbackRequest(state, { cookie }));
    expect(locationParams(res).get('xero_error')).toBe('user_mismatch');
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(_peekXeroConnectAttemptForTests(state)).toBeNull();
  });

  it('rejects a callback completed in a different tenant', async () => {
    const { state, cookie } = await startFlow();

    mocks.getCurrentUserWithRevocationCheck.mockResolvedValue({ user_id: 'user-1', tenant: 'tenant-2' });
    const res = await callbackGET(callbackRequest(state, { cookie }));
    expect(locationParams(res).get('xero_error')).toBe('tenant_mismatch');
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(_peekXeroConnectAttemptForTests(state)).toBeNull();
  });

  it('rejects a callback bound to a different provider', async () => {
    const { csrf } = await seedAttempt('nonce-provider', { provider: 'google' });

    const res = await callbackGET(callbackRequest('nonce-provider', { cookie: csrf }));
    expect(locationParams(res).get('xero_error')).toBe('provider_mismatch');
    expect(mocks.axiosPost).not.toHaveBeenCalled();
  });

  it('rejects a callback when the user no longer holds the billing permission', async () => {
    const { state, cookie } = await startFlow();

    mocks.hasPermission.mockResolvedValue(false);
    const res = await callbackGET(callbackRequest(state, { cookie }));
    expect(locationParams(res).get('xero_error')).toBe('forbidden');
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(_peekXeroConnectAttemptForTests(state)).toBeNull();
  });

  it('rejects a callback whose CSRF cookie does not match the attempt', async () => {
    const { state } = await startFlow();

    const res = await callbackGET(callbackRequest(state, { cookie: 'e'.repeat(64) }));
    expect(locationParams(res).get('xero_error')).toBe('csrf_mismatch');
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(_peekXeroConnectAttemptForTests(state)).toBeNull();
  });

  it('rejects a callback with no CSRF cookie without consuming the attempt', async () => {
    const { state } = await startFlow();

    const res = await callbackGET(callbackRequest(state, { code: 'auth-code-1' }));
    expect(locationParams(res).get('xero_error')).toBe('csrf_mismatch');
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    // Preserved for the initiating browser, which still holds the cookie.
    expect(_peekXeroConnectAttemptForTests(state)).not.toBeNull();
  });

  it('lets two parallel attempts in the same browser complete independently', async () => {
    const first = await startFlow();
    const second = await startFlow(`${XERO_OAUTH_CSRF_COOKIE.name}=${first.cookie}`);

    expect(first.state).not.toBe(second.state);
    expect(second.cookie).toBe(first.cookie); // cookie reused, not clobbered

    const res1 = await callbackGET(callbackRequest(first.state, { cookie: first.cookie }));
    const res2 = await callbackGET(callbackRequest(second.state, { cookie: second.cookie }));

    expect(locationParams(res1).get('xero_status')).toBe('success');
    expect(locationParams(res2).get('xero_status')).toBe('success');
    expect(mocks.upsertStoredXeroConnections).toHaveBeenCalledTimes(2);
    expect(_peekXeroConnectAttemptForTests(first.state)).toBeNull();
    expect(_peekXeroConnectAttemptForTests(second.state)).toBeNull();
  });

  it('maps provider error callbacks to coarse codes and consumes the attempt', async () => {
    const { state, cookie } = await startFlow();

    const res = await callbackGET(callbackRequest(state, { cookie, error: 'access_denied' }));
    expect(locationParams(res).get('xero_error')).toBe('access_denied');
    expect(_peekXeroConnectAttemptForTests(state)).toBeNull();

    // Replay after a provider error also fails: the attempt is consumed.
    mocks.getCurrentUserWithRevocationCheck.mockResolvedValue({ user_id: 'user-1', tenant: 'tenant-1' });
    const retry = await callbackGET(callbackRequest(state, { cookie }));
    expect(locationParams(retry).get('xero_error')).toBe('invalid_state');
    expect(mocks.axiosPost).not.toHaveBeenCalled();
  });

  it('does not burn the attempt on a provider denial that omits the CSRF cookie', async () => {
    // An attacker with only the state URL (no CSRF cookie) must not burn the
    // victim's state; the victim's own callback still completes.
    const { state, cookie } = await startFlow();

    const denial = await callbackGET(callbackRequest(state, { error: 'access_denied' }));
    expect(locationParams(denial).get('xero_error')).toBe('access_denied');
    expect(_peekXeroConnectAttemptForTests(state)).not.toBeNull();

    const res = await callbackGET(callbackRequest(state, { cookie }));
    expect(locationParams(res).get('xero_status')).toBe('success');
    expect(mocks.upsertStoredXeroConnections).toHaveBeenCalledTimes(1);
  });

  it('never echoes provider-controlled error content into the redirect', async () => {
    const { state, cookie } = await startFlow();

    const res = await callbackGET(
      callbackRequest(state, { cookie, error: 'attacker_controlled_xyz_987' })
    );
    expect(locationParams(res).get('xero_error')).toBe('provider_denied');
    expect(res.headers.get('location')).not.toContain('attacker_controlled_xyz_987');
  });

  it('revokes the obtained grant and stores nothing when a persistence-time denial races the exchange', async () => {
    // Pre-exchange authorization passes; the persistence-time re-check fails,
    // so the just-obtained grant is revoked and nothing is stored.
    const { csrf } = await seedAttempt('nonce-persist-denial');
    mocks.getCurrentUserWithRevocationCheck
      .mockResolvedValueOnce({ user_id: 'user-1', tenant: 'tenant-1' })
      .mockResolvedValueOnce(null);

    const res = await callbackGET(callbackRequest('nonce-persist-denial', { cookie: csrf }));

    expect(locationParams(res).get('xero_error')).toBe('session_expired');
    expect(mocks.upsertStoredXeroConnections).not.toHaveBeenCalled();
    // Token exchange, then revocation.
    expect(mocks.axiosPost).toHaveBeenCalledTimes(2);
    expect(mocks.axiosGet).toHaveBeenCalledTimes(1);
    const calls = mocks.axiosPost.mock.calls;
    expect(calls[1][0]).toBe(XERO_REVOKE_URL);
    const revokeBody = calls[1][1] as string;
    expect(revokeBody).toContain('token=refresh-token-1');
    expect(revokeBody).toContain('token_type_hint=refresh_token');
  });

  it('keeps verifier, state nonce, and token material out of logs and redirect URLs', async () => {
    const { state, cookie } = await startFlow();
    const attempt = _peekXeroConnectAttemptForTests(state)!;
    const verifier = await decryptXeroVerifier(attempt.verifier);

    const res = await callbackGET(callbackRequest(state, { cookie }));
    expect(locationParams(res).get('xero_status')).toBe('success');

    const logs = loggedText();
    expect(logs).not.toContain(state);
    expect(logs).not.toContain(verifier);
    expect(logs).not.toContain(attempt.verifier);
    expect(logs).not.toContain('access-token-1');
    expect(logs).not.toContain('refresh-token-1');
    expect(logs).not.toContain('client-secret-1');

    const location = res.headers.get('location')!;
    expect(location).not.toContain(state);
    expect(location).not.toContain(verifier);
    expect(location).not.toContain('access-token-1');
    expect(location).not.toContain('refresh-token-1');
  });

  it('keeps verifier and state nonce out of failure redirects and their logs', async () => {
    const { state, cookie } = await startFlow();
    const attempt = _peekXeroConnectAttemptForTests(state)!;
    const verifier = await decryptXeroVerifier(attempt.verifier);

    // A terminal failure path: wrong user. The redirect and its log must not
    // carry the state nonce, verifier, or ciphertext.
    mocks.getCurrentUserWithRevocationCheck.mockResolvedValue({ user_id: 'user-2', tenant: 'tenant-1' });
    const res = await callbackGET(callbackRequest(state, { cookie }));
    expect(locationParams(res).get('xero_error')).toBe('user_mismatch');

    const location = res.headers.get('location')!;
    expect(location).not.toContain(state);
    expect(location).not.toContain(verifier);
    expect(location).not.toContain(attempt.verifier);
    expect(location).not.toContain('auth-code-1');

    const logs = loggedText();
    expect(logs).not.toContain(state);
    expect(logs).not.toContain(verifier);
    expect(logs).not.toContain(attempt.verifier);
    expect(logs).not.toContain('auth-code-1');
  });

  it('rejects a provider-mismatch attempt before any token exchange', async () => {
    const { csrf } = await seedAttempt('nonce-other-provider', { provider: 'qbo' });
    const res = await callbackGET(callbackRequest('nonce-other-provider', { cookie: csrf }));

    expect(locationParams(res).get('xero_error')).toBe('provider_mismatch');
    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(mocks.upsertStoredXeroConnections).not.toHaveBeenCalled();
    expect(_peekXeroConnectAttemptForTests('nonce-other-provider')).toBeNull();
  });
});
