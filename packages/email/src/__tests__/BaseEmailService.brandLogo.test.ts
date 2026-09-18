import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

const embedBrandLogo = vi.fn();
vi.mock('../inlineBrandLogo', () => ({
  embedBrandLogo: (...args: any[]) => embedBrandLogo(...args),
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

const BRANDED_HTML = '<img data-alga-brand-logo src="cid:alga-brand-logo"/><p>Ticket updated</p>';

function service() {
  const sendEmail = vi.fn(async () => ({ success: true, messageId: 'message-1' }));
  const provider = { providerId: 'smtp', providerType: 'smtp', sendEmail } as unknown as IEmailProvider;
  const instance = new TestEmailService(provider);
  vi.spyOn(instance as any, 'logEmailSendResult').mockResolvedValue(undefined);
  return { instance, sendEmail };
}

describe('BaseEmailService brand logo embedding', () => {
  beforeEach(() => {
    embedBrandLogo.mockReset();
  });

  it('sends the embedded HTML with the logo attached alongside the caller attachments', async () => {
    const logo = { filename: 'logo.png', content: Buffer.from('bytes'), contentType: 'image/png', cid: 'alga-brand-logo' };
    embedBrandLogo.mockResolvedValue({ html: BRANDED_HTML, attachments: [logo] });
    const { instance, sendEmail } = service();

    await instance.sendEmail({
      tenantId: 'tenant-1',
      to: 'customer@example.test',
      subject: 'Ticket updated',
      html: BRANDED_HTML,
      attachments: [{ filename: 'invoice.pdf', content: Buffer.from('pdf') }],
    });

    expect(embedBrandLogo).toHaveBeenCalledWith(BRANDED_HTML, { tenantId: 'tenant-1' });
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      html: BRANDED_HTML,
      attachments: [{ filename: 'invoice.pdf' }, logo],
    });
  });

  it('still sends, minus the placeholder, when the logo cannot be embedded', async () => {
    embedBrandLogo.mockRejectedValue(new Error('storage unavailable'));
    const { instance, sendEmail } = service();

    await expect(instance.sendEmail({
      tenantId: 'tenant-1',
      to: 'customer@example.test',
      subject: 'Ticket updated',
      html: BRANDED_HTML,
    })).resolves.toMatchObject({ success: true });

    const sent = sendEmail.mock.calls[0][0] as any;
    expect(sent.html).toBe('<p>Ticket updated</p>');
    expect(sent.attachments).toBeUndefined();
  });

  it('leaves system mail with no tenant alone', async () => {
    const { instance } = service();

    await instance.sendEmail({
      to: 'customer@example.test',
      subject: 'Welcome',
      html: BRANDED_HTML,
    });

    expect(embedBrandLogo).not.toHaveBeenCalled();
  });
});
