import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IEmailProvider, TenantEmailSettings } from '@alga-psa/types';

const { createProviderMock } = vi.hoisted(() => ({
  createProviderMock: vi.fn()
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: vi.fn(async () => undefined),
    getAppSecret: vi.fn(async () => undefined)
  }))
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('../../../../packages/email/src/system/SystemEmailProviderFactory', () => ({
  SystemEmailProviderFactory: {
    createProvider: createProviderMock
  }
}));

import { EmailProviderManager } from '../../../../packages/email/src/providers/EmailProviderManager';

const buildSettings = (overrides: Partial<TenantEmailSettings> = {}): TenantEmailSettings => ({
  tenantId: 'tenant-1',
  defaultFromDomain: 'example.com',
  ticketingFromEmail: 'no-reply@example.com',
  customDomains: [],
  emailProvider: 'smtp',
  providerConfigs: [],
  trackingEnabled: false,
  createdAt: new Date('2026-03-07T00:00:00.000Z'),
  updatedAt: new Date('2026-03-07T00:00:00.000Z'),
  ...overrides
});

const buildProvider = (providerId: string, providerType = 'smtp'): IEmailProvider => ({
  providerId,
  providerType,
  capabilities: {
    supportsHtml: true,
    supportsAttachments: true,
    supportsTemplating: false,
    supportsBulkSending: false,
    supportsTracking: false,
    supportsCustomDomains: true
  },
  initialize: vi.fn(async () => undefined),
  sendEmail: vi.fn(async () => ({
    success: true,
    providerId,
    providerType,
    sentAt: new Date('2026-03-07T00:00:00.000Z')
  })),
  healthCheck: vi.fn(async () => ({ healthy: true }))
});

describe('EmailProviderManager fallback behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the system provider fallback when no enabled tenant provider is configured', async () => {
    const systemProvider = buildProvider('system-email-provider');
    createProviderMock.mockResolvedValue(systemProvider);

    const manager = new EmailProviderManager();
    await manager.initialize(buildSettings());

    const providers = await manager.getAvailableProviders('tenant-1');
    expect(createProviderMock).toHaveBeenCalledTimes(1);
    expect(providers).toEqual([systemProvider]);
  });

  it('does not use the system provider fallback when an enabled tenant provider exists', async () => {
    const manager = new EmailProviderManager();
    const tenantProvider = buildProvider('tenant-smtp');
    vi.spyOn(manager as any, 'createProvider').mockResolvedValue(tenantProvider);
    vi.spyOn(manager as any, 'resolveProviderConfig').mockResolvedValue({
      host: 'localhost',
      port: 3026,
      username: 'imap_user',
      password: 'imap_pass',
      from: 'no-reply@example.com',
      rejectUnauthorized: false
    });
    const settings = buildSettings({
      providerConfigs: [
        {
          providerId: 'tenant-smtp',
          providerType: 'smtp',
          isEnabled: true,
          config: {
            host: 'localhost',
            port: 3026,
            username: 'imap_user',
            password: 'imap_pass',
            from: 'no-reply@example.com',
            rejectUnauthorized: false
          }
        }
      ]
    });

    await manager.initialize(settings);

    const providers = await manager.getAvailableProviders('tenant-1');
    expect(createProviderMock).not.toHaveBeenCalled();
    expect(providers).toHaveLength(1);
    expect(providers[0]?.providerId).toBe('tenant-smtp');
  });
});
