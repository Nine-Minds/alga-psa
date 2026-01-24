import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmailMessage, EmailSendResult, IEmailProvider } from '../../types/email.types';
import { BaseEmailService } from '../../lib/email/BaseEmailService';

vi.mock('@alga-psa/core/logger', () => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return { default: stub, logger: stub };
});

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => {}),
}));

import { publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';

function makeProvider(sendResult: EmailSendResult): IEmailProvider {
  return {
    providerId: 'test-provider',
    providerType: 'smtp',
    capabilities: {
      supportsHtml: true,
      supportsAttachments: true,
      supportsTemplating: false,
      supportsBulkSending: false,
      supportsTracking: false,
      supportsCustomDomains: false,
    },
    async initialize() {},
    async sendEmail(_message: EmailMessage, _tenantId: string) {
      return sendResult;
    },
    async healthCheck() {
      return { healthy: true };
    },
  };
}

class TestEmailService extends BaseEmailService {
  constructor(private readonly provider: IEmailProvider) {
    super();
  }

  protected async getEmailProvider(): Promise<IEmailProvider | null> {
    return this.provider;
  }

  protected getFromAddress(): string {
    return 'Sender Name <sender@example.com>';
  }

  protected getServiceName(): string {
    return 'TestEmailService';
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  vi.mocked(publishWorkflowEvent).mockReset();
  vi.mocked(publishWorkflowEvent).mockImplementation(async () => {});
});

describe('outbound email workflow events', () => {
  it('publishes queued + sent events on success', async () => {
    const sentAt = new Date('2026-01-24T12:00:00.000Z');
    const service = new TestEmailService(
      makeProvider({
        success: true,
        messageId: 'provider-msg-1',
        providerId: 'test-provider',
        providerType: 'smtp',
        sentAt,
      })
    );

    const result = await service.sendEmail({
      tenantId: 'tenant-1',
      to: 'to@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
    });

    expect(result.success).toBe(true);
    expect(vi.mocked(publishWorkflowEvent)).toHaveBeenCalledTimes(2);

    const queuedCall = vi.mocked(publishWorkflowEvent).mock.calls[0]?.[0] as any;
    const sentCall = vi.mocked(publishWorkflowEvent).mock.calls[1]?.[0] as any;

    expect(queuedCall.eventType).toBe('OUTBOUND_EMAIL_QUEUED');
    expect(queuedCall.payload.from).toBe('sender@example.com');
    expect(queuedCall.payload.to).toEqual(['to@example.com']);
    expect(queuedCall.payload.subject).toBe('Hello');
    expect(queuedCall.payload.provider).toBe('smtp');
    expect(queuedCall.payload.messageId).toMatch(UUID_RE);

    expect(sentCall.eventType).toBe('OUTBOUND_EMAIL_SENT');
    expect(sentCall.payload.messageId).toBe(queuedCall.payload.messageId);
    expect(sentCall.payload.providerMessageId).toBe('provider-msg-1');
    expect(sentCall.payload.provider).toBe('smtp');
    expect(sentCall.payload.sentAt).toBe(sentAt.toISOString());
  });

  it('publishes queued + failed events on provider failure', async () => {
    const service = new TestEmailService(
      makeProvider({
        success: false,
        providerId: 'test-provider',
        providerType: 'smtp',
        error: 'SMTP rejected',
        sentAt: new Date('2026-01-24T12:00:00.000Z'),
      })
    );

    const result = await service.sendEmail({
      tenantId: 'tenant-1',
      to: 'to@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
    });

    expect(result.success).toBe(false);
    expect(vi.mocked(publishWorkflowEvent)).toHaveBeenCalledTimes(2);

    const queuedCall = vi.mocked(publishWorkflowEvent).mock.calls[0]?.[0] as any;
    const failedCall = vi.mocked(publishWorkflowEvent).mock.calls[1]?.[0] as any;

    expect(queuedCall.eventType).toBe('OUTBOUND_EMAIL_QUEUED');
    expect(failedCall.eventType).toBe('OUTBOUND_EMAIL_FAILED');
    expect(failedCall.payload.messageId).toBe(queuedCall.payload.messageId);
    expect(failedCall.payload.errorMessage).toBe('SMTP rejected');
    expect(failedCall.payload.provider).toBe('smtp');
  });

  it('does not fail the send when workflow publishing fails', async () => {
    vi.mocked(publishWorkflowEvent).mockImplementation(async () => {
      throw new Error('event bus down');
    });

    const sentAt = new Date('2026-01-24T12:00:00.000Z');
    const service = new TestEmailService(
      makeProvider({
        success: true,
        messageId: 'provider-msg-1',
        providerId: 'test-provider',
        providerType: 'smtp',
        sentAt,
      })
    );

    const result = await service.sendEmail({
      tenantId: 'tenant-1',
      to: 'to@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
    });

    expect(result.success).toBe(true);
  });
});

