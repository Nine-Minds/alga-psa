type TicketMessageChannel = 'email' | 'portal' | 'ui' | 'api';
type TicketMessageVisibility = 'public' | 'internal';
type TicketMessageAuthorType = 'user' | 'contact';

export type TicketCommunicationAuthor =
  | { authorType: 'user'; authorId: string }
  | { authorType: 'contact'; authorId: string; contactId: string };

export type TicketCommunicationMessageInput = {
  ticketId: string;
  messageId: string;
  visibility: TicketMessageVisibility;
  author: TicketCommunicationAuthor;
  channel: TicketMessageChannel;
  createdAt?: string;
  attachmentsCount?: number;
};

export type TicketCommunicationWorkflowEvent =
  | {
      eventType: 'TICKET_MESSAGE_ADDED';
      payload: {
        ticketId: string;
        messageId: string;
        visibility: TicketMessageVisibility;
        authorId: string;
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
        createdAt?: string;
      };
    };

export function buildTicketCommunicationWorkflowEvents(
  input: TicketCommunicationMessageInput
): TicketCommunicationWorkflowEvent[] {
  const events: TicketCommunicationWorkflowEvent[] = [];

  events.push({
    eventType: 'TICKET_MESSAGE_ADDED',
    payload: {
      ticketId: input.ticketId,
      messageId: input.messageId,
      visibility: input.visibility,
      authorId: input.author.authorId,
      authorType: input.author.authorType,
      channel: input.channel,
      createdAt: input.createdAt,
      attachmentsCount: input.attachmentsCount,
    },
  });

  if (input.visibility === 'internal') {
    events.push({
      eventType: 'TICKET_INTERNAL_NOTE_ADDED',
      payload: {
        ticketId: input.ticketId,
        noteId: input.messageId,
        createdAt: input.createdAt,
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
        receivedAt: input.createdAt,
        attachmentsCount: input.attachmentsCount,
      },
    });
  }

  return events;
}

