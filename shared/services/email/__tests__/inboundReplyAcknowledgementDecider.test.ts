import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('resolveInboundReplyAcknowledgementDecider', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('T011: CE runtime uses default non-AI decider without importing EE module', async () => {
    vi.doMock('@alga-psa/core/features', () => ({
      isEnterprise: false,
    }));
    vi.doMock('@ee/services/email/inboundReplyAcknowledgementDecider', () => {
      throw new Error('EE decider should not be imported in CE mode');
    });

    const { resolveInboundReplyAcknowledgementDecider } = await import(
      '../inboundReplyAcknowledgementDecider'
    );

    const decider = await resolveInboundReplyAcknowledgementDecider();
    const result = await decider.decide({
      tenantId: 'tenant-1',
      boardId: 'board-1',
      ticketId: 'ticket-1',
      subject: 'Re: done',
      text: 'thanks',
    });

    expect(result).toMatchObject({
      decision: 'NOT_ACK',
      source: 'default',
      attempted: false,
      reason: 'default_non_ai',
    });
  });
});
