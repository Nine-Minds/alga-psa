import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailProviderConfig, TenantEmailSettings } from '@alga-psa/types';

const { createTenantKnexMock, getTenantEmailSettingsMock } = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(),
  getTenantEmailSettingsMock: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
  }),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) =>
    fn({ id: 'user-1' }, { tenant: 'tenant-123' }, ...args),
}));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: {
    getTenantEmailSettings: getTenantEmailSettingsMock,
  },
}));

vi.mock('@alga-psa/email/providerConfig', () => ({
  createDefaultProviderConfig: (
    providerType: 'smtp' | 'resend',
    { isEnabled }: { isEnabled: boolean }
  ): EmailProviderConfig => ({
    providerId: `${providerType}-provider`,
    providerType,
    isEnabled,
    config: providerType === 'smtp'
      ? { host: '', port: 587, username: '', password: '', from: '' }
      : { apiKey: '', from: '' },
  }),
}));

function buildSettings(
  emailProvider: TenantEmailSettings['emailProvider'],
  providerConfigs: EmailProviderConfig[]
): TenantEmailSettings {
  return {
    tenantId: 'tenant-123',
    customDomains: [],
    emailProvider,
    providerConfigs,
    trackingEnabled: false,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  };
}

describe('email settings provider invariants', () => {
  beforeEach(() => {
    createTenantKnexMock.mockReset();
    getTenantEmailSettingsMock.mockReset();
    createTenantKnexMock.mockResolvedValue({ knex: vi.fn() });
  });

  it('materializes editable provider configs for an existing empty settings row', async () => {
    getTenantEmailSettingsMock.mockResolvedValue(buildSettings('resend', []));

    const { getEmailSettings } = await import('./emailSettingsActions');
    const result = await getEmailSettings();

    expect(result).toMatchObject({
      emailProvider: 'resend',
      providerConfigs: [
        {
          providerId: 'smtp-provider',
          providerType: 'smtp',
          isEnabled: false,
          config: { host: '', port: 587, username: '', password: '', from: '' },
        },
        {
          providerId: 'resend-provider',
          providerType: 'resend',
          isEnabled: true,
          config: { apiKey: '', from: '' },
        },
      ],
    });
  });

  it('preserves an existing provider and only adds the missing editable provider', async () => {
    const resendConfig: EmailProviderConfig = {
      providerId: 'custom-resend',
      providerType: 'resend',
      isEnabled: true,
      config: { apiKey: 'secret-key', from: 'support@acme.test' },
      rateLimits: { perDay: 500 },
    };
    getTenantEmailSettingsMock.mockResolvedValue(buildSettings('resend', [resendConfig]));

    const { getEmailSettings } = await import('./emailSettingsActions');
    const result = await getEmailSettings();

    expect(result).toMatchObject({
      emailProvider: 'resend',
      providerConfigs: [
        {
          providerId: 'custom-resend',
          providerType: 'resend',
          isEnabled: true,
          config: { apiKey: '***', from: 'support@acme.test' },
          rateLimits: { perDay: 500 },
        },
        {
          providerId: 'smtp-provider',
          providerType: 'smtp',
          isEnabled: false,
        },
      ],
    });
  });

  it('normalizes enablement and preserves masked secrets when changing provider', async () => {
    const existingSettings = buildSettings('resend', [
      {
        providerId: 'smtp-provider',
        providerType: 'smtp',
        isEnabled: false,
        config: {
          host: 'relay.acme.test',
          port: 587,
          username: 'mailer',
          password: 'stored-password',
          from: 'support@acme.test',
        },
      },
      {
        providerId: 'resend-provider',
        providerType: 'resend',
        isEnabled: true,
        config: { apiKey: 'stored-api-key', from: 'support@acme.test' },
      },
    ]);
    const updateMock = vi.fn(async (_value: Record<string, unknown>) => 1);
    const whereMock = vi.fn(() => ({
      first: vi.fn(async () => ({ tenant: 'tenant-123' })),
      update: updateMock,
    }));
    const knexMock = vi.fn(() => ({
      where: whereMock,
      insert: vi.fn(async () => 1),
    })) as any;
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });
    getTenantEmailSettingsMock
      .mockResolvedValueOnce(existingSettings)
      .mockResolvedValueOnce({ ...existingSettings, emailProvider: 'smtp' });

    const { updateEmailSettings } = await import('./emailSettingsActions');
    await updateEmailSettings({
      emailProvider: 'smtp',
      providerConfigs: existingSettings.providerConfigs.map(config => ({
        ...config,
        config: {
          ...config.config,
          ...(config.providerType === 'smtp'
            ? { password: '***' }
            : { apiKey: '***' }),
        },
      })),
    });

    expect(updateMock).toHaveBeenCalledOnce();
    const persistedPayload = updateMock.mock.calls[0]?.[0];
    expect(persistedPayload).toBeDefined();
    const persisted = JSON.parse(persistedPayload?.provider_configs as string);
    expect(persisted).toEqual([
      expect.objectContaining({
        providerType: 'smtp',
        isEnabled: true,
        config: expect.objectContaining({ password: 'stored-password' }),
      }),
      expect.objectContaining({
        providerType: 'resend',
        isEnabled: false,
        config: expect.objectContaining({ apiKey: 'stored-api-key' }),
      }),
    ]);
  });
});
