import { describe, expect, it } from 'vitest';

import {
  emailWorkflowPayloadSchema,
  inboundEmailReceivedEventPayloadSchema,
} from '../../../../../packages/event-schemas/src/schemas/domain/emailWorkflowSchemas';
import { InboundEmailEventPayloadSchema } from '../../../../../packages/event-schemas/src/schemas/eventBusSchema';

const tenantId = '00000000-0000-4000-8000-000000000001';
const providerId = 'provider-1';
const occurredAt = '2026-02-27T00:00:00.000Z';

describe('email workflow schema contracts', () => {
  it('accepts inline attachment fields required for embedded-image processing', () => {
    const payload = {
      emailData: {
        id: 'message-1',
        from: { email: 'from@example.com', name: 'From' },
        to: [{ email: 'to@example.com', name: 'To' }],
        subject: 'Inline image',
        body: { text: 'body', html: '<img src="cid:inline-1" />' },
        receivedAt: new Date().toISOString(),
        attachments: [
          {
            id: 'att-1',
            name: 'inline.png',
            contentType: 'image/png',
            size: 123,
            contentId: 'inline-1',
            isInline: true,
            content: Buffer.from('hello').toString('base64'),
          },
        ],
        providerId,
        tenant: tenantId,
      },
      providerId,
      tenantId,
      occurredAt,
    };

    expect(emailWorkflowPayloadSchema.safeParse(payload).success).toBe(true);
    expect(inboundEmailReceivedEventPayloadSchema.safeParse(payload).success).toBe(true);
    expect(InboundEmailEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('remains backward compatible with existing provider payloads lacking new optional fields', () => {
    const legacyPayload = {
      emailData: {
        id: 'message-legacy-1',
        from: { email: 'from@example.com' },
        to: [{ email: 'to@example.com' }],
        subject: 'Legacy',
        body: { text: 'plain text' },
        receivedAt: new Date().toISOString(),
        attachments: [
          {
            id: 'att-legacy-1',
            name: 'file.txt',
            contentType: 'text/plain',
            size: 5,
          },
        ],
        threadId: 'thread-1',
      },
      providerId: 'provider-legacy',
      tenantId,
      occurredAt,
    };

    expect(emailWorkflowPayloadSchema.safeParse(legacyPayload).success).toBe(true);
    expect(inboundEmailReceivedEventPayloadSchema.safeParse(legacyPayload).success).toBe(true);
    expect(InboundEmailEventPayloadSchema.safeParse(legacyPayload).success).toBe(true);
  });

  it('accepts IMAP webhook payload fields for raw MIME + attachment byte ingress handling', () => {
    const payload = {
      emailData: {
        id: 'imap-message-1',
        from: { email: 'from@example.com' },
        to: [{ email: 'to@example.com' }],
        subject: 'IMAP payload',
        body: { text: 'body', html: '<p>body</p>' },
        receivedAt: new Date().toISOString(),
        rawMimeBase64: Buffer.from('From: from@example.com\r\n\r\nbody').toString('base64'),
        attachments: [
          {
            id: 'imap-att-1',
            name: 'inline.png',
            contentType: 'image/png',
            size: 5,
            contentId: 'cid-1',
            isInline: true,
            content: Buffer.from('hello').toString('base64'),
          },
        ],
        ingressSkipReasons: [
          {
            type: 'attachment',
            reason: 'attachment_over_max_bytes',
            attachmentId: 'imap-att-2',
            attachmentName: 'too-large.bin',
            size: 1025,
            cap: 1024,
          },
        ],
      },
      providerId: 'provider-imap-1',
      tenantId,
      occurredAt,
    };

    expect(emailWorkflowPayloadSchema.safeParse(payload).success).toBe(true);
    expect(inboundEmailReceivedEventPayloadSchema.safeParse(payload).success).toBe(true);
    expect(InboundEmailEventPayloadSchema.safeParse(payload).success).toBe(true);
  });
});
