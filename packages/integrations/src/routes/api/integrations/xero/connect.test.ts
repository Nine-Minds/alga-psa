import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';

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
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

// The connect route resolves and authorizes the live user via the central
// accounting-connection policy (getCurrentUserWithRevocationCheck +
// hasPermission).
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

vi.mock('../../../../lib/providerDisconnect', () => ({
  getProviderDisconnectStatusInfo: vi.fn(async () => null),
  isProviderDisconnectActive: vi.fn(async () => false),
  withProviderCredentialLock: vi.fn(async (_knex, _tenant, _provider, fn) => fn({})),
  PROVIDER_XERO: 'xero',
}));

vi.mock('../../../../lib/xero/xeroClientService', () => ({
  XERO_TOKEN_URL: 'https://identity.xero.com/connect/token',
  getXeroRedirectUri: mocks.getXeroRedirectUri,
  resolveXeroOAuthCredentials: mocks.resolveXeroOAuthCredentials,
  getXeroOAuthScopeConfig: mocks.getXeroOAuthScopeConfig,
  upsertStoredXeroConnections: mocks.upsertStoredXeroConnections,
}));

import { GET } from './connect';
import {
  XERO_OAUTH_CSRF_COOKIE,
} from '../../../../lib/xero/oauthCsrf';
import {
  _resetXeroConnectAttemptStoreForTests,
  _peekXeroConnectAttemptForTests,
} from '../../../../lib/xero/xeroOAuthConnectAttemptStore';
import { decryptXeroVerifier } from '../../../../lib/xero/xeroOAuthVerifierCipher';

const REDIRECT_URI = 'https://example.com/api/integrations/xero/callback';

function connectRequest(cookieHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }
  return new NextRequest('https://example.com/api/integrations/xero/connect', { headers });
}

function sha256Base64Url(value: string): string {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

describe('Xero OAuth connect route', () => {
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
    mocks.loggerInfo.mockClear();
    mocks.loggerWarn.mockClear();
    mocks.loggerError.mockClear();

    _resetXeroConnectAttemptStoreForTests();

    mocks.getCurrentUserWithRevocationCheck.mockResolvedValue({ user_id: 'user-1', tenant: 'tenant-1' } as any);
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
  });

  afterEach(() => {
    delete process.env.EDITION;
  });

  it('emits an opaque 256-bit state nonce that carries no verifier, tenant, or CSRF payload', async () => {
    const res = await GET(connectRequest());

    expect(res.status).toBe(307);
    const authorizeUrl = new URL(res.headers.get('location')!);
    expect(authorizeUrl.origin).toBe('https://login.xero.com');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');

    const state = authorizeUrl.searchParams.get('state')!;
    // 32 random bytes, base64url, unpadded => 43 chars.
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Decoding the state must yield no verifier/tenant/csrf payload.
    const decoded = Buffer.from(state, 'base64url').toString('utf-8');
    expect(decoded).not.toContain('codeVerifier');
    expect(decoded).not.toContain('tenantId');
    expect(decoded).not.toContain('csrf');

    // The stored attempt is keyed to that exact nonce and holds the encrypted
    // verifier plus every binding.
    const attempt = _peekXeroConnectAttemptForTests(state)!;
    expect(attempt).toBeDefined();
    expect(attempt.tenantId).toBe('tenant-1');
    expect(attempt.userId).toBe('user-1');
    expect(attempt.provider).toBe('xero');
    expect(attempt.redirectUri).toBe(REDIRECT_URI);
    expect(attempt.csrf).toMatch(/^[a-f0-9]{64}$/);
    expect(attempt.verifier).toMatch(/^enc:/);

    // Behavioral proof the verifier never crossed the front channel: it is
    // recoverable server-side and its S256 challenge matches the URL.
    const verifier = await decryptXeroVerifier(attempt.verifier);
    expect(sha256Base64Url(verifier)).toBe(authorizeUrl.searchParams.get('code_challenge'));
  });

  it('sets the CSRF cookie scoped to both connect and callback', async () => {
    const res = await GET(connectRequest());

    const cookie = res.cookies.get(XERO_OAUTH_CSRF_COOKIE.name);
    expect(cookie?.value).toMatch(/^[a-f0-9]{64}$/);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe('/api/integrations/xero');
  });

  it('reuses a well-formed CSRF cookie so a second parallel attempt does not clobber the first', async () => {
    const first = await GET(connectRequest());
    const cookie1 = first.cookies.get(XERO_OAUTH_CSRF_COOKIE.name)!.value;
    const state1 = new URL(first.headers.get('location')!).searchParams.get('state')!;

    const second = await GET(connectRequest(`${XERO_OAUTH_CSRF_COOKIE.name}=${cookie1}`));
    const cookie2 = second.cookies.get(XERO_OAUTH_CSRF_COOKIE.name)!.value;
    const state2 = new URL(second.headers.get('location')!).searchParams.get('state')!;

    expect(cookie2).toBe(cookie1);
    expect(state1).not.toBe(state2);
    expect(_peekXeroConnectAttemptForTests(state1)).not.toBeNull();
    expect(_peekXeroConnectAttemptForTests(state2)).not.toBeNull();
  });

  it('does not log the state nonce, verifier, or code challenge', async () => {
    const res = await GET(connectRequest());
    const authorizeUrl = new URL(res.headers.get('location')!);
    const state = authorizeUrl.searchParams.get('state')!;
    const challenge = authorizeUrl.searchParams.get('code_challenge')!;
    const attempt = _peekXeroConnectAttemptForTests(state)!;
    const verifier = await decryptXeroVerifier(attempt.verifier);

    const logged = [
      ...mocks.loggerInfo.mock.calls.flat(),
      ...mocks.loggerWarn.mock.calls.flat(),
      ...mocks.loggerError.mock.calls.flat(),
    ];
    const text = JSON.stringify(logged);
    expect(text).not.toContain(state);
    expect(text).not.toContain(challenge);
    expect(text).not.toContain(verifier);
    expect(text).not.toContain(attempt.verifier);
  });
});
