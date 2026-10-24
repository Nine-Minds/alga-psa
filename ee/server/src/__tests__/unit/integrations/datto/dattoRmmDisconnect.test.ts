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

describe('Datto RMM disconnect', () => {
  let calls: ReturnType<typeof makeKnex>['calls'];
  let store: Map<string, string>;

  beforeEach(() => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    const secrets = makeSecrets({
      datto_rmm_api_key: 'KEY',
      datto_rmm_api_secret: 'SECRET',
      datto_rmm_access_token: 'tok',
      datto_rmm_access_token_expires_at: '123',
      datto_rmm_webhook_secret: 'whsec',
    });
    secretProvider = secrets.provider as any;
    store = secrets.store;
    const k = makeKnex();
    knexMock = k.knex;
    calls = k.calls;
  });

  async function runDisconnect() {
    const { disconnectDattoRmmIntegration } = await import(
      '@ee/lib/actions/integrations/dattoRmmActions'
    );
    return (disconnectDattoRmmIntegration as any)({} as any, { tenant: 'tenant_1' });
  }

  it('T014: clears the credentials, cached token and webhook secret', async () => {
    const res = await runDisconnect();

    expect(res).toEqual({ success: true });
    expect(store.has('datto_rmm_api_key')).toBe(false);
    expect(store.has('datto_rmm_api_secret')).toBe(false);
    expect(store.has('datto_rmm_access_token')).toBe(false);
    expect(store.has('datto_rmm_access_token_expires_at')).toBe(false);
    // Inbound alerts signed with the old secret must not survive a reconnect.
    expect(store.has('datto_rmm_webhook_secret')).toBe(false);
  });

  it('T014: deactivates the integration (which retires the scheduled jobs) and keeps the mappings', async () => {
    await runDisconnect();

    const update = calls.find((c) => c.table === 'rmm_integrations' && c.op === 'update');
    expect(update?.args[0]).toMatchObject({ is_active: false, connected_at: null, sync_error: null });

    // Mappings and assets are never touched.
    expect(calls.filter((c) => c.table === 'rmm_organization_mappings')).toEqual([]);
    expect(calls.filter((c) => c.table === 'assets')).toEqual([]);
    expect(calls.filter((c) => c.table === 'tenant_external_entity_mappings')).toEqual([]);
    expect(calls.filter((c) => c.op === 'del')).toEqual([]);
  });

  it('requires system_settings update', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const res = await runDisconnect();

    expect(res).toEqual({ success: false, error: 'Forbidden' });
    expect(hasPermissionMock).toHaveBeenCalledWith(expect.anything(), 'system_settings', 'update');
    expect(store.has('datto_rmm_api_key')).toBe(true);
    expect(calls).toEqual([]);
  });

  it('still deactivates when a secret delete fails', async () => {
    (secretProvider as any).deleteTenantSecret = vi.fn(async () => {
      throw new Error('vault down');
    });

    const res = await runDisconnect();

    expect(res.success).toBe(true);
    expect(calls.find((c) => c.table === 'rmm_integrations' && c.op === 'update')).toBeDefined();
  });
});

describe('Datto RMM webhook secret regeneration', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    knexMock = makeKnex().knex;
  });

  async function actions() {
    return (await import('@ee/lib/actions/integrations/dattoRmmActions')) as any;
  }

  it('replaces the stored secret and returns the new one with the webhook info', async () => {
    const { store, provider } = makeSecrets({ datto_rmm_webhook_secret: 'value-before-regenerate' });
    secretProvider = provider as any;
    const { regenerateDattoRmmWebhookSecret, getDattoRmmWebhookInfo } = await actions();

    const res = await regenerateDattoRmmWebhookSecret({} as any, { tenant: 'tenant_1' });

    expect(res.success).toBe(true);
    expect(res.webhook.secret).toMatch(/^[0-9a-f]{48}$/);
    expect(res.webhook.secret).not.toBe('value-before-regenerate');
    expect(store.get('datto_rmm_webhook_secret')).toBe(res.webhook.secret);
    expect(res.webhook.url).toContain('tenant=tenant_1');

    const info = await getDattoRmmWebhookInfo({} as any, { tenant: 'tenant_1' });
    expect(info.webhook.secret).toBe(res.webhook.secret);
  });

  it('requires system_settings update and leaves the secret alone otherwise', async () => {
    const { store, provider } = makeSecrets({ datto_rmm_webhook_secret: 'value-before-regenerate' });
    secretProvider = provider as any;
    hasPermissionMock.mockResolvedValue(false);
    const { regenerateDattoRmmWebhookSecret } = await actions();

    expect(await regenerateDattoRmmWebhookSecret({} as any, { tenant: 'tenant_1' })).toEqual({
      success: false,
      error: 'Forbidden',
    });
    expect(store.get('datto_rmm_webhook_secret')).toBe('value-before-regenerate');
  });
});
