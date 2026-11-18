import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DattoRmmClient } from '@ee/lib/integrations/datto/dattoApiClient';

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

const BASE = 'https://merlot-api.centrastage.net/api';

function axiosError(status: number | undefined): any {
  const err: any = new Error(status ? `Request failed with status code ${status}` : 'connect ECONNREFUSED');
  err.isAxiosError = true;
  if (status) err.response = { status, headers: {}, data: {} };
  return err;
}

const isTokenCall = (args: any) => String(args.url).endsWith('/auth/oauth/token');

/** A real client over a fake transport, so the 401 / 403 / network paths are the client's own. */
function clientOver(handler: (args: any) => any) {
  const http = { request: vi.fn(async (args: any) => handler(args)) };
  return new DattoRmmClient({
    baseUrl: BASE,
    apiKey: 'key-123',
    apiSecret: 'secret-456',
    http: http as any,
    sleep: async () => undefined,
  });
}

describe('Datto RMM connection test', () => {
  let calls: ReturnType<typeof makeKnex>['calls'];

  beforeEach(() => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    buildClientMock.mockReset();
    clearReconnectMock.mockClear();
    secretProvider = makeSecrets().provider as any;
    const k = makeKnex();
    knexMock = k.knex;
    calls = k.calls;
  });

  async function runTest() {
    const { testDattoRmmConnection } = await import(
      '@ee/lib/actions/integrations/dattoRmmActions'
    );
    return (testDattoRmmConnection as any)({} as any, { tenant: 'tenant_1' });
  }

  it('T013: requires system_settings update and never builds a client without it', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const res = await runTest();

    expect(res).toEqual({ success: false, error: 'Forbidden' });
    expect(hasPermissionMock).toHaveBeenCalledWith(expect.anything(), 'system_settings', 'update');
    expect(buildClientMock).not.toHaveBeenCalled();
  });

  it('asks for configuration first when there is no client to build', async () => {
    buildClientMock.mockResolvedValue(null);

    const res = await runTest();

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not configured/i);
    expect(buildClientMock).toHaveBeenCalledWith('tenant_1', { allowInactive: true });
  });

  it('reports the account name and counts, activates the integration, and clears reconnect-required', async () => {
    buildClientMock.mockResolvedValue(
      clientOver((args) => {
        if (isTokenCall(args)) return { data: { access_token: 'tok', expires_in: 3600 } };
        if (String(args.url).endsWith('/v2/account')) {
          return { data: { name: 'Acme MSP', devicesStatus: { numberOfDevices: 412 } } };
        }
        if (String(args.url).endsWith('/v2/account/sites')) {
          expect(args.params).toEqual({ max: 1 });
          return { data: { sites: [{ uid: 's1' }], pageDetails: { count: 1, totalCount: 37 } } };
        }
        throw new Error(`unexpected ${args.url}`);
      })
    );

    const res = await runTest();

    expect(res).toEqual({ success: true, accountName: 'Acme MSP', deviceCount: 412, siteCount: 37 });
    expect(calls.find((c) => c.table === 'rmm_integrations' && c.op === 'update')?.args[0]).toMatchObject({
      is_active: true,
      sync_error: null,
    });
    expect(clearReconnectMock).toHaveBeenCalledWith('tenant_1');
  });

  it('401 on authentication names the key, secret, and platform', async () => {
    buildClientMock.mockResolvedValue(
      clientOver((args) => {
        if (isTokenCall(args)) throw axiosError(401);
        throw new Error('should not be reached');
      })
    );

    const res = await runTest();

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/API key/);
    expect(res.error).toMatch(/secret/i);
    expect(res.error).toMatch(/platform/i);
    expect(res.error).not.toMatch(/security level/i);
    // A failed test must not flip the integration to active.
    expect(calls.find((c) => c.table === 'rmm_integrations' && c.op === 'update')).toBeUndefined();
  });

  it('403 names the missing resource and the security level, not the credentials', async () => {
    buildClientMock.mockResolvedValue(
      clientOver((args) => {
        if (isTokenCall(args)) return { data: { access_token: 'tok', expires_in: 3600 } };
        if (String(args.url).endsWith('/v2/account')) return { data: { name: 'Acme MSP' } };
        throw axiosError(403);
      })
    );

    const res = await runTest();

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/security level/i);
    expect(res.error).toContain('/v2/account/sites');
    expect(res.error).not.toMatch(/API key and secret/i);
    expect(calls.find((c) => c.table === 'rmm_integrations' && c.op === 'update')).toBeUndefined();
  });

  it('a network failure is reported as unreachable, with no URL or credentials', async () => {
    buildClientMock.mockResolvedValue(
      clientOver(() => {
        throw axiosError(undefined);
      })
    );

    const res = await runTest();

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/unable to reach datto rmm/i);
    expect(res.error).not.toContain('centrastage');
    expect(res.error).not.toContain('key-123');
    expect(res.error).not.toContain('secret-456');
  });
});
