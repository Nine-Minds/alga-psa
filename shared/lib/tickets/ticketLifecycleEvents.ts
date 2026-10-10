import type { Knex } from 'knex';
import { registerAfterCommit, tenantDb } from '@alga-psa/db';
import type { IEventPublisher } from '@alga-psa/types';

/**
 * Ticket lifecycle event engine.
 *
 * Event publication used to be opt-in at every call site, which is why many
 * ticket write paths were silent. This module makes it structural:
 *  - `buildTicketTransitionEvents` derives transition events from before/after
 *    snapshots (status, priority, unassign, queue, reopen, escalate);
 *  - `publishTicketTransitionsAfterCommit` publishes them once the owning
 *    transaction commits (or enqueues them on the inbound outbox, which is part
 *    of the transaction). Every code path that writes `tickets.status_id` or
 *    `tickets.board_id` calls it; `ticketStatusWriteSites.contract.test.ts`
 *    fails the build when a new write site skips it;
 *  - `TicketCreationEvents` / `silentTicketCreation` make the creation publisher
 *    a required decision for `TicketModel.createTicket`.
 */

export type TicketTransitionSnapshot = {
  ticketId: string;
  statusId: string;
  priorityId: string | null;
  assignedTo: string | null;
  boardId: string;
  escalated?: boolean | null;
};

export type TicketTransitionContext = {
  occurredAt: string;
  actorUserId?: string;
  previousStatusIsClosed?: boolean;
  newStatusIsClosed?: boolean;
};

export type TicketTransitionWorkflowEvent = {
  eventType:
    | 'TICKET_STATUS_CHANGED'
    | 'TICKET_PRIORITY_CHANGED'
    | 'TICKET_UNASSIGNED'
    | 'TICKET_REOPENED'
    | 'TICKET_ESCALATED'
    | 'TICKET_QUEUE_CHANGED';
  payload: Record<string, unknown>;
  workflow?: {
    eventName?: string;
    fromState?: string;
    toState?: string;
  };
};

function normalizeUuid(value: string | null | undefined): string | null {
  if (!value) return null;
  return value;
}

/** TICKET_STATUS_CHANGED payload (also used by the bundle close path). */
export function buildTicketStatusChangedPayload(input: {
  ticketId: string;
  previousStatusId: string;
  newStatusId: string;
  changedAt: string;
}) {
  return {
    ticketId: input.ticketId,
    previousStatusId: input.previousStatusId,
    newStatusId: input.newStatusId,
    changedAt: input.changedAt,
  };
}

export function buildTicketTransitionEvents(params: {
  before: TicketTransitionSnapshot;
  after: TicketTransitionSnapshot;
  ctx: TicketTransitionContext;
}): TicketTransitionWorkflowEvent[] {
  const { before, after, ctx } = params;
  const occurredAt = ctx.occurredAt;
  const previousAssignedTo = normalizeUuid(before.assignedTo);
  const newAssignedTo = normalizeUuid(after.assignedTo);

  const events: TicketTransitionWorkflowEvent[] = [];

  if (before.statusId !== after.statusId) {
    events.push({
      eventType: 'TICKET_STATUS_CHANGED',
      payload: buildTicketStatusChangedPayload({
        ticketId: after.ticketId,
        previousStatusId: before.statusId,
        newStatusId: after.statusId,
        changedAt: occurredAt,
      }),
      workflow: {
        eventName: 'Ticket Status Changed',
        fromState: before.statusId,
        toState: after.statusId,
      },
    });
  }

  if (
    before.priorityId &&
    after.priorityId &&
    normalizeUuid(before.priorityId) !== normalizeUuid(after.priorityId)
  ) {
    events.push({
      eventType: 'TICKET_PRIORITY_CHANGED',
      payload: {
        ticketId: after.ticketId,
        previousPriorityId: before.priorityId,
        newPriorityId: after.priorityId,
        changedAt: occurredAt,
      },
      workflow: {
        eventName: 'Ticket Priority Changed',
      },
    });
  }

  if (previousAssignedTo !== newAssignedTo) {
    if (!newAssignedTo && previousAssignedTo) {
      events.push({
        eventType: 'TICKET_UNASSIGNED',
        payload: {
          ticketId: after.ticketId,
          previousAssigneeId: previousAssignedTo,
          previousAssigneeType: 'user',
          unassignedAt: occurredAt,
        },
        workflow: {
          eventName: 'Ticket Unassigned',
        },
      });
    }
  }

  if (before.boardId !== after.boardId) {
    events.push({
      eventType: 'TICKET_QUEUE_CHANGED',
      payload: {
        ticketId: after.ticketId,
        previousBoardId: before.boardId,
        newBoardId: after.boardId,
        changedAt: occurredAt,
      },
      workflow: {
        eventName: 'Ticket Queue Changed',
      },
    });
  }

  if (ctx.previousStatusIsClosed && !ctx.newStatusIsClosed && before.statusId !== after.statusId) {
    events.push({
      eventType: 'TICKET_REOPENED',
      payload: {
        ticketId: after.ticketId,
        previousStatusId: before.statusId,
        newStatusId: after.statusId,
        reopenedAt: occurredAt,
      },
      workflow: {
        eventName: 'Ticket Reopened',
        fromState: before.statusId,
        toState: after.statusId,
      },
    });
  }

  if (!before.escalated && after.escalated) {
    events.push({
      eventType: 'TICKET_ESCALATED',
      payload: {
        ticketId: after.ticketId,
        fromQueueId: before.boardId,
        toQueueId: after.boardId,
        escalatedAt: occurredAt,
      },
      workflow: {
        eventName: 'Ticket Escalated',
      },
    });
  }

  return events;
}


/** Explicit opt-out of TICKET_CREATED publication; only for bulk historical data. */
export interface SilentTicketCreation {
  readonly __silentTicketCreation: true;
  readonly reason: string;
  /** `silent`: no TICKET_CREATED at all. `caller_published`: the caller publishes it itself after commit. */
  readonly kind: 'silent' | 'caller_published';
}

/**
 * A publisher plus extra TICKET_CREATED payload fields, merged into the published
 * metadata by `TicketModel.createTicket`.
 */
export interface TicketCreationWithPayloadExtras {
  readonly __ticketCreationWithPayloadExtras: true;
  readonly reason: string;
  readonly publisher: IEventPublisher;
  readonly payloadExtras: Readonly<Record<string, unknown>>;
}

export type TicketCreationEvents = IEventPublisher | SilentTicketCreation | TicketCreationWithPayloadExtras;

/**
 * Publish TICKET_CREATED (internal notifications, board rules, watchers, workflows)
 * but keep the client contact silent. Required for creation sources that did not
 * publish TICKET_CREATED before it became mandatory, so the contact does not start
 * receiving "New Ticket" mail/in-app notifications. `suppressInternalNotifications`
 * stays unset. Turning client mail on for a source is a separate product decision.
 */
export function contactSuppressedTicketCreation(
  publisher: IEventPublisher,
  reason: string
): TicketCreationWithPayloadExtras {
  if (!reason || !reason.trim()) {
    throw new Error('contactSuppressedTicketCreation requires a reason');
  }
  if (!publisher) {
    throw new Error('contactSuppressedTicketCreation requires a publisher');
  }
  return {
    __ticketCreationWithPayloadExtras: true,
    reason,
    publisher,
    payloadExtras: { suppressContactNotifications: true },
  };
}

export function isTicketCreationWithPayloadExtras(value: unknown): value is TicketCreationWithPayloadExtras {
  return !!value && (value as TicketCreationWithPayloadExtras).__ticketCreationWithPayloadExtras === true;
}

export function silentTicketCreation(reason: string): SilentTicketCreation {
  if (!reason || !reason.trim()) {
    throw new Error('silentTicketCreation requires a reason');
  }
  return { __silentTicketCreation: true, reason, kind: 'silent' };
}

/**
 * For callers that publish TICKET_CREATED themselves after commit with a richer
 * payload (e.g. the REST TicketService). The model does not publish a second one.
 */
export function ticketCreatedPublishedByCaller(reason: string): SilentTicketCreation {
  if (!reason || !reason.trim()) {
    throw new Error('ticketCreatedPublishedByCaller requires a reason');
  }
  return { __silentTicketCreation: true, reason, kind: 'caller_published' };
}

export function isSilentTicketCreation(value: unknown): value is SilentTicketCreation {
  return !!value && (value as SilentTicketCreation).__silentTicketCreation === true;
}

/** Publisher able to enqueue a status-changed event on the inbound outbox (in-transaction). */
interface OutboxTransitionPublisher {
  __inboundOutboxPublisher: true;
  publishTicketStatusChanged(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    previousStatusId: string;
    newStatusId: string;
    changedAt: string;
  }): Promise<void>;
}

function isOutboxTransitionPublisher(value: unknown): value is OutboxTransitionPublisher {
  return !!value && (value as { __inboundOutboxPublisher?: boolean }).__inboundOutboxPublisher === true;
}

export async function captureTicketTransitionSnapshot(
  conn: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string
): Promise<TicketTransitionSnapshot | null> {
  const row = await tenantDb(conn, tenant)
    .table('tickets')
    .select('ticket_id', 'status_id', 'priority_id', 'assigned_to', 'board_id', 'escalated')
    .where({ ticket_id: ticketId })
    .first();
  if (!row) return null;
  return {
    ticketId: row.ticket_id,
    statusId: row.status_id,
    priorityId: row.priority_id ?? null,
    assignedTo: row.assigned_to ?? null,
    boardId: row.board_id,
    escalated: row.escalated ?? null,
  };
}

export interface PublishTicketTransitionsParams {
  tenant: string;
  /** Snapshot taken before the write; null (ticket did not exist) publishes nothing. */
  before: TicketTransitionSnapshot | null;
  /** Snapshot after the write; reloaded from the transaction when omitted. */
  after?: TicketTransitionSnapshot;
  actorUserId?: string;
  /**
   * When provided and it is the inbound outbox publisher, the status event is
   * enqueued inside the transaction instead of published after commit.
   */
  publisher?: IEventPublisher;
  /** Workflow run correlation id (self-trigger guard). */
  correlationId?: string;
  /**
   * Restrict to these event types. For call sites that already publish part of
   * the transition set (e.g. TICKET_CLOSED / TICKET_REOPENED) and only need the
   * missing TICKET_STATUS_CHANGED.
   */
  only?: TicketTransitionWorkflowEvent['eventType'][];
  /**
   * Extra TICKET_STATUS_CHANGED payload fields, e.g. the notification
   * suppression flags of a silent API update. Not carried on the outbox path.
   */
  statusChangedPayloadExtras?: Record<string, unknown>;
}

/**
 * Builds the transition events between `before` and the current ticket row and
 * publishes them after the transaction commits (nothing is published when the
 * transaction rolls back). Returns the events that were scheduled.
 */
export async function publishTicketTransitionsAfterCommit(
  trx: Knex.Transaction,
  params: PublishTicketTransitionsParams
): Promise<TicketTransitionWorkflowEvent[]> {
  const { tenant, before } = params;
  if (!before) return [];
  const after = params.after ?? (await captureTicketTransitionSnapshot(trx, tenant, before.ticketId));
  if (!after) return [];

  const statusIds = Array.from(new Set([before.statusId, after.statusId].filter(Boolean)));
  const statusRows = statusIds.length
    ? await tenantDb(trx, tenant).table('statuses').select('status_id', 'is_closed').whereIn('status_id', statusIds)
    : [];
  const isClosed = (statusId: string) => !!statusRows.find((s: any) => s.status_id === statusId)?.is_closed;

  const occurredAt = new Date().toISOString();
  const allEvents = buildTicketTransitionEvents({
    before,
    after,
    ctx: {
      occurredAt,
      actorUserId: params.actorUserId,
      previousStatusIsClosed: isClosed(before.statusId),
      newStatusIsClosed: isClosed(after.statusId),
    },
  });
  const events = params.only ? allEvents.filter((e) => params.only!.includes(e.eventType)) : allEvents;
  if (events.length === 0) return events;

  if (isOutboxTransitionPublisher(params.publisher)) {
    const statusEvent = events.find((e) => e.eventType === 'TICKET_STATUS_CHANGED');
    if (statusEvent) {
      await params.publisher.publishTicketStatusChanged({
        tenantId: tenant,
        ticketId: after.ticketId,
        userId: params.actorUserId,
        previousStatusId: before.statusId,
        newStatusId: after.statusId,
        changedAt: occurredAt,
      });
    }
    return events;
  }

  const correlationId = params.correlationId;
  const actor = params.actorUserId
    ? ({ actorType: 'USER', actorUserId: params.actorUserId } as const)
    : ({ actorType: 'SYSTEM' } as const);

  registerAfterCommit(
    trx,
    async () => {
      const { publishWorkflowEvent } = await import('@alga-psa/event-bus/publishers');
      for (const ev of events) {
        await publishWorkflowEvent({
          eventType: ev.eventType as any,
          payload:
            ev.eventType === 'TICKET_STATUS_CHANGED' && params.statusChangedPayloadExtras
              ? { ...ev.payload, ...params.statusChangedPayloadExtras }
              : ev.payload,
          ctx: { tenantId: tenant, actor, occurredAt, ...(correlationId ? { correlationId } : {}) },
          eventName: ev.workflow?.eventName,
          fromState: ev.workflow?.fromState,
          toState: ev.workflow?.toState,
        });
      }
    },
    `ticket transitions ticket=${after.ticketId}`
  );
  return events;
}
