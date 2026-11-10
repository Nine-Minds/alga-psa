import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  user: null as any,
  permission: false,
  issuerBound: true,
  dbReads: [] as string[],
  writes: [] as string[],
  secretReads: [] as string[],
  secretWrites: [] as Array<[string, string]>,
  posts: [] as string[],
}));

vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: () => mocks.user }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: () => mocks.permission }));
vi.mock('@/lib/db', () => ({
  createTenantKnex: async () => ({ knex: { fn: { now: () => new Date() } }, tenant: 'tenant-1' }),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      mocks.dbReads.push(name);
      let where: any;
      const query: any = {
        where: (criteria: any) => { where = criteria; return query; },
        first: async () => name === 'email_providers'
          ? { id: where?.id, provider_type: 'imap', inbound_paused_at: null }
          : {
              email_provider_id: where?.email_provider_id,
              tenant: 'tenant-1',
              oauth_token_url: 'https://auth.example.test/token',
              oauth_authorize_url: 'https://auth.example.test/authorize',
              oauth_client_id: 'client-id',
              oauth_credentials_token_url: mocks.issuerBound ? 'https://auth.example.test/token' : null,
              oauth_credentials_secret_version: 0,
              oauth_client_secret: null,
              refresh_token: null,
            },
        update: async (changes: any) => { mocks.writes.push(`${name}:${JSON.stringify(changes)}`); return 1; },
      };
      return query;
    },
  }),
}));
vi.mock('@/lib/productAccess', () => ({
  assertTenantProductAccess: async () => {},
  isProductAccessError: () => false,
  toProductAccessDeniedResponse: () => new Response(null, { status: 403 }),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async () => 'https://app.example.test',
    getTenantSecret: async (_tenant: string, name: string) => { mocks.secretReads.push(name); return 'refresh-secret'; },
    setTenantSecret: async (_tenant: string, name: string, value: string) => { mocks.secretWrites.push([name, value]); },
  }),
}));
vi.mock('axios', () => ({ default: { post: async (url: string) => { mocks.posts.push(url); return { data: { access_token: 'access-token', expires_in: 300 } }; } } }));
vi.mock('@alga-psa/shared/services/email/imapOutboundTarget', () => ({
  isImapOauthCredentialIssuerBound: (config: any) => config.oauth_credentials_token_url === config.oauth_token_url,
  getImapOauthSecretNames: () => ({ clientSecret: 'scoped-client', refreshToken: 'scoped-refresh' }),
  assertSafeImapOauthTokenEndpoint: async () => ({ lookup: () => {} }),
}));

const admin = { user_id: 'admin-1', tenant: 'tenant-1', user_type: 'internal' };
const callbackState = Buffer.from(JSON.stringify({
  tenant: 'tenant-1', userId: 'different-user', providerId: 'provider-1',
  redirectUri: 'https://app.example.test/callback', timestamp: Date.now(), nonce: 'nonce',
})).toString('base64');

function request(path: string, method: 'GET' | 'POST' = 'POST', body?: unknown) {
  const url = path.startsWith('http') ? path : `http://localhost${path}`;
  return new NextRequest(url, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

describe('IMAP provider route administration boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = admin;
    mocks.permission = false;
    mocks.issuerBound = true;
    mocks.dbReads.length = 0;
    mocks.writes.length = 0;
    mocks.secretReads.length = 0;
    mocks.secretWrites.length = 0;
    mocks.posts.length = 0;
  });

  const cases = [
    ['resync', () => import('@/app/api/email/imap/resync/route').then((m) => m.POST(request('/api/email/imap/resync', 'POST', { providerId: 'provider-1' })))],
    ['reconnect', () => import('@/app/api/email/imap/reconnect/route').then((m) => m.POST(request('/api/email/imap/reconnect', 'POST', { providerId: 'provider-1' })))],
    ['initiate', () => import('@/app/api/email/oauth/imap/initiate/route').then((m) => m.POST(request('/api/email/oauth/imap/initiate', 'POST', { providerId: 'provider-1' })))],
    ['callback', () => import('@/app/api/email/oauth/imap/callback/route').then((m) => m.GET(request(`http://localhost/api/email/oauth/imap/callback?code=code&state=${encodeURIComponent(callbackState)}`, 'GET')))],
  ] as const;

  it.each(cases)('%s rejects anonymous, client, and low-privilege callers before side effects', async (_name, invoke) => {
    mocks.user = null;
    expect((await invoke()).status).toBe(401);
    expect(mocks.dbReads).toEqual([]);

    mocks.user = { ...admin, user_type: 'client' };
    expect((await invoke()).status).toBe(403);
    expect(mocks.dbReads).toEqual([]);

    mocks.user = admin;
    mocks.permission = false;
    expect((await invoke()).status).toBe(403);
    expect(mocks.dbReads).toEqual([]);
    expect(mocks.writes).toEqual([]);
    expect(mocks.secretReads).toEqual([]);
    expect(mocks.secretWrites).toEqual([]);
    expect(mocks.posts).toEqual([]);
  });

  it.each(cases)('%s permits an authorized MSP administrator', async (_name, invoke) => {
    mocks.permission = true;
    const response = await invoke();
    expect(response.status).toBe(_name === 'callback' ? 307 : 200);
    expect(mocks.dbReads).toContain('email_providers');
    if (_name === 'resync' || _name === 'reconnect') expect(mocks.writes.length).toBeGreaterThan(0);
    if (_name === 'callback') {
      expect(mocks.posts).toEqual(['https://auth.example.test/token']);
      expect(mocks.secretWrites).toContainEqual(['scoped-refresh', 'refresh-secret']);
      expect(mocks.writes.some((write) => write.includes('"refresh_token":"refresh-secret"'))).toBe(true);
      expect(mocks.writes.some((write) => write.includes('"oauth_reauthorization_required":false'))).toBe(true);
    }
  });

  it('does not restore an unbound refresh credential when callback omits refresh_token', async () => {
    mocks.permission = true;
    mocks.issuerBound = false;
    const { GET } = await import('@/app/api/email/oauth/imap/callback/route');

    const response = await GET(request(`http://localhost/api/email/oauth/imap/callback?code=code&state=${encodeURIComponent(callbackState)}`, 'GET'));

    expect(response.status).toBe(307);
    expect(mocks.secretReads).toEqual([]);
    expect(mocks.secretWrites).toEqual([]);
    expect(mocks.writes.some((write) => write.includes('"oauth_credentials_token_url":null'))).toBe(true);
    expect(mocks.writes.some((write) => write.includes('"oauth_reauthorization_required":true'))).toBe(true);
  });
});
