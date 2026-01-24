import { describe, expect, it } from 'vitest';
import { inboundEmailReplyReceivedEventPayloadSchema } from '@shared/workflow/runtime/schemas/communicationsEventSchemas';
import { buildWorkflowPayload } from '@shared/workflow/streams/workflowEventPublishHelpers';
import { buildInboundEmailReplyReceivedPayload } from '../inboundEmailReplyEventBuilders';

describe('buildInboundEmailReplyReceivedPayload', () => {
  it('builds a schema-valid payload when enriched', () => {
    const base = buildInboundEmailReplyReceivedPayload({
      messageId: '2c9b1e2c-2f9f-4efb-9dc5-7f2d6f231f45',
      threadId: '18a9c9b8-12c1-4db5-8b74-9aa84ad39a07',
      ticketId: '7bffbe44-9b92-4d39-9d0a-94b4d2554a5a',
      from: 'customer@example.com',
      to: ['support@example.com'],
      subject: 'Re: Ticket update',
      receivedAt: '2026-01-24T01:02:03.000Z',
      provider: 'provider-123',
      matchedBy: 'thread_headers',
    });

    const payload = buildWorkflowPayload(base, {
      tenantId: 'c6da0f3a-d8d7-4b34-85c8-7f75e0b4f9ce',
      occurredAt: '2026-01-24T01:02:03.000Z',
    });

    expect(inboundEmailReplyReceivedEventPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('throws when required fields are missing', () => {
    expect(() =>
      buildInboundEmailReplyReceivedPayload({
        // @ts-expect-error intentional
        messageId: '',
        threadId: '18a9c9b8-12c1-4db5-8b74-9aa84ad39a07',
        from: 'customer@example.com',
        to: ['support@example.com'],
        provider: 'provider-123',
        matchedBy: 'reply_token',
      })
    ).toThrow(/messageId/);
  });
});

