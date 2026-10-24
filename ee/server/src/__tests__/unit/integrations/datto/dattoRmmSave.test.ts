import { beforeEach, describe, expect, it, vi } from 'vitest';

// These are Next.js server actions, so we unit-test by mocking the wrappers and dependencies,
// then calling the underlying handler directly.

let secretProvider: { getTenantSecret: (tenant: string, key: string) => Promise<string | null> };
let knexMock: any;
const hasPermissionMock = vi.fn(async (..._args: any[]) => true);
const buildClientMock = vi.fn();
const clearReconnectMock = vi.fn(async () => undefined);

// Tier gating is exercised by the shared helper's own tests; keep these edition-independent.
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => secretProvider),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexMock })),
  withTransaction: vi.fn(async (knex: any, fn: any) => fn(knex)),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any) => q,
  }),
}));

vi.mock('@alga-psa/assets/actions/assetActions', () => ({
  createAsset: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

// The sync engines are exercised by their own suites; these tests are about
// the settings actions.
vi.mock('@ee/lib/integrations/datto/siteSync', () => ({ runDattoRmmSiteSync: vi.fn() }));
vi.mock('@ee/lib/integrations/datto/deviceSync', () => ({ runDattoRmmDeviceSync: vi.fn() }));
vi.mock('@ee/lib/integrations/datto/syncSingleDevice', () => ({ syncDattoSingleDeviceForTenant: vi.fn() }));
vi.mock('@ee/lib/integrations/datto/alertBackfill', () => ({ runDattoRmmAlertBackfill: vi.fn() }));
vi.mock('@ee/lib/integrations/datto/softwareIngest', () => ({ runDattoRmmSoftwareIngest: vi.fn() }));

vi.mock('@ee/lib/integrations/datto/buildClient', () => ({
  buildDattoClientForTenant: (...args: any[]) => buildClientMock(...args),
  clearDattoReconnectRequired: (...args: any[]) => (clearReconnectMock as any)(...args),
}));


function makeKnex(rows: Record<string, any> = {}) {
  const calls: Array<{ table: string; op: string; args: any[] }> = [];
  const knex: any = vi.fn((table: string) => {
    const q: any = {};
    for (const op of ['where', 'whereRaw', 'whereNotNull', 'select']) q[op] = vi.fn().mockReturnThis();
    q.first = vi.fn(async () => rows[table]);
    q.update = vi.fn(async (patch: any) => {
      calls.push({ table, op: 'update', args: [patch] });
      return 1;
    });
    q.del = vi.fn(async () => {
      calls.push({ table, op: 'del', args: [] });
      return 1;
    });
    q.insert = vi.fn((row: any) => {
      calls.push({ table, op: 'insert', args: [row] });
      return q;
    });
    q.onConflict = vi.fn().mockReturnThis();
    q.merge = vi.fn(async (merge: any) => {
      calls.push({ table, op: 'merge', args: [merge] });
      return [];
    });
    return q;
  });
  knex.fn = { now: () => 'NOW' };
  knex.raw = vi.fn((sql: string, bindings?: any[]) => ({ sql, bindings }));
  return { knex, calls };
}

function makeSecrets(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const provider = {
    getTenantSecret: vi.fn(async (_tenant: string, key: string) => store.get(key) ?? null),
    setTenantSecret: vi.fn(async (_tenant: string, key: string, value: string | null) => {
      if (value === null) store.delete(key);
      else store.set(key, value);
    }),
    deleteTenantSecret: vi.fn(async (_tenant: string, key: string) => {
      store.delete(key);
    }),
  };
  return { provider, store };
}

describe('Datto RMM save configuration', () => {
  let calls: ReturnType<typeof makeKnex>['calls'];
  let store: Map<string, string>;

  function setup(args: { secrets?: Record<string, string>; row?: any } = {}) {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    clearReconnectMock.mockClear();
    const secrets = makeSecrets(args.secrets);
    secretProvider = secrets.provider as any;
    store = secrets.store;
    const k = makeKnex(args.row ? { rmm_integrations: args.row } : {});
    knexMock = k.knex;
    calls = k.calls;
  }

  async function save(input: any) {
    const { saveDattoRmmConfiguration } = await import(
      '@ee/lib/actions/integrations/dattoRmmActions'
    );
    return (saveDattoRmmConfiguration as any)({} as any, { tenant: 'tenant_1' }, input);
  }

  beforeEach(() => setup());

  it('derives the API URL from the platform and stores the credentials', async () => {
    const res = await save({ platform: 'concord', apiKey: ' K ', apiSecret: ' S ' });

    expect(res).toEqual({ success: true });
    expect(store.get('datto_rmm_api_key')).toBe('K');
    expect(store.get('datto_rmm_api_secret')).toBe('S');
    const insert = calls.find((c) => c.table === 'rmm_integrations' && c.op === 'insert')?.args[0];
    expect(insert).toMatchObject({ provider: 'datto', instance_url: 'https://concord-api.centrastage.net/api', is_active: false });
    expect(insert.settings).toMatchObject({ platform: 'concord' });
    expect(clearReconnectMock).toHaveBeenCalledWith('tenant_1');
  });

  it('normalizes a custom URL', async () => {
    const res = await save({ platform: 'custom', instanceUrl: 'my-api.centrastage.net/', apiKey: 'K', apiSecret: 'S' });

    expect(res.success).toBe(true);
    const insert = calls.find((c) => c.op === 'insert')?.args[0];
    expect(insert.instance_url).toBe('https://my-api.centrastage.net/api');
  });

  it('rejects a custom URL that is not a Datto host, before touching secrets or the database', async () => {
    for (const instanceUrl of ['my-api.example.com', 'https://centrastage.net.evil.example', 'https://merlot-api.centrastage.net:8443']) {
      const res = await save({ platform: 'custom', instanceUrl, apiKey: 'K', apiSecret: 'S' });
      expect(res.success, instanceUrl).toBe(false);
      expect(res.error).toMatch(/Datto host/);
    }
    expect(calls).toEqual([]);
    expect(store.size).toBe(0);
  });

  it('requires the key and secret to be re-entered when the host changes, and stores nothing otherwise', async () => {
    setup({
      secrets: { datto_rmm_api_key: 'OLDK', datto_rmm_api_secret: 'OLDS', datto_rmm_access_token: 'tok' },
      row: { instance_url: 'https://merlot-api.centrastage.net/api', settings: { platform: 'merlot' } },
    });

    for (const input of [
      { platform: 'concord' },
      { platform: 'concord', apiKey: 'NEWK' },
      { platform: 'concord', apiSecret: 'NEWS' },
      { platform: 'custom', instanceUrl: 'https://my-api.centrastage.net' },
    ]) {
      const res = await save(input);
      expect(res.success, JSON.stringify(input)).toBe(false);
      expect(res.error).toMatch(/Re-enter the API key and API secret/);
    }
    expect(calls).toEqual([]);
    expect(store.get('datto_rmm_api_key')).toBe('OLDK');
    expect(store.get('datto_rmm_api_secret')).toBe('OLDS');
    expect(store.get('datto_rmm_access_token')).toBe('tok');

    const ok = await save({ platform: 'concord', apiKey: 'NEWK', apiSecret: 'NEWS' });
    expect(ok.success).toBe(true);
    expect(store.get('datto_rmm_api_key')).toBe('NEWK');
    expect(store.get('datto_rmm_api_secret')).toBe('NEWS');
    expect(store.has('datto_rmm_access_token')).toBe(false);
  });

  it('an unchanged host does not need the credentials again', async () => {
    setup({
      secrets: { datto_rmm_api_key: 'OLDK', datto_rmm_api_secret: 'OLDS' },
      row: { instance_url: 'https://my-api.centrastage.net/api', settings: { platform: 'custom' } },
    });
    const res = await save({ platform: 'custom', instanceUrl: 'https://my-api.centrastage.net/', softwareIngestOnSync: true });
    expect(res.success).toBe(true);
  });

  it('rejects a custom platform without a usable URL', async () => {
    const res = await save({ platform: 'custom', instanceUrl: 'http://not-allowed.example.com', apiKey: 'K', apiSecret: 'S' });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/https/);
    expect(calls).toEqual([]);
  });

  it('requires both credentials on first save', async () => {
    const res = await save({ platform: 'merlot', apiKey: 'K' });

    expect(res).toEqual({ success: false, error: 'API key and API secret are required' });
    expect(store.size).toBe(0);
  });

  it('blank credentials keep the stored ones and leave the connection active', async () => {
    setup({
      secrets: { datto_rmm_api_key: 'OLDK', datto_rmm_api_secret: 'OLDS', datto_rmm_access_token: 'tok' },
      row: { instance_url: 'https://merlot-api.centrastage.net/api', settings: { platform: 'merlot' } },
    });

    const res = await save({ platform: 'merlot', apiKey: '', apiSecret: '', resolveAlertsOnTicketClose: true });

    expect(res.success).toBe(true);
    expect(store.get('datto_rmm_api_key')).toBe('OLDK');
    expect(store.get('datto_rmm_api_secret')).toBe('OLDS');
    // Nothing that authenticates changed, so the cached token survives.
    expect(store.get('datto_rmm_access_token')).toBe('tok');
    expect(clearReconnectMock).not.toHaveBeenCalled();

    const merge = calls.find((c) => c.op === 'merge')?.args[0];
    expect(merge.is_active).toEqual({ sql: 'rmm_integrations.is_active', bindings: undefined });
  });

  it('changing the secret clears the cached token and deactivates until the next test', async () => {
    setup({
      secrets: { datto_rmm_api_key: 'OLDK', datto_rmm_api_secret: 'OLDS', datto_rmm_access_token: 'tok', datto_rmm_access_token_expires_at: '9' },
      row: { instance_url: 'https://merlot-api.centrastage.net/api', settings: { platform: 'merlot' } },
    });

    const res = await save({ platform: 'merlot', apiSecret: 'NEWS' });

    expect(res.success).toBe(true);
    expect(store.get('datto_rmm_api_secret')).toBe('NEWS');
    expect(store.get('datto_rmm_api_key')).toBe('OLDK');
    expect(store.has('datto_rmm_access_token')).toBe(false);
    expect(store.has('datto_rmm_access_token_expires_at')).toBe(false);
    expect(clearReconnectMock).toHaveBeenCalledWith('tenant_1');
    expect(calls.find((c) => c.op === 'merge')?.args[0]).toMatchObject({ is_active: false, connected_at: null });
  });

  it('merges settings as jsonb so deviceSync, alertPolling and tokenLifecycle survive', async () => {
    setup({
      secrets: { datto_rmm_api_key: 'K', datto_rmm_api_secret: 'S' },
      row: { instance_url: 'https://merlot-api.centrastage.net/api', settings: {} },
    });

    await save({ platform: 'merlot', rebootComponentUid: ' comp-9 ', softwareIngestOnSync: true });

    const merge = calls.find((c) => c.op === 'merge')?.args[0];
    expect(merge.settings.sql).toContain('||');
    const patch = JSON.parse(merge.settings.bindings[0]);
    expect(patch).toEqual({ platform: 'merlot', rebootComponentUid: 'comp-9', softwareIngestOnSync: true });
    expect(Object.keys(patch)).not.toContain('deviceSync');
    expect(Object.keys(patch)).not.toContain('alertPolling');
    expect(Object.keys(patch)).not.toContain('tokenLifecycle');
  });

  it('turning on auto-create clients requires client:create, and stores nothing without it', async () => {
    setup({
      secrets: { datto_rmm_api_key: 'K', datto_rmm_api_secret: 'S' },
      row: { instance_url: 'https://merlot-api.centrastage.net/api', settings: { autoCreateClientsForNewSites: false } },
    });
    hasPermissionMock.mockImplementation(async (_user: any, resource: string) => resource !== 'client');

    const denied = await save({ platform: 'merlot', autoCreateClientsForNewSites: true });

    expect(denied.success).toBe(false);
    expect(denied.error).toMatch(/permission to create clients/);
    expect(hasPermissionMock).toHaveBeenCalledWith(expect.anything(), 'client', 'create');
    expect(calls).toEqual([]);

    hasPermissionMock.mockResolvedValue(true);
    const allowed = await save({ platform: 'merlot', autoCreateClientsForNewSites: true });
    expect(allowed.success).toBe(true);
    const patch = JSON.parse(calls.find((c) => c.op === 'merge')?.args[0].settings.bindings[0]);
    expect(patch.autoCreateClientsForNewSites).toBe(true);
  });

  it('saving with auto-create already on, or turning it off, needs only settings access', async () => {
    setup({
      secrets: { datto_rmm_api_key: 'K', datto_rmm_api_secret: 'S' },
      row: { instance_url: 'https://merlot-api.centrastage.net/api', settings: { autoCreateClientsForNewSites: true } },
    });
    hasPermissionMock.mockImplementation(async (_user: any, resource: string) => resource !== 'client');

    expect((await save({ platform: 'merlot', autoCreateClientsForNewSites: true })).success).toBe(true);
    expect((await save({ platform: 'merlot', autoCreateClientsForNewSites: false })).success).toBe(true);
    expect(hasPermissionMock).not.toHaveBeenCalledWith(expect.anything(), 'client', 'create');
  });

  it('requires system_settings update', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const res = await save({ platform: 'merlot', apiKey: 'K', apiSecret: 'S' });

    expect(res).toEqual({ success: false, error: 'Forbidden' });
    expect(store.size).toBe(0);
  });
});
