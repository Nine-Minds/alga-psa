/**
 * Pure payload builders for ServerEventPublisher (ticket events published from
 * TicketModel callers such as the client portal and Teams). The envelope
 * (tenantId, occurredAt, actor) is added by publishWorkflowEvent.
 *
 * `now` is injected so the builders stay deterministic.
 */

import type { WorkflowActor } from '@alga-psa/types';
import { builtWorkflowPayload, resolveTicketEventActor, ticketEventActorFields } from '@alga-psa/event-schemas';

export function buildServerPublisherTicketCreatedPayload(
  data: { ticketId: string; userId?: string; metadata?: Record<string, any> },
  now: string
) {
  return builtWorkflowPayload('TICKET_CREATED', {
    ticketId: data.ticketId,
    createdByUserId: data.userId,
    createdAt: now,
    ...data.metadata,
  });
}

export function buildServerPublisherTicketUpdatedPayload(data: {
  ticketId: string;
  userId?: string;
  changes: Record<string, any>;
  metadata?: Record<string, any>;
}) {
  return builtWorkflowPayload('TICKET_UPDATED', {
    ticketId: data.ticketId,
    updatedByUserId: data.userId,
    updatedFields: Object.keys(data.changes ?? {}),
    changes: data.changes,
    ...data.metadata,
  });
}

export function buildServerPublisherTicketClosedPayload(
  data: { ticketId: string; userId?: string; metadata?: Record<string, any> },
  now: string
) {
  return builtWorkflowPayload('TICKET_CLOSED', {
    ticketId: data.ticketId,
    closedByUserId: data.userId,
    closedAt: now,
    ...data.metadata,
  });
}

export function buildServerPublisherTicketAssignedPayload(
  data: { ticketId: string; userId: string; assignedByUserId?: string },
  now: string
) {
  return builtWorkflowPayload('TICKET_ASSIGNED', {
    ticketId: data.ticketId,
    // The recipient must ride in payload.userId — that is the single field the
    // internal-notification subscriber reads for the assignee (handleTicketAssigned
    // destructures event.payload.userId). Emitting only assignedToUserId (the v2
    // workflow field) loses the recipient through union validation, so the
    // notification is either created for the wrong user or stamped the subtype
    // default. Every other TICKET_ASSIGNED publisher carries userId; this one
    // must too.
    userId: data.userId,
    assignedToUserId: data.userId,
    assignedByUserId: data.assignedByUserId,
    assignedAt: now,
  });
}

/**
 * TICKET_COMMENT_ADDED (payload.TicketCommentAdded.v1). The legacy `comment` object feeds the
 * notification subscribers.
 */
export function buildServerPublisherTicketCommentAddedPayload(data: {
  ticketId: string;
  commentId: string;
  userId?: string;
  actor?: WorkflowActor;
  metadata?: Record<string, any>;
}) {
  return builtWorkflowPayload('TICKET_COMMENT_ADDED', {
    ticketId: data.ticketId,
    commentId: data.commentId,
    comment: { id: data.commentId },
    ...ticketEventActorFields(data.actor ?? resolveTicketEventActor({ userId: data.userId })),
    ...data.metadata,
  });
}
