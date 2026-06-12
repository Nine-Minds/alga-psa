import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

let secretProvider: { getTenantSecret: (tenant: string, key: string) => Promise<string | null> };
let knexMock: any;

type DbState = {
  rmm_integrations: Array<any>;
  tenant_external_entity_mappings: Array<any>;
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
  }

  const knex = ((table: string) => new QB(table as any)) as any;
  knex.fn = { now: () => now };
  return knex;
}

const processRmmAlertEvent = vi.fn(async () => ({
  outcome: 'ticket_created',
  alertId: 'alert-1',
  ticketId: 'ticket-1',
  warnings: [],
}));

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
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/shared/rmm/alerts', () => ({
  processRmmAlertEvent,
}));

vi.mock('@alga-psa/integrations/lib/rmm/alerts/pipelineDeps', () => ({
  buildRmmAlertPipelineDeps: vi.fn(() => ({})),
}));

describe('Tactical webhook alert normalization into the shared pipeline', () => {
  let state: DbState;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-13T12:00:00.000Z'));
    processRmmAlertEvent.mockClear();

    state = {
      rmm_integrations: [
        {
          tenant: 'tenant_1',
          provider: 'tacticalrmm',
          integration_id: 'integration_1',
        },
      ],
      tenant_external_entity_mappings: [],
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

  function webhookRequest(body: Record<string, unknown>, secret = 'expected_secret') {
    return new Request('http://localhost/api/webhooks/tacticalrmm?tenant=tenant_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Alga-Webhook-Secret': secret,
      },
      body: JSON.stringify(body),
    });
  }

  it('normalizes a trigger payload and runs it through the pipeline', async () => {
    const { POST } = await import('server/src/app/api/webhooks/tacticalrmm/route');
    const res = await POST(
      webhookRequest({
        agent_id: 'a1',
        alert_id: '42',
        event: 'trigger',
        severity: 'critical',
        message: 'Test alert',
        alert_type: 'cpu_check',
        hostname: 'SERVER-01',
        client_id: 7,
        alert_time: '2026-02-13T12:00:00.000Z',
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.recorded).toBe(true);
    expect(json.outcome).toBe('ticket_created');

    expect(processRmmAlertEvent).toHaveBeenCalledTimes(1);
    const [, event] = processRmmAlertEvent.mock.calls[0] as any[];
    expect(event).toEqual(
      expect.objectContaining({
        tenantId: 'tenant_1',
        integrationId: 'integration_1',
        provider: 'tacticalrmm',
        kind: 'triggered',
        externalAlertId: '42',
        externalDeviceId: 'a1',
        severity: 'critical',
        message: 'Test alert',
        alertClass: 'cpu_check',
        deviceName: 'SERVER-01',
        externalOrganizationId: '7',
        occurredAt: '2026-02-13T12:00:00.000Z',
      })
    );
  });

  it('maps resolve events to kind reset and synthesizes an external id when absent', async () => {
    const { POST } = await import('server/src/app/api/webhooks/tacticalrmm/route');
    const res = await POST(
      webhookRequest({
        agent_id: 'a1',
        event: 'resolved',
        alert_time: '2026-02-13T12:00:00.000Z',
      })
    );

    expect(res.status).toBe(200);
    const [, event] = processRmmAlertEvent.mock.calls[0] as any[];
    expect(event.kind).toBe('reset');
    expect(event.externalAlertId).toBe('a1:resolved:2026-02-13T12:00:00.000Z');
  });

  it('rejects a wrong webhook secret without touching the pipeline', async () => {
    const { POST } = await import('server/src/app/api/webhooks/tacticalrmm/route');
    const res = await POST(webhookRequest({ agent_id: 'a1' }, 'wrong_secret'));
    expect(res.status).toBe(401);
    expect(processRmmAlertEvent).not.toHaveBeenCalled();
  });
});
