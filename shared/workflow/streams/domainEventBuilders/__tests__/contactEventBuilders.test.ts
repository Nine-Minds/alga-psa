import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers';
import {
  contactArchivedEventPayloadSchema,
  contactCreatedEventPayloadSchema,
  contactMergedEventPayloadSchema,
  contactPrimarySetEventPayloadSchema,
  contactUpdatedEventPayloadSchema,
} from '../../../runtime/schemas/crmEventSchemas';
import {
  buildContactArchivedPayload,
  buildContactCreatedPayload,
  buildContactMergedPayload,
  buildContactPrimarySetPayload,
  buildContactUpdatedPayload,
} from '../contactEventBuilders';

describe('contactEventBuilders', () => {
  const tenantId = '7e8a6f60-7a47-4f20-b2ac-5b77a3b5c9fd';
  const actorUserId = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';
  const clientId = 'b3d1b8a8-3ed2-4c5e-8b0f-5d1d646bf2e2';
  const contactId = 'b2d0f51b-1d66-49c8-ae6f-d0a96d6e6ed1';
  const occurredAt = '2026-01-23T12:00:00.000Z';

  const ctx = {
    tenantId,
    occurredAt,
    actor: { actorType: 'USER' as const, actorUserId },
  };

  it('builds CONTACT_CREATED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildContactCreatedPayload({
        contactId,
        clientId,
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        phoneNumber: '555-0100',
        createdByUserId: actorUserId,
        createdAt: occurredAt,
      }),
      ctx
    );

    expect(contactCreatedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds CONTACT_UPDATED payloads with field/path diffs compatible with schema', () => {
    const before = {
      contact_name_id: contactId,
      client_id: clientId,
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      phone_number: '555-0100',
      role: 'billing',
      is_inactive: false,
    };
    const after = {
      contact_name_id: contactId,
      client_id: clientId,
      full_name: 'Jane Q. Doe',
      email: 'jane@example.com',
      phone_number: '555-0101',
      role: 'billing',
      is_inactive: false,
    };

    const payload = buildWorkflowPayload(
      buildContactUpdatedPayload({
        contactId,
        clientId,
        before,
        after,
        updatedFieldKeys: ['full_name', 'phone_number'],
        updatedByUserId: actorUserId,
        updatedAt: occurredAt,
      }),
      ctx
    );

    expect(contactUpdatedEventPayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.updatedFields).toEqual(expect.arrayContaining(['fullName', 'phoneNumber']));
    expect(payload.changes).toMatchObject({
      fullName: { previous: 'Jane Doe', new: 'Jane Q. Doe' },
      phoneNumber: { previous: '555-0100', new: '555-0101' },
    });
  });

  it('builds CONTACT_PRIMARY_SET payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildContactPrimarySetPayload({
        clientId,
        contactId,
        previousPrimaryContactId: '7db299e0-56c5-4b31-9db7-3c98649d7292',
        setByUserId: actorUserId,
        setAt: occurredAt,
      }),
      ctx
    );

    expect(contactPrimarySetEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds CONTACT_ARCHIVED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildContactArchivedPayload({
        contactId,
        clientId,
        archivedByUserId: actorUserId,
        archivedAt: occurredAt,
        reason: 'duplicate',
      }),
      ctx
    );

    expect(contactArchivedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('builds CONTACT_MERGED payloads compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildContactMergedPayload({
        sourceContactId: contactId,
        targetContactId: 'd97b9c79-2c78-49d0-a10f-0f1216b815c0',
        mergedByUserId: actorUserId,
        mergedAt: occurredAt,
        strategy: 'manual',
      }),
      ctx
    );

    expect(contactMergedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

