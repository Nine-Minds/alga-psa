import { publishWorkflowEvent, type WorkflowEventPublishContext } from '@alga-psa/event-bus/publishers';
import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';
import type { CollaborationActorReference } from '@alga-psa/event-schemas/collaboration';

/** Who may read a co-managed message; absent for native (non-collaboration) messages. */
type TicketMessageAudience = 'requester' | 'shared_it' | 'organization_private';
type TicketMessageChannel = 'email' | 'portal' | 'ui' | 'api';
type TicketMessageVisibility = 'public' | 'internal';
type TicketMessageAuthorType = 'user' | 'contact' | 'collaborator';

export type TicketCommunicationAuthor =
  | { authorType: 'user'; authorId: string }
  | { authorType: 'contact'; authorId: string; contactId: string }
  | { authorType: 'collaborator'; authorReference: CollaborationActorReference };

export type TicketCommunicationMessageInput = {
  ticketId: string;
  messageId: string;
  visibility: TicketMessageVisibility;
  audience?: TicketMessageAudience;
  author: TicketCommunicationAuthor;
  channel: TicketMessageChannel;
  createdAt?: string | Date;
  attachmentsCount?: number;
};

export type TicketCommunicationWorkflowEvent =
  | {
      eventType: 'TICKET_MESSAGE_ADDED';
      payload: {
        ticketId: string;
        messageId: string;
        visibility: TicketMessageVisibility;
        authorId?: string;
        authorReference?: CollaborationActorReference;
        audience?: TicketMessageAudience;
        authorType: TicketMessageAuthorType;
        channel: TicketMessageChannel;
        createdAt?: string;
        attachmentsCount?: number;
      } & BuiltWorkflowPayload<'TICKET_MESSAGE_ADDED'>;
    }
  | {
      eventType: 'TICKET_CUSTOMER_REPLIED';
      payload: {
        ticketId: string;
        messageId: string;
        contactId: string;
        channel: TicketMessageChannel;
        receivedAt?: string;
        attachmentsCount?: number;
      } & BuiltWorkflowPayload<'TICKET_CUSTOMER_REPLIED'>;
    }
  | {
      eventType: 'TICKET_INTERNAL_NOTE_ADDED';
      payload: {
        ticketId: string;
        noteId: string;
        audience?: TicketMessageAudience;
        createdAt?: string;
      } & BuiltWorkflowPayload<'TICKET_INTERNAL_NOTE_ADDED'>;
    };

export function buildTicketCommunicationWorkflowEvents(
  input: TicketCommunicationMessageInput
): TicketCommunicationWorkflowEvent[] {
  const events: TicketCommunicationWorkflowEvent[] = [];
  const createdAt = normalizeOptionalTimestamp(input.createdAt);

  events.push({
    eventType: 'TICKET_MESSAGE_ADDED',
    payload: builtWorkflowPayload('TICKET_MESSAGE_ADDED', {
      ticketId: input.ticketId,
      messageId: input.messageId,
      visibility: input.visibility,
      ...(input.author.authorType === 'collaborator' ? { authorReference: { ...input.author.authorReference } } : { authorId: input.author.authorId }),
      ...(input.audience ? { audience: input.audience } : {}),
      authorType: input.author.authorType,
      channel: input.channel,
      createdAt,
      attachmentsCount: input.attachmentsCount,
    }),
  });

  if (input.visibility === 'internal') {
    events.push({
      eventType: 'TICKET_INTERNAL_NOTE_ADDED',
      payload: builtWorkflowPayload('TICKET_INTERNAL_NOTE_ADDED', {
        ticketId: input.ticketId,
        noteId: input.messageId,
        ...(input.audience ? { audience: input.audience } : {}),
        createdAt,
      }),
    });
  }

  if (input.visibility === 'public' && input.author.authorType === 'contact') {
    events.push({
      eventType: 'TICKET_CUSTOMER_REPLIED',
      payload: builtWorkflowPayload('TICKET_CUSTOMER_REPLIED', {
        ticketId: input.ticketId,
        messageId: input.messageId,
        contactId: input.author.contactId,
        channel: input.channel,
        receivedAt: createdAt,
        attachmentsCount: input.attachmentsCount,
      }),
    });
  }

  return events;
}

function normalizeOptionalTimestamp(value?: string | Date): string | undefined {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : value;
}

/** Publish one communication event (one case per event so each payload keeps its brand). */
export function publishTicketCommunicationWorkflowEvent(
  event: TicketCommunicationWorkflowEvent,
  ctx: WorkflowEventPublishContext
): Promise<void> {
  switch (event.eventType) {
    case 'TICKET_MESSAGE_ADDED':
      return publishWorkflowEvent({ eventType: event.eventType, payload: event.payload, ctx });
    case 'TICKET_CUSTOMER_REPLIED':
      return publishWorkflowEvent({ eventType: event.eventType, payload: event.payload, ctx });
    case 'TICKET_INTERNAL_NOTE_ADDED':
      return publishWorkflowEvent({ eventType: event.eventType, payload: event.payload, ctx });
  }
}
