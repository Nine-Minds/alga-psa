import { describe, expect, it, vi } from 'vitest';
import { BaseEmailService, type BaseEmailParams } from '../BaseEmailService';
import type { IEmailProvider } from '@alga-psa/types';

class TestEmailService extends BaseEmailService {
  constructor(provider: IEmailProvider) {
    super();
    this.emailProvider = provider;
    this.initialized = true;
  }

  protected getServiceName(): string {
    return 'TestEmailService';
  }

  protected async getEmailProvider(): Promise<IEmailProvider | null> {
    return this.emailProvider;
  }

  protected getFromAddress(params?: BaseEmailParams) {
    return params?.resolvedSystemFallbackFromAddress ?? params?.from ?? 'default@example.test';
  }
}

describe('BaseEmailService system fallback identity', () => {
  it('uses the forced verified From and tenant Reply-To instead of caller-supplied identities', async () => {
    const sendEmail = vi.fn(async () => ({ success: true, messageId: 'message-1' }));
    const provider = { providerId: 'system', providerType: 'resend', sendEmail } as unknown as IEmailProvider;
    const service = new TestEmailService(provider);
    vi.spyOn(service as any, 'logEmailSendResult').mockResolvedValue(undefined);

    await expect(service.sendEmail({
      tenantId: 'tenant-1',
      to: 'customer@example.test',
      subject: 'Status',
      html: '<p>Status</p>',
      from: { email: 'spoofed@unverified.example', name: 'Spoofed' },
      replyTo: { email: 'wrong@example.test' },
      resolvedSystemFallbackFromAddress: { email: 'noreply@algapsa.com', name: 'Tenant Services' },
      resolvedSystemFallbackReplyTo: { email: 'service@tenant.example', name: 'Tenant Services' },
    })).resolves.toMatchObject({ success: true });

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      from: { email: 'noreply@algapsa.com', name: 'Tenant Services' },
      replyTo: { email: 'service@tenant.example', name: 'Tenant Services' },
    }), 'tenant-1');
  });
});
