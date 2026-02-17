import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let secretProvider: { getTenantSecret: (tenant: string, key: string) => Promise<string | null> };
let knexMock: any;

let requestCalls: Array<{ method: string; path: string; params: any }> = [];

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
      if (!colsArr) return this.filtered();
      return this.filtered().map((r) => {
        const out: any = {};
        for (const c of colsArr) out[c] = r[c];
        return out;
      });
    }

    async first(cols?: string[] | string) {
      const colsArr = typeof cols === 'string' ? [cols] : cols;
      const row = this.filtered()[0];
      if (!row) return undefined;
      if (!colsArr) return row;
      const out: any = {};
      for (const c of colsArr) out[c] = row[c];
      return out;
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

      return {
        onConflict: (_cols: string[]) => ({
          merge: async (mergePatch: any) => {
            if (this.table !== 'workstation_assets' && this.table !== 'server_assets') return;
            const match = rows.find((r) => r.tenant === toInsert.tenant && String(r.asset_id) === String(toInsert.asset_id));
            if (!match) return;
            Object.assign(match, mergePatch);
          },
        }),
        returning: async (_cols?: string[]) => [toInsert],
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
    async request(args: any) {
      requestCalls.push({ method: String(args.method), path: String(args.path), params: args.params || {} });

      const path = String(args.path);
      const page = Number(args?.params?.page || 1);

      if (path === '/api/beta/v1/site/') {
        if (page === 1) return { results: [{ id: 's1', name: 'HQ' }], next: 'page2' };
        if (page === 2) return { results: [{ id: 's2', name: 'Branch' }], next: null };
        throw new Error(`Unexpected site page: ${page}`);
      }

      if (path === '/api/beta/v1/agent/') {
        const clientId = String(args?.params?.client_id ?? '');
        if (clientId !== '100') throw new Error(`Unexpected client_id: ${clientId}`);

        if (page === 1) {
          return { results: [
            { agent_id: 'a1', hostname: 'A1', site_id: 's1', last_seen: '2026-02-13T11:59:00.000Z', offline_time: 5, overdue_time: 60 },
            { agent_id: 'a2', hostname: 'A2', site_id: 's1', last_seen: '2026-02-13T11:59:00.000Z', offline_time: 5, overdue_time: 60 },
          ], next: 'page2' };
        }
        if (page === 2) {
          return { results: [
            { agent_id: 'a3', hostname: 'A3', site_id: 's2', last_seen: '2026-02-13T11:59:00.000Z', offline_time: 5, overdue_time: 60 },
            { agent_id: 'a4', hostname: 'A4', site_id: 's2', last_seen: '2026-02-13T11:59:00.000Z', offline_time: 5, overdue_time: 60 },
          ], next: 'page3' };
        }
        if (page === 3) {
          return { results: [
            { agent_id: 'a5', hostname: 'A5', site_id: 's2', last_seen: '2026-02-13T11:59:00.000Z', offline_time: 5, overdue_time: 60 },
          ], next: null };
        }
        throw new Error(`Unexpected agent page: ${page}`);
      }

      throw new Error(`Unexpected Tactical request: ${args.method} ${args.path}`);
    }

    async listAllBeta(args: any) {
      // Use the real paging logic; it should call our request() multiple times.
      return (actual.TacticalRmmClient.prototype.listAllBeta as any).call(this, args);
    }

    async checkCreds() {
      return { totp: false };
    }
    async login() {
      return { token: 'token' };
    }
  }

  return { ...actual, TacticalRmmClient: TacticalRmmClientMock };
});

describe('Tactical device sync paging (smoke)', () => {
  let state: DbState;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-13T12:00:00.000Z'));

    requestCalls = [];
    nextAssetId = 0;
    nextMappingId = 0;

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
        return null;
      }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pages beta endpoints and processes all agents across pages', async () => {
    const { syncTacticalRmmDevices } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    const res = await syncTacticalRmmDevices({ user_id: 'u1' } as any, { tenant: 'tenant_1' });
    expect(res.success).toBe(true);
    expect(res.items_processed).toBe(5);
    expect(res.items_created).toBe(5);

    // Ensure we made multiple page requests for both sites and agents, with page_size capped to 1000.
    const siteCalls = requestCalls.filter((c) => c.path === '/api/beta/v1/site/');
    const agentCalls = requestCalls.filter((c) => c.path === '/api/beta/v1/agent/');
    expect(siteCalls.map((c) => c.params.page)).toEqual([1, 2]);
    expect(agentCalls.map((c) => c.params.page)).toEqual([1, 2, 3]);
    expect(requestCalls.every((c) => Number(c.params.page_size) === 1000)).toBe(true);

    // Smoke: mappings were created for every agent returned across pages.
    expect(state.tenant_external_entity_mappings).toHaveLength(5);
  });
});

