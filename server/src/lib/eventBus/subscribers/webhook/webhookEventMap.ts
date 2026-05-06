import type { EventType } from '@alga-psa/event-schemas';

export type TicketWebhookPublicEvent =
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.status_changed'
  | 'ticket.assigned'
  | 'ticket.closed'
  | 'ticket.comment.added';

export type TicketWebhookInternalEvent =
  | 'TICKET_CREATED'
  | 'TICKET_UPDATED'
  | 'TICKET_STATUS_CHANGED'
  | 'TICKET_ASSIGNED'
  | 'TICKET_CLOSED'
  | 'TICKET_COMMENT_ADDED';

export const TICKET_INTERNAL_TO_PUBLIC = {
  TICKET_CREATED: ['ticket.created'],
  TICKET_UPDATED: ['ticket.updated'],
  TICKET_STATUS_CHANGED: ['ticket.status_changed'],
  TICKET_ASSIGNED: ['ticket.assigned'],
  TICKET_CLOSED: ['ticket.closed'],
  TICKET_COMMENT_ADDED: ['ticket.comment.added'],
} as const satisfies Partial<Record<EventType, readonly TicketWebhookPublicEvent[]>>;

export function publicEventsFor(eventType: EventType | string): TicketWebhookPublicEvent[] {
  const mapped = TICKET_INTERNAL_TO_PUBLIC[eventType as TicketWebhookInternalEvent];
  return mapped ? [...mapped] : [];
}

