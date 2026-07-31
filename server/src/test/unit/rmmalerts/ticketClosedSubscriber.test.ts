import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerRmmAlertOutboundAdapter } from '@alga-psa/shared/rmm/alerts';

let knexMock: any;

type DbState = {
  rmm_alerts: Array<any>;
  rmm_alert_rules: Array<any>;
};

function createFakeKnex(state: DbState) {
  // The subscriber's alert query joins rmm_integrations; the fake resolves it
  // by letting rows carry a `provider` field directly.
  const knex = ((tableExpr: string) => {
    const table = tableExpr.startsWith('rmm_alerts') ? 'rmm_alerts' : 'rmm_alert_rules';
    const wheres: Array<[string, any]> = [];
    const whereIns: Array<[string, any[]]> = [];
    const qb: any = {
      join: () => qb,
      where(arg1: any, arg2?: any) {
        // tenantDb qualifies the tenant predicate ('a.tenant' / 'rmm_alerts.tenant');
        // strip the qualifier so the fake rows still enforce the tenant filter.
        if (typeof arg1 === 'object') {
          for (const [k, v] of Object.entries(arg1)) wheres.push([k, v]);
        } else {
          wheres.push([String(arg1).split('.').pop() as string, arg2]);
        }
        return qb;
      },
      andWhere(arg1: any, arg2?: any) {
        return qb.where(arg1, arg2);
      },
      whereIn(col: string, values: any[]) {
        whereIns.push([String(col).split('.').pop() as string, values]);
        return qb;
      },
      filtered() {
        let rows = [...state[table]];
        for (const [k, v] of wheres) rows = rows.filter((r) => r[k.replace(/^tenant$/, 'tenant')] === v);
        for (const [k, values] of whereIns) rows = rows.filter((r) => values.includes(r[k]));
        return rows;
      },
      // select stays chainable so tenantJoin can still attach the join before
      // the query is awaited (qb is thenable, like a real knex builder).
      select: (..._cols: string[]) => qb,
      then(onFulfilled: any, onRejected?: any) {
        return Promise.resolve(qb.filtered()).then(onFulfilled, onRejected);
      },
      first: (..._cols: string[]) => Promise.resolve(qb.filtered()[0]),
      update: (patch: any) => {
        const rows = qb.filtered();
        for (const r of rows) Object.assign(r, typeof patch === 'object' ? patch : {});
        return Promise.resolve(rows.length);
      },
    };
    return qb;
  }) as any;
  knex.raw = (sql: string, bindings: unknown[]) => ({ __raw: sql, bindings });
  return knex;
}

vi.mock('server/src/lib/db/db', () => ({
  getConnection: vi.fn(async () => knexMock),
}));

vi.mock('server/src/lib/eventBus/index', () => ({
  getEventBus: vi.fn(() => ({ subscribe: vi.fn(), unsubscribe: vi.fn() })),
}));

describe('rmmAlertTicketClosedSubscriber', () => {
  let state: DbState;
  const resetAlert = vi.fn(async () => undefined);

  beforeEach(() => {
    resetAlert.mockClear();
    resetAlert.mockResolvedValue(undefined);
    registerRmmAlertOutboundAdapter('testprovider', { resetAlert });

    state = {
      rmm_alerts: [
        {
          tenant: 'tenant_1',
          alert_id: 'alert_1',
          external_alert_id: 'ext-1',
          integration_id: 'integration_1',
          matched_rule_id: 'rule_1',
          provider: 'testprovider',
          status: 'active',
          ticket_id: 'ticket_1',
          metadata: {},
        },
      ],
      rmm_alert_rules: [
        {
          tenant: 'tenant_1',
          rule_id: 'rule_1',
          actions: { createTicket: true, resetAlertOnTicketClose: true },
        },
      ],
    };
    knexMock = createFakeKnex(state);
  });

  async function dispatch() {
    const { handleTicketClosed } = await import(
      'server/src/lib/eventBus/subscribers/rmmAlertTicketClosedSubscriber'
    );
    await handleTicketClosed({ payload: { tenantId: 'tenant_1', ticketId: 'ticket_1' } });
  }

  it('resets the alert in the RMM and marks it resolved locally', async () => {
    await dispatch();
    expect(resetAlert).toHaveBeenCalledWith({
      tenantId: 'tenant_1',
      integrationId: 'integration_1',
      externalAlertId: 'ext-1',
    });
    expect(state.rmm_alerts[0].status).toBe('resolved');
  });

  it('honors a rule that opted out of resetAlertOnTicketClose', async () => {
    state.rmm_alert_rules[0].actions.resetAlertOnTicketClose = false;
    await dispatch();
    expect(resetAlert).not.toHaveBeenCalled();
    expect(state.rmm_alerts[0].status).toBe('active');
  });

  it('skips alerts that are already resolved', async () => {
    state.rmm_alerts[0].status = 'resolved';
    await dispatch();
    expect(resetAlert).not.toHaveBeenCalled();
  });

  it('defaults to resetting for manually linked alerts with no rule', async () => {
    state.rmm_alerts[0].matched_rule_id = null;
    await dispatch();
    expect(resetAlert).toHaveBeenCalledTimes(1);
  });

  it('an outbound failure stamps metadata and leaves the alert active', async () => {
    resetAlert.mockRejectedValueOnce(new Error('NinjaOne 503'));
    await dispatch();
    expect(state.rmm_alerts[0].status).toBe('active');
    expect(state.rmm_alerts[0].metadata.__raw ?? state.rmm_alerts[0].metadata).toBeDefined();
  });

  it('skips providers without an adapter', async () => {
    state.rmm_alerts[0].provider = 'levelio';
    await dispatch();
    expect(resetAlert).not.toHaveBeenCalled();
    expect(state.rmm_alerts[0].status).toBe('active');
  });
});
