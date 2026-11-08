import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedRmmAlertEvent } from '../contracts';

const h = vi.hoisted(() => {
  const state = {
    statusIsClosed: true,
    alertStatus: 'active',
    afterCommit: [] as Array<{ fn: () => Promise<unknown>; label: string }>,
    updates: [] as Array<{ table: string; patch: Record<string, unknown> }>,
  };
  return { state, publishWorkflowEvent: vi.fn(async (_arg: unknown) => undefined) };
});

const TICKET_ID = 'ticket-1';
const STATUS_ID = '11111111-1111-4111-8111-111111111111';
const RULE_ID = 'rule-1';

vi.mock('@alga-psa/db', () => ({
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
  registerAfterCommit: (_trx: unknown, fn: () => Promise<unknown>, label: string) => {
    h.state.afterCommit.push({ fn, label });
  },
  tenantDb: () => ({
    table: (name: string) => {
      const qb: any = {
        where: () => qb,
        forUpdate: () => qb,
        update: async (patch: Record<string, unknown>) => {
          h.state.updates.push({ table: name, patch });
          if (name === 'rmm_alerts' && typeof patch.status === 'string') h.state.alertStatus = patch.status;
          return 1;
        },
        first: async () => {
          switch (name) {
            case 'rmm_alerts':
              return { alert_id: 'alert-1', status: h.state.alertStatus, ticket_id: TICKET_ID, matched_rule_id: RULE_ID, asset_id: null };
            case 'tickets':
              return { ticket_id: TICKET_ID };
            case 'rmm_alert_rules':
              return {
                rule_id: RULE_ID,
                actions: { createTicket: true, autoResolveTicket: true, autoResolveStatusId: STATUS_ID },
              };
            case 'statuses':
              return { is_closed: h.state.statusIsClosed };
            default:
              return undefined;
          }
        },
      };
      return qb;
    },
  }),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: h.publishWorkflowEvent }));
vi.mock('../untouched', () => ({ isTicketUntouched: async () => true }));
vi.mock('../ticketCreator', () => ({
  addAlertInternalNote: async () => undefined,
  createTicketForAlert: async () => undefined,
  providerLabel: (p: string) => p,
}));
vi.mock('../../../lib/tickets/ticketLifecycleEvents', () => ({
  captureTicketTransitionSnapshot: async () => ({}),
  publishTicketTransitionsAfterCommit: async () => [],
}));
vi.mock('../../../lib/ticketStatusClock', () => ({ ticketStatusClockPatch: () => ({}) }));
vi.mock('../../../lib/tickets/ticketUpdateStamp', () => ({ ticketUpdateStamp: () => ({}) }));

import { processRmmAlertEvent } from '../processRmmAlertEvent';

const event: NormalizedRmmAlertEvent = {
  kind: 'reset',
  tenantId: 'tenant-1',
  integrationId: 'int-1',
  provider: 'ninjaone',
  externalAlertId: 'ext-1',
  severity: 'critical',
  occurredAt: '2026-10-16T00:00:00.000Z',
  raw: {},
};

async function run() {
  const result = await processRmmAlertEvent({ knex: {} as any }, event);
  expect(result.outcome).toBe('resolved');
  // Nothing publishes until the transaction commits.
  expect(h.publishWorkflowEvent).not.toHaveBeenCalled();
  for (const { fn } of h.state.afterCommit) await fn();
}

describe('processReset autoResolveTicket → TICKET_CLOSED', () => {
  beforeEach(() => {
    h.state.statusIsClosed = true;
    h.state.alertStatus = 'active';
    h.state.afterCommit = [];
    h.state.updates = [];
    h.publishWorkflowEvent.mockClear();
  });

  it('emits exactly one after-commit TICKET_CLOSED (system actor, toState = target status) for a closed status', async () => {
    await run();
    expect(h.publishWorkflowEvent).toHaveBeenCalledTimes(1);
    const arg = h.publishWorkflowEvent.mock.calls[0][0] as any;
    expect(arg.eventType).toBe('TICKET_CLOSED');
    expect(arg.payload.ticketId).toBe(TICKET_ID);
    expect(arg.ctx.actor).toEqual({ actorType: 'SYSTEM' });
    expect(arg.ctx.tenantId).toBe('tenant-1');
    expect(arg.toState).toBe(STATUS_ID);
    expect(h.state.updates.some((u) => u.table === 'rmm_alerts' && u.patch.status === 'auto_resolved')).toBe(true);
  });

  it('emits no TICKET_CLOSED when the target status is not closed', async () => {
    h.state.statusIsClosed = false;
    await run();
    expect(h.state.afterCommit).toHaveLength(0);
    expect(h.publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('skips a repeated reset without closing or publishing the ticket twice', async () => {
    await run();
    expect(h.state.alertStatus).toBe('auto_resolved');
    const updatesAfterReset = [...h.state.updates];
    const hooksAfterReset = [...h.state.afterCommit];

    const result = await processRmmAlertEvent({ knex: {} as any }, event);

    expect(result).toMatchObject({ outcome: 'skipped', alertId: 'alert-1' });
    expect(h.state.updates).toEqual(updatesAfterReset);
    expect(h.state.afterCommit).toEqual(hooksAfterReset);
    expect(h.publishWorkflowEvent).toHaveBeenCalledTimes(1);
  });
});
