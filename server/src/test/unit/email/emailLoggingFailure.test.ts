import { describe, expect, it, vi } from 'vitest';
import type { EmailMessage, EmailProviderCapabilities, EmailSendResult, IEmailProvider } from '@alga-psa/types';

const { loggerWarn, loggerInfo, loggerError } = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    warn: loggerWarn,
    info: loggerInfo,
    error: loggerError,
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => {
    throw new Error('DB unavailable');
  }),
}));

import { BaseEmailService } from '@alga-psa/email/BaseEmailService';

const capabilities: EmailProviderCapabilities = {
  supportsHtml: true,
  supportsAttachments: false,
  supportsTemplating: false,
  supportsBulkSending: false,
  supportsTracking: false,
  supportsCustomDomains: false,
};

class TestEmailService extends BaseEmailService {
  constructor(private readonly provider: IEmailProvider) {
    super();
  }

  protected async getEmailProvider(): Promise<IEmailProvider | null> {
    return this.provider;
  }

  protected getFromAddress(): string {
    return 'from@example.com';
  }

  protected getServiceName(): string {
    return 'TestEmailService';
  }
}

describe('BaseEmailService logging failure handling', () => {
  it('does not throw or block when email_sending_logs insert fails', async () => {
    const provider: IEmailProvider = {
      providerId: 'test-provider',
      providerType: 'test',
      capabilities,
      async initialize() {
        // no-op
      },
      async sendEmail(_message: EmailMessage, _tenant: string): Promise<EmailSendResult> {
        return {
          success: true,
          messageId: 'msg-1',
          providerId: 'test-provider',
          providerType: 'test',
          sentAt: new Date(),
        };
      },
      async healthCheck() {
        return { healthy: true };
      },
    };

    const service = new TestEmailService(provider);

    const result = await service.sendEmail({
      tenantId: 'tenant-test',
      to: 'to@example.com',
      subject: 'Hello',
      html: '<p>Hello</p>',
    });

    expect(result.success).toBe(true);

    // Allow the best-effort logging promise to run.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(loggerWarn).toHaveBeenCalled();
    expect(String(loggerWarn.mock.calls[0]?.[0] ?? '')).toContain('Failed to write email_sending_logs record');
  });
});
