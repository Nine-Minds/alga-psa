import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage, IEmailProvider, TenantEmailSettings } from '@alga-psa/types';
import { EmailProviderError } from '@alga-psa/types';

const { writeEmailSendResultLogMock } = vi.hoisted(() => ({
  writeEmailSendResultLogMock: vi.fn(),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: vi.fn(async () => undefined),
    getAppSecret: vi.fn(async () => undefined),
  })),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../../packages/email/src/emailSendLogWriter', () => ({
  buildFailedProviderResult: vi.fn(({ providerId, providerType, error, metadata }: any) => ({
    success: false,
    messageId: undefined,
    providerId,
    providerType,
    error: error instanceof Error ? error.message : String(error),
    metadata: metadata ?? { error: error instanceof Error ? error.message : String(error) },
    sentAt: new Date('2026-03-15T01:00:00.000Z'),
  })),
  writeEmailSendResultLog: writeEmailSendResultLogMock,
}));

import { EmailProviderManager } from '../../../../packages/email/src/providers/EmailProviderManager';

const message: EmailMessage = {
  from: { email: 'from@example.com' },
  to: [{ email: 'to@example.com' }],
  subject: 'Manager send',
  html: '<p>Hello</p>',
  text: 'Hello',
};

function buildSettings(): TenantEmailSettings {
  return {
    tenantId: 'tenant-1',
    defaultFromDomain: 'example.com',
    ticketingFromEmail: 'no-reply@example.com',
    customDomains: [],
    emailProvider: 'smtp',
    providerConfigs: [
      {
        providerId: 'tenant-smtp',
        providerType: 'smtp',
        isEnabled: true,
        config: {},
      },
    ],
    trackingEnabled: false,
    createdAt: new Date('2026-03-15T00:00:00.000Z'),
    updatedAt: new Date('2026-03-15T00:00:00.000Z'),
  };
}

function buildProvider(sendEmail: IEmailProvider['sendEmail']): IEmailProvider {
  return {
    providerId: 'tenant-smtp',
    providerType: 'smtp',
    capabilities: {
      supportsHtml: true,
      supportsAttachments: true,
      supportsTemplating: false,
      supportsBulkSending: false,
      supportsTracking: false,
      supportsCustomDomains: false,
    },
    initialize: vi.fn(async () => undefined),
    sendEmail,
    healthCheck: vi.fn(async () => ({ healthy: true })),
  };
}

describe('EmailProviderManager logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs successful direct sends via the shared writer', async () => {
    const manager = new EmailProviderManager();
    const provider = buildProvider(async () => ({
      success: true,
      messageId: 'provider-msg-1',
      providerId: 'tenant-smtp',
      providerType: 'smtp',
      sentAt: new Date('2026-03-15T01:00:00.000Z'),
    }));

    vi.spyOn(manager as any, 'createProvider').mockResolvedValue(provider);
    vi.spyOn(manager as any, 'resolveProviderConfig').mockResolvedValue({});

    await manager.initialize(buildSettings());
    const result = await manager.sendEmail(message, 'tenant-1');

    expect(result.success).toBe(true);
    expect(writeEmailSendResultLogMock).toHaveBeenCalledWith({
      serviceName: 'EmailProviderManager',
      tenantId: 'tenant-1',
      providerResult: expect.objectContaining({
        success: true,
        messageId: 'provider-msg-1',
      }),
      message,
    });
  });

  it('logs provider-declared failures via the shared writer', async () => {
    const manager = new EmailProviderManager();
    const provider = buildProvider(async () => ({
      success: false,
      messageId: 'provider-msg-2',
      providerId: 'tenant-smtp',
      providerType: 'smtp',
      error: 'Provider rejected request',
      sentAt: new Date('2026-03-15T01:00:00.000Z'),
    }));

    vi.spyOn(manager as any, 'createProvider').mockResolvedValue(provider);
    vi.spyOn(manager as any, 'resolveProviderConfig').mockResolvedValue({});

    await manager.initialize(buildSettings());
    const result = await manager.sendEmail(message, 'tenant-1');

    expect(result.success).toBe(false);
    expect(writeEmailSendResultLogMock).toHaveBeenCalledWith({
      serviceName: 'EmailProviderManager',
      tenantId: 'tenant-1',
      providerResult: expect.objectContaining({
        success: false,
        error: 'Provider rejected request',
      }),
      message,
    });
  });

  it('logs thrown provider exceptions before rethrowing them', async () => {
    const manager = new EmailProviderManager();
    const provider = buildProvider(async () => {
      throw new Error('SMTP exploded');
    });

    vi.spyOn(manager as any, 'createProvider').mockResolvedValue(provider);
    vi.spyOn(manager as any, 'resolveProviderConfig').mockResolvedValue({});

    await manager.initialize(buildSettings());

    await expect(manager.sendEmail(message, 'tenant-1')).rejects.toMatchObject({
      name: 'EmailProviderError',
      message: 'SMTP exploded',
    });

    expect(writeEmailSendResultLogMock).toHaveBeenCalledWith({
      serviceName: 'EmailProviderManager',
      tenantId: 'tenant-1',
      providerResult: expect.objectContaining({
        success: false,
        error: 'SMTP exploded',
      }),
      message,
    });
  });

  it('preserves provider metadata when rethrowing EmailProviderError instances', async () => {
    const manager = new EmailProviderManager();
    const provider = buildProvider(async () => {
      throw new EmailProviderError('SMTP exploded', 'tenant-smtp', 'smtp', false, 'SMTP_REJECTED', { code: 'SMTP_REJECTED' });
    });

    vi.spyOn(manager as any, 'createProvider').mockResolvedValue(provider);
    vi.spyOn(manager as any, 'resolveProviderConfig').mockResolvedValue({});

    await manager.initialize(buildSettings());

    await expect(manager.sendEmail(message, 'tenant-1')).rejects.toMatchObject({
      name: 'EmailProviderError',
      errorCode: 'SMTP_REJECTED',
      metadata: { code: 'SMTP_REJECTED' },
    });
  });
});
