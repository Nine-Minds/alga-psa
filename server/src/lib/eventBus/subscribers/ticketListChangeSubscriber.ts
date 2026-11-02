import { publishTicketListActivity } from '@alga-psa/tickets/lib/liveUpdates';
import { getEventBus } from '../index';

const EVENT_TYPES = [
  'TICKET_CREATED', 'TICKET_UPDATED', 'TICKET_STATUS_CHANGED', 'TICKET_ASSIGNED',
  'TICKET_CLOSED', 'TICKET_REOPENED', 'TICKET_PRIORITY_CHANGED', 'TICKET_TAGS_CHANGED',
  'TICKET_UNASSIGNED', 'TICKET_ADDITIONAL_AGENT_ASSIGNED', 'TICKET_COMMENT_ADDED', 'TICKET_COMMENT_UPDATED',
  'TICKET_RESPONSE_STATE_CHANGED', 'INBOUND_EMAIL_REPLY_RECEIVED',
] as const;

let registered = false;

export async function registerTicketListChangeSubscriber(): Promise<void> {
  if (registered) return;
  for (const eventType of EVENT_TYPES) {
    await getEventBus().subscribe(eventType, handleTicketListChange, { subscriberId: 'ticket-list-live-changes' });
  }
  registered = true;
}

export async function unregisterTicketListChangeSubscriber(): Promise<void> {
  if (!registered) return;
  for (const eventType of EVENT_TYPES) await getEventBus().unsubscribe(eventType, handleTicketListChange);
  registered = false;
}

export async function handleTicketListChange(value: unknown): Promise<void> {
  if (!value || typeof value !== 'object') return;
  const event = value as {
    eventType?: string; timestamp?: string;
    payload?: { tenantId?: string; ticketId?: string; boardId?: string | null; userId?: string | null; actorUserId?: string | null; actor?: { actorUserId?: string | null; userId?: string | null }; assignedByUserId?: string | null; closedByUserId?: string | null; updatedByUserId?: string | null; createdByUserId?: string | null; occurredAt?: string; changes?: unknown };
  };
  const payload = event.payload;
  if (!payload?.tenantId || !payload.ticketId) return;
  const updatedAt = typeof event.timestamp === 'string' ? event.timestamp : payload.occurredAt ?? new Date().toISOString();
  const changedFields = payload.changes && typeof payload.changes === 'object'
    ? Object.keys(payload.changes as Record<string, unknown>)
    : event.eventType === 'TICKET_COMMENT_ADDED' || event.eventType === 'TICKET_COMMENT_UPDATED' ? ['comments']
      : event.eventType === 'INBOUND_EMAIL_REPLY_RECEIVED' ? ['email']
        : event.eventType === 'TICKET_STATUS_CHANGED' || event.eventType === 'TICKET_CLOSED' || event.eventType === 'TICKET_REOPENED' ? ['status_id']
          : event.eventType === 'TICKET_PRIORITY_CHANGED' ? ['priority_id']
            : event.eventType === 'TICKET_TAGS_CHANGED' ? ['tags']
              : event.eventType === 'TICKET_ASSIGNED' || event.eventType === 'TICKET_UNASSIGNED' ? ['assigned_to', 'assigned_team_id']
                : event.eventType === 'TICKET_ADDITIONAL_AGENT_ASSIGNED' ? ['additional_assignees'] : [];
  await publishTicketListActivity({
    tenantId: payload.tenantId,
    ticketId: payload.ticketId,
    changeKind: event.eventType === 'TICKET_CREATED' ? 'created' : 'updated',
    boardId: payload.boardId ?? null,
    changedFields,
    actorUserId: payload.actorUserId ?? payload.actor?.actorUserId ?? payload.actor?.userId ??
      payload.assignedByUserId ?? payload.closedByUserId ?? payload.updatedByUserId ?? payload.createdByUserId ??
      (event.eventType === 'TICKET_ASSIGNED' || event.eventType === 'TICKET_ADDITIONAL_AGENT_ASSIGNED' ? null : payload.userId ?? null),
    updatedAt,
  });
}
