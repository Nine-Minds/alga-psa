import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = { rows: [] as any[], users: [] as any[] };
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
      async select() {
        return filtered().map((row) => ({ ...row }));
      },
    };
    return query;
  };
  const knexMock: any = () => createQuery(state.rows);
  knexMock.fn = { now: () => 'NOW()' };
  return { state, knexMock, createQuery };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
  tenantDb: (_knex: any, tenant: string) => ({
    table: (name: string) => hoisted.createQuery(name === 'users' ? hoisted.state.users : hoisted.state.rows).where({ tenant }),
  }),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => 'shh' }),
}));
vi.mock('@alga-psa/event-bus', () => ({ getRedisConfig: () => ({ url: 'redis://x', prefix: 'alga-psa:' }) }));

import { parseThreecxConfig } from './providerState';
import { setThreecxTokenStore, type ThreecxTokenStore } from './pbx/token';
import {
  extensionForUser,
  mergeThreecxExtensions,
  setThreecxExtensionUser,
  syncThreecxExtensions,
  userForExtension,
} from './extensions';

const TENANT = 'tenant-1';

class FakeStore implements ThreecxTokenStore {
  async get() {
    return 'tok';
  }
  async setWithTtl() {}
  async del() {}
  async acquireLock() {
    return true;
  }
  async releaseLock() {}
}

function seedRow(extensions: unknown[] = []) {
  hoisted.state.rows.push({
    tenant: TENANT,
    provider: '3cx',
    provider_id: 'p1',
    status: 'active',
    webhook_secret: 'key',
    config: JSON.stringify({
      templateVersion: 1,
      pbx: { baseUrl: 'https://pbx.example.com', clientId: '900', clientSecretRef: 'ref', status: 'connected', capabilities: { xapi: true, callControl: true } },
      extensions,
    }),
  });
}

function usersFetch(pages: unknown[][]) {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/connect/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    const skip = Number(new URL(url).searchParams.get('$skip') ?? '0');
    const index = Math.floor(skip / 200);
    return new Response(JSON.stringify({ value: pages[index] ?? [] }), { status: 200 });
  });
}

describe('3CX extension map', () => {
  beforeEach(() => {
    hoisted.state.rows.length = 0;
    hoisted.state.users.length = 0;
    setThreecxTokenStore(new FakeStore());
  });

  it('F015/F016: merge auto-maps by email, keeps manual mappings, drops vanished extensions and disabled users', () => {
    const existing = [
      { dn: '101', pbxDisplayName: 'Old', pbxEmail: 'a@x.com', userId: 'u-manual', mappedBy: 'manual' as const },
      { dn: '102', pbxDisplayName: 'B', pbxEmail: 'b@x.com', userId: 'u-b', mappedBy: 'auto' as const },
      { dn: '103', pbxDisplayName: 'Gone', pbxEmail: '', userId: null, mappedBy: null },
    ];
    const pbxUsers = [
      { Number: '101', FirstName: 'Ann', LastName: 'A', EmailAddress: 'other@x.com', Enabled: true },
      { Number: '102', FirstName: 'Bob', LastName: 'B', EmailAddress: 'B@X.COM', Enabled: true },
      { Number: '104', FirstName: 'Dan', LastName: 'D', EmailAddress: 'nobody@x.com', Enabled: true },
      { Number: '105', FirstName: 'Off', LastName: 'O', EmailAddress: 'off@x.com', Enabled: false },
    ];
    const byEmail = new Map([['other@x.com', 'u-other'], ['b@x.com', 'u-b'], ['off@x.com', 'u-off']]);
    const merged = mergeThreecxExtensions(existing, pbxUsers, byEmail);
    expect(merged).toEqual([
      { dn: '101', pbxDisplayName: 'Ann A', pbxEmail: 'other@x.com', userId: 'u-manual', mappedBy: 'manual' },
      { dn: '102', pbxDisplayName: 'Bob B', pbxEmail: 'B@X.COM', userId: 'u-b', mappedBy: 'auto' },
      { dn: '104', pbxDisplayName: 'Dan D', pbxEmail: 'nobody@x.com', userId: null, mappedBy: null },
    ]);
  });

  it('F014: sync pages /Users with $select/$top/$skip and writes the merged map with a sync time', async () => {
    seedRow();
    hoisted.state.users.push({ tenant: TENANT, user_id: 'u1', email: 'One@x.com', user_type: 'internal' });
    const page1 = Array.from({ length: 200 }, (_, i) => ({ Number: String(200 + i), FirstName: 'U', LastName: String(i), EmailAddress: `u${i}@x.com`, Enabled: true }));
    const page2 = [{ Number: '101', FirstName: 'One', LastName: 'X', EmailAddress: 'one@x.com', Enabled: true }];
    const fetchImpl = usersFetch([page1, page2]);
    const state = await syncThreecxExtensions(TENANT, { fetchImpl: fetchImpl as any });
    const userCalls = fetchImpl.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/xapi/v1/Users'));
    expect(userCalls).toHaveLength(2);
    expect(userCalls[0]).toContain('%24select=Id%2CNumber%2CFirstName%2CLastName%2CEmailAddress%2CEnabled');
    expect(userCalls[1]).toContain('%24skip=200');
    expect(state.extensions).toHaveLength(201);
    expect(state.extensions.find((e) => e.dn === '101')).toMatchObject({ userId: 'u1', mappedBy: 'auto' });
    expect(state.extensionsSyncedAt).not.toBeNull();
  });

  it('F017: setThreecxExtensionUser sets a manual mapping, clears with null, and refuses an unknown dn', async () => {
    seedRow([{ dn: '101', pbxDisplayName: 'A', pbxEmail: 'a@x.com', userId: null, mappedBy: null }]);
    let state = await setThreecxExtensionUser(TENANT, { dn: '101', userId: 'u9' });
    expect(state.extensions[0]).toMatchObject({ userId: 'u9', mappedBy: 'manual' });
    state = await setThreecxExtensionUser(TENANT, { dn: '101', userId: null });
    expect(state.extensions[0]).toMatchObject({ userId: null, mappedBy: null });
    await expect(setThreecxExtensionUser(TENANT, { dn: '999', userId: 'u9' })).rejects.toThrow(/999/);
    expect(parseThreecxConfig(hoisted.state.rows[0].config).pbx.baseUrl).toBe('https://pbx.example.com');
  });

  it('F018: extensionForUser and userForExtension round-trip and return null for unknown ids', () => {
    const config = parseThreecxConfig({ extensions: [{ dn: '101', userId: 'u1', mappedBy: 'auto' }] });
    expect(extensionForUser(config, 'u1')).toBe('101');
    expect(userForExtension(config, '101')).toBe('u1');
    expect(extensionForUser(config, 'nope')).toBeNull();
    expect(userForExtension(config, '102')).toBeNull();
    expect(extensionForUser(config, null)).toBeNull();
  });
});
