import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let secretProvider: { getTenantSecret: (tenant: string, key: string) => Promise<string | null> };
let knexMock: any;
let tacticalAgentById: Record<string, any> = {};

type DbState = {
  rmm_integrations: Array<any>;
  assets: Array<any>;
  workstation_assets: Array<any>;
  server_assets: Array<any>;
  tenant_external_entity_mappings: Array<any>;
};

function createFakeKnex(state: DbState) {
  const now = new Date('2026-02-13T12:00:00.000Z');

  function rows(table: keyof DbState) {
    return state[table];
  }

  class QB {
    private _where: Record<string, any>[] = [];
    private _rawTextEq: { col: string; val: string } | null = null;

    constructor(private readonly table: keyof DbState) {}

    where(where: Record<string, any>) {
      this._where.push(where);
      return this;
    }

    whereRaw(sql: string, bindings: any[]) {
      const m = sql.match(/assets\.asset_id::text\s*=\s*\?/i);
      if (m) {
        this._rawTextEq = { col: 'asset_id', val: String(bindings?.[0] ?? '') };
        return this;
      }
      throw new Error(`Unsupported whereRaw: ${sql}`);
    }

    private filtered(): any[] {
      let out = [...rows(this.table)];
      for (const w of this._where) {
        out = out.filter((r) => Object.entries(w).every(([k, v]) => r[k] === v));
      }
      if (this._rawTextEq) out = out.filter((r) => String(r[this._rawTextEq!.col]) === this._rawTextEq!.val);
      return out;
    }

    async first(cols?: string[]) {
      const row = this.filtered()[0];
      if (!row) return undefined;
      if (!cols) return row;
      const picked: any = {};
      for (const c of cols) picked[c] = row[c];
      return picked;
    }

    insert(row: any) {
      const target = rows(this.table);
      const toInsert = { ...row };
      if (toInsert.asset_id && typeof toInsert.asset_id === 'object' && 'bindings' in toInsert.asset_id) {
        toInsert.asset_id = String((toInsert.asset_id as any).bindings?.[0] ?? '');
      }
      target.push(toInsert);
      return {
        onConflict: (_cols: string[]) => ({
          merge: async (mergePatch: any) => {
            // Merge by (tenant, asset_id)
            const match = target.find((r) => r.tenant === toInsert.tenant && String(r.asset_id) === String(toInsert.asset_id));
            if (!match) return;
            Object.assign(match, mergePatch);
          },
        }),
      };
    }

    async update(patch: any) {
      const target = this.filtered();
      for (const r of target) Object.assign(r, patch);
      return target.length;
    }
  }

  const knex = ((table: string) => new QB(table as any)) as any;
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
  createAsset: vi.fn(),
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
    async request(args: { method: string; path: string }) {
      const m = String(args.path).match(/\/api\/beta\/v1\/agent\/([^/]+)\//);
      if (!m) throw new Error(`Unexpected request path: ${args.path}`);
      const agentId = decodeURIComponent(m[1]!);
      const agent = tacticalAgentById[agentId];
      if (!agent) throw new Error(`No mock agent for id ${agentId}`);
      return agent;
    }

    async listAllBeta(_args: any) {
      throw new Error('listAllBeta not implemented in this mock');
    }
  }

  return { ...actual, TacticalRmmClient: TacticalRmmClientMock };
});

describe('Tactical device sync (single agent)', () => {
  let state: DbState;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-13T12:00:00.000Z'));

    tacticalAgentById = {
      a1: {
        agent_id: 'a1',
        hostname: 'pc-1-updated',
        client_id: '200',
        site_id: 's2',
        site_name: 'Branch',
        operating_system: 'Windows 11',
        agent_version: '2.0.0',
        last_seen: new Date('2026-02-13T11:59:30.000Z').toISOString(),
        offline_time: 5,
        overdue_time: 30,
      },
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
      assets: [
        {
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
        },
      ],
      workstation_assets: [],
      server_assets: [],
      tenant_external_entity_mappings: [
        {
          tenant: 'tenant_1',
          id: 'mapping_existing',
          integration_type: 'tacticalrmm',
          alga_entity_type: 'asset',
          alga_entity_id: 'asset_existing',
          external_entity_id: 'a1',
          external_realm_id: '100',
          metadata: {},
        },
      ],
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

  it('updates the corresponding asset and mapping by agent_id', async () => {
    const { syncTacticalRmmSingleAgent } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    const res = await syncTacticalRmmSingleAgent(
      { user_id: 'u1' } as any,
      { tenant: 'tenant_1' },
      { agentId: 'a1' }
    );

    expect(res.success).toBe(true);
    expect(res.updated).toBe(true);
    expect(res.assetId).toBe('asset_existing');

    const asset = state.assets.find((a) => a.asset_id === 'asset_existing');
    expect(asset?.name).toBe('pc-1-updated');
    expect(asset?.rmm_organization_id).toBe('200');
    expect(asset?.agent_status).toBe('online');
    expect(asset?.last_rmm_sync_at).toBeInstanceOf(Date);

    const mapping = state.tenant_external_entity_mappings.find((m) => m.id === 'mapping_existing');
    expect(mapping?.external_realm_id).toBe('200');
    expect(mapping?.metadata?.site_id).toBe('s2');
    expect(mapping?.metadata?.site_name).toBe('Branch');
  });
});

