import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage, TenantEmailSettings } from '@alga-psa/types';

const {
  buildConfigMock,
  connectMock,
  sendMailMock,
  testConnectionMock,
  tableRows,
} = vi.hoisted(() => ({
  buildConfigMock: vi.fn(async (config: any) => config),
  connectMock: vi.fn(async () => undefined),
  sendMailMock: vi.fn(async () => ({ requestId: 'request-1' })),
  testConnectionMock: vi.fn(async () => ({ success: true })),
  tableRows: {
    email_providers: null as any,
    microsoft_email_provider_config: null as any,
  },
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => ({})),
  tenantDb: () => ({
    table: (tableName: keyof typeof tableRows) => ({
      where: () => ({
        first: vi.fn(async () => tableRows[tableName]),
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

  it('fails before adapter construction when the selected mailbox is disconnected', async () => {
    tableRows.email_providers.status = 'disconnected';
    const manager = new EmailProviderManager();

    await expect(manager.initialize(settings())).rejects.toMatchObject({
      name: 'EmailProviderError',
      errorCode: 'MICROSOFT_PROVIDER_NOT_CONNECTED',
    });
    expect(connectMock).not.toHaveBeenCalled();
  });
});
