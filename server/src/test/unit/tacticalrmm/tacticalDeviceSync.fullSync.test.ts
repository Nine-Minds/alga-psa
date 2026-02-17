import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

let secretProvider: { getTenantSecret: (tenant: string, key: string) => Promise<string | null> };
let knexMock: any;

let tacticalSites: any[] = [];
let tacticalAgentsByClientId: Record<string, any[]> = {};

let nextAssetId = 0;
let nextMappingId = 0;

type DbState = {
  rmm_integrations: Array<any>;
  rmm_organization_mappings: Array<any>;
  assets: Array<any>;
  workstation_assets: Array<any>;
  server_assets: Array<any>;
  tenant_external_entity_mappings: Array<any>;
};

function createFakeKnex(state: DbState) {
  const now = new Date('2026-02-13T12:00:00.000Z');

  function tableRows(table: string): any[] {
    const key = table.replace(/\s+as\s+\w+$/i, '') as keyof DbState;
    const rows = (state as any)[key];
    if (!rows) throw new Error(`Unknown table: ${table}`);
    return rows;
  }

  function applySelect(row: any, cols?: string[]) {
    if (!cols || cols.length === 0) return row;
    const out: any = {};
    for (const c of cols) {
      // Support "c.client_name as company_name" patterns by returning undefined for non-existing keys.
      const m = c.match(/(.+)\s+as\s+(.+)/i);
      if (m) {
        out[m[2]!.trim()] = (row as any)[m[1]!.trim()];
      } else {
        out[c] = (row as any)[c];
      }
    }
    return out;
  }

  function matchesWhere(row: any, where: Record<string, any>) {
    return Object.entries(where).every(([k, v]) => row[k] === v);
  }

  class QB {
    private _where: Record<string, any>[] = [];
    private _notNull: string[] = [];
    private _andWhere: Array<{ col: string; val: any }> = [];
    private _rawTextEq: { col: string; val: string } | null = null;

    constructor(private readonly table: string) {}

    where(where: Record<string, any>) {
      this._where.push(where);
      return this;
    }

    whereNotNull(col: string) {
      this._notNull.push(col);
      return this;
    }

    andWhere(col: string, val: any) {
      this._andWhere.push({ col, val });
      return this;
    }

    whereRaw(sql: string, bindings: any[]) {
      // Only support: 'assets.asset_id::text = ?'
      const m = sql.match(/assets\.asset_id::text\s*=\s*\?/i);
      if (m) {
        this._rawTextEq = { col: 'asset_id', val: String(bindings?.[0] ?? '') };
        return this;
      }
      throw new Error(`Unsupported whereRaw: ${sql}`);
    }

    private filtered(): any[] {
      let rows = [...tableRows(this.table)];
      for (const w of this._where) rows = rows.filter((r) => matchesWhere(r, w));
      for (const nn of this._notNull) rows = rows.filter((r) => r[nn] !== null && typeof r[nn] !== 'undefined');
      for (const aw of this._andWhere) rows = rows.filter((r) => r[aw.col] === aw.val);
      if (this._rawTextEq) rows = rows.filter((r) => String(r[this._rawTextEq!.col]) === this._rawTextEq!.val);
      return rows;
    }

    async select(cols?: string[] | string) {
      const colsArr = typeof cols === 'string' ? [cols] : cols;
      return this.filtered().map((r) => applySelect(r, colsArr as any));
    }

    async first(cols?: string[] | string) {
      const colsArr = typeof cols === 'string' ? [cols] : cols;
      const row = this.filtered()[0];
      if (!row) return undefined;
      return applySelect(row, colsArr as any);
    }

    insert(row: any) {
      const rows = tableRows(this.table);
      const toInsert = { ...row };

      // Unwrap knex.raw('?::uuid', [id]) used by the sync engine for extension inserts.
      if (toInsert.asset_id && typeof toInsert.asset_id === 'object' && 'bindings' in toInsert.asset_id) {
        toInsert.asset_id = String((toInsert.asset_id as any).bindings?.[0] ?? '');
      }

      if (this.table === 'tenant_external_entity_mappings') {
        toInsert.id = toInsert.id ?? `mapping_${++nextMappingId}`;
      }

      rows.push(toInsert);

      // Support onConflict merge for workstation/server assets only.
      return {
        onConflict: (_cols: string[]) => ({
          merge: async (mergePatch: any) => {
            if (this.table !== 'workstation_assets' && this.table !== 'server_assets') return;
            const match = rows.find((r) => r.tenant === toInsert.tenant && String(r.asset_id) === String(toInsert.asset_id));
            if (!match) return;
            Object.assign(match, mergePatch);
          },
        }),
      };
    }

    async update(patch: any) {
      const rows = this.filtered();
      for (const r of rows) Object.assign(r, patch);
      return rows.length;
    }
  }

  const knex = ((table: string) => new QB(table)) as any;
  knex.fn = { now: () => now };
  knex.raw = (sql: string, bindings: any[]) => ({ __raw: sql, bindings });
  return knex;
}

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => secretProvider),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexMock })),
}));

vi.mock('@alga-psa/assets/actions/assetActions', () => ({
  createAsset: vi.fn(async (input: any) => {
    const asset_id = `asset_${++nextAssetId}`;
    // The sync engine updates the assets row after create; insert a minimal base row so updates can find it.
    (knexMock as any)('assets').insert({
      tenant: 'tenant_1',
      asset_id,
      asset_type: input.asset_type,
      name: input.name,
      client_id: input.client_id,
      status: input.status,
      serial_number: input.serial_number,
    });
    return { asset_id };
  }),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/integrations/lib/rmm/tacticalrmm/tacticalApiClient', async () => {
  const actual: any = await vi.importActual(
    '@alga-psa/integrations/lib/rmm/tacticalrmm/tacticalApiClient'
  );

  class TacticalRmmClientMock {
    async listAllBeta(args: { path: string; params?: any }) {
      if (args.path === '/api/beta/v1/site/') return tacticalSites;
      if (args.path === '/api/beta/v1/agent/') {
        const clientId = String(args.params?.client_id ?? '');
        return tacticalAgentsByClientId[clientId] ?? [];
      }
      throw new Error(`Unexpected listAllBeta path: ${args.path}`);
    }

    async request(_args: any) {
      throw new Error('request not implemented in this mock');
    }
  }

  return { ...actual, TacticalRmmClient: TacticalRmmClientMock };
});

describe('Tactical device sync (full sync)', () => {
  let state: DbState;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-13T12:00:00.000Z'));

    nextAssetId = 0;
    nextMappingId = 0;

    tacticalSites = [{ id: 's1', name: 'HQ' }];
    tacticalAgentsByClientId = {
      '100': [
        {
          agent_id: 'a1',
          hostname: 'pc-1',
          site_id: 's1',
          operating_system: 'Windows 10 Pro 22H2',
          agent_version: '1.2.3',
          last_seen: new Date('2026-02-13T11:59:00.000Z').toISOString(),
          offline_time: 5,
          overdue_time: 30,
        },
      ],
    };

    state = {
      rmm_integrations: [
        {
          tenant: 'tenant_1',
          provider: 'tacticalrmm',
          integration_id: 'integration_1',
          instance_url: 'https://tactical.example',
          settings: { auth_mode: 'api_key' },
        },
      ],
      rmm_organization_mappings: [
        {
          tenant: 'tenant_1',
          integration_id: 'integration_1',
          external_organization_id: '100',
          client_id: 'client_1',
          auto_sync_assets: true,
        },
      ],
      assets: [],
      workstation_assets: [],
      server_assets: [],
      tenant_external_entity_mappings: [],
    };

    knexMock = createFakeKnex(state);

    secretProvider = {
      getTenantSecret: vi.fn(async (_tenant: string, key: string) => {
        if (key === 'tacticalrmm_api_key') return 'api_key_1';
        if (key === 'tacticalrmm_instance_url') return 'https://tactical.example';
        return null;
      }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a new asset and external mapping for an unmapped agent_id', async () => {
    const { syncTacticalRmmDevices } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    const res = await syncTacticalRmmDevices({ user_id: 'u1' } as any, { tenant: 'tenant_1' });
    expect(res.success).toBe(true);
    expect(res.items_processed).toBe(1);
    expect(res.items_created).toBe(1);
    expect(res.items_updated).toBe(0);
    expect(res.items_failed).toBe(0);

    expect(state.tenant_external_entity_mappings).toHaveLength(1);
    expect(state.tenant_external_entity_mappings[0]).toEqual(
      expect.objectContaining({
        tenant: 'tenant_1',
        integration_type: 'tacticalrmm',
        alga_entity_type: 'asset',
        external_entity_id: 'a1',
        external_realm_id: '100',
        metadata: expect.objectContaining({
          site_id: 's1',
          site_name: 'HQ',
        }),
      })
    );
  });

  it('updates existing assets when agent fields change and refreshes last_seen/agent_status', async () => {
    // Seed an existing asset + mapping for agent a1.
    state.assets.push({
      tenant: 'tenant_1',
      asset_id: 'asset_existing',
      asset_type: 'workstation',
      name: 'old-name',
      rmm_provider: 'tacticalrmm',
      rmm_device_id: 'a1',
      rmm_organization_id: '100',
      agent_status: 'offline',
      last_seen_at: null,
      last_rmm_sync_at: null,
    });
    state.tenant_external_entity_mappings.push({
      tenant: 'tenant_1',
      id: 'mapping_existing',
      integration_type: 'tacticalrmm',
      alga_entity_type: 'asset',
      alga_entity_id: 'asset_existing',
      external_entity_id: 'a1',
      external_realm_id: '100',
      sync_status: 'synced',
      last_synced_at: null,
      metadata: {},
    });

    tacticalAgentsByClientId['100'] = [
      {
        agent_id: 'a1',
        hostname: 'pc-1-renamed',
        site_id: 's1',
        operating_system: 'Windows Server 2022',
        agent_version: '9.9.9',
        last_seen: new Date('2026-02-13T11:00:00.000Z').toISOString(),
        offline_time: 5,
        overdue_time: 30,
      },
    ];

    const { syncTacticalRmmDevices } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    const res = await syncTacticalRmmDevices({ user_id: 'u1' } as any, { tenant: 'tenant_1' });
    expect(res.success).toBe(true);
    expect(res.items_processed).toBe(1);
    expect(res.items_created).toBe(0);
    expect(res.items_updated).toBe(1);
    expect(res.items_failed).toBe(0);

    const asset = state.assets.find((a) => a.asset_id === 'asset_existing');
    expect(asset?.name).toBe('pc-1-renamed');
    expect(asset?.agent_status).toBe('overdue');
    expect(asset?.last_seen_at).toBeInstanceOf(Date);
    expect(asset?.last_rmm_sync_at).toBeInstanceOf(Date);
  });

  it('does not inactivate or delete assets when agents disappear (deletion policy = skip)', async () => {
    // Seed an existing asset + mapping for an agent that will not be returned by Tactical.
    state.assets.push({
      tenant: 'tenant_1',
      asset_id: 'asset_missing',
      asset_type: 'workstation',
      name: 'missing-agent-asset',
      status: 'active',
      rmm_provider: 'tacticalrmm',
      rmm_device_id: 'a_missing',
      rmm_organization_id: '100',
      agent_status: 'online',
    });
    state.tenant_external_entity_mappings.push({
      tenant: 'tenant_1',
      id: 'mapping_missing',
      integration_type: 'tacticalrmm',
      alga_entity_type: 'asset',
      alga_entity_id: 'asset_missing',
      external_entity_id: 'a_missing',
      external_realm_id: '100',
      sync_status: 'synced',
      metadata: {},
    });

    tacticalAgentsByClientId['100'] = []; // agent disappeared

    const { syncTacticalRmmDevices } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    const res = await syncTacticalRmmDevices({ user_id: 'u1' } as any, { tenant: 'tenant_1' });
    expect(res.success).toBe(true);
    expect(res.items_processed).toBe(0);
    expect(res.items_deleted).toBe(0);

    const stillThere = state.assets.find((a) => a.asset_id === 'asset_missing');
    expect(stillThere?.status).toBe('active');
  });
});
