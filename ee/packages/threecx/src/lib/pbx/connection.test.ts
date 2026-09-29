import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = { rows: [] as any[], secrets: new Map<string, string>() };
  const createQuery = (rows: any[]) => {
    const filters: Record<string, unknown>[] = [];
    const filtered = () =>
      rows.filter((row) => filters.every((cond) => Object.entries(cond).every(([k, v]) => row[k] === v)));
    const query: any = {
      where(cond: Record<string, unknown>) {
        filters.push(cond);
        return query;
      },
      async first() {
        const [row] = filtered();
        return row ? { ...row } : undefined;
      },
      async update(values: Record<string, unknown>) {
        filtered().forEach((row) => Object.assign(row, values));
        return filtered().length;
      },
    };
    return query;
  };
  const knexMock: any = () => createQuery(state.rows);
  knexMock.fn = { now: () => 'NOW()' };
  return { state, knexMock };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
  tenantDb: (_knex: any, tenant: string) => ({ table: () => hoisted.knexMock().where({ tenant }) }),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async () => undefined,
    getTenantSecret: async (tenant: string, name: string) => hoisted.state.secrets.get(`${tenant}:${name}`),
    setTenantSecret: async (tenant: string, name: string, value: string) => {
      hoisted.state.secrets.set(`${tenant}:${name}`, value);
    },
    deleteTenantSecret: async (tenant: string, name: string) => {
      hoisted.state.secrets.delete(`${tenant}:${name}`);
    },
  }),
}));
vi.mock('@alga-psa/event-bus', () => ({ getRedisConfig: () => ({ url: 'redis://x', prefix: 'alga-psa:' }) }));

import { parseThreecxConfig } from '../providerState';
import { setThreecxTokenStore, type ThreecxTokenStore } from './token';
import {
  clearThreecxPbxCredentials,
  saveThreecxPbxCredentials,
  testThreecxPbxConnection,
  validateThreecxPbxBaseUrl,
} from './connection';

const TENANT = 'tenant-1';

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

function seedRow(config: Record<string, unknown> = {}) {
  hoisted.state.rows.push({
    tenant: TENANT,
    provider: '3cx',
    provider_id: 'p1',
    status: 'active',
    webhook_secret: 'key',
    config: JSON.stringify({ templateVersion: 1, ...config }),
  });
}

function pbxFetch(plan: { token?: number; defs?: number; callcontrol?: number }) {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/connect/token')) {
      return new Response(JSON.stringify(plan.token === undefined ? { access_token: 't', expires_in: 3600 } : { error: 'invalid_client' }), {
        status: plan.token ?? 200,
      });
    }
    if (url.includes('/xapi/v1/Defs')) return new Response('{"value":[]}', { status: plan.defs ?? 200 });
    if (url.endsWith('/callcontrol')) return new Response('[]', { status: plan.callcontrol ?? 200 });
    return new Response('{}', { status: 404 });
  });
}

describe('3CX PBX connection', () => {
  const store = new FakeStore();
  beforeEach(() => {
    hoisted.state.rows.length = 0;
    hoisted.state.secrets.clear();
    store.values.clear();
    setThreecxTokenStore(store);
    delete process.env.THREECX_EMULATOR_MODE;
  });
  afterEach(() => {
    setThreecxTokenStore(null);
    delete process.env.THREECX_EMULATOR_MODE;
  });

  it('F002/F012: http:// is refused unless THREECX_EMULATOR_MODE is on', () => {
    expect(validateThreecxPbxBaseUrl('http://localhost:4070')).toMatchObject({ ok: false });
    expect(validateThreecxPbxBaseUrl('https://pbx.example.com/')).toEqual({ ok: true, baseUrl: 'https://pbx.example.com' });
    expect(validateThreecxPbxBaseUrl('not a url')).toMatchObject({ ok: false });
    process.env.THREECX_EMULATOR_MODE = 'true';
    expect(validateThreecxPbxBaseUrl('http://localhost:4070/')).toEqual({ ok: true, baseUrl: 'http://localhost:4070' });
  });

  it('F002: saving writes the secret to the tenant secret provider and only its ref into config', async () => {
    seedRow();
    const state = await saveThreecxPbxCredentials(TENANT, { baseUrl: 'https://pbx.example.com', clientId: '900', clientSecret: 'shh' });
    const config = parseThreecxConfig(hoisted.state.rows[0].config);
    expect(config.pbx).toMatchObject({ baseUrl: 'https://pbx.example.com', clientId: '900', clientSecretRef: 'threecx-pbx-client-secret', status: 'not_configured' });
    expect(hoisted.state.rows[0].config).not.toContain('shh');
    expect(hoisted.state.secrets.get(`${TENANT}:threecx-pbx-client-secret`)).toBe('shh');
    expect(state.pbx.hasClientSecret).toBe(true);
    expect((state.pbx as any).clientSecretRef).toBeUndefined();
  });

  it('F002: saving without a secret keeps the stored ref; without any secret it refuses', async () => {
    seedRow();
    await expect(saveThreecxPbxCredentials(TENANT, { baseUrl: 'https://pbx.example.com', clientId: '900' })).rejects.toThrow(/secret/i);
    await saveThreecxPbxCredentials(TENANT, { baseUrl: 'https://pbx.example.com', clientId: '900', clientSecret: 'shh' });
    await saveThreecxPbxCredentials(TENANT, { baseUrl: 'https://pbx2.example.com', clientId: '901' });
    const config = parseThreecxConfig(hoisted.state.rows[0].config);
    expect(config.pbx.clientSecretRef).toBe('threecx-pbx-client-secret');
    expect(config.pbx.baseUrl).toBe('https://pbx2.example.com');
  });

  it('F003: clearing removes config.pbx and the tenant secret', async () => {
    seedRow();
    await saveThreecxPbxCredentials(TENANT, { baseUrl: 'https://pbx.example.com', clientId: '900', clientSecret: 'shh' });
    const state = await clearThreecxPbxCredentials(TENANT);
    expect(state.pbx).toMatchObject({ baseUrl: null, clientId: null, hasClientSecret: false, status: 'not_configured' });
    expect(hoisted.state.secrets.size).toBe(0);
  });

  it('F008: a successful probe marks connected with both capabilities', async () => {
    seedRow();
    await saveThreecxPbxCredentials(TENANT, { baseUrl: 'https://pbx.example.com', clientId: '900', clientSecret: 'shh' });
    const state = await testThreecxPbxConnection(TENANT, { fetchImpl: pbxFetch({}) as any });
    expect(state.pbx.status).toBe('connected');
    expect(state.pbx.capabilities).toEqual({ xapi: true, callControl: true });
    expect(state.pbx.lastCheckedAt).not.toBeNull();
    expect(state.pbx.lastError).toBeNull();
  });

  it('F008: a 403 on /callcontrol leaves callControl not granted while xapi is granted', async () => {
    seedRow();
    await saveThreecxPbxCredentials(TENANT, { baseUrl: 'https://pbx.example.com', clientId: '900', clientSecret: 'shh' });
    const state = await testThreecxPbxConnection(TENANT, { fetchImpl: pbxFetch({ callcontrol: 403 }) as any });
    expect(state.pbx.status).toBe('connected');
    expect(state.pbx.capabilities).toEqual({ xapi: true, callControl: false });
  });

  it('F009: a token failure marks the connection as error with the PBX message and no capabilities', async () => {
    seedRow();
    await saveThreecxPbxCredentials(TENANT, { baseUrl: 'https://pbx.example.com', clientId: '900', clientSecret: 'shh' });
    const state = await testThreecxPbxConnection(TENANT, { fetchImpl: pbxFetch({ token: 401 }) as any });
    expect(state.pbx.status).toBe('error');
    expect(state.pbx.lastError).toMatch(/401/);
    expect(state.pbx.capabilities).toEqual({ xapi: false, callControl: false });
  });

  it('F008: testing before credentials are saved refuses', async () => {
    seedRow();
    await expect(testThreecxPbxConnection(TENANT)).rejects.toThrow(/Save the PBX credentials/);
  });
});
