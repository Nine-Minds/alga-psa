import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({ table: () => ({ where: () => ({ first: async () => undefined }) }) }),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }),
}));
vi.mock('@alga-psa/event-bus', () => ({ getRedisConfig: () => ({ url: 'redis://x', prefix: 'alga-psa:' }) }));

import {
  getThreecxAccessToken,
  invalidateThreecxToken,
  requestThreecxToken,
  ThreecxTokenError,
  threecxTokenKey,
  type ThreecxTokenStore,
} from './token';

const TENANT = 'tenant-1';
const CREDS = { baseUrl: 'https://pbx.example.com/', clientId: '900', clientSecret: 's3cret' };

class FakeStore implements ThreecxTokenStore {
  values = new Map<string, { value: string; ttl: number }>();
  locks = new Set<string>();
  async get(key: string) {
    return this.values.get(key)?.value ?? null;
  }
  async setWithTtl(key: string, value: string, ttl: number) {
    this.values.set(key, { value, ttl });
  }
  async del(key: string) {
    this.values.delete(key);
  }
  async acquireLock(key: string) {
    if (this.locks.has(key)) return false;
    this.locks.add(key);
    return true;
  }
  async releaseLock(key: string) {
    this.locks.delete(key);
  }
}

function tokenFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { status: 200, body: { access_token: 'tok-' + calls.length, expires_in: 3600 } };
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } });
  });
  return { fetchImpl, calls };
}

describe('3CX PBX token', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  it('F005: requestThreecxToken posts form-encoded client_credentials to /connect/token', async () => {
    const { fetchImpl, calls } = tokenFetch([{ status: 200, body: { access_token: 'abc', expires_in: 1800, token_type: 'Bearer' } }]);
    const token = await requestThreecxToken(CREDS, fetchImpl as any);
    expect(token).toEqual({ accessToken: 'abc', expiresIn: 1800 });
    expect(calls[0].url).toBe('https://pbx.example.com/connect/token');
    expect(calls[0].init?.method).toBe('POST');
    expect((calls[0].init?.headers as any)['content-type']).toBe('application/x-www-form-urlencoded');
    expect(String(calls[0].init?.body)).toBe('client_id=900&client_secret=s3cret&grant_type=client_credentials');
  });

  it('F005: a 401 from the token endpoint throws ThreecxTokenError with the status', async () => {
    const { fetchImpl } = tokenFetch([{ status: 401, body: { error: 'invalid_client' } }]);
    await expect(requestThreecxToken(CREDS, fetchImpl as any)).rejects.toMatchObject({ name: 'ThreecxTokenError', status: 401 });
  });

  it('F006: a second request within the TTL is served from the store without calling the PBX', async () => {
    const { fetchImpl } = tokenFetch([]);
    const first = await getThreecxAccessToken(TENANT, { credentials: CREDS, fetchImpl: fetchImpl as any, store });
    const second = await getThreecxAccessToken(TENANT, { credentials: CREDS, fetchImpl: fetchImpl as any, store });
    expect(first).toBe(second);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.values.get(threecxTokenKey(TENANT))?.ttl).toBe(3600 - 60);
  });

  it('F006: two concurrent requests on a cold store produce one PBX token call', async () => {
    const { fetchImpl } = tokenFetch([]);
    const [a, b] = await Promise.all([
      getThreecxAccessToken(TENANT, { credentials: CREDS, fetchImpl: fetchImpl as any, store }),
      getThreecxAccessToken(TENANT, { credentials: CREDS, fetchImpl: fetchImpl as any, store }),
    ]);
    expect(a).toBe(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('F007: force evicts the cached token and fetches a fresh one', async () => {
    const { fetchImpl } = tokenFetch([]);
    const first = await getThreecxAccessToken(TENANT, { credentials: CREDS, fetchImpl: fetchImpl as any, store });
    const second = await getThreecxAccessToken(TENANT, { credentials: CREDS, fetchImpl: fetchImpl as any, store, force: true });
    expect(second).not.toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await invalidateThreecxToken(TENANT, store);
    expect(await store.get(threecxTokenKey(TENANT))).toBeNull();
  });

  it('F005: missing credentials throw a ThreecxTokenError before any network call', async () => {
    const { fetchImpl } = tokenFetch([]);
    await expect(getThreecxAccessToken(TENANT, { fetchImpl: fetchImpl as any, store })).rejects.toBeInstanceOf(ThreecxTokenError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
