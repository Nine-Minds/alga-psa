import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage, TenantEmailSettings } from '@alga-psa/types';

const {
  buildConfigMock,
  connectMock,
  sendMailMock,
  testConnectionMock,
  smtpSendMock,
  tableRows,
} = vi.hoisted(() => ({
  buildConfigMock: vi.fn(async (config: any) => config),
  connectMock: vi.fn(async () => undefined),
  sendMailMock: vi.fn(async () => ({ requestId: 'request-1' })),
  testConnectionMock: vi.fn(async () => ({ success: true })),
  smtpSendMock: vi.fn(async () => ({ success: true, messageId: 'smtp-message-1', providerId: 'smtp-provider', providerType: 'smtp', sentAt: new Date() })),
  tableRows: {
    email_providers: null as any,
    microsoft_email_provider_config: null as any,
  },
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => ({})),
  tenantDb: () => ({
    table: (tableName: keyof typeof tableRows) => ({
      where: (criteria?: any) => ({
        first: vi.fn(async () => {
          const row = tableRows[tableName];
          if (tableName === 'email_providers' && criteria?.id && row && criteria.id !== row.id) {
            return { ...row, id: criteria.id, mailbox: 'projects@example.com' };
          }
          return row;
        }),
      }),
    }),
  }),
}));

vi.mock('@alga-psa/shared/services/email/microsoftEmailProviderConfig', () => ({
  buildMicrosoftEmailProviderConfig: buildConfigMock,
}));

vi.mock('@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter', () => ({
  MicrosoftGraphAdapter: class {
    connect = connectMock;
    sendMail = sendMailMock;
    testConnection = testConnectionMock;
  },
}));

vi.mock('../SMTPEmailProvider', () => ({
  SMTPEmailProvider: class {
    providerId: string;
    providerType = 'smtp';
    constructor(providerId: string) { this.providerId = providerId; }
    initialize = vi.fn(async () => undefined);
    sendEmail = smtpSendMock;
  },
}));

import { EmailProviderManager } from '../EmailProviderManager';

function makeJwt(): string {
  const header = Buffer.from('{}').toString('base64url');
  const payload = Buffer.from(JSON.stringify({ scp: 'Mail.Read Mail.Send' })).toString('base64url');
  return `${header}.${payload}.signature`;
}

function settings(): TenantEmailSettings {
  return {
    tenantId: 'tenant-1',
    customDomains: [],
    emailProvider: 'microsoft',
    providerConfigs: [{
      providerId: 'microsoft-outbound-placeholder',
      providerType: 'microsoft',
      isEnabled: true,
      config: {
        inboundProviderId: 'inbound-microsoft-1',
        accessToken: 'stale-browser-value-must-not-be-used',
      },
    }],
    trackingEnabled: false,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function message(subject: string): EmailMessage {
  return {
    from: { email: 'support@example.com' },
    to: [{ email: 'customer@example.net' }],
    subject,
    html: `<p>${subject}</p>`,
  };
}

describe('EmailProviderManager Microsoft Graph support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableRows.email_providers = {
      id: 'inbound-microsoft-1',
      tenant: 'tenant-1',
      provider_type: 'microsoft',
      provider_name: 'Support mailbox',
      mailbox: 'support@example.com',
      is_active: true,
      status: 'connected',
      created_at: new Date('2026-08-01T00:00:00.000Z'),
      updated_at: new Date('2026-08-01T00:00:00.000Z'),
    };
    tableRows.microsoft_email_provider_config = {
      email_provider_id: 'inbound-microsoft-1',
      tenant: 'tenant-1',
      access_token: makeJwt(),
      refresh_token: 'stored-refresh-token',
      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      resolved_client_id: 'profile-client-id',
      resolved_client_secret: 'profile-client-secret',
    };
  });

  it('resolves fresh inbound credentials and sends through the common manager path', async () => {
    const manager = new EmailProviderManager();
    await manager.initialize(settings());

    const result = await manager.sendEmail(message('Common path'), 'tenant-1');

    expect(buildConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      id: 'inbound-microsoft-1',
      tenant: 'tenant-1',
      mailbox: 'support@example.com',
      provider_config: expect.objectContaining({
        refresh_token: 'stored-refresh-token',
      }),
    }));
    expect(buildConfigMock.mock.calls[0]?.[0].provider_config.accessToken).toBeUndefined();
    expect(sendMailMock).toHaveBeenCalledWith({
      kind: 'json',
      fromAddress: 'support@example.com',
      message: expect.objectContaining({ subject: 'Common path' }),
    });
    expect(result).toMatchObject({ success: true, providerType: 'microsoft' });
  });

  it('uses per-message fallback for Microsoft bulk sends', async () => {
    const manager = new EmailProviderManager();
    await manager.initialize(settings());

    const results = await manager.sendBulkEmails(
      [message('First'), message('Second')],
      'tenant-1'
    );

    expect(sendMailMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(results.every(result => result.success)).toBe(true);
  });

  it('initializes and caches the routed connected mailbox on demand', async () => {
    const manager = new EmailProviderManager();
    await manager.initialize(settings());
    await manager.sendEmail({ ...message('Routed mailbox'), microsoftProviderId: 'inbound-microsoft-2' }, 'tenant-1');
    expect(buildConfigMock).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'inbound-microsoft-2',
      mailbox: 'projects@example.com',
    }));
    expect(connectMock).toHaveBeenCalledTimes(2);
  });

  it('fails before adapter construction when the selected mailbox is disconnected', async () => {
    tableRows.email_providers.status = 'disconnected';
    const manager = new EmailProviderManager();

    await expect(manager.initialize(settings())).rejects.toMatchObject({
      name: 'EmailProviderError',
      errorCode: 'MICROSOFT_PROVIDER_NOT_CONNECTED',
    });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('ignores a stale Microsoft sender link when SMTP is the active transport', async () => {
    const manager = new EmailProviderManager();
    await manager.initialize({
      ...settings(),
      emailProvider: 'smtp',
      providerConfigs: [{
        providerId: 'smtp-provider',
        providerType: 'smtp',
        isEnabled: true,
        config: { host: 'smtp.example.test', port: 587, from: 'support@example.com' },
      }],
    });

    const result = await manager.sendEmail({
      ...message('SMTP with stale Microsoft link'),
      microsoftProviderId: 'old-inbound-microsoft-id',
    }, 'tenant-1');

    expect(smtpSendMock).toHaveBeenCalledWith(expect.objectContaining({ subject: 'SMTP with stale Microsoft link' }), 'tenant-1');
    expect(result).toMatchObject({ success: true, providerType: 'smtp' });
    expect(buildConfigMock).not.toHaveBeenCalled();
  });
});
