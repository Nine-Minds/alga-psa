import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '@shared/workflow/streams/workflowEventPublishHelpers';
import {
  ticketCustomerRepliedEventPayloadSchema,
  ticketInternalNoteAddedEventPayloadSchema,
  ticketMessageAddedEventPayloadSchema,
} from '@shared/workflow/runtime/schemas/ticketEventSchemas';
import { buildTicketCommunicationWorkflowEvents } from '../workflowTicketCommunicationEvents';

const TENANT_ID = '00000000-0000-0000-0000-000000000000';
const TICKET_ID = '11111111-1111-1111-1111-111111111111';
const MESSAGE_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const CONTACT_ID = '44444444-4444-4444-4444-444444444444';

describe('buildTicketCommunicationWorkflowEvents', () => {
  it('emits message + internal note for internal visibility', () => {
    const createdAt = '2026-01-23T12:00:00.000Z';
    const events = buildTicketCommunicationWorkflowEvents({
      ticketId: TICKET_ID,
      messageId: MESSAGE_ID,
      visibility: 'internal',
      author: { authorType: 'user', authorId: USER_ID },
      channel: 'ui',
      createdAt,
    });

    expect(events.map((e) => e.eventType)).toEqual(['TICKET_MESSAGE_ADDED', 'TICKET_INTERNAL_NOTE_ADDED']);

    const ctx = {
      tenantId: TENANT_ID,
      occurredAt: createdAt,
      actor: { actorType: 'USER' as const, actorUserId: USER_ID },
    };

    const message = events[0];
    expect(message?.payload).toMatchObject({
      ticketId: TICKET_ID,
      messageId: MESSAGE_ID,
      visibility: 'internal',
      authorId: USER_ID,
      authorType: 'user',
      channel: 'ui',
      createdAt,
    });
    ticketMessageAddedEventPayloadSchema.parse(buildWorkflowPayload(message!.payload as any, ctx));

    const internalNote = events[1];
    expect(internalNote?.payload).toMatchObject({ ticketId: TICKET_ID, noteId: MESSAGE_ID, createdAt });
    ticketInternalNoteAddedEventPayloadSchema.parse(buildWorkflowPayload(internalNote!.payload as any, ctx));
  });

  it('emits customer replied for public messages authored by contacts', () => {
    const createdAt = '2026-01-23T12:00:00.000Z';
    const events = buildTicketCommunicationWorkflowEvents({
      ticketId: TICKET_ID,
      messageId: MESSAGE_ID,
      visibility: 'public',
      author: { authorType: 'contact', authorId: CONTACT_ID, contactId: CONTACT_ID },
      channel: 'portal',
      createdAt,
    });

    expect(events.map((e) => e.eventType)).toEqual(['TICKET_MESSAGE_ADDED', 'TICKET_CUSTOMER_REPLIED']);

    const ctx = {
      tenantId: TENANT_ID,
      occurredAt: createdAt,
      actor: { actorType: 'CONTACT' as const, actorContactId: CONTACT_ID },
    };

    const message = events[0];
    ticketMessageAddedEventPayloadSchema.parse(buildWorkflowPayload(message!.payload as any, ctx));

    const customerReplied = events[1];
    expect(customerReplied?.payload).toMatchObject({
      ticketId: TICKET_ID,
      messageId: MESSAGE_ID,
      contactId: CONTACT_ID,
      channel: 'portal',
      receivedAt: createdAt,
    });
    ticketCustomerRepliedEventPayloadSchema.parse(buildWorkflowPayload(customerReplied!.payload as any, ctx));
  });

  it('does not emit customer replied when contactId is unavailable', () => {
    const events = buildTicketCommunicationWorkflowEvents({
      ticketId: TICKET_ID,
      messageId: MESSAGE_ID,
      visibility: 'public',
      author: { authorType: 'user', authorId: USER_ID },
      channel: 'portal',
    });

    expect(events.map((e) => e.eventType)).toEqual(['TICKET_MESSAGE_ADDED']);
  });
});

