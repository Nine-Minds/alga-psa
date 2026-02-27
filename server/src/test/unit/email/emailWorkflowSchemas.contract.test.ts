import { describe, expect, it } from 'vitest';

import {
  emailWorkflowPayloadSchema,
  inboundEmailReceivedEventPayloadSchema,
} from '../../../../../packages/event-schemas/src/schemas/domain/emailWorkflowSchemas';
import { InboundEmailEventPayloadSchema } from '../../../../../packages/event-schemas/src/schemas/eventBusSchema';

describe('email workflow schema contracts', () => {
  it('accepts inline attachment fields required for embedded-image processing', () => {
    const payload = {
      emailData: {
        id: 'message-1',
        from: { email: 'from@example.com', name: 'From' },
        to: [{ email: 'to@example.com', name: 'To' }],
        subject: 'Inline image',
        body: { text: 'body', html: '<img src="cid:inline-1" />' },
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
        providerId: 'provider-1',
        tenant: 'tenant-1',
      },
      providerId: 'provider-1',
      tenantId: 'tenant-1',
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
      tenantId: 'tenant-legacy',
    };

    expect(emailWorkflowPayloadSchema.safeParse(legacyPayload).success).toBe(true);
    expect(inboundEmailReceivedEventPayloadSchema.safeParse(legacyPayload).success).toBe(true);
    expect(InboundEmailEventPayloadSchema.safeParse(legacyPayload).success).toBe(true);
  });
});
