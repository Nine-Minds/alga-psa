import { describe, expect, it } from 'vitest';
import { inboundEmailReplyReceivedEventPayloadSchema } from '@alga-psa/workflows/runtime/schemas/communicationsEventSchemas';
import { buildWorkflowPayload } from '../../workflowEventPublishHelpers.js';
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

  it('accepts provider-native message/thread identifiers (non-UUID)', () => {
    const base = buildInboundEmailReplyReceivedPayload({
      messageId:
        'AAMkADljNmQ3M2YzLTI3N2EtNDQ0OC05MjM2LTI0ZjlkMTU0MzUwNQBGAAAAAABsymEH1nfSRoQWGbfhaom2BwD51_5h5He8SrvX0UqJVsXoAAAAAAEMAAD51_5h5He8SrvX0UqJVsXoAATykjyvAAA=',
      threadId: 'AAQkADljNmQ3M2YzLTI3N2EtNDQ0OC05MjM2LTI0ZjlkMTU0MzUwNQAQAJHU1jiHi2pKpVAYlu6Zbws=',
      ticketId: '7bffbe44-9b92-4d39-9d0a-94b4d2554a5a',
      from: 'customer@example.com',
      to: ['support@example.com'],
      subject: 'Re: Ticket update',
      receivedAt: '2026-01-24T01:02:03.000Z',
      provider: 'microsoft',
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
