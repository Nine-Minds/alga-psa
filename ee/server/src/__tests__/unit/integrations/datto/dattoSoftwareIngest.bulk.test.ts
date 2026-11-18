import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
let tables: Record<string, Row[]> = {};
let softwareByDevice: Record<string, any[] | Error> = {};
let inFlight = 0;
let maxInFlight = 0;
const listCalls: string[] = [];
const syncCalls: Array<{ assetId: string; list: any[] }> = [];
let clientAvailable = true;

vi.mock('@alga-psa/db', () => {
  class QB {
    private filters: Array<(r: Row) => boolean> = [];
    constructor(private readonly table: string) {}
    where(w: Row) {
      this.filters.push((r) => Object.entries(w).every(([k, v]) => r[k] === v));
      return this;
    }
    whereIn(col: string, values: any[]) {
      this.filters.push((r) => values.includes(r[col]));
      return this;
    }
    private rows() {
      return (tables[this.table] || []).filter((r) => this.filters.every((f) => f(r)));
    }
    then(resolve: any, reject: any) {
      return Promise.resolve(this.rows()).then(resolve, reject);
    }
    async select(cols: string[]) {
      return this.rows().map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
    }
    async update(patch: Row) {
      const rows = this.rows();
      for (const r of rows) {
        if (patch.metadata?.__merge) r.metadata = { ...(r.metadata || {}), ...patch.metadata.__merge };
        else Object.assign(r, patch);
      }
      return rows.length;
    }
  }
  const knex: any = {};
  knex.raw = (_sql: string, bindings: string[]) => ({ __merge: JSON.parse(bindings[0]) });
  return {
    createTenantKnex: vi.fn(async () => ({ knex })),
    tenantDb: (_conn: any, _tenant: string) => ({ table: (t: string) => new QB(t) }),
  };
});

vi.mock('@ee/lib/integrations/datto/softwareInventory', () => ({
  syncAssetSoftwareList: vi.fn(async (_knex: any, _tenant: string, assetId: string, list: any[]) => {
    syncCalls.push({ assetId, list });
    return { installed: list.length, uninstalled: 0, catalogCreated: list.length };
  }),
}));

vi.mock('@ee/lib/integrations/datto/buildClient', () => ({
  buildDattoClientForTenant: vi.fn(async () =>
    clientAvailable
      ? {
          listDeviceSoftware: async (uid: string) => {
            listCalls.push(uid);
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            inFlight -= 1;
            const result = softwareByDevice[uid] ?? [];
            if (result instanceof Error) throw result;
            return result;
          },
        }
      : null
  ),
}));

function mapping(n: number, metadata: Row = {}): Row {
  return {
    id: `m${n}`,
    tenant: 'tenant_1',
    integration_type: 'datto',
    alga_entity_type: 'asset',
    external_entity_id: `dev-${n}`,
    alga_entity_id: `asset-${n}`,
    metadata: { lastAuditDate: 1000 + n, ...metadata },
  };
}

function httpError(status: number) {
  return new AxiosError(`HTTP ${status}`, String(status), undefined, undefined, {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: {} as any,
  });
}

describe('Datto software inventory ingest (bulk)', () => {
  beforeEach(() => {
    inFlight = 0;
    maxInFlight = 0;
    listCalls.length = 0;
    syncCalls.length = 0;
    clientAvailable = true;
    tables = {
      tenant_external_entity_mappings: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => mapping(n)),
      assets: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ asset_id: `asset-${n}` })),
    };
    softwareByDevice = Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`dev-${n}`, [{ name: `App ${n}`, version: '1.0' }, { name: '  ', version: '2' }]])
    );
  });

  it('upserts each mapped device\'s software through the shared helper and stamps the audit date', async () => {
    const { runDattoRmmSoftwareIngest } = await import('@ee/lib/integrations/datto/softwareIngest');
    const res = await runDattoRmmSoftwareIngest({ tenant: 'tenant_1' });

    expect(res).toMatchObject({ success: true, items_processed: 8, items_created: 8, items_updated: 8, items_failed: 0 });
    expect(syncCalls).toHaveLength(8);
    expect(syncCalls.find((c) => c.assetId === 'asset-1')?.list).toEqual([{ name: 'App 1', version: '1.0' }]);
    for (const m of tables.tenant_external_entity_mappings) {
      expect(m.metadata.softwareIngestedAuditDate).toBe(String(m.metadata.lastAuditDate));
    }
  });

  it('never runs more than 4 audit requests at once', async () => {
    const { runDattoRmmSoftwareIngest } = await import('@ee/lib/integrations/datto/softwareIngest');
    await runDattoRmmSoftwareIngest({ tenant: 'tenant_1' });
    expect(listCalls).toHaveLength(8);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it('skips devices whose audit date was already ingested, unless forced', async () => {
    tables.tenant_external_entity_mappings[0].metadata.softwareIngestedAuditDate = '1001';
    tables.tenant_external_entity_mappings[1].metadata.softwareIngestedAuditDate = '5';
    const { runDattoRmmSoftwareIngest } = await import('@ee/lib/integrations/datto/softwareIngest');

    const res = await runDattoRmmSoftwareIngest({ tenant: 'tenant_1' });
    expect(res.success).toBe(true);
    expect(listCalls).not.toContain('dev-1');
    expect(listCalls).toContain('dev-2');
    expect(listCalls).toHaveLength(7);

    listCalls.length = 0;
    await runDattoRmmSoftwareIngest({ tenant: 'tenant_1', force: true });
    expect(listCalls).toHaveLength(8);
  });

  it('restricts to deviceUids and counts per-device failures without aborting; 404 is skipped', async () => {
    softwareByDevice['dev-2'] = httpError(500);
    softwareByDevice['dev-3'] = httpError(404);
    const { runDattoRmmSoftwareIngest } = await import('@ee/lib/integrations/datto/softwareIngest');

    const res = await runDattoRmmSoftwareIngest({ tenant: 'tenant_1', deviceUids: ['dev-1', 'dev-2', 'dev-3'] });
    expect(listCalls.sort()).toEqual(['dev-1', 'dev-2', 'dev-3']);
    expect(res.success).toBe(true);
    expect(res.items_updated).toBe(1);
    expect(res.items_failed).toBe(1);
    expect(res.errors?.[0]).toContain('dev-2');
    expect(tables.tenant_external_entity_mappings[1].metadata.softwareIngestedAuditDate).toBeUndefined();
    expect(tables.tenant_external_entity_mappings[2].metadata.softwareIngestedAuditDate).toBeUndefined();
  });

  it('ignores mappings whose asset was deleted and reports a missing integration', async () => {
    tables.assets = tables.assets.filter((a) => a.asset_id !== 'asset-1');
    const { runDattoRmmSoftwareIngest } = await import('@ee/lib/integrations/datto/softwareIngest');
    await runDattoRmmSoftwareIngest({ tenant: 'tenant_1' });
    expect(listCalls).not.toContain('dev-1');

    clientAvailable = false;
    const res = await runDattoRmmSoftwareIngest({ tenant: 'tenant_1' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('not configured');
  });

  it('stops issuing calls after a permission failure and reports it once', async () => {
    const { DattoRmmPermissionError } = await import('@ee/lib/integrations/datto/dattoApiClient');
    for (let n = 1; n <= 8; n += 1) {
      softwareByDevice[`dev-${n}`] = new DattoRmmPermissionError('denied', { status: 403, path: '/x' });
    }
    const { runDattoRmmSoftwareIngest } = await import('@ee/lib/integrations/datto/softwareIngest');

    const res = await runDattoRmmSoftwareIngest({ tenant: 'tenant_1' });

    // Only the first wave (concurrency 4) was in flight when the first one failed.
    expect(listCalls.length).toBeLessThanOrEqual(4);
    expect(res.success).toBe(false);
    expect(res.error).toContain('lacks permission');
    expect(res.error).toContain('not checked');
    expect(res.items_failed).toBe(8);
  });

  it('stops on an auth failure too', async () => {
    const { DattoRmmAuthError } = await import('@ee/lib/integrations/datto/dattoApiClient');
    for (let n = 1; n <= 8; n += 1) {
      softwareByDevice[`dev-${n}`] = new DattoRmmAuthError('Datto RMM rejected the API key and secret.', { status: 401, path: '/x' });
    }
    const { runDattoRmmSoftwareIngest } = await import('@ee/lib/integrations/datto/softwareIngest');

    const res = await runDattoRmmSoftwareIngest({ tenant: 'tenant_1' });

    expect(listCalls.length).toBeLessThanOrEqual(4);
    expect(res.success).toBe(false);
    expect(res.error).toContain('rejected the API key');
  });

  it('never calls the API for device classes without a software audit', async () => {
    tables.tenant_external_entity_mappings[0].metadata.deviceClass = 'printer';
    tables.tenant_external_entity_mappings[1].metadata.deviceClass = 'esxihost';
    tables.tenant_external_entity_mappings[2].metadata.deviceClass = 'udf';
    tables.tenant_external_entity_mappings[3].metadata.deviceClass = 'device';
    const { runDattoRmmSoftwareIngest } = await import('@ee/lib/integrations/datto/softwareIngest');

    await runDattoRmmSoftwareIngest({ tenant: 'tenant_1', force: true });

    expect(listCalls.sort()).toEqual(['dev-4', 'dev-5', 'dev-6', 'dev-7', 'dev-8']);
  });

  it('skips never-audited devices in bulk runs but fetches them when asked by uid or forced', async () => {
    delete tables.tenant_external_entity_mappings[0].metadata.lastAuditDate;
    const { runDattoRmmSoftwareIngest } = await import('@ee/lib/integrations/datto/softwareIngest');

    await runDattoRmmSoftwareIngest({ tenant: 'tenant_1' });
    expect(listCalls).not.toContain('dev-1');

    listCalls.length = 0;
    await runDattoRmmSoftwareIngest({ tenant: 'tenant_1', deviceUids: ['dev-1'] });
    expect(listCalls).toEqual(['dev-1']);

    listCalls.length = 0;
    await runDattoRmmSoftwareIngest({ tenant: 'tenant_1', force: true });
    expect(listCalls).toContain('dev-1');
  });
});
