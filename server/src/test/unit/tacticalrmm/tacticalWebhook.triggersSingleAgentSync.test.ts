import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let secretProvider: {
  getTenantSecret: (tenant: string, key: string) => Promise<string | null>;
  setTenantSecret?: (tenant: string, key: string, value: string) => Promise<void>;
};
let knexMock: any;
let tacticalAgentById: Record<string, any> = {};

type DbState = {
  rmm_integrations: Array<any>;
  tenant_external_entity_mappings: Array<any>;
  assets: Array<any>;
  workstation_assets: Array<any>;
  server_assets: Array<any>;
  rmm_alerts: Array<any>;
};

function createFakeKnex(state: DbState) {
  const now = new Date('2026-02-13T12:00:00.000Z');

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

    private filtered() {
      let rows = [...state[this.table]];
      for (const w of this._where) {
        rows = rows.filter((r) => Object.entries(w).every(([k, v]) => r[k] === v));
      }
      if (this._rawTextEq) rows = rows.filter((r) => String(r[this._rawTextEq!.col]) === this._rawTextEq!.val);
      return rows;
    }

    async first(cols?: string[]) {
      const row = this.filtered()[0];
      if (!row) return undefined;
      if (!cols) return row;
      const picked: any = {};
      for (const c of cols) picked[c] = row[c];
      return picked;
    }

    async update(patch: any) {
      const rows = this.filtered();
      for (const r of rows) Object.assign(r, patch);
      return rows.length;
    }

    insert(row: any) {
      const target = state[this.table];
      const toInsert = { ...row };
      if (toInsert.asset_id && typeof toInsert.asset_id === 'object' && 'bindings' in toInsert.asset_id) {
        toInsert.asset_id = String((toInsert.asset_id as any).bindings?.[0] ?? '');
      }
      target.push(toInsert);
      return {
        onConflict: (_cols: string[]) => ({
          merge: async (mergePatch: any) => {
            const match = target.find(
              (r) => r.tenant === toInsert.tenant && String(r.asset_id) === String(toInsert.asset_id)
            );
            if (!match) return;
            Object.assign(match, mergePatch);
          },
        }),
      };
    }
  }

  const knex = ((table: string) => new QB(table as any)) as any;
  knex.fn = { now: () => now };
  knex.raw = (sql: string, bindings: any[]) => ({ __raw: sql, bindings });
  return knex;
}

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => secretProvider),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexMock })),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
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
    async checkCreds() {
      return { totp: false };
    }
    async login() {
      return { token: 'token' };
    }
  }

  return { ...actual, TacticalRmmClient: TacticalRmmClientMock };
});

describe('Tactical webhook triggers single-agent sync', () => {
  let state: DbState;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-13T12:00:00.000Z'));

    tacticalAgentById = {
      a1: {
        agent_id: 'a1',
        hostname: 'pc-1-updated',
        client_id: '100',
        operating_system: 'Windows 11',
        agent_version: '2.0.0',
        last_seen: '2026-02-13T11:59:30.000Z',
        offline_time: 5,
        overdue_time: 30,
        logged_in_username: 'alice',
        uptime_seconds: 1234,
        lan_ip: '192.168.1.10',
        wan_ip: '203.0.113.10',
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
      tenant_external_entity_mappings: [
        {
          tenant: 'tenant_1',
          id: 'mapping_1',
          integration_type: 'tacticalrmm',
          alga_entity_type: 'asset',
          external_entity_id: 'a1',
          alga_entity_id: 'asset_1',
          external_realm_id: '100',
          metadata: {},
        },
      ],
      assets: [
        {
          tenant: 'tenant_1',
          asset_id: 'asset_1',
          asset_type: 'workstation',
          name: 'old-name',
          agent_status: 'offline',
          last_seen_at: null,
          last_rmm_sync_at: null,
        },
      ],
      workstation_assets: [],
      server_assets: [],
      rmm_alerts: [],
    };

    knexMock = createFakeKnex(state);

    secretProvider = {
      getTenantSecret: vi.fn(async (_tenant: string, key: string) => {
        if (key === 'tacticalrmm_webhook_secret') return 'expected_secret';
        if (key === 'tacticalrmm_api_key') return 'api_key_1';
        return null;
      }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls sync and updates asset vitals/status after alert event', async () => {
    const { POST } = await import('server/src/app/api/webhooks/tacticalrmm/route');

    const req = new Request('http://localhost/api/webhooks/tacticalrmm?tenant=tenant_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Alga-Webhook-Secret': 'expected_secret',
      },
      body: JSON.stringify({
        agent_id: 'a1',
        event: 'trigger',
        alert_time: '2026-02-13T12:00:00.000Z',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Alert recorded
    expect(state.rmm_alerts).toHaveLength(1);
    expect(state.rmm_alerts[0]?.external_device_id).toBe('a1');

    // Asset updated by syncSingleAgent
    const asset = state.assets.find((a) => a.asset_id === 'asset_1');
    expect(asset?.name).toBe('pc-1-updated');
    expect(asset?.agent_status).toBe('online');
    expect(asset?.last_rmm_sync_at).toBeInstanceOf(Date);

    const ext = state.workstation_assets.find((w) => w.asset_id === 'asset_1');
    expect(ext).toEqual(
      expect.objectContaining({
        tenant: 'tenant_1',
        asset_id: 'asset_1',
        current_user: 'alice',
        uptime_seconds: 1234,
        lan_ip: '192.168.1.10',
        wan_ip: '203.0.113.10',
      })
    );
  });
});

