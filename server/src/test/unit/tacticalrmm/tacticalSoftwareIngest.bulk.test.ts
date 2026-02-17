import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let secretProvider: { getTenantSecret: (tenant: string, key: string) => Promise<string | null> };
let knexMock: any;

let tacticalSoftwareRows: any[] = [];
let requestCalls: Array<{ method: string; path: string }> = [];

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
      requestCalls.push({ method: String(args.method), path: String(args.path) });
      if (args.method === 'GET' && args.path === '/api/software/') return tacticalSoftwareRows;
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
  software_catalog: Array<any>;
  asset_software: Array<any>;
};

let nextSoftwareId = 0;

function normalizeName(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s.+-]/g, '');
}

function createFakeKnex(state: DbState) {
  const now = new Date('2026-02-13T12:00:00.000Z');

  class QB {
    private _where: Record<string, any>[] = [];

    constructor(private readonly table: keyof DbState) {}

    where(where: Record<string, any>) {
      this._where.push(where);
      return this;
    }

    private filtered(): any[] {
      let rows = [...state[this.table]];
      for (const w of this._where) {
        rows = rows.filter((r) => Object.entries(w).every(([k, v]) => r[k] === v));
      }
      return rows;
    }

    async first(cols?: string[] | string) {
      const colsArr = typeof cols === 'string' ? [cols] : cols;
      const row = this.filtered()[0];
      if (!row) return undefined;
      if (!colsArr) return row;
      const picked: any = {};
      for (const c of colsArr) picked[c] = row[c];
      return picked;
    }

    async select(cols?: string[] | string) {
      const colsArr = typeof cols === 'string' ? [cols] : cols;
      if (!colsArr) return this.filtered();
      return this.filtered().map((r) => {
        const picked: any = {};
        for (const c of colsArr) picked[c] = r[c];
        return picked;
      });
    }

    insert(row: any) {
      const inserted = { ...row };

      if (this.table === 'software_catalog') {
        inserted.software_id = inserted.software_id ?? `software_${++nextSoftwareId}`;
        inserted.normalized_name = inserted.normalized_name ?? normalizeName(String(inserted.name ?? ''));
      }

      state[this.table].push(inserted);

      return {
        returning: async (cols?: string[]) => {
          if (!cols || cols.length === 0) return [inserted];
          const picked: any = {};
          for (const c of cols) picked[c] = inserted[c];
          return [picked];
        },
      };
    }

    async update(patch: any) {
      const rows = this.filtered();
      for (const r of rows) Object.assign(r, patch);
      return rows.length;
    }
  }

  const knex = ((table: string) => new QB(table as any)) as any;
  knex.fn = { now: () => now };
  return knex;
}

describe('Tactical software inventory ingest (bulk)', () => {
  let state: DbState;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-13T12:00:00.000Z'));

    requestCalls = [];
    nextSoftwareId = 0;

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
      software_catalog: [],
      asset_software: [],
    };
    knexMock = createFakeKnex(state);

    secretProvider = {
      getTenantSecret: vi.fn(async (_tenant: string, key: string) => {
        if (key === 'tacticalrmm_api_key') return 'api_key_1';
        return null;
      }),
    };

    tacticalSoftwareRows = [
      { agent_id: 'a1', name: 'App One', version: '1.0.0', publisher: 'Pub', install_path: 'C:\\\\AppOne' },
      { agent_id: 'a1', name: 'App Two', version: '2.0.0', publisher: 'Pub' },
      { agent_id: 'a2', name: 'Unmapped App', version: '3.0.0', publisher: 'Pub' },
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ingests via GET /api/software/ without per-agent refresh calls and writes normalized software tables', async () => {
    const { ingestTacticalRmmSoftwareInventory } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    const res = await ingestTacticalRmmSoftwareInventory({ user_id: 'u1' } as any, { tenant: 'tenant_1' });
    expect(res.success).toBe(true);

    expect(requestCalls).toEqual([{ method: 'GET', path: '/api/software/' }]);
    expect(requestCalls.some((c) => c.method === 'PUT')).toBe(false);

    expect(res.items_processed).toBe(3);
    expect(state.software_catalog.length).toBeGreaterThan(0);
    expect(state.asset_software.length).toBeGreaterThan(0);
  });

  it('associates ingested software to the correct asset via Tactical agent_id mappings', async () => {
    const { ingestTacticalRmmSoftwareInventory } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    const res = await ingestTacticalRmmSoftwareInventory({ user_id: 'u1' } as any, { tenant: 'tenant_1' });
    expect(res.success).toBe(true);

    // Only mapped agent a1 should produce catalog + asset software rows.
    expect(state.asset_software).toHaveLength(2);
    expect(new Set(state.asset_software.map((r) => r.asset_id))).toEqual(new Set(['asset_1']));

    const names = new Set(state.software_catalog.map((r) => r.name));
    expect(names.has('App One')).toBe(true);
    expect(names.has('App Two')).toBe(true);
    expect(names.has('Unmapped App')).toBe(false);
  });

  it('is idempotent (rerun does not duplicate software_catalog or asset_software rows)', async () => {
    const { ingestTacticalRmmSoftwareInventory } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    const first = await ingestTacticalRmmSoftwareInventory({ user_id: 'u1' } as any, { tenant: 'tenant_1' });
    expect(first.success).toBe(true);
    expect(state.software_catalog).toHaveLength(2);
    expect(state.asset_software).toHaveLength(2);

    const second = await ingestTacticalRmmSoftwareInventory({ user_id: 'u1' } as any, { tenant: 'tenant_1' });
    expect(second.success).toBe(true);
    expect(state.software_catalog).toHaveLength(2);
    expect(state.asset_software).toHaveLength(2);
  });
});
