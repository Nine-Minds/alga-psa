import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({ table: () => ({ where: () => ({ first: async () => undefined }) }) }),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }),
}));
vi.mock('@alga-psa/event-bus', () => ({ getRedisConfig: () => ({ url: 'redis://x', prefix: 'alga-psa:' }) }));

import { createThreecxPbxClient, odataPageAll, ThreecxPbxError } from './client';
import type { ThreecxTokenStore } from './token';

const TENANT = 'tenant-1';
const CREDS = { baseUrl: 'https://pbx.example.com', clientId: '900', clientSecret: 's3cret' };

class FakeStore implements ThreecxTokenStore {
  values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async setWithTtl(key: string, value: string) {
    this.values.set(key, value);
  }
  async del(key: string) {
    this.values.delete(key);
  }
  async acquireLock() {
    return true;
  }
  async releaseLock() {}
}

type Handler = (url: string, init?: RequestInit) => { status: number; body?: unknown } | undefined;

function fakeFetch(handler: Handler) {
  let tokens = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/connect/token')) {
      tokens += 1;
      return new Response(JSON.stringify({ access_token: `tok-${tokens}`, expires_in: 3600 }), { status: 200 });
    }
    const result = handler(url, init) ?? { status: 200, body: {} };
    return new Response(result.body === undefined ? null : JSON.stringify(result.body), { status: result.status });
  });
  return { fetchImpl, calls, tokenCount: () => tokens };
}

describe('ThreecxPbxClient', () => {
  it('F004: prefixes /xapi/v1 and /callcontrol and sends the bearer header on every call', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { value: [] } }));
    const client = await createThreecxPbxClient(TENANT, { credentials: CREDS, fetchImpl: fetchImpl as any, store: new FakeStore() });
    await client.xapiGet('/Users', { $top: 5, $select: 'Id' });
    await client.callControlGet('/900/participants/1');
    await client.xapiPost('/Contacts', { FirstName: 'A' });
    await client.xapiDelete('/Contacts(4)');
    const nonToken = calls.filter((c) => !c.url.endsWith('/connect/token'));
    expect(nonToken.map((c) => c.url)).toEqual([
      'https://pbx.example.com/xapi/v1/Users?%24top=5&%24select=Id',
      'https://pbx.example.com/callcontrol/900/participants/1',
      'https://pbx.example.com/xapi/v1/Contacts',
      'https://pbx.example.com/xapi/v1/Contacts(4)',
    ]);
    for (const call of nonToken) {
      expect((call.init?.headers as any).authorization).toBe('Bearer tok-1');
    }
    expect(nonToken[2].init?.method).toBe('POST');
    expect(nonToken[3].init?.method).toBe('DELETE');
  });

  it('F007: a 401 evicts the cached token and the retried call succeeds with a fresh token', async () => {
    let first = true;
    const { fetchImpl, calls, tokenCount } = fakeFetch(() => {
      if (first) {
        first = false;
        return { status: 401, body: { error: 'expired' } };
      }
      return { status: 200, body: { Id: 1 } };
    });
    const store = new FakeStore();
    const client = await createThreecxPbxClient(TENANT, { credentials: CREDS, fetchImpl: fetchImpl as any, store });
    const result = await client.xapiGet('/Defs');
    expect(result).toEqual({ Id: 1 });
    expect(tokenCount()).toBe(2);
    const defs = calls.filter((c) => c.url.endsWith('/Defs'));
    expect((defs[0].init?.headers as any).authorization).toBe('Bearer tok-1');
    expect((defs[1].init?.headers as any).authorization).toBe('Bearer tok-2');
  });

  it('F007: a second consecutive 401 surfaces as ThreecxPbxError without a third attempt', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 401, body: {} }));
    const client = await createThreecxPbxClient(TENANT, { credentials: CREDS, fetchImpl: fetchImpl as any, store: new FakeStore() });
    await expect(client.xapiGet('/Defs')).rejects.toMatchObject({ name: 'ThreecxPbxError', status: 401 });
    expect(calls.filter((c) => c.url.endsWith('/Defs'))).toHaveLength(2);
  });

  it('F004: non-2xx answers become ThreecxPbxError carrying the status and body', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 422, body: { message: 'bad destination' } }));
    const client = await createThreecxPbxClient(TENANT, { credentials: CREDS, fetchImpl: fetchImpl as any, store: new FakeStore() });
    const error: any = await client.xapiPost('/Users/Pbx.MakeCall', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ThreecxPbxError);
    expect(error.status).toBe(422);
    expect(error.body).toContain('bad destination');
  });

  it('F014: odataPageAll follows $top/$skip until a short page', async () => {
    const pages: Record<string, unknown[]> = { '0': [1, 2], '2': [3, 4], '4': [5] };
    const { fetchImpl } = fakeFetch((url) => {
      const skip = new URL(url).searchParams.get('$skip') ?? '0';
      return { status: 200, body: { value: pages[skip] ?? [] } };
    });
    const client = await createThreecxPbxClient(TENANT, { credentials: CREDS, fetchImpl: fetchImpl as any, store: new FakeStore() });
    const all = await odataPageAll<number>(client, '/Users', { $select: 'Id' }, 2);
    expect(all).toEqual([1, 2, 3, 4, 5]);
  });
});
