import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let secretProvider: { getTenantSecret: (tenant: string, key: string) => Promise<string | null> };
let knexMock: any;

const runRmmAlertReconciliation = vi.fn(async () => ({
  skipped: false,
  remoteActive: 3,
  ingested: 2,
  resetsSynthesized: 1,
  warnings: [],
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (input: any) => fn({ user_id: 'user_1' }, { tenant: 'tenant_1' }, input),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => secretProvider),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexMock })),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
  }),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/shared/rmm/alerts', async () => {
  const actual: any = await vi.importActual('@alga-psa/shared/rmm/alerts');
  return { ...actual, runRmmAlertReconciliation, registerRmmAlertFetcher: vi.fn() };
});

vi.mock('@alga-psa/integrations/lib/rmm/alerts/pipelineDeps', () => ({
  buildRmmAlertPipelineDeps: vi.fn(() => ({})),
}));

type DbState = {
  rmm_integrations: Array<any>;
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

describe('backfillTacticalRmmAlerts runs a reconciliation cycle', () => {
  let state: DbState;

  beforeEach(() => {
    runRmmAlertReconciliation.mockClear();
    state = {
      rmm_integrations: [
        {
          tenant: 'tenant_1',
          provider: 'tacticalrmm',
          integration_id: 'integration_1',
          instance_url: 'https://api.tactical.example',
          settings: {},
          sync_error: 'stale error',
        },
      ],
    };
    knexMock = createFakeKnex(state);
    secretProvider = { getTenantSecret: vi.fn(async () => null) };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('invokes the shared reconciliation and maps its counts into the action result', async () => {
    const { backfillTacticalRmmAlerts } = await import(
      '@alga-psa/integrations/actions'
    );

    const result = await (backfillTacticalRmmAlerts as any)();
    expect(result.success).toBe(true);
    expect(result.items_processed).toBe(3);
    expect(result.items_created).toBe(2);
    expect(result.items_updated).toBe(1);
    expect(result.items_failed).toBe(0);

    expect(runRmmAlertReconciliation).toHaveBeenCalledTimes(1);
    const [, args] = runRmmAlertReconciliation.mock.calls[0] as any[];
    expect(args).toEqual({
      tenantId: 'tenant_1',
      integrationId: 'integration_1',
      provider: 'tacticalrmm',
    });

    // Sync bookkeeping: last_sync_at stamped, stale error cleared.
    expect(state.rmm_integrations[0].sync_error).toBeNull();
    expect(state.rmm_integrations[0].last_sync_at).toBeDefined();
  });

  it('fails cleanly when the integration is not configured', async () => {
    state.rmm_integrations = [];
    const { backfillTacticalRmmAlerts } = await import(
      '@alga-psa/integrations/actions'
    );
    const result = await (backfillTacticalRmmAlerts as any)();
    expect(result.success).toBe(false);
    expect(runRmmAlertReconciliation).not.toHaveBeenCalled();
  });
});
