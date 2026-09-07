import type { CollaborationActorReference } from '@alga-psa/event-schemas/collaboration';
import type { CommentAudience } from '@alga-psa/shared/lib/commentAudience';
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
  audience?: CommentAudience;
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
        audience?: CommentAudience;
        authorType: TicketMessageAuthorType;
        channel: TicketMessageChannel;
        createdAt?: string;
        attachmentsCount?: number;
      };
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
      };
    }
  | {
      eventType: 'TICKET_INTERNAL_NOTE_ADDED';
      payload: {
        ticketId: string;
        noteId: string;
        audience?: CommentAudience;
        createdAt?: string;
      };
    };

export function buildTicketCommunicationWorkflowEvents(
  input: TicketCommunicationMessageInput
): TicketCommunicationWorkflowEvent[] {
  const events: TicketCommunicationWorkflowEvent[] = [];
  const createdAt = normalizeOptionalTimestamp(input.createdAt);

  events.push({
    eventType: 'TICKET_MESSAGE_ADDED',
    payload: {
      ticketId: input.ticketId,
      messageId: input.messageId,
      visibility: input.visibility,
      ...(input.author.authorType === 'collaborator' ? { authorReference: { ...input.author.authorReference } } : { authorId: input.author.authorId }),
      ...(input.audience ? { audience: input.audience } : {}),
      authorType: input.author.authorType,
      channel: input.channel,
      createdAt,
      attachmentsCount: input.attachmentsCount,
    },
  });

  if (input.visibility === 'internal') {
    events.push({
      eventType: 'TICKET_INTERNAL_NOTE_ADDED',
      payload: {
        ticketId: input.ticketId,
        noteId: input.messageId,
        ...(input.audience ? { audience: input.audience } : {}),
        createdAt,
      },
    });
  }

  if (input.visibility === 'public' && input.author.authorType === 'contact') {
    events.push({
      eventType: 'TICKET_CUSTOMER_REPLIED',
      payload: {
        ticketId: input.ticketId,
        messageId: input.messageId,
        contactId: input.author.contactId,
        channel: input.channel,
        receivedAt: createdAt,
        attachmentsCount: input.attachmentsCount,
      },
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
