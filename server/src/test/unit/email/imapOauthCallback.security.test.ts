import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  consumedState: null as any,
  deleteCount: 0,
  tenantDb: vi.fn(),
  createTenantKnex: vi.fn(),
  getTenantSecret: vi.fn(),
  setTenantSecret: vi.fn(),
  postSafeOutboundForm: vi.fn(),
  assertSafeOutboundUrl: vi.fn(),
  currentUser: null as any,
}));

vi.mock('@alga-psa/db', () => ({ tenantDb: mocks.tenantDb }));
vi.mock('@/lib/db', () => ({ createTenantKnex: mocks.createTenantKnex }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: vi.fn(async () => mocks.currentUser) }));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: vi.fn(async () => 'test-signing-key'),
    getTenantSecret: mocks.getTenantSecret,
    setTenantSecret: mocks.setTenantSecret,
  })),
}));
vi.mock('@alga-psa/integrations/lib/outboundUrlPolicy', () => ({
  assertSafeOutboundUrl: mocks.assertSafeOutboundUrl,
  postSafeOutboundForm: mocks.postSafeOutboundForm,
}));
vi.mock('@/lib/productAccess', () => ({
  assertTenantProductAccess: vi.fn(async () => undefined),
  isProductAccessError: vi.fn(() => false),
  toProductAccessDeniedResponse: vi.fn(),
}));

import { GET } from '@/app/api/email/oauth/imap/callback/route';
import { POST } from '@/app/api/email/oauth/imap/initiate/route';
import { createImapOAuthState } from '@/utils/email/imapOAuthState';

const config = {
  oauth_token_url: 'https://oauth.example.com/token',
  oauth_client_id: 'client-a',
};

function configureDb() {
  mocks.tenantDb.mockReturnValue({
    table: (name: string) => {
      const query: any = {
        where: vi.fn(() => query),
        delete: vi.fn(() => ({ returning: vi.fn(async () => {
          mocks.deleteCount++;
          const consumed = mocks.consumedState;
          mocks.consumedState = null;
          return consumed ? [{ state: consumed }] : [];
        }) })),
        first: vi.fn(async () => name === 'email_providers' ? { id: 'provider-a' } : config),
        update: vi.fn(async () => 1),
      };
      return query;
    },
  });
  mocks.createTenantKnex.mockImplementation(async (tenant: string) => ({ knex: { fn: { now: () => new Date().toISOString() } }, tenant }));
}

async function signedAttempt(overrides: Record<string, unknown> = {}) {
  const { state, token } = await createImapOAuthState({
    tenant: 'tenant-a', userId: 'user-a', providerId: 'provider-a',
    redirectUri: 'https://app.example.com/api/email/oauth/imap/callback',
    ...overrides,
  } as any);
  mocks.consumedState = state;
  return token;
}

function request(state: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://app.example.com/api/email/oauth/imap/callback?code=auth-code&state=${encodeURIComponent(state)}`, { headers });
}

describe('IMAP OAuth callback security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.oauth_token_url = 'https://oauth.example.com/token';
    process.env.NEXTAUTH_SECRET = 'test-signing-key';
    mocks.consumedState = null;
    mocks.currentUser = null;
    mocks.deleteCount = 0;
    mocks.getTenantSecret.mockResolvedValue('client-secret');
    mocks.setTenantSecret.mockResolvedValue(undefined);
    mocks.postSafeOutboundForm.mockResolvedValue({ data: { access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600 } });
    mocks.assertSafeOutboundUrl.mockResolvedValue(undefined);
    configureDb();
  });

  it('requires an authenticated user to initiate authorization', async () => {
    const response = await POST(new NextRequest('https://app.example.com/api/email/oauth/imap/initiate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'provider-a' }),
    }));
    expect(response.status).toBe(401);
    expect(mocks.createTenantKnex).not.toHaveBeenCalled();
  });

  it('rejects forged or tampered state before database or secret access', async () => {
    const token = await signedAttempt();
    const [payload] = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), tenant: 'tenant-victim' })).toString('base64url');
    const response = await GET(request(`${tamperedPayload}.${token.split('.')[1]}`));
    expect(response.status).toBe(400);
    expect(mocks.createTenantKnex).not.toHaveBeenCalled();
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
    expect(mocks.postSafeOutboundForm).not.toHaveBeenCalled();
  });

  it('rejects unsigned legacy state before database or secret access', async () => {
    const unsigned = Buffer.from(JSON.stringify({
      tenant: 'tenant-a', userId: 'user-a', providerId: 'provider-a',
      redirectUri: 'https://app.example.com/api/email/oauth/imap/callback',
      timestamp: Date.now(), nonce: 'attacker-controlled',
    })).toString('base64');
    const response = await GET(request(unsigned));
    expect(response.status).toBe(400);
    expect(mocks.createTenantKnex).not.toHaveBeenCalled();
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
    expect(mocks.postSafeOutboundForm).not.toHaveBeenCalled();
  });

  it('rejects expired state before database or secret access', async () => {
    const token = await signedAttempt({ now: Date.now() - 11 * 60 * 1000 });
    const response = await GET(request(token));
    expect(response.status).toBe(400);
    expect(mocks.createTenantKnex).not.toHaveBeenCalled();
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
  });

  it('consumes state once and refuses replay', async () => {
    const token = await signedAttempt();
    expect((await GET(request(token))).status).toBe(307);
    expect((await GET(request(token))).status).toBe(400);
    expect(mocks.postSafeOutboundForm).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['tenant', 'tenant-victim'],
    ['userId', 'user-victim'],
    ['providerId', 'provider-victim'],
    ['redirectUri', 'https://attacker.example/callback'],
    ['purpose', 'other-purpose'],
    ['expiresAt', Date.now() + 60_000],
  ])('rejects a persisted %s binding mismatch before accessing credentials', async (field, value) => {
    const token = await signedAttempt();
    mocks.consumedState[field] = value;
    const response = await GET(request(token));
    expect(response.status).toBe(400);
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
    expect(mocks.postSafeOutboundForm).not.toHaveBeenCalled();
  });

  it('ignores a spoofed tenant header and completes a valid exchange', async () => {
    const validToken = await signedAttempt();
    const response = await GET(request(validToken, { 'x-tenant-id': 'tenant-victim' }));
    expect(response.status).toBe(307);
    expect(mocks.createTenantKnex).toHaveBeenLastCalledWith('tenant-a');
    expect(mocks.getTenantSecret).toHaveBeenCalledWith('tenant-a', 'imap_oauth_client_secret_provider-a');
    expect(mocks.postSafeOutboundForm).toHaveBeenCalledTimes(1);
    const [, form] = mocks.postSafeOutboundForm.mock.calls[0]!;
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('auth-code');
    expect(form.get('client_secret')).toBe('client-secret');
    expect(mocks.setTenantSecret).toHaveBeenCalledWith('tenant-a', 'imap_refresh_token_provider-a', 'refresh-token');
  });

  it('rejects an unsafe legacy token URL before retrieving credentials', async () => {
    const token = await signedAttempt();
    config.oauth_token_url = 'http://127.0.0.1/token';
    mocks.assertSafeOutboundUrl.mockRejectedValue(new Error('unsafe URL'));
    const response = await GET(request(token));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('127.0.0.1');
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
    expect(mocks.postSafeOutboundForm).not.toHaveBeenCalled();
    config.oauth_token_url = 'https://oauth.example.com/token';
  });

  it('does not disclose token-exchange errors in callback responses or logs', async () => {
    const token = await signedAttempt();
    mocks.postSafeOutboundForm.mockRejectedValue(new Error('client_secret=super-secret'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await GET(request(token));
    const body = await response.text();
    const logs = warn.mock.calls.flat().join(' ');

    expect(response.status).toBe(400);
    expect(body).not.toContain('super-secret');
    expect(logs).not.toContain('super-secret');
    expect(warn).toHaveBeenCalledWith('IMAP OAuth token exchange failed');
    warn.mockRestore();
  });
});
