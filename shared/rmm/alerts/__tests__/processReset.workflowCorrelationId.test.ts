import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: Level alert ids are base64 GIDs, not UUIDs. processReset used to
 * pass the external alert id as the workflow correlationId, which the real
 * publisher copies into `execution_id` (UUID-only in WorkflowEventBaseSchema).
 * The publish threw inside the swallowed after-commit hook, so
 * TICKET_STATUS_CHANGED / TICKET_CLOSED never reached the global stream.
 *
 * Here the real publishWorkflowEvent → publishEventUnchecked path runs; only the
 * transport (getEventBus().publish) is stubbed, and it applies the same
 * convertToWorkflowEvent + WorkflowEventBaseSchema.parse the real bus applies.
 */
const h = vi.hoisted(() => ({
  afterCommit: [] as Array<{ fn: () => Promise<unknown>; label: string }>,
  published: [] as Array<{ eventType: string; executionId?: string }>,
}));

const LEVEL_GID = 'Z2lkOi8vbGV2ZWwvQWxlcnQvMTA';
const TICKET_ID = '22222222-2222-4222-8222-222222222222';
const ALERT_ID = '33333333-3333-4333-8333-333333333333';
const OPEN_STATUS_ID = '44444444-4444-4444-8444-444444444444';
const CLOSED_STATUS_ID = '11111111-1111-4111-8111-111111111111';
const RULE_ID = 'rule-1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

vi.mock('@alga-psa/db', () => ({
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
  registerAfterCommit: (_trx: unknown, fn: () => Promise<unknown>, label: string) => {
    h.afterCommit.push({ fn, label });
  },
  tenantDb: () => ({
    table: (name: string) => {
      const qb: any = {
        where: () => qb,
        select: () => qb,
        whereIn: async () => [
          { status_id: OPEN_STATUS_ID, is_closed: false },
          { status_id: CLOSED_STATUS_ID, is_closed: true },
        ],
        update: async () => 1,
        first: async () => {
          switch (name) {
            case 'rmm_alerts':
              return { alert_id: ALERT_ID, status: 'active', ticket_id: TICKET_ID, matched_rule_id: RULE_ID, asset_id: null };
            case 'tickets':
              return { ticket_id: TICKET_ID };
            case 'rmm_alert_rules':
              return {
                rule_id: RULE_ID,
                actions: { createTicket: true, autoResolveTicket: true, autoResolveStatusId: CLOSED_STATUS_ID },
              };
            case 'statuses':
              return { is_closed: true };
            default:
              return undefined;
          }
        },
      };
      return qb;
    },
  }),
}));

vi.mock('@alga-psa/event-bus', async () => {
  const { convertToWorkflowEvent } = await import('@alga-psa/event-bus/schemas/eventBusSchema');
  const { WorkflowEventBaseSchema } = await import('@alga-psa/event-bus/schemas/workflowEventSchema');
  return {
    getEventBus: () => ({
      publish: async (event: any, options: any) => {
        const wire = WorkflowEventBaseSchema.parse(
          convertToWorkflowEvent(
            { ...event, id: '55555555-5555-4555-8555-555555555555', timestamp: new Date().toISOString() },
            options?.workflow
          )
        );
        h.published.push({ eventType: event.eventType, executionId: wire.execution_id });
      },
    }),
  };
});
vi.mock('@alga-psa/event-bus/workflow/workflowEventContract', () => ({ enforceWorkflowEventContract: () => undefined }));
vi.mock('../untouched', () => ({ isTicketUntouched: async () => true }));
vi.mock('../ticketCreator', () => ({
  addAlertInternalNote: async () => undefined,
  createTicketForAlert: async () => undefined,
  providerLabel: (p: string) => p,
}));
vi.mock('../../../lib/tickets/ticketLifecycleEvents', async (importActual) => {
  const actual = await importActual<typeof import('../../../lib/tickets/ticketLifecycleEvents')>();
  const snap = (statusId: string) => ({
    ticketId: TICKET_ID,
    statusId,
    priorityId: null,
    assignedTo: null,
    boardId: 'board-1',
  });
  return {
    ...actual,
    captureTicketTransitionSnapshot: async () => snap(OPEN_STATUS_ID),
    // Real publishTicketTransitionsAfterCommit; only the post-write snapshot is supplied.
    publishTicketTransitionsAfterCommit: (trx: any, params: any) =>
      actual.publishTicketTransitionsAfterCommit(trx, { ...params, after: snap(CLOSED_STATUS_ID) }),
  };
});
vi.mock('../../../lib/ticketStatusClock', () => ({ ticketStatusClockPatch: () => ({}) }));
vi.mock('../../../lib/tickets/ticketUpdateStamp', () => ({ ticketUpdateStamp: () => ({}) }));

import { processRmmAlertEvent } from '../processRmmAlertEvent';

describe('processReset workflow correlation ids', () => {
  beforeEach(() => {
    h.afterCommit = [];
    h.published = [];
  });

  it('publishes TICKET_STATUS_CHANGED and TICKET_CLOSED with a UUID execution id for a non-UUID (Level GID) external alert id', async () => {
    const result = await processRmmAlertEvent(
      { knex: {} as any },
      {
        kind: 'reset',
        tenantId: 'tenant-1',
        integrationId: 'int-1',
        provider: 'levelio',
        externalAlertId: LEVEL_GID,
        occurredAt: '2026-10-16T00:00:00.000Z',
      } as any
    );
    expect(result.outcome).toBe('resolved');

    // Run every after-commit hook exactly as the commit would; a publish error propagates.
    for (const { fn } of h.afterCommit) await fn();

    const types = h.published.map((p) => p.eventType);
    expect(types).toContain('TICKET_CLOSED');
    expect(types).toContain('TICKET_STATUS_CHANGED');
    for (const p of h.published) {
      expect(p.executionId, p.eventType).toMatch(UUID_RE);
      expect(p.executionId).toBe(ALERT_ID);
    }
  });
});
