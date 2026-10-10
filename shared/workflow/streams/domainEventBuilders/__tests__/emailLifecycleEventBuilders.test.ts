import { describe, expect, it } from 'vitest';
import {
  buildInboundEmailReceivedPayload,
  buildOutboundEmailFailedPayload,
  buildOutboundEmailQueuedPayload,
  buildOutboundEmailSentPayload,
} from '../emailLifecycleEventBuilders';

describe('emailLifecycleEventBuilders', () => {
  it('omits optional thread/ticket/cc fields when absent (matches the former hand-built literals)', () => {
    expect(
      buildOutboundEmailQueuedPayload({
        messageId: 'm1',
        from: 'a@x.example',
        to: ['b@x.example'],
        cc: [],
        subject: 'Hi',
        queuedAt: '2026-07-16T12:00:00.000Z',
        provider: 'smtp',
      })
    ).toEqual({
      messageId: 'm1',
      from: 'a@x.example',
      to: ['b@x.example'],
      subject: 'Hi',
      queuedAt: '2026-07-16T12:00:00.000Z',
      provider: 'smtp',
    });
  });

  it('keeps thread, ticket, error code and retryable when provided', () => {
    expect(
      buildOutboundEmailFailedPayload({
        messageId: 'm1',
        threadId: 't1',
        ticketId: 'k1',
        provider: 'smtp',
        errorMessage: 'boom',
        errorCode: 'E1',
        retryable: false,
      })
    ).toEqual({ messageId: 'm1', threadId: 't1', ticketId: 'k1', provider: 'smtp', errorCode: 'E1', errorMessage: 'boom', retryable: false });
    expect(buildOutboundEmailSentPayload({ messageId: 'm1', providerMessageId: 'p1', provider: 'smtp' })).toEqual({
      messageId: 'm1',
      providerMessageId: 'p1',
      provider: 'smtp',
    });
  });

  it('rejects missing required fields', () => {
    expect(() => buildOutboundEmailFailedPayload({ messageId: 'm1', provider: 'smtp', errorMessage: '' })).toThrow('errorMessage');
    expect(() => buildInboundEmailReceivedPayload({ providerId: '', emailData: { id: '1' } })).toThrow('providerId');
  });

  it('keeps the legacy top-level tenant field for older subscribers', () => {
    expect(buildInboundEmailReceivedPayload({ tenant: 't', providerId: 'p', emailData: { id: '1' } })).toEqual({
      tenant: 't',
      providerId: 'p',
      emailData: { id: '1' },
    });
  });
});
