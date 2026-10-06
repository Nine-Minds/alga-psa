import { beforeEach, describe, expect, it, vi } from 'vitest';

const publishWorkflowEvent = vi.fn(async (_args: any) => {});
let statusRows: Array<{ status_id: string; is_closed: boolean }> = [];
let ticketRow: any = null;

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: (args: any) => publishWorkflowEvent(args),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  tenantDb: () => ({
    table: (name: string) => {
      const builder: any = {
        select: () => builder,
        where: () => builder,
        whereIn: () => Promise.resolve(statusRows),
        first: () => Promise.resolve(name === 'tickets' ? ticketRow : undefined),
      };
      return builder;
    },
  }),
}));

import { withTransaction } from '@alga-psa/db';
import {
  buildTicketTransitionEvents,
  captureTicketTransitionSnapshot,
  isSilentTicketCreation,
  publishTicketTransitionsAfterCommit,
  silentTicketCreation,
  ticketCreatedPublishedByCaller,
  type TicketTransitionSnapshot,
} from '../ticketLifecycleEvents';

const base: TicketTransitionSnapshot = {
  ticketId: 't1',
  statusId: 's-open',
  priorityId: 'p1',
  assignedTo: 'u1',
  boardId: 'b1',
  escalated: false,
};
const ctx = { occurredAt: '2026-01-01T00:00:00.000Z' };
const types = (evs: Array<{ eventType: string }>) => evs.map((e) => e.eventType);

function createKnex() {
  const trx: any = { commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}) };
  const knex: any = {
    transaction: vi.fn(async (cb: any) => {
      try {
        const r = await cb(trx);
        await trx.commit();
        return r;
      } catch (e) {
        await trx.rollback(e);
        throw e;
      }
    }),
  };
  return knex;
}

describe('buildTicketTransitionEvents', () => {
  it('builds TICKET_STATUS_CHANGED with previous/new ids', () => {
    const evs = buildTicketTransitionEvents({ before: base, after: { ...base, statusId: 's-2' }, ctx });
    expect(types(evs)).toEqual(['TICKET_STATUS_CHANGED']);
    expect(evs[0].payload).toMatchObject({ ticketId: 't1', previousStatusId: 's-open', newStatusId: 's-2', changedAt: ctx.occurredAt });
  });

  it('adds TICKET_REOPENED when closed -> open', () => {
    const evs = buildTicketTransitionEvents({
      before: { ...base, statusId: 's-closed' },
      after: base,
      ctx: { ...ctx, previousStatusIsClosed: true, newStatusIsClosed: false },
    });
    expect(types(evs)).toEqual(['TICKET_STATUS_CHANGED', 'TICKET_REOPENED']);
  });

  it('does not build REOPENED for open -> closed (no TICKET_CLOSED in this builder)', () => {
    const evs = buildTicketTransitionEvents({
      before: base,
      after: { ...base, statusId: 's-closed' },
      ctx: { ...ctx, previousStatusIsClosed: false, newStatusIsClosed: true },
    });
    expect(types(evs)).toEqual(['TICKET_STATUS_CHANGED']);
  });

  it('builds no events when nothing changed', () => {
    expect(buildTicketTransitionEvents({ before: base, after: { ...base }, ctx })).toEqual([]);
  });

  it('builds priority, unassign, queue and escalation events', () => {
    const evs = buildTicketTransitionEvents({
      before: base,
      after: { ...base, priorityId: 'p2', assignedTo: null, boardId: 'b2', escalated: true },
      ctx,
    });
    expect(types(evs).sort()).toEqual(
      ['TICKET_ESCALATED', 'TICKET_PRIORITY_CHANGED', 'TICKET_QUEUE_CHANGED', 'TICKET_UNASSIGNED'].sort()
    );
  });
});

describe('publishTicketTransitionsAfterCommit', () => {
  beforeEach(() => {
    publishWorkflowEvent.mockClear();
    statusRows = [
      { status_id: 's-open', is_closed: false },
      { status_id: 's-2', is_closed: false },
      { status_id: 's-closed', is_closed: true },
    ];
    ticketRow = null;
  });

  it('publishes status change after commit only', async () => {
    const knex = createKnex();
    await withTransaction(knex, async (trx) => {
      const evs = await publishTicketTransitionsAfterCommit(trx, {
        tenant: 'tn', before: base, after: { ...base, statusId: 's-2' }, actorUserId: 'actor', correlationId: 'run-1',
      });
      expect(types(evs)).toEqual(['TICKET_STATUS_CHANGED']);
      expect(publishWorkflowEvent).not.toHaveBeenCalled();
    });
    expect(publishWorkflowEvent).toHaveBeenCalledTimes(1);
    const arg = publishWorkflowEvent.mock.calls[0][0];
    expect(arg.eventType).toBe('TICKET_STATUS_CHANGED');
    expect(arg.payload).toMatchObject({ previousStatusId: 's-open', newStatusId: 's-2' });
    expect(arg.ctx).toMatchObject({ tenantId: 'tn', actor: { actorType: 'USER', actorUserId: 'actor' }, correlationId: 'run-1' });
  });

  it('uses SYSTEM actor without actorUserId and merges statusChangedPayloadExtras', async () => {
    await withTransaction(createKnex(), async (trx) => {
      await publishTicketTransitionsAfterCommit(trx, {
        tenant: 'tn', before: base, after: { ...base, statusId: 's-2' }, statusChangedPayloadExtras: { suppressContactNotifications: true },
      });
    });
    const arg = publishWorkflowEvent.mock.calls[0][0];
    expect(arg.ctx.actor).toEqual({ actorType: 'SYSTEM' });
    expect(arg.ctx.correlationId).toBeUndefined();
    expect(arg.payload.suppressContactNotifications).toBe(true);
  });

  it('publishes STATUS_CHANGED then REOPENED when closed -> open (derived from statuses)', async () => {
    await withTransaction(createKnex(), async (trx) => {
      const evs = await publishTicketTransitionsAfterCommit(trx, {
        tenant: 'tn', before: { ...base, statusId: 's-closed' }, after: base,
      });
      expect(types(evs)).toEqual(['TICKET_STATUS_CHANGED', 'TICKET_REOPENED']);
    });
    expect(publishWorkflowEvent.mock.calls.map((c) => c[0].eventType)).toEqual(['TICKET_STATUS_CHANGED', 'TICKET_REOPENED']);
  });

  it('publishes only STATUS_CHANGED on open -> closed', async () => {
    await withTransaction(createKnex(), async (trx) => {
      await publishTicketTransitionsAfterCommit(trx, { tenant: 'tn', before: base, after: { ...base, statusId: 's-closed' } });
    });
    expect(publishWorkflowEvent.mock.calls.map((c) => c[0].eventType)).toEqual(['TICKET_STATUS_CHANGED']);
  });

  it('publishes nothing when nothing changed', async () => {
    await withTransaction(createKnex(), async (trx) => {
      expect(await publishTicketTransitionsAfterCommit(trx, { tenant: 'tn', before: base, after: { ...base } })).toEqual([]);
    });
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('honours the only filter', async () => {
    await withTransaction(createKnex(), async (trx) => {
      const evs = await publishTicketTransitionsAfterCommit(trx, {
        tenant: 'tn', before: { ...base, statusId: 's-closed' }, after: base, only: ['TICKET_STATUS_CHANGED'],
      });
      expect(types(evs)).toEqual(['TICKET_STATUS_CHANGED']);
    });
    expect(publishWorkflowEvent.mock.calls.map((c) => c[0].eventType)).toEqual(['TICKET_STATUS_CHANGED']);
  });

  it('only filter yielding nothing publishes nothing', async () => {
    await withTransaction(createKnex(), async (trx) => {
      expect(await publishTicketTransitionsAfterCommit(trx, {
        tenant: 'tn', before: base, after: { ...base, statusId: 's-2' }, only: ['TICKET_REOPENED'],
      })).toEqual([]);
    });
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('null before publishes nothing', async () => {
    await withTransaction(createKnex(), async (trx) => {
      expect(await publishTicketTransitionsAfterCommit(trx, { tenant: 'tn', before: null })).toEqual([]);
    });
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('reloads the after snapshot from the transaction when omitted', async () => {
    ticketRow = { ticket_id: 't1', status_id: 's-2', priority_id: 'p1', assigned_to: 'u1', board_id: 'b1', escalated: false };
    await withTransaction(createKnex(), async (trx) => {
      await publishTicketTransitionsAfterCommit(trx, { tenant: 'tn', before: base });
    });
    expect(publishWorkflowEvent).toHaveBeenCalledTimes(1);
    expect(publishWorkflowEvent.mock.calls[0][0].payload.newStatusId).toBe('s-2');
  });

  it('publishes nothing when the ticket row is gone and after is omitted', async () => {
    ticketRow = null;
    await withTransaction(createKnex(), async (trx) => {
      expect(await publishTicketTransitionsAfterCommit(trx, { tenant: 'tn', before: base })).toEqual([]);
    });
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('does not run hooks on rollback', async () => {
    await expect(
      withTransaction(createKnex(), async (trx) => {
        await publishTicketTransitionsAfterCommit(trx, { tenant: 'tn', before: base, after: { ...base, statusId: 's-2' } });
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('outbox publisher: calls publishTicketStatusChanged in-transaction and registers no after-commit hook', async () => {
    const publisher: any = { __inboundOutboxPublisher: true, publishTicketStatusChanged: vi.fn(async () => {}) };
    await withTransaction(createKnex(), async (trx) => {
      await publishTicketTransitionsAfterCommit(trx, {
        tenant: 'tn', before: base, after: { ...base, statusId: 's-2' }, actorUserId: 'actor', publisher,
      });
      expect(publisher.publishTicketStatusChanged).toHaveBeenCalledTimes(1);
      expect(publisher.publishTicketStatusChanged).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tn', ticketId: 't1', userId: 'actor', previousStatusId: 's-open', newStatusId: 's-2' })
      );
    });
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('outbox publisher: no status change means no outbox call', async () => {
    const publisher: any = { __inboundOutboxPublisher: true, publishTicketStatusChanged: vi.fn(async () => {}) };
    await withTransaction(createKnex(), async (trx) => {
      await publishTicketTransitionsAfterCommit(trx, {
        tenant: 'tn', before: base, after: { ...base, boardId: 'b2' }, publisher,
      });
    });
    expect(publisher.publishTicketStatusChanged).not.toHaveBeenCalled();
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('a non-outbox publisher still goes through the after-commit path', async () => {
    const publisher: any = { publishTicketStatusChanged: vi.fn() };
    await withTransaction(createKnex(), async (trx) => {
      await publishTicketTransitionsAfterCommit(trx, { tenant: 'tn', before: base, after: { ...base, statusId: 's-2' }, publisher });
    });
    expect(publisher.publishTicketStatusChanged).not.toHaveBeenCalled();
    expect(publishWorkflowEvent).toHaveBeenCalledTimes(1);
  });
});

describe('captureTicketTransitionSnapshot', () => {
  it('maps the row and returns null when missing', async () => {
    ticketRow = { ticket_id: 't9', status_id: 's', priority_id: undefined, assigned_to: null, board_id: 'b', escalated: undefined };
    expect(await captureTicketTransitionSnapshot({} as any, 'tn', 't9')).toEqual({
      ticketId: 't9', statusId: 's', priorityId: null, assignedTo: null, boardId: 'b', escalated: null,
    });
    ticketRow = null;
    expect(await captureTicketTransitionSnapshot({} as any, 'tn', 't9')).toBeNull();
  });
});

describe('silent ticket creation markers', () => {
  it('silentTicketCreation produces a silent marker', () => {
    const m = silentTicketCreation('bulk import');
    expect(m).toMatchObject({ __silentTicketCreation: true, kind: 'silent', reason: 'bulk import' });
    expect(isSilentTicketCreation(m)).toBe(true);
  });

  it('ticketCreatedPublishedByCaller produces a caller_published marker', () => {
    const m = ticketCreatedPublishedByCaller('REST publishes');
    expect(m.kind).toBe('caller_published');
    expect(isSilentTicketCreation(m)).toBe(true);
  });

  it('requires a non-blank reason', () => {
    expect(() => silentTicketCreation('')).toThrow();
    expect(() => silentTicketCreation('   ')).toThrow();
    expect(() => ticketCreatedPublishedByCaller(' ')).toThrow();
  });

  it('isSilentTicketCreation rejects real publishers and nullish values', () => {
    expect(isSilentTicketCreation({ publishTicketCreated: () => {} })).toBe(false);
    expect(isSilentTicketCreation(null)).toBe(false);
    expect(isSilentTicketCreation(undefined)).toBe(false);
  });
});
