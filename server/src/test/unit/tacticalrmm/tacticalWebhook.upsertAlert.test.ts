import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

let secretProvider: { getTenantSecret: (tenant: string, key: string) => Promise<string | null> };
let knexMock: any;

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

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => secretProvider),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexMock })),
}));

vi.mock('@alga-psa/integrations/lib/rmm/tacticalrmm/syncSingleAgent', () => ({
  syncTacticalSingleAgentForTenant: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
}));

describe('Tactical webhook alert upsert', () => {
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
        },
      ],
      tenant_external_entity_mappings: [],
      rmm_alerts: [],
    };
    knexMock = createFakeKnex(state);

    secretProvider = {
      getTenantSecret: vi.fn(async (_tenant: string, key: string) => {
        if (key === 'tacticalrmm_webhook_secret') return 'expected_secret';
        return null;
      }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts minimal payload with agent_id and upserts an alert record', async () => {
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
        severity: 'critical',
        message: 'Test alert',
        alert_time: '2026-02-13T12:00:00.000Z',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.recorded).toBe(true);

    expect(state.rmm_alerts).toHaveLength(1);
    expect(state.rmm_alerts[0]).toEqual(
      expect.objectContaining({
        tenant: 'tenant_1',
        integration_id: 'integration_1',
        external_device_id: 'a1',
        status: 'active',
        severity: 'critical',
      })
    );
  });

  it('associates alert to asset when agent_id mapping exists, otherwise asset_id is null', async () => {
    state.tenant_external_entity_mappings.push({
      tenant: 'tenant_1',
      integration_type: 'tacticalrmm',
      alga_entity_type: 'asset',
      external_entity_id: 'a1',
      alga_entity_id: 'asset_1',
    });

    const { POST } = await import('server/src/app/api/webhooks/tacticalrmm/route');
    const req1 = new Request('http://localhost/api/webhooks/tacticalrmm?tenant=tenant_1', {
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

    const res1 = await POST(req1);
    expect(res1.status).toBe(200);
    expect(state.rmm_alerts[0]?.asset_id).toBe('asset_1');

    const req2 = new Request('http://localhost/api/webhooks/tacticalrmm?tenant=tenant_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Alga-Webhook-Secret': 'expected_secret',
      },
      body: JSON.stringify({
        agent_id: 'a2',
        event: 'trigger',
        alert_time: '2026-02-13T12:00:01.000Z',
      }),
    });

    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    expect(state.rmm_alerts[1]?.asset_id).toBeNull();
  });
});

