import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const TENANT = 'a0000000-0000-4000-8000-00000000000a';
  const calls: Array<{ table?: string; method: string; args: unknown[] }> = [];
  const state = {
    permitted: true,
    clientExists: true,
    countRow: { count: '1' } as { count: string },
    rows: [] as any[],
  };

  // Chainable recorder: every method records itself and returns the builder;
  // awaiting it resolves to the queued result for that query kind.
  function makeBuilder(table: string) {
    const record: { kind: 'client' | 'count' | 'rows' } = { kind: 'rows' };
    const builder: any = new Proxy(function () {}, {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(state.rows);
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: prop, args });
          if (prop === 'first') {
            if (table === 'clients') return Promise.resolve(state.clientExists ? { client_id: 'x' } : undefined);
            return Promise.resolve(state.countRow);
          }
          return builder;
        };
      },
    });
    return builder;
  }

  const knexMock: any = Object.assign((t: string) => makeBuilder(t), {
    raw: (sql: string) => ({ __raw: sql }),
  });

  return { TENANT, calls, state, knexMock, makeBuilder, user: { user_id: 'u1' } };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(h.user, { tenant: h.TENANT }, ...args),
  hasPermission: vi.fn(async () => h.state.permitted),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.knexMock, tenant: h.TENANT })),
  tenantDb: (_conn: any, tenant: string) => ({
    table: (t: string) => {
      h.calls.push({ table: t, method: 'tenantDb.table', args: [tenant] });
      return h.makeBuilder(t.split(' as ')[0]);
    },
    tenantJoin: (q: any, t: string, l: string, r: string) => {
      h.calls.push({ table: t, method: 'tenantJoin', args: [l, r] });
      return q;
    },
  }),
}));

import { hasPermission } from '@alga-psa/auth';
import { getAssetSoftware, getClientSoftwareSummary } from './softwareActions';

const CLIENT = 'c1000000-0000-4000-8000-0000000000c1';

const callsOf = (method: string) => h.calls.filter((c) => c.method === method);

describe('getClientSoftwareSummary', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.state.permitted = true;
    h.state.clientExists = true;
    h.state.countRow = { count: '1' };
    h.state.rows = [];
    vi.mocked(hasPermission).mockClear();
  });

  it('requires asset:read and returns a permission error when denied', async () => {
    h.state.permitted = false;
    const result: any = await getClientSoftwareSummary({ clientId: CLIENT });
    expect(hasPermission).toHaveBeenCalledWith(h.user, 'asset', 'read');
    expect(result.permissionError).toContain('Permission denied');
    expect(callsOf('tenantDb.table').some((c) => String(c.table).startsWith('asset_software'))).toBe(false);
  });

  it('returns the mapped "Client not found" error for a client outside the tenant', async () => {
    h.state.clientExists = false;
    const result: any = await getClientSoftwareSummary({ clientId: CLIENT });
    expect(result.actionError ?? result.message ?? JSON.stringify(result)).toMatch(/Client not found/);
    expect(callsOf('tenantDb.table').some((c) => String(c.table).startsWith('asset_software'))).toBe(false);
  });

  it('scopes every root and join through tenantDb and filters to the client and current installs', async () => {
    await getClientSoftwareSummary({ clientId: CLIENT });

    const roots = callsOf('tenantDb.table');
    expect(roots.map((c) => c.table)).toEqual(
      expect.arrayContaining(['clients', 'asset_software as asw'])
    );
    expect(roots.every((c) => c.args[0] === h.TENANT)).toBe(true);
    expect(callsOf('tenantJoin').map((c) => c.table)).toEqual(
      expect.arrayContaining(['assets as a', 'software_catalog as sc'])
    );
    const wheres = callsOf('where').map((c) => c.args);
    expect(wheres).toContainEqual(['a.client_id', CLIENT]);
    expect(wheres).toContainEqual(['asw.is_current', true]);
  });

  it('groups by catalog software_id, not by the raw title', async () => {
    await getClientSoftwareSummary({ clientId: CLIENT });
    const groupBy = callsOf('groupBy').map((c) => c.args);
    expect(groupBy).toContainEqual(['sc.software_id', 'sc.name']);
  });

  it('maps a grouped row (two assets, one software_id) to a single row with asset_count 2', async () => {
    h.state.countRow = { count: '1' };
    h.state.rows = [{
      software_id: 's1',
      title: 'Google Chrome',
      versions: ['125.0', '124.0'],
      asset_count: '2',
      assets: [{ asset_id: 'a1', name: 'PC-1' }, { asset_id: 'a2', name: 'PC-2' }],
      last_seen: '2026-01-02T03:04:05.000Z',
    }];
    const result: any = await getClientSoftwareSummary({ clientId: CLIENT });
    expect(result.total).toBe(1);
    expect(result.rows).toEqual([{
      software_id: 's1',
      title: 'Google Chrome',
      versions: ['124.0', '125.0'],
      asset_count: 2,
      assets: [{ asset_id: 'a1', name: 'PC-1' }, { asset_id: 'a2', name: 'PC-2' }],
      last_seen: '2026-01-02T03:04:05.000Z',
    }]);
  });

  it('applies an escaped ILIKE search on the catalog title', async () => {
    await getClientSoftwareSummary({ clientId: CLIENT, search: '  50%_off ' });
    const ilike = callsOf('whereILike').map((c) => c.args);
    expect(ilike.length).toBeGreaterThan(0);
    expect(ilike[0]).toEqual(['sc.name', '%50\\%\\_off%']);
  });

  it('paginates at 50 and omits limit/offset for page "all" (export)', async () => {
    await getClientSoftwareSummary({ clientId: CLIENT, page: 3 });
    expect(callsOf('limit').map((c) => c.args)).toEqual([[50]]);
    expect(callsOf('offset').map((c) => c.args)).toEqual([[100]]);

    h.calls.length = 0;
    await getClientSoftwareSummary({ clientId: CLIENT, page: 'all' });
    expect(callsOf('limit')).toHaveLength(0);
    expect(callsOf('offset')).toHaveLength(0);
  });
});

describe('getAssetSoftware', () => {
  const ASSET = 'a1000000-0000-4000-8000-0000000000a1';

  beforeEach(() => {
    h.calls.length = 0;
    h.state.permitted = true;
    h.state.countRow = { count: '0' };
    h.state.rows = [];
    vi.mocked(hasPermission).mockClear();
  });

  it('requires asset:read and returns a permission error before touching the inventory', async () => {
    h.state.permitted = false;
    const result: any = await getAssetSoftware({ asset_id: ASSET });
    expect(hasPermission).toHaveBeenCalledWith(h.user, 'asset', 'read');
    expect(result.permissionError).toContain('Permission denied');
    expect(callsOf('tenantDb.table')).toHaveLength(0);
  });

  it('reads current installs for the asset from the normalized view, tenant-scoped', async () => {
    h.state.countRow = { count: '1' };
    h.state.rows = [{
      software_id: 's1', name: 'Google Chrome', publisher: 'Google', category: 'Browser',
      software_type: 'application', version: '125', install_date: null, size_bytes: null,
      first_seen_at: '2026-01-01T00:00:00.000Z', is_current: true, is_managed: false, is_security_relevant: false,
    }];
    const result: any = await getAssetSoftware({ asset_id: ASSET, limit: 50 });

    expect(callsOf('tenantDb.table').map((c) => [c.table, c.args[0]])).toEqual([['v_asset_software_details', h.TENANT]]);
    const wheres = callsOf('where').map((c) => c.args);
    expect(wheres).toContainEqual(['asset_id', ASSET]);
    expect(wheres).toContainEqual(['is_current', true]);
    expect(result.total).toBe(1);
    expect(result.software).toEqual([expect.objectContaining({ software_id: 's1', name: 'Google Chrome', version: '125' })]);
  });

  it('matches the search term literally on name or publisher (escaped ILIKE)', async () => {
    await getAssetSoftware({ asset_id: ASSET, search: '  50%_off ' });
    const grouped = callsOf('where').find((c) => typeof c.args[0] === 'function');
    expect(grouped).toBeDefined();
    const before = h.calls.length;
    (grouped!.args[0] as (this: unknown) => void).call(h.makeBuilder('inner'));
    const ilike = h.calls.slice(before).map((c) => [c.method, ...c.args]);
    expect(ilike).toEqual([
      ['whereILike', 'software_name', '%50\\%\\_off%'],
      ['orWhereILike', 'publisher', '%50\\%\\_off%'],
    ]);
  });

  it('skips the search clause for a blank term', async () => {
    await getAssetSoftware({ asset_id: ASSET, search: '   ' });
    expect(callsOf('where').some((c) => typeof c.args[0] === 'function')).toBe(false);
  });
});
