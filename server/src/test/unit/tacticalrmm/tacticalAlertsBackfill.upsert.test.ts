import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let secretProvider: { getTenantSecret: (tenant: string, key: string) => Promise<string | null> };
let knexMock: any;
let tacticalAlerts: any[] = [];

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
    async request(args: any) {
      if (args.method === 'PATCH' && args.path === '/api/alerts/') {
        return tacticalAlerts;
      }
      throw new Error(`Unexpected Tactical request: ${args.method} ${args.path}`);
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

type DbState = {
  rmm_integrations: Array<any>;
  tenant_external_entity_mappings: Array<any>;
  rmm_alerts: Array<any>;
};

function createFakeKnex(state: DbState) {
  const now = new Date('2026-02-13T12:00:00.000Z');

  class QB {
    private _where: Record<string, any>[] = [];
    constructor(private readonly table: keyof DbState) {}

    where(where: Record<string, any>) {
      this._where.push(where);
      return this;
    }

    private filtered() {
      let rows = [...state[this.table]];
      for (const w of this._where) {
        rows = rows.filter((r) => Object.entries(w).every(([k, v]) => r[k] === v));
      }
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

    async select(col: string) {
      return this.filtered().map((r) => ({ [col]: r[col] }));
    }

    async update(patch: any) {
      const rows = this.filtered();
      for (const r of rows) Object.assign(r, patch);
      return rows.length;
    }

    async insert(row: any) {
      state[this.table].push(row);
      return [row];
    }
  }

  const knex = ((table: string) => new QB(table as any)) as any;
  knex.fn = { now: () => now };
  return knex;
}

describe('Tactical alerts backfill', () => {
  let state: DbState;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-13T12:00:00.000Z'));

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
          integration_type: 'tacticalrmm',
          alga_entity_type: 'asset',
          external_entity_id: 'a1',
          alga_entity_id: 'asset_1',
        },
      ],
      rmm_alerts: [],
    };
    knexMock = createFakeKnex(state);

    secretProvider = {
      getTenantSecret: vi.fn(async (_tenant: string, key: string) => {
        if (key === 'tacticalrmm_api_key') return 'api_key_1';
        return null;
      }),
    };

    tacticalAlerts = [
      { id: 'alert_1', agent_id: 'a1', severity: 'critical', message: 'Disk full', alert_time: '2026-02-13T12:00:00.000Z' },
      { id: 'alert_2', agent_id: 'a2', severity: 'minor', message: 'CPU high', alert_time: '2026-02-13T12:00:00.000Z' },
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('upserts alerts without duplicating on rerun and maps agent_id to assets when possible', async () => {
    const { backfillTacticalRmmAlerts } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    const first = await backfillTacticalRmmAlerts({ user_id: 'u1' } as any, { tenant: 'tenant_1' });
    expect(first.success).toBe(true);
    expect(first.items_processed).toBe(2);
    expect(first.items_created).toBe(2);
    expect(first.items_updated).toBe(0);
    expect(state.rmm_alerts).toHaveLength(2);
    expect(state.rmm_alerts.find((a) => a.external_alert_id === 'alert_1')?.asset_id).toBe('asset_1');
    expect(state.rmm_alerts.find((a) => a.external_alert_id === 'alert_2')?.asset_id).toBeNull();

    // Rerun with changed messages should update, not insert new.
    tacticalAlerts = [
      { id: 'alert_1', agent_id: 'a1', severity: 'critical', message: 'Disk full (updated)', alert_time: '2026-02-13T12:00:00.000Z' },
      { id: 'alert_2', agent_id: 'a2', severity: 'minor', message: 'CPU high (updated)', alert_time: '2026-02-13T12:00:00.000Z' },
    ];

    const second = await backfillTacticalRmmAlerts({ user_id: 'u1' } as any, { tenant: 'tenant_1' });
    expect(second.success).toBe(true);
    expect(second.items_processed).toBe(2);
    expect(second.items_created).toBe(0);
    expect(second.items_updated).toBe(2);
    expect(state.rmm_alerts).toHaveLength(2);
    expect(state.rmm_alerts.find((a) => a.external_alert_id === 'alert_1')?.message).toBe('Disk full (updated)');
  });
});

