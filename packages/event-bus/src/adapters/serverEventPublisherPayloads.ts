/**
 * Pure payload builders for ServerEventPublisher (ticket events published from
 * TicketModel callers such as the client portal and Teams). The envelope
 * (tenantId, occurredAt, actor) is added by publishWorkflowEvent.
 *
 * `now` is injected so the builders stay deterministic.
 */

export function buildServerPublisherTicketCreatedPayload(
  data: { ticketId: string; userId?: string; metadata?: Record<string, any> },
  now: string
) {
  return {
    ticketId: data.ticketId,
    createdByUserId: data.userId,
    createdAt: now,
    ...data.metadata,
  };
}

export function buildServerPublisherTicketUpdatedPayload(data: {
  ticketId: string;
  userId?: string;
  changes: Record<string, any>;
  metadata?: Record<string, any>;
}) {
  return {
    ticketId: data.ticketId,
    updatedByUserId: data.userId,
    updatedFields: Object.keys(data.changes ?? {}),
    changes: data.changes,
    ...data.metadata,
  };
}

export function buildServerPublisherTicketClosedPayload(
  data: { ticketId: string; userId?: string; metadata?: Record<string, any> },
  now: string
) {
  return {
    ticketId: data.ticketId,
    closedByUserId: data.userId,
    closedAt: now,
    ...data.metadata,
  };
}

export function buildServerPublisherTicketAssignedPayload(
  data: { ticketId: string; userId: string; assignedByUserId?: string },
  now: string
) {
  return {
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
  };
}
