import type { Event } from '@alga-psa/event-bus/events';

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

export function buildTicketTransitionWorkflowEvents(params: {
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
      payload: {
        ticketId: after.ticketId,
        previousStatusId: before.statusId,
        newStatusId: after.statusId,
        changedAt: occurredAt,
      },
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

  return events as TicketTransitionWorkflowEvent[] satisfies Array<{
    eventType: Event['eventType'];
    payload: Record<string, unknown>;
  }>;
}
