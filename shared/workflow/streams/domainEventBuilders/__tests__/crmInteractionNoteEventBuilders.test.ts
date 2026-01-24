import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import { interactionLoggedEventPayloadSchema, noteCreatedEventPayloadSchema } from '../../../runtime/schemas/crmEventSchemas';
import {
  buildInteractionLoggedPayload,
  buildNoteCreatedPayload,
  deriveInteractionChannel,
} from '../crmInteractionNoteEventBuilders';

describe('crmInteractionNoteEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const actorUserId = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';
  const occurredAt = '2026-01-23T12:00:00.000Z';
  const ctx = {
    tenantId,
    occurredAt,
    actor: { actorType: 'USER' as const, actorUserId },
  };

  it('builds INTERACTION_LOGGED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildInteractionLoggedPayload({
        interactionId: 'b2b1b726-6fb1-4b85-a0c3-0b9f42b80d5a',
        clientId: 'b3d1b8a8-3ed2-4c5e-8b0f-5d1d646bf2e2',
        contactId: 'e7cc2264-6c56-44bd-a3c1-6b20c22cce32',
        interactionType: 'Email',
        interactionOccurredAt: occurredAt,
        loggedByUserId: actorUserId,
        subject: 'Follow-up',
        outcome: 'Completed',
      }),
      ctx
    );

    expect(interactionLoggedEventPayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.channel).toBe('email');
  });

  it('derives interaction channels for common system types', () => {
    expect(deriveInteractionChannel('Call')).toBe('phone');
    expect(deriveInteractionChannel('Email')).toBe('email');
    expect(deriveInteractionChannel('Meeting')).toBe('meeting');
    expect(deriveInteractionChannel('Note')).toBe('note');
    expect(deriveInteractionChannel('On-site Visit')).toBe('other');
  });

  it('builds NOTE_CREATED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildNoteCreatedPayload({
        noteId: '4f52ed1a-80c9-4c5b-9f3f-b2b1c2f56f1c',
        entityType: 'client',
        entityId: 'b3d1b8a8-3ed2-4c5e-8b0f-5d1d646bf2e2',
        createdByUserId: actorUserId,
        createdAt: occurredAt,
        visibility: 'internal',
        bodyPreview: { blocks: [{ type: 'paragraph', content: 'hello world' }] },
      }),
      ctx
    );

    expect(noteCreatedEventPayloadSchema.safeParse(payload).success).toBe(true);
    expect(typeof payload.bodyPreview).toBe('string');
    expect((payload.bodyPreview as string).length).toBeGreaterThan(0);
  });
});

