import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
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
    return params?.from ?? 'support@example.test';
  }
}

const TENANT = '0f7a3a52-8b41-4c39-9a47-3f3f5d8c2a10';
const TICKET = 'b2d1c9e4-5a6f-4e3b-8c7d-1e2f3a4b5c6d';

function service() {
  const sendEmail = vi.fn(async (_message: any, _tenantId?: string) => ({ success: true, messageId: 'message-1' }));
  const provider = { providerId: 'resend-provider', providerType: 'resend', sendEmail } as unknown as IEmailProvider;
  const instance = new TestEmailService(provider);
  vi.spyOn(instance as any, 'logEmailSendResult').mockResolvedValue(undefined);
  return { instance, sendEmail };
}

describe('BaseEmailService provider tags (alga0002306)', () => {
  it('tags every send with the tenant the Resend webhook needs to record the on-wire Message-ID', async () => {
    const { instance, sendEmail } = service();

    await instance.sendEmail({
      mailClass: 'general',
      tenantId: TENANT,
      to: 'contact@example.test',
      subject: 'Ticket created',
      html: '<p>hello</p>',
      correlationId: 'corr_123-abc',
      replyContext: { ticketId: TICKET } as any,
    });

    const tags = sendEmail.mock.calls[0][0].tags;
    expect(tags).toMatchObject({
      alga_tenant_id: TENANT,
      alga_correlation_id: 'corr_123-abc',
      alga_ticket_id: TICKET,
    });
    expect(tags.alga_workflow_message_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('leaves out values a provider would reject instead of failing the send', async () => {
    const { instance, sendEmail } = service();

    const result = await instance.sendEmail({
      mailClass: 'general',
      tenantId: TENANT,
      to: 'contact@example.test',
      subject: 'Ticket created',
      html: '<p>hello</p>',
      correlationId: 'not allowed: spaces & symbols',
    });

    expect(result.success).toBe(true);
    const tags = sendEmail.mock.calls[0][0].tags;
    expect(tags.alga_tenant_id).toBe(TENANT);
    expect(tags).not.toHaveProperty('alga_correlation_id');
  });
});
