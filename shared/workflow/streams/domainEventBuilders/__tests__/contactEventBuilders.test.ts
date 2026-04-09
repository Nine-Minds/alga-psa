import { describe, expect, it } from 'vitest';
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

function buildWorkflowPayload<TPayload extends Record<string, unknown>>(
  payload: TPayload,
  ctx: {
    tenantId: string;
    occurredAt?: string | Date;
    actor?: { actorType: 'USER'; actorUserId: string };
    idempotencyKey?: string;
  }
): TPayload & {
  tenantId: string;
  occurredAt: string;
  actorType?: 'USER';
  actorUserId?: string;
  idempotencyKey?: string;
} {
  const occurredAt = typeof ctx.occurredAt === 'string'
    ? ctx.occurredAt
    : ctx.occurredAt?.toISOString() ?? new Date().toISOString();

  return {
    ...payload,
    tenantId: ctx.tenantId,
    occurredAt,
    ...(ctx.actor ? { actorType: 'USER' as const, actorUserId: ctx.actor.actorUserId } : {}),
    ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}),
  };
}

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

  it('T017: builds CONTACT_CREATED payloads with email metadata compatible with schema', () => {
    const payload = buildWorkflowPayload(
      buildContactCreatedPayload({
        contactId,
        clientId,
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        primaryEmailCanonicalType: 'billing',
        primaryEmailType: 'billing',
        additionalEmailAddresses: [{
          contact_additional_email_address_id: '1f88c32b-e780-4036-a9bc-0a7b16535e4a',
          email_address: 'jane.billing@example.com',
          normalized_email_address: 'jane.billing@example.com',
          canonical_type: 'billing',
          custom_type: null,
          display_order: 0,
        }],
        phoneNumbers: [{
          contact_phone_number_id: '6e2d2752-4be9-4313-971f-e1576fdd0119',
          phone_number: '555-0100',
          normalized_phone_number: '5550100',
          canonical_type: 'work',
          custom_type: null,
          is_default: true,
          display_order: 0,
        }],
        defaultPhoneNumber: '555-0100',
        defaultPhoneType: 'work',
        createdByUserId: actorUserId,
        createdAt: occurredAt,
      }),
      ctx
    );

    expect(contactCreatedEventPayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({
      primaryEmailCanonicalType: 'billing',
      primaryEmailType: 'billing',
      additionalEmailAddresses: [
        expect.objectContaining({
          email_address: 'jane.billing@example.com',
        }),
      ],
    });
  });

  it('T017: builds CONTACT_UPDATED payloads with email metadata diffs compatible with schema', () => {
    const before = {
      contact_name_id: contactId,
      client_id: clientId,
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      primary_email_canonical_type: 'work',
      primary_email_custom_type_id: null,
      primary_email_type: 'work',
      additional_email_addresses: [],
      phone_numbers: [{
        contact_phone_number_id: '6e2d2752-4be9-4313-971f-e1576fdd0119',
        phone_number: '555-0100',
        normalized_phone_number: '5550100',
        canonical_type: 'work',
        custom_type: null,
        is_default: true,
        display_order: 0,
      }],
      role: 'billing',
      is_inactive: false,
    };
    const after = {
      contact_name_id: contactId,
      client_id: clientId,
      full_name: 'Jane Q. Doe',
      email: 'jane@example.com',
      primary_email_canonical_type: null,
      primary_email_custom_type_id: 'c17bc1e3-cbdc-424f-aab9-0da9303cd8b6',
      primary_email_type: 'Escalations',
      additional_email_addresses: [{
        contact_additional_email_address_id: '1f88c32b-e780-4036-a9bc-0a7b16535e4a',
        email_address: 'jane.old@example.com',
        normalized_email_address: 'jane.old@example.com',
        canonical_type: 'work',
        custom_type: null,
        display_order: 0,
      }],
      phone_numbers: [{
        contact_phone_number_id: '6e2d2752-4be9-4313-971f-e1576fdd0119',
        phone_number: '555-0101',
        normalized_phone_number: '5550101',
        canonical_type: 'work',
        custom_type: null,
        is_default: true,
        display_order: 0,
      }],
      role: 'billing',
      is_inactive: false,
    };

    const payload = buildWorkflowPayload(
      buildContactUpdatedPayload({
        contactId,
        clientId,
        before,
        after,
        updatedFieldKeys: ['full_name', 'phone_numbers', 'primary_email_custom_type', 'additional_email_addresses'],
        updatedByUserId: actorUserId,
        updatedAt: occurredAt,
      }),
      ctx
    );

    expect(contactUpdatedEventPayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.updatedFields).toEqual(expect.arrayContaining(['fullName', 'phoneNumbers', 'primaryEmailType', 'primaryEmailCustomTypeId', 'additionalEmailAddresses']));
    expect(payload.changes).toMatchObject({
      fullName: { previous: 'Jane Doe', new: 'Jane Q. Doe' },
      primaryEmailType: { previous: 'work', new: 'Escalations' },
      primaryEmailCustomTypeId: { previous: null, new: 'c17bc1e3-cbdc-424f-aab9-0da9303cd8b6' },
      additionalEmailAddresses: {
        previous: [],
        new: after.additional_email_addresses,
      },
      phoneNumbers: {
        previous: before.phone_numbers,
        new: after.phone_numbers,
      },
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
