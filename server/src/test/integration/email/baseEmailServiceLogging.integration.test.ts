import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import type { EmailMessage, EmailSendResult, EmailProviderCapabilities, IEmailProvider } from '@alga-psa/types';
import { BaseEmailService } from '@alga-psa/email/BaseEmailService';
import { resetTenantConnectionPool } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

const capabilities: EmailProviderCapabilities = {
  supportsHtml: true,
  supportsAttachments: true,
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

async function waitForEmailLog(knex: Knex, where: Record<string, any>, timeoutMs = 5000) {
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const row = await knex('email_sending_logs').where(where).orderBy('id', 'desc').first();
    if (row) return row;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for email_sending_logs row: ${JSON.stringify(where)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('BaseEmailService → email_sending_logs', () => {
  let knex: Knex;
  let tenantId: string;

  beforeAll(async () => {
    knex = await createTestDbConnection();
    await resetTenantConnectionPool();

    const tenant = await knex('tenants').first('tenant');
    if (!tenant?.tenant) {
      throw new Error('No tenant found in seeded test DB');
    }
    tenantId = tenant.tenant;
  });

  beforeEach(async () => {
    await knex('email_sending_logs').del();
  });

  afterAll(async () => {
    await knex.destroy();
    await resetTenantConnectionPool();
  });

  it('successful send creates log entry with status sent', async () => {
    const messageId = `msg-${uuidv4()}`;
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
          messageId,
          providerId: 'test-provider',
          providerType: 'test',
          metadata: { ok: true },
          sentAt: new Date(),
        };
      },
      async healthCheck() {
        return { healthy: true };
      },
    };

    const service = new TestEmailService(provider);
    const entityId = uuidv4();
    const contactId = uuidv4();

    const result = await service.sendEmail({
      tenantId,
      to: 'to@example.com',
      subject: 'Hello',
      html: '<p>Hello</p>',
      entityType: 'ticket',
      entityId,
      contactId,
      notificationSubtypeId: 42,
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe(messageId);

    const row = await waitForEmailLog(knex, { tenant: tenantId, message_id: messageId });
    expect(row.status).toBe('sent');
    expect(row.message_id).toBe(messageId);
    expect(row.from_address).toBe('from@example.com');
    expect(row.subject).toBe('Hello');
    expect(row.provider_id).toBe('test-provider');
    expect(row.provider_type).toBe('test');
    expect(row.entity_type).toBe('ticket');
    expect(row.entity_id).toBe(entityId);
    expect(row.contact_id).toBe(contactId);
    expect(row.notification_subtype_id).toBe(42);

    const toAddresses = Array.isArray(row.to_addresses) ? row.to_addresses : [];
    expect(toAddresses).toContain('to@example.com');
  });

  it('failed send creates log entry with status failed and error_message', async () => {
    const messageId = `msg-${uuidv4()}`;
    const provider: IEmailProvider = {
      providerId: 'test-provider',
      providerType: 'test',
      capabilities,
      async initialize() {
        // no-op
      },
      async sendEmail(_message: EmailMessage, _tenant: string): Promise<EmailSendResult> {
        return {
          success: false,
          messageId,
          providerId: 'test-provider',
          providerType: 'test',
          error: 'Provider rejected request',
          metadata: { ok: false },
          sentAt: new Date(),
        };
      },
      async healthCheck() {
        return { healthy: true };
      },
    };

    const service = new TestEmailService(provider);

    const result = await service.sendEmail({
      tenantId,
      to: 'to@example.com',
      subject: 'Hello',
      html: '<p>Hello</p>',
    });

    expect(result.success).toBe(false);
    expect(result.messageId).toBe(messageId);

    const row = await waitForEmailLog(knex, { tenant: tenantId, message_id: messageId });
    expect(row.status).toBe('failed');
    expect(row.error_message).toBe('Provider rejected request');
  });
});
