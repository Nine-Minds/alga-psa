import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { decodeImapOAuthState, encodeImapOAuthState, type ImapOAuthState } from '@/utils/email/oauthHelpers';

const mocks = vi.hoisted(() => ({
  user: null as any,
  permitted: true,
  hasPermission: vi.fn(async () => true),
  secret: 'test-signing-key' as string | null,
  provider: null as any,
  config: null as any,
  grant: null as any,
  userRow: null as any,
  grantsInserted: [] as any[],
  tokenExchange: vi.fn(async () => ({ data: { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 } })),
  setTenantSecret: vi.fn(async () => undefined),
  permissionCheck: true,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: async () => mocks.user }));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: (...args: any[]) => (mocks.hasPermission as any)(...args) }));
vi.mock('@/lib/productAccess', () => ({
  assertTenantProductAccess: async () => undefined,
  isProductAccessError: () => false,
  toProductAccessDeniedResponse: () => null,
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async (name: string) => name === 'OAUTH_STATE_SIGNING_KEY' ? mocks.secret : 'https://psa.example.test',
    getTenantSecret: async () => 'client-secret',
    setTenantSecret: mocks.setTenantSecret,
  }),
}));
vi.mock('axios', () => ({ default: { post: (...args: any[]) => (mocks.tokenExchange as any)(...args) } }));
vi.mock('@/lib/db', () => ({ createTenantKnex: async (tenant?: string) => ({ knex: { fn: { now: () => new Date() } }, tenant: tenant || 'tenant-a' }) }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: (_knex: unknown, tenant = 'tenant-a') => ({
    table: (table: string) => {
      const predicates: Array<(row: any) => boolean> = [];
      const query: any = {
        where: (...args: any[]) => {
          if (typeof args[0] === 'object') predicates.push((row) => Object.entries(args[0]).every(([key, value]) => row[key] === value));
          else if (args.length === 3) predicates.push((row) => args[1] === '>' ? new Date(row[args[0]]).getTime() > new Date(args[2]).getTime() : row[args[0]] === args[2]);
          else predicates.push((row) => row[args[0]] === args[1]);
          return query;
        },
        first: async () => {
          const rows = table === 'email_providers' ? [mocks.provider]
            : table === 'imap_email_provider_config' ? [mocks.config]
            : table === 'users' ? [mocks.userRow] : [];
          return rows.find((row) => row && row.tenant === tenant && predicates.every((predicate) => predicate(row))) || null;
        },
        insert: async (row: any) => { mocks.grantsInserted.push(row); mocks.grant = { ...row }; },
        update: (values: any) => {
          const row = table === 'email_oauth_grants' ? mocks.grant : table === 'imap_email_provider_config' ? mocks.config : mocks.provider;
          const matched = Boolean(row && row.tenant === tenant && predicates.every((predicate) => predicate(row)));
          if (matched) Object.assign(row, values);
          return { returning: async () => matched ? [row] : [] };
        },
      };
      return query;
    },
  }),
}));

import { POST as initiate } from '../../../app/api/email/oauth/imap/initiate/route';
import { GET as callback } from '../../../app/api/email/oauth/imap/callback/route';
import { POST as reconnect } from '../../../app/api/email/imap/reconnect/route';
import { POST as googleInitiate } from '../../../app/api/email/oauth/initiate/route';

const baseState = (): ImapOAuthState => ({
  tenant: 'tenant-a', userId: 'user-a', providerId: 'provider-a',
  redirectUri: 'https://psa.example.test/api/email/oauth/imap/callback',
  timestamp: Date.now(), nonce: 'grant-a', purpose: 'reconnect',
});

function callbackRequest(stateToken: string) {
  return new NextRequest(`https://psa.example.test/api/email/oauth/imap/callback?code=auth-code&state=${encodeURIComponent(stateToken)}`);
}

describe('IMAP OAuth authorization routes', () => {
  beforeEach(() => {
    mocks.user = { tenant: 'tenant-a', user_id: 'user-a', user_type: 'internal' };
    mocks.permitted = true;
    mocks.hasPermission.mockImplementation(async () => mocks.permissionCheck);
    mocks.permissionCheck = true;
    mocks.secret = 'test-signing-key';
    mocks.provider = { tenant: 'tenant-a', id: 'provider-a', provider_type: 'imap', status: 'disconnected' };
    mocks.config = { tenant: 'tenant-a', email_provider_id: 'provider-a', oauth_authorize_url: 'https://oauth.example.test/authorize', oauth_token_url: 'https://oauth.example.test/token', oauth_client_id: 'client-id', oauth_scopes: 'mail.read' };
    mocks.grant = null;
    mocks.grantsInserted.length = 0;
    mocks.userRow = { tenant: 'tenant-a', user_id: 'user-a', user_type: 'internal', is_inactive: false };
    mocks.tokenExchange.mockClear();
    mocks.setTenantSecret.mockClear();
  });

  it('denies ticket-settings readers and client users before creating a grant', async () => {
    mocks.permissionCheck = false;
    let response = await initiate(new NextRequest('https://psa.example.test/api/email/oauth/imap/initiate', {
      method: 'POST', body: JSON.stringify({ providerId: 'provider-a' }), headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(403);
    expect(mocks.grantsInserted).toHaveLength(0);

    mocks.permissionCheck = true;
    mocks.user = { tenant: 'tenant-a', user_id: 'client-user', user_type: 'client' };
    response = await initiate(new NextRequest('https://psa.example.test/api/email/oauth/imap/initiate', {
      method: 'POST', body: JSON.stringify({ providerId: 'provider-a' }), headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(403);
    expect(mocks.grantsInserted).toHaveLength(0);
  });

  it('denies readers and client users from generic OAuth initiate and IMAP reconnect', async () => {
    const request = (path: string) => new NextRequest(`https://psa.example.test${path}`, {
      method: 'POST', body: JSON.stringify({ providerId: 'provider-a', provider: 'google' }),
      headers: { 'content-type': 'application/json' },
    });
    mocks.permissionCheck = false;
    expect((await googleInitiate(request('/api/email/oauth/initiate'))).status).toBe(403);
    expect((await reconnect(request('/api/email/imap/reconnect'))).status).toBe(403);
    mocks.permissionCheck = true;
    mocks.user = { tenant: 'tenant-a', user_id: 'client-user', user_type: 'client' };
    expect((await googleInitiate(request('/api/email/oauth/initiate'))).status).toBe(403);
    expect((await reconnect(request('/api/email/imap/reconnect'))).status).toBe(403);
  });

  it('rejects cross-tenant provider references before OAuth exchange', async () => {
    // A provider with this id exists, but belongs to tenant B. The mocked
    // tenantDb applies tenant filtering just like the production wrapper.
    mocks.provider = { tenant: 'tenant-b', id: 'provider-a', provider_type: 'imap', status: 'connected' };
    mocks.config.access_token = 'existing-access';
    mocks.config.refresh_token = 'existing-refresh';
    mocks.config.token_expires_at = 'existing-expiry';
    mocks.grant = {
      tenant: 'tenant-a', id: 'grant-a', provider_id: 'provider-a', initiated_by_user_id: 'user-a',
      purpose: 'reconnect', redirect_uri: baseState().redirectUri,
      expires_at: new Date(Date.now() + 60_000), consumed_at: null,
    };
    const response = await callback(callbackRequest(encodeImapOAuthState(baseState(), mocks.secret!)));
    expect(response.status).toBe(404);
    expect(mocks.tokenExchange).not.toHaveBeenCalled();
    expect(mocks.provider).toMatchObject({ tenant: 'tenant-b', id: 'provider-a', status: 'connected' });
    expect(mocks.config).toMatchObject({
      access_token: 'existing-access', refresh_token: 'existing-refresh', token_expires_at: 'existing-expiry',
    });
  });

  it('does not treat a same-id user in another tenant as the grant initiator', async () => {
    const token = encodeImapOAuthState(baseState(), mocks.secret!);
    mocks.userRow = { tenant: 'tenant-b', user_id: 'user-a', user_type: 'internal', is_inactive: false };
    mocks.grant = {
      tenant: 'tenant-a', id: 'grant-a', provider_id: 'provider-a', initiated_by_user_id: 'user-a',
      purpose: 'reconnect', redirect_uri: baseState().redirectUri,
      expires_at: new Date(Date.now() + 60_000), consumed_at: null,
    };
    const response = await callback(callbackRequest(token));
    expect(response.status).toBe(403);
    expect(mocks.tokenExchange).not.toHaveBeenCalled();
  });

  it('returns 400 for forged, unsigned, tampered, and expired callback state', async () => {
    const valid = encodeImapOAuthState(baseState(), mocks.secret!);
    const [payload, signature] = valid.split('.');
    const tampered = `${Buffer.from(JSON.stringify({ ...baseState(), tenant: 'tenant-b' })).toString('base64url')}.${signature}`;
    const expired = encodeImapOAuthState({ ...baseState(), timestamp: Date.now() - 11 * 60 * 1000 }, mocks.secret!);
    const unsigned = Buffer.from(JSON.stringify(baseState())).toString('base64');
    for (const token of [tampered, `${payload}.AAAA`, unsigned, expired]) {
      const response = await callback(callbackRequest(token));
      expect(response.status).toBe(400);
    }
    expect(mocks.tokenExchange).not.toHaveBeenCalled();
  });

  it('rejects replayed grants and atomically allows at most one concurrent callback', async () => {
    const initiateResponse = await initiate(new NextRequest('https://psa.example.test/api/email/oauth/imap/initiate', {
      method: 'POST', body: JSON.stringify({ providerId: 'provider-a' }), headers: { 'content-type': 'application/json' },
    }));
    const payload = await initiateResponse.json();
    const grantToken = new URL(payload.authUrl).searchParams.get('state')!;
    const [first, second] = await Promise.all([callback(callbackRequest(grantToken)), callback(callbackRequest(grantToken))]);
    expect([first.status, second.status].filter((status) => status === 307 || status === 308)).toHaveLength(1);
    expect([first.status, second.status].filter((status) => status === 400)).toHaveLength(1);
    expect(mocks.tokenExchange).toHaveBeenCalledTimes(1);
    expect(mocks.grant).toMatchObject({ tenant: 'tenant-a', provider_id: 'provider-a', initiated_by_user_id: 'user-a', purpose: 'reconnect' });
    const replay = await callback(callbackRequest(grantToken));
    expect(replay.status).toBe(400);
  });

  it('rejects an expired persisted grant without exchanging credentials', async () => {
    const initiateResponse = await initiate(new NextRequest('https://psa.example.test/api/email/oauth/imap/initiate', {
      method: 'POST', body: JSON.stringify({ providerId: 'provider-a' }), headers: { 'content-type': 'application/json' },
    }));
    const payload = await initiateResponse.json();
    mocks.grant.expires_at = new Date(Date.now() - 1000);
    const response = await callback(callbackRequest(new URL(payload.authUrl).searchParams.get('state')!));
    expect(response.status).toBe(400);
    expect(mocks.tokenExchange).not.toHaveBeenCalled();
  });

  it('rejects an initiating user who was deactivated before callback', async () => {
    const initiateResponse = await initiate(new NextRequest('https://psa.example.test/api/email/oauth/imap/initiate', {
      method: 'POST', body: JSON.stringify({ providerId: 'provider-a' }), headers: { 'content-type': 'application/json' },
    }));
    const payload = await initiateResponse.json();
    mocks.userRow.is_inactive = true;
    const response = await callback(callbackRequest(new URL(payload.authUrl).searchParams.get('state')!));
    expect(response.status).toBe(403);
    expect(mocks.tokenExchange).not.toHaveBeenCalled();
  });

  it('keeps persisted credentials unchanged when permission is revoked before callback', async () => {
    const original = { access_token: 'old-access', refresh_token: 'old-refresh', token_expires_at: 'old-expiry' };
    Object.assign(mocks.config, original);
    const initiateResponse = await initiate(new NextRequest('https://psa.example.test/api/email/oauth/imap/initiate', {
      method: 'POST', body: JSON.stringify({ providerId: 'provider-a' }), headers: { 'content-type': 'application/json' },
    }));
    const payload = await initiateResponse.json();
    mocks.permissionCheck = false;
    const response = await callback(callbackRequest(new URL(payload.authUrl).searchParams.get('state')!));
    expect(response.status).toBe(403);
    expect({ access_token: mocks.config.access_token, refresh_token: mocks.config.refresh_token, token_expires_at: mocks.config.token_expires_at }).toEqual(original);
    expect(mocks.provider.status).toBe('disconnected');
    expect(mocks.tokenExchange).not.toHaveBeenCalled();
  });

  it('completes an authorized internal-user reconnect', async () => {
    const initiateResponse = await initiate(new NextRequest('https://psa.example.test/api/email/oauth/imap/initiate', {
      method: 'POST', body: JSON.stringify({ providerId: 'provider-a' }), headers: { 'content-type': 'application/json' },
    }));
    expect(initiateResponse.status).toBe(200);
    const payload = await initiateResponse.json();
    const response = await callback(callbackRequest(new URL(payload.authUrl).searchParams.get('state')!));
    expect(response.status).toBe(307);
    expect(mocks.config.access_token).toBe('new-access');
    expect(mocks.config.refresh_token).toBe('new-refresh');
    expect(mocks.provider.status).toBe('connected');
  });
});
