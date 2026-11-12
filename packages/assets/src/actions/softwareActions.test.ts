import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const TENANT = 'a0000000-0000-4000-8000-00000000000a';
  const calls: Array<{ table?: string; method: string; args: unknown[] }> = [];
  const state = {
    permitted: true,
    clientExists: true,
    assetExists: true,
    assetClientId: 'x',
    readableClients: ['x'],
    assets: [{ asset_id: 'a1', client_id: 'x' }, { asset_id: 'a2', client_id: 'y' }],
    countRow: { count: '1' } as { count: string },
    rows: [] as any[],
    catalogUpdates: [] as any[],
  };

  // Chainable recorder: every method records itself and returns the builder;
  // awaiting it resolves to the queued result for that query kind.
  function makeBuilder(table: string) {
    const record: { kind: 'client' | 'count' | 'rows' } = { kind: 'rows' };
    const builder: any = new Proxy(function () {}, {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(table === 'assets' ? state.assets : state.rows);
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: prop, args });
          if (prop === 'first') {
            if (table === 'assets') return Promise.resolve(state.assetExists ? { asset_id: 'asset-1', client_id: state.assetClientId } : undefined);
            if (table === 'clients') return Promise.resolve(state.clientExists ? { client_id: 'x' } : undefined);
            return Promise.resolve(state.countRow);
          }
          if (prop === 'update') {
            state.catalogUpdates.push({ table, data: args[0] });
            return Promise.resolve(1);
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

  return { TENANT, calls, state, knexMock, makeBuilder, user: { user_id: 'u1', user_type: 'internal' } };
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
    tenantJoinSubquery: (q: any, subquery: any, l: string, r: string, options: any) => {
      h.calls.push({ table: 'subquery', method: 'tenantJoinSubquery', args: [l, r, options] });
      return q;
    },
  }),
}));

vi.mock('../lib/assetReadAuthorization', () => ({
  createAssetReadContext: vi.fn(async () => ({})),
  isAssetReadAllowed: vi.fn(async (_knex: any, _tenant: string, _ctx: any, asset: any) => h.state.readableClients.includes(asset.client_id)),
  filterReadableAssets: vi.fn(async (_knex: any, _tenant: string, _ctx: any, assets: any[]) =>
    assets.filter((asset) => h.state.readableClients.includes(asset.client_id))
  ),
}));

import { hasPermission } from '@alga-psa/auth';
import {
  getAssetSoftware,
  getAssetSoftwareSummary,
  getRecentSoftwareChanges,
  getClientSoftwareSummary,
  searchSoftwareFleetWide,
  updateSoftwareCatalogEntry,
} from './softwareActions';

const CLIENT = 'c1000000-0000-4000-8000-0000000000c1';

const callsOf = (method: string) => h.calls.filter((c) => c.method === method);

describe('getClientSoftwareSummary', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.state.permitted = true;
    h.state.clientExists = true;
    h.state.assetExists = true;
    h.state.assetClientId = 'x';
    h.state.readableClients = ['x'];
    h.state.assets = [{ asset_id: 'a1', client_id: 'x' }, { asset_id: 'a2', client_id: 'y' }];
    h.state.countRow = { count: '1' };
    h.state.rows = [];
    h.state.catalogUpdates = [];
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
    h.state.assetExists = true;
    h.state.assetClientId = 'x';
    h.state.clientExists = true;
    h.state.readableClients = ['x'];
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

    expect(callsOf('tenantDb.table').map((c) => [c.table, c.args[0]])).toEqual([
      ['assets', h.TENANT], ['clients', h.TENANT], ['v_asset_software_details', h.TENANT],
    ]);
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

  it('returns the same empty list for an excluded asset and an asset missing in this tenant', async () => {
    h.state.assetClientId = 'excluded-client';
    const excluded = await getAssetSoftware({ asset_id: ASSET });
    h.state.assetExists = false;
    const missing = await getAssetSoftware({ asset_id: ASSET });
    expect(excluded).toEqual({ software: [], total: 0, page: 1, limit: 50 });
    expect(missing).toEqual(excluded);
  });

  it('applies the same asset authorization before summary and recent-change queries', async () => {
    h.state.readableClients = [];
    const summaryDenied = await getAssetSoftwareSummary(ASSET);
    const recentDenied = await getRecentSoftwareChanges(ASSET);
    h.state.assetExists = false;
    const summaryMissing = await getAssetSoftwareSummary(ASSET);
    const recentMissing = await getRecentSoftwareChanges(ASSET);
    expect(summaryDenied).toEqual(summaryMissing);
    expect(recentDenied).toEqual(recentMissing);
    expect(summaryDenied).toMatchObject({ total_installed: 0 });
    expect(recentDenied).toEqual({ installed: [], uninstalled: [] });
    expect(callsOf('tenantDb.table').some((c) => String(c.table).startsWith('v_asset_software_details'))).toBe(false);
  });

  it('requires the coarse asset:read permission for all three per-asset actions', async () => {
    h.state.permitted = false;
    const results = await Promise.all([
      getAssetSoftware({ asset_id: ASSET }),
      getAssetSoftwareSummary(ASSET),
      getRecentSoftwareChanges(ASSET),
    ]);
    expect(results.every((result: any) => result.permissionError?.includes('Permission denied'))).toBe(true);
    expect(vi.mocked(hasPermission).mock.calls).toEqual([
      [h.user, 'asset', 'read'], [h.user, 'asset', 'read'], [h.user, 'asset', 'read'],
    ]);
    expect(callsOf('tenantDb.table')).toHaveLength(0);
  });

  it('keeps authorized summary and recent-change reads successful', async () => {
    h.state.countRow = { count: '1' };
    const summary = await getAssetSoftwareSummary(ASSET);
    const recent = await getRecentSoftwareChanges(ASSET);
    expect(summary).toMatchObject({ total_installed: 1 });
    expect(recent).toEqual({ installed: [], uninstalled: [] });
  });
});

describe('fleet search and software catalog mutation authorization', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.state.permitted = true;
    h.state.assetExists = true;
    h.state.clientExists = true;
    h.state.readableClients = ['x'];
    h.state.assets = [{ asset_id: 'a1', client_id: 'x' }, { asset_id: 'a2', client_id: 'y' }];
    h.state.countRow = { count: '1' };
    h.state.rows = [];
    h.state.catalogUpdates = [];
    vi.mocked(hasPermission).mockClear();
  });

  it('requires asset:read before fleet data access', async () => {
    h.state.permitted = false;
    const result: any = await searchSoftwareFleetWide({ page: 1 });
    expect(hasPermission).toHaveBeenCalledWith(h.user, 'asset', 'read');
    expect(result.permissionError).toContain('Permission denied');
    expect(callsOf('tenantDb.table')).toHaveLength(0);
  });

  it('constrains all fleet aggregates and previews to the authorized asset IDs and tenant', async () => {
    h.state.rows = [{
      software_id: 'sw1', name: 'App', publisher: 'Vendor', category: 'Productivity',
      software_type: 'application', is_managed: false, is_security_relevant: false, install_count: '1',
    }];
    const result: any = await searchSoftwareFleetWide({ client_id: 'x' });
    expect(result.results).toHaveLength(1);
    expect(result.total).toBe(1);
    const scopedAssetSubqueries = callsOf('whereIn').filter((call) =>
      call.args[0] === 'scoped_asw.asset_id' || call.args[0] === 'scoped_a.asset_id'
    );
    expect(scopedAssetSubqueries).toHaveLength(2);
    expect(scopedAssetSubqueries.every((call) => (call.args[1] as any[]).includes('a1') && !(call.args[1] as any[]).includes('a2'))).toBe(true);
    const previewScope = callsOf('whereIn').find((call) => call.args[0] === 'asset_id');
    expect(previewScope?.args[1]).toEqual(['a1']);
    expect(callsOf('tenantJoinSubquery')).toEqual(expect.arrayContaining([
      expect.objectContaining({ args: ['asw.software_id', 'sc.software_id', expect.objectContaining({ type: 'inner' })] }),
      expect.objectContaining({ args: ['a.asset_id', 'asw.asset_id', expect.objectContaining({ type: 'inner' })] }),
    ]));
    expect(callsOf('tenantDb.table').every((call) => call.args[0] === h.TENANT)).toBe(true);
    expect(callsOf('where')).toContainEqual(expect.objectContaining({ args: ['a.client_id', 'x'] }));
    const clientFilterIndex = h.calls.findIndex((call) => call.method === 'where' && call.args[0] === 'a.client_id');
    const totalCountIndex = h.calls.findIndex((call) => call.method === 'countDistinct');
    expect(clientFilterIndex).toBeGreaterThan(-1);
    expect(totalCountIndex).toBeGreaterThan(clientFilterIndex);
  });

  it('requires asset:update and does not mutate catalog classifications when denied', async () => {
    h.state.permitted = false;
    const denied: any = await updateSoftwareCatalogEntry('sw1', { is_security_relevant: true });
    expect(hasPermission).toHaveBeenCalledWith(h.user, 'asset', 'update');
    expect(denied.permissionError).toContain('Permission denied');
    expect(h.state.catalogUpdates).toEqual([]);
  });

  it('updates a catalog entry for an authorized asset manager', async () => {
    await updateSoftwareCatalogEntry('sw1', { category: 'Browser', is_managed: true });
    expect(h.state.catalogUpdates).toEqual([{
      table: 'software_catalog',
      data: { category: 'Browser', is_managed: true },
    }]);
  });
});
