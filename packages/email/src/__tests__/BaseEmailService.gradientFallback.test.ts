import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../inlineBrandLogo', () => ({
  embedBrandLogo: async (html: string) => ({ html, attachments: [] }),
}));

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
    return params?.from ?? 'default@example.test';
  }
}

const LEGACY_HTML =
  '<table><tr><td style="padding:32px;background:linear-gradient(135deg,#4a5a68,#6b7c8a);color:#ffffff;">New ticket</td></tr></table>';

const REPAIRED_HTML =
  '<table><tr><td bgcolor="#4a5a68" style="padding:32px;background-color:#4a5a68;background:linear-gradient(135deg,#4a5a68,#6b7c8a);color:#ffffff;">New ticket</td></tr></table>';

function service() {
  const sendEmail = vi.fn(async (_message: any, _tenantId?: string) => ({ success: true, messageId: 'message-1' }));
  const provider = { providerId: 'smtp', providerType: 'smtp', sendEmail } as unknown as IEmailProvider;
  const instance = new TestEmailService(provider);
  vi.spyOn(instance as any, 'logEmailSendResult').mockResolvedValue(undefined);
  return { instance, sendEmail };
}

describe('BaseEmailService gradient fallback', () => {
  it('sends a tenant row written before the fallback with the flat header color added', async () => {
    const { instance, sendEmail } = service();

    await instance.sendEmail({
      mailClass: 'general',
      tenantId: 'tenant-1',
      to: 'customer@example.test',
      subject: 'New ticket',
      html: LEGACY_HTML,
    });

    expect(sendEmail.mock.calls[0][0]).toMatchObject({ html: REPAIRED_HTML });
  });

  it('repairs system mail too, which never passes through the tenant logo pass', async () => {
    const { instance, sendEmail } = service();

    await instance.sendEmail({
      mailClass: 'general',
      tenantId: 'system',
      to: 'customer@example.test',
      subject: 'New ticket',
      html: LEGACY_HTML,
    });

    expect(sendEmail.mock.calls[0][0]).toMatchObject({ html: REPAIRED_HTML });
  });
});
