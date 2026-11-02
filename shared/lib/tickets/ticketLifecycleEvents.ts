import type { Knex } from 'knex';
import { registerAfterCommit, tenantDb } from '@alga-psa/db';
import type { IEventPublisher, WorkflowActor } from '@alga-psa/types';
import type { WorkflowEventPublishContext } from '@alga-psa/event-bus/publishers';
import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';

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
  /** Extra TICKET_STATUS_CHANGED payload fields. */
  statusChangedPayloadExtras?: Record<string, unknown>;
  actorUserId?: string;
  previousStatusIsClosed?: boolean;
  newStatusIsClosed?: boolean;
};

type TicketTransitionWorkflowMeta = {
  workflow?: {
    eventName?: string;
    fromState?: string;
    toState?: string;
  };
};

type TicketTransitionEventType =
  | 'TICKET_STATUS_CHANGED'
  | 'TICKET_PRIORITY_CHANGED'
  | 'TICKET_UNASSIGNED'
  | 'TICKET_REOPENED'
  | 'TICKET_ESCALATED'
  | 'TICKET_QUEUE_CHANGED';

/** Discriminated by `eventType`: each payload is branded for exactly its own event. */
export type TicketTransitionWorkflowEvent = {
  [T in TicketTransitionEventType]: {
    eventType: T;
    payload: Record<string, unknown> & BuiltWorkflowPayload<T>;
  } & TicketTransitionWorkflowMeta;
}[TicketTransitionEventType];

/**
 * Publish one transition event. A switch (one case per event) because a union of branded events
 * cannot be passed through a single generic `publishWorkflowEvent` call without losing the brand.
 */
export async function publishTicketTransitionWorkflowEvent(
  ev: TicketTransitionWorkflowEvent,
  ctx: WorkflowEventPublishContext
): Promise<void> {
  const { publishWorkflowEvent } = await import('@alga-psa/event-bus/publishers');
  const meta = {
    ctx,
    eventName: ev.workflow?.eventName,
    fromState: ev.workflow?.fromState,
    toState: ev.workflow?.toState,
  };
  // LEVERAGE: friction brand-union-dispatch — publishing a union of branded events needs a per-member switch.
  switch (ev.eventType) {
    case 'TICKET_STATUS_CHANGED':
      return publishWorkflowEvent({ eventType: ev.eventType, payload: ev.payload, ...meta });
    case 'TICKET_PRIORITY_CHANGED':
      return publishWorkflowEvent({ eventType: ev.eventType, payload: ev.payload, ...meta });
    case 'TICKET_UNASSIGNED':
      return publishWorkflowEvent({ eventType: ev.eventType, payload: ev.payload, ...meta });
    case 'TICKET_REOPENED':
      return publishWorkflowEvent({ eventType: ev.eventType, payload: ev.payload, ...meta });
    case 'TICKET_ESCALATED':
      return publishWorkflowEvent({ eventType: ev.eventType, payload: ev.payload, ...meta });
    case 'TICKET_QUEUE_CHANGED':
      return publishWorkflowEvent({ eventType: ev.eventType, payload: ev.payload, ...meta });
  }
}

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
  /** Extra fields (e.g. notification suppression flags of a silent API update); win over the base fields. */
  extras?: Record<string, unknown>;
}) {
  return builtWorkflowPayload('TICKET_STATUS_CHANGED', {
    ticketId: input.ticketId,
    previousStatusId: input.previousStatusId,
    newStatusId: input.newStatusId,
    changedAt: input.changedAt,
    ...input.extras,
  });
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
        extras: ctx.statusChangedPayloadExtras,
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
      payload: builtWorkflowPayload('TICKET_PRIORITY_CHANGED', {
        ticketId: after.ticketId,
        previousPriorityId: before.priorityId,
        newPriorityId: after.priorityId,
        changedAt: occurredAt,
      }),
      workflow: {
        eventName: 'Ticket Priority Changed',
      },
    });
  }

  if (previousAssignedTo !== newAssignedTo) {
    if (!newAssignedTo && previousAssignedTo) {
      events.push({
        eventType: 'TICKET_UNASSIGNED',
        payload: builtWorkflowPayload('TICKET_UNASSIGNED', {
          ticketId: after.ticketId,
          previousAssigneeId: previousAssignedTo,
          previousAssigneeType: 'user',
          unassignedAt: occurredAt,
        }),
        workflow: {
          eventName: 'Ticket Unassigned',
        },
      });
    }
  }

  if (before.boardId !== after.boardId) {
    events.push({
      eventType: 'TICKET_QUEUE_CHANGED',
      payload: builtWorkflowPayload('TICKET_QUEUE_CHANGED', {
        ticketId: after.ticketId,
        previousBoardId: before.boardId,
        newBoardId: after.boardId,
        changedAt: occurredAt,
      }),
      workflow: {
        eventName: 'Ticket Queue Changed',
      },
    });
  }

  if (ctx.previousStatusIsClosed && !ctx.newStatusIsClosed && before.statusId !== after.statusId) {
    events.push({
      eventType: 'TICKET_REOPENED',
      payload: builtWorkflowPayload('TICKET_REOPENED', {
        ticketId: after.ticketId,
        previousStatusId: before.statusId,
        newStatusId: after.statusId,
        reopenedAt: occurredAt,
      }),
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
      payload: builtWorkflowPayload('TICKET_ESCALATED', {
        ticketId: after.ticketId,
        fromQueueId: before.boardId,
        toQueueId: after.boardId,
        escalatedAt: occurredAt,
      }),
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
  /**
   * Explicit actor for TICKET_CREATED when it is not derivable from the `userId`
   * argument (e.g. a CONTACT for inbound email). Forwarded to `publishTicketCreated`.
   */
  readonly actor?: WorkflowActor;
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

/**
 * Publish TICKET_CREATED through `publisher` with an explicit actor, e.g. the matched
 * contact of an inbound email that has no user account.
 */
export function ticketCreationWithActor(
  publisher: IEventPublisher,
  actor: WorkflowActor,
  reason: string
): TicketCreationWithPayloadExtras {
  if (!reason || !reason.trim()) {
    throw new Error('ticketCreationWithActor requires a reason');
  }
  if (!publisher) {
    throw new Error('ticketCreationWithActor requires a publisher');
  }
  return { __ticketCreationWithPayloadExtras: true, reason, publisher, payloadExtras: {}, actor };
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
   * The publication actor when it is not the user named by actorUserId: a
   * co-managed collaborator acting on this ticket. actorUserId stays empty then,
   * so no payload names a local user who did not act.
   */
  actor?: WorkflowEventPublishContext['actor'];
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
      statusChangedPayloadExtras: params.statusChangedPayloadExtras,
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
  const actor: WorkflowEventPublishContext['actor'] = params.actor ?? (params.actorUserId
    ? ({ actorType: 'USER', actorUserId: params.actorUserId } as const)
    : ({ actorType: 'SYSTEM' } as const));

  registerAfterCommit(
    trx,
    async () => {
      const eventCtx = { tenantId: tenant, actor, occurredAt, ...(correlationId ? { correlationId } : {}) };
      for (const ev of events) {
        await publishTicketTransitionWorkflowEvent(ev, eventCtx);
      }
    },
    `ticket transitions ticket=${after.ticketId}`
  );
  return events;
}
