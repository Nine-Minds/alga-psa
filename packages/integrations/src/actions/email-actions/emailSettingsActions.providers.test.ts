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
    providerType: 'smtp' | 'resend' | 'microsoft',
    { isEnabled }: { isEnabled: boolean }
  ): EmailProviderConfig => ({
    providerId: `${providerType}-provider`,
    providerType,
    isEnabled,
    config: providerType === 'smtp'
      ? { host: '', port: 587, username: '', password: '', from: '' }
      : providerType === 'resend'
      ? { apiKey: '', from: '' }
      : { inboundProviderId: '', mailbox: '', from: '' },
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
        {
          providerId: 'microsoft-provider',
          providerType: 'microsoft',
          isEnabled: false,
          config: { inboundProviderId: '', mailbox: '', from: '' },
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
        {
          providerId: 'microsoft-provider',
          providerType: 'microsoft',
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

  it('pins Microsoft outbound settings to a connected tenant mailbox', async () => {
    const existingSettings = buildSettings('smtp', [
      {
        providerId: 'smtp-provider',
        providerType: 'smtp',
        isEnabled: true,
        config: { host: 'smtp.test', port: 587, from: 'old@example.net' },
      },
      {
        providerId: 'microsoft-provider',
        providerType: 'microsoft',
        isEnabled: false,
        config: { inboundProviderId: '', mailbox: '', from: '' },
      },
    ]);
    const updateMock = vi.fn(async (_value: Record<string, unknown>) => 1);
    const knexMock = vi.fn((table: string) => {
      const builder: any = {
        where: vi.fn(() => builder),
        first: vi.fn(async () => table === 'email_providers'
          ? {
              id: 'microsoft-inbound-1',
              mailbox: 'support@contoso.example',
              provider_name: 'Contoso Support',
              sender_display_name: 'Contoso Support',
              status: 'connected',
            }
          : { tenant: 'tenant-123' }),
        update: updateMock,
        insert: vi.fn(async () => 1),
      };
      return builder;
    }) as any;
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });
    getTenantEmailSettingsMock
      .mockResolvedValueOnce(existingSettings)
      .mockResolvedValueOnce({
        ...existingSettings,
        emailProvider: 'microsoft',
        defaultFromDomain: 'contoso.example',
        ticketingFromEmail: 'support@contoso.example',
      });

    const { updateEmailSettings } = await import('./emailSettingsActions');
    const result = await updateEmailSettings({
      emailProvider: 'microsoft',
      providerConfigs: existingSettings.providerConfigs.map(config =>
        config.providerType === 'microsoft'
          ? {
              ...config,
              config: { inboundProviderId: 'microsoft-inbound-1' },
            }
          : config
      ),
    });

    expect(result).toMatchObject({ emailProvider: 'microsoft' });
    expect(updateMock).toHaveBeenCalledOnce();
    const payload = updateMock.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      email_provider: 'microsoft',
      default_from_domain: 'contoso.example',
      ticketing_from_email: 'support@contoso.example',
    });
    const configs = JSON.parse(String(payload?.provider_configs));
    expect(configs).toContainEqual({
      providerId: 'microsoft-inbound-1',
      providerType: 'microsoft',
      isEnabled: true,
      config: {
        inboundProviderId: 'microsoft-inbound-1',
        mailbox: 'support@contoso.example',
        from: 'support@contoso.example',
        fromName: 'Contoso Support',
      },
    });
    expect(configs.find((config: EmailProviderConfig) => config.providerType === 'smtp')?.isEnabled).toBe(false);
  });
});
