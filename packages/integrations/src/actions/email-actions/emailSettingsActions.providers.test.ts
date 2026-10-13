import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailProviderConfig, TenantEmailSettings } from '@alga-psa/types';

const { createTenantKnexMock, getTenantEmailSettingsMock, invalidateTenantSettingsMock, secretStore } = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    createTenantKnexMock: vi.fn(),
    getTenantEmailSettingsMock: vi.fn(),
    invalidateTenantSettingsMock: vi.fn(),
    secretStore: {
      data,
      getTenantSecret: vi.fn(async (_tenant: string, name: string) => data.get(name)),
      setTenantSecret: vi.fn(async (_tenant: string, name: string, value: string | null) => {
        if (value === null) data.delete(name); else data.set(name, value);
      }),
      deleteTenantSecret: vi.fn(async (_tenant: string, name: string) => { data.delete(name); }),
    },
  };
});

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => secretStore),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
  }),
}));

vi.mock('@alga-psa/auth', () => ({
  hasPermission: vi.fn(async () => true),
  withAuth: (fn: any) => async (...args: any[]) =>
    fn({ id: 'user-1', tenant: 'tenant-123' }, { tenant: 'tenant-123' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: {
    getTenantEmailSettings: getTenantEmailSettingsMock,
    invalidateTenantSettings: invalidateTenantSettingsMock,
  },
  resolveTenantCompanyName: vi.fn(async () => 'Example MSP'),
  resolveDefaultFromAddress: vi.fn((settings: TenantEmailSettings, companyName: string) => ({
    email: settings.providerConfigs.find(config => config.isEnabled)?.config.from || 'notifications@example.test',
    name: companyName,
  })),
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
    invalidateTenantSettingsMock.mockReset();
    invalidateTenantSettingsMock.mockResolvedValue(undefined);
    createTenantKnexMock.mockResolvedValue({ knex: vi.fn() });
    secretStore.data.clear();
    secretStore.setTenantSecret.mockClear();
    secretStore.deleteTenantSecret.mockClear();
  });

  it('materializes editable provider configs for an existing empty settings row', async () => {
    getTenantEmailSettingsMock.mockResolvedValue(buildSettings('resend', []));

    const { getEmailSettings } = await import('./emailSettingsActions');
    const result = await getEmailSettings();

    expect(result).toMatchObject({
      emailProvider: 'resend',
      tenantCompanyName: 'Example MSP',
      effectiveNotificationFrom: {
        email: 'notifications@example.test',
        name: 'Example MSP',
      },
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

  it('normalizes enablement and migrates masked legacy secrets into the secret store when changing provider', async () => {
    const existingSettings = buildSettings('resend', [
      {
        providerId: 'smtp-provider',
        providerType: 'smtp',
        isEnabled: false,
        config: {
          host: 'relay.acme.test',
          port: 587,
          username: 'mailer',
          password: 'stored-password', // legacy plaintext, migrated on save
          from: 'support@acme.test',
        },
      },
      {
        providerId: 'resend-provider',
        providerType: 'resend',
        isEnabled: true,
        config: { apiKey: 'stored-api-key', from: 'support@acme.test' }, // legacy plaintext
      },
    ]);
    const updateMock = vi.fn(async (_value: Record<string, unknown>) => 1);
    const whereMock = vi.fn(() => ({
      first: vi.fn(async () => ({ tenant: 'tenant-123' })),
      update: updateMock,
      whereNotNull: vi.fn(() => ({ update: updateMock })),
      select: vi.fn(async () => []),
    }));
    const knexMock = vi.fn(() => ({
      where: whereMock,
      insert: vi.fn(async () => 1),
      select: vi.fn(async () => []),
    })) as any;
    knexMock.transaction = async (callback: (trx: any) => Promise<unknown>) => callback(knexMock);
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

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ provider_configs: expect.any(String) }));
    expect(invalidateTenantSettingsMock).toHaveBeenCalledWith('tenant-123');
    const persistedPayload = updateMock.mock.calls[0]?.[0];
    expect(persistedPayload).toBeDefined();
    const persisted = JSON.parse(persistedPayload?.provider_configs as string);
    const smtpRef = persisted[0].config.secretRefs.password;
    const resendRef = persisted[1].config.secretRefs.apiKey;
    expect(persisted).toEqual([
      expect.objectContaining({ providerType: 'smtp', isEnabled: true }),
      expect.objectContaining({ providerType: 'resend', isEnabled: false }),
    ]);
    expect(secretStore.data.get(smtpRef)).toBe('stored-password');
    expect(secretStore.data.get(resendRef)).toBe('stored-api-key');
    expect(persistedPayload?.provider_configs).not.toContain('stored-password');
    expect(persistedPayload?.provider_configs).not.toContain('stored-api-key');
  });

  it('rejects a transport change that would invalidate a saved sender identity', async () => {
    const existingSettings = buildSettings('smtp', [
      { providerId: 'smtp-provider', providerType: 'smtp', isEnabled: true, config: { host: 'relay', port: 587, username: 'mailer', password: 'secret', from: 'support@unverified.example' } },
    ]);
    getTenantEmailSettingsMock.mockResolvedValue(existingSettings);
    const knexMock = vi.fn((table: string) => {
      const query: any = {
        where: vi.fn(() => query),
        whereNotNull: vi.fn(() => query),
        select: vi.fn(async () => table === 'email_sender_addresses' ? [
          { sender_id: 'sender-1', email_address: 'support@unverified.example', verification_status: 'unverified' },
        ] : []),
        first: vi.fn(async () => null),
        insert: vi.fn(async () => 1),
      };
      return query;
    }) as any;
    knexMock.transaction = async (callback: (trx: any) => Promise<unknown>) => callback(knexMock);
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    const { updateEmailSettings } = await import('./emailSettingsActions');
    const result = await updateEmailSettings({ emailProvider: 'resend' });

    expect(JSON.stringify(result)).toMatch(/Cannot change transport/);
    expect(invalidateTenantSettingsMock).not.toHaveBeenCalled();
  });

  it('pins Microsoft outbound settings to a connected tenant mailbox without changing ticket identity', async () => {
    const existingSettings = {
      ...buildSettings('smtp', [
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
        config: { inboundProviderId: '', mailbox: '', from: '', fromName: 'Billing Team' },
      },
      ]),
      ticketingFromEmail: 'support@contoso.example',
      ticketingFromName: 'Support Team',
    };
    const updateMock = vi.fn(async (_value: Record<string, unknown>) => 1);
    const knexMock = vi.fn((table: string) => {
      const builder: any = {
        where: vi.fn(() => builder),
        whereNotNull: vi.fn(() => builder),
        select: vi.fn(async () => []),
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
    knexMock.transaction = async (callback: (trx: any) => Promise<unknown>) => callback(knexMock);
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });
    getTenantEmailSettingsMock
      .mockResolvedValueOnce(existingSettings)
      .mockResolvedValueOnce({
        ...existingSettings,
        emailProvider: 'microsoft',
        defaultFromDomain: 'contoso.example',
        ticketingFromEmail: 'support@contoso.example',
        ticketingFromName: 'Support Team',
      });

    const { updateEmailSettings } = await import('./emailSettingsActions');
    const result = await updateEmailSettings({
      emailProvider: 'microsoft',
      providerConfigs: existingSettings.providerConfigs.map(config =>
        config.providerType === 'microsoft'
          ? {
              ...config,
              config: { inboundProviderId: 'microsoft-inbound-1', fromName: ' Billing Team ' },
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
    });
    expect(payload).not.toHaveProperty('ticketing_from_email');
    expect(payload).not.toHaveProperty('ticketing_from_name');
    const configs = JSON.parse(String(payload?.provider_configs));
    expect(configs).toContainEqual({
      providerId: 'microsoft-inbound-1',
      providerType: 'microsoft',
      isEnabled: true,
      config: {
        inboundProviderId: 'microsoft-inbound-1',
        mailbox: 'support@contoso.example',
        from: 'support@contoso.example',
        fromName: 'Billing Team',
      },
    });
    expect(configs.find((config: EmailProviderConfig) => config.providerType === 'smtp')?.isEnabled).toBe(false);
  });


  describe('secret handling', () => {
    const FAKE_PASSWORD = 'fake-smtp-password-7f3a';
    const FAKE_KEY = 'fake-resend-key-91bd';

    function knexWith(opts: { failTransaction?: boolean; senders?: any[] } = {}) {
      const updateMock = vi.fn(async (_value: Record<string, unknown>) => 1);
      const knexMock = vi.fn((table: string) => {
        const builder: any = {
          where: vi.fn(() => builder),
          whereNotNull: vi.fn(() => builder),
          select: vi.fn(async () => table === 'email_sender_addresses' ? opts.senders ?? [] : []),
          first: vi.fn(async () => ({ tenant: 'tenant-123' })),
          update: updateMock,
          insert: vi.fn(async () => 1),
        };
        return builder;
      }) as any;
      knexMock.transaction = async (callback: (trx: any) => Promise<unknown>) => {
        if (opts.failTransaction) throw new Error('db down');
        return callback(knexMock);
      };
      createTenantKnexMock.mockResolvedValue({ knex: knexMock });
      return { updateMock };
    }

    const smtpConfig = (config: Record<string, any>): EmailProviderConfig => ({
      providerId: 'smtp-provider', providerType: 'smtp', isEnabled: true,
      config: { host: 'relay.acme.test', port: 587, username: 'mailer', from: 'support@acme.test', ...config },
    });

    function deepStrings(value: unknown, out: string[] = []): string[] {
      if (typeof value === 'string') out.push(value);
      else if (Array.isArray(value)) value.forEach(v => deepStrings(v, out));
      else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) { out.push(k); deepStrings(v, out); }
      }
      return out;
    }

    function expectNoSecretLeak(result: unknown, secrets: string[]) {
      const serialized = JSON.stringify(result);
      const strings = deepStrings(JSON.parse(serialized));
      expect(serialized).not.toContain('secretRefs');
      expect(serialized).not.toContain('email_outbound_');
      expect(serialized).not.toContain('api_key');
      for (const secret of secrets) expect(serialized).not.toContain(secret);
      for (const secret of secrets) expect(strings.some(v => v === secret)).toBe(false);
    }

    it('writes the secret to the store and persists refs only', async () => {
      const { updateMock } = knexWith();
      const existing = buildSettings('smtp', [smtpConfig({ password: '' })]);
      const savedRef = 'email_outbound_smtp_password_00000000-0000-4000-8000-0000000000aa';
      getTenantEmailSettingsMock.mockResolvedValueOnce(existing).mockImplementationOnce(async () => {
        const persisted = JSON.parse(String(updateMock.mock.calls[0]?.[0].provider_configs));
        return buildSettings('smtp', persisted);
      });
      void savedRef;

      const { updateEmailSettings } = await import('./emailSettingsActions');
      const result = await updateEmailSettings({
        emailProvider: 'smtp',
        providerConfigs: [smtpConfig({ password: FAKE_PASSWORD })],
      });

      expect(secretStore.setTenantSecret).toHaveBeenCalledTimes(1);
      const [tenant, name, value] = secretStore.setTenantSecret.mock.calls[0];
      expect(tenant).toBe('tenant-123');
      expect(name).toMatch(/^email_outbound_smtp_password_[0-9a-f-]{36}$/);
      expect(value).toBe(FAKE_PASSWORD);

      const persistedJson = String(updateMock.mock.calls[0]?.[0].provider_configs);
      expect(persistedJson).not.toContain(FAKE_PASSWORD);
      expect(JSON.parse(persistedJson)[0].config.secretRefs).toEqual({ password: name });
      expect(JSON.parse(persistedJson)[0].config).not.toHaveProperty('password');

      // Response: masked, no refs, no values.
      expect((result as any).providerConfigs[0].config.password).toBe('***');
      expectNoSecretLeak(result, [FAKE_PASSWORD]);
    });

    it('deletes the new ref when the DB transaction fails, and keeps the old credential', async () => {
      knexWith({ failTransaction: true });
      const oldRef = 'email_outbound_smtp_password_00000000-0000-4000-8000-0000000000bb';
      secretStore.data.set(oldRef, 'fake-old-password');
      getTenantEmailSettingsMock.mockResolvedValueOnce(buildSettings('smtp', [
        smtpConfig({ secretRefs: { password: oldRef } }),
      ]));

      const { updateEmailSettings } = await import('./emailSettingsActions');
      const result = await updateEmailSettings({
        emailProvider: 'smtp',
        providerConfigs: [smtpConfig({ password: FAKE_PASSWORD })],
      });

      expect(JSON.stringify(result)).toMatch(/Failed to update email settings/);
      const written = secretStore.setTenantSecret.mock.calls[0][1];
      expect(secretStore.deleteTenantSecret).toHaveBeenCalledWith('tenant-123', written);
      expect(secretStore.deleteTenantSecret).not.toHaveBeenCalledWith('tenant-123', oldRef);
      expect(secretStore.data.has(written)).toBe(false);
      expect(secretStore.data.get(oldRef)).toBe('fake-old-password');
      expect(invalidateTenantSettingsMock).not.toHaveBeenCalled();
    });

    it('deletes the replaced ref only after a successful commit', async () => {
      knexWith();
      const oldRef = 'email_outbound_smtp_password_00000000-0000-4000-8000-0000000000cc';
      secretStore.data.set(oldRef, 'fake-old-password');
      getTenantEmailSettingsMock.mockResolvedValue(buildSettings('smtp', [
        smtpConfig({ secretRefs: { password: oldRef } }),
      ]));

      const { updateEmailSettings } = await import('./emailSettingsActions');
      await updateEmailSettings({ emailProvider: 'smtp', providerConfigs: [smtpConfig({ password: FAKE_PASSWORD })] });

      expect(secretStore.deleteTenantSecret).toHaveBeenCalledWith('tenant-123', oldRef);
    });

    it('never writes a secret when validation rejects the save', async () => {
      knexWith({ senders: [{ email_address: 'not-an-email' }] });
      getTenantEmailSettingsMock.mockResolvedValue(buildSettings('resend', [
        { providerId: 'resend-provider', providerType: 'resend', isEnabled: true, config: { from: 'a@acme.test' } },
      ]));

      const { updateEmailSettings } = await import('./emailSettingsActions');
      const senderReject = await updateEmailSettings({
        emailProvider: 'smtp',
        providerConfigs: [smtpConfig({ password: FAKE_PASSWORD })],
      });
      expect(JSON.stringify(senderReject)).toMatch(/Cannot change transport/);

      knexWith();
      const fromReject = await updateEmailSettings({
        emailProvider: 'smtp',
        providerConfigs: [smtpConfig({ password: FAKE_PASSWORD, from: 'junk-from' })],
      });
      expect(JSON.stringify(fromReject)).toMatch(/From address must be a valid email/);

      const domainReject = await updateEmailSettings({
        emailProvider: 'smtp',
        defaultFromDomain: 'not a domain',
        providerConfigs: [smtpConfig({ password: FAKE_PASSWORD })],
      });
      expect(JSON.stringify(domainReject)).toMatch(/domain must be a valid domain/);

      expect(secretStore.setTenantSecret).not.toHaveBeenCalled();
      expect(secretStore.deleteTenantSecret).not.toHaveBeenCalled();
    });

    it('getEmailSettings never returns secrets, aliases, refs or ref-shaped values', async () => {
      knexWith();
      const ref = 'email_outbound_smtp_password_00000000-0000-4000-8000-0000000000dd';
      const resendRef = 'email_outbound_resend_api_key_00000000-0000-4000-8000-0000000000ee';
      getTenantEmailSettingsMock.mockResolvedValue(buildSettings('smtp', [
        smtpConfig({ secretRefs: { password: ref }, password: FAKE_PASSWORD }),
        { providerId: 'resend-provider', providerType: 'resend', isEnabled: false,
          config: { from: 'a@acme.test', api_key: FAKE_KEY, apiKey: FAKE_KEY, secretRefs: { apiKey: resendRef } } },
        { providerId: 'resend-legacy', providerType: 'resend', isEnabled: false, config: { api_key: FAKE_KEY } },
      ]));

      const { getEmailSettings } = await import('./emailSettingsActions');
      const result = await getEmailSettings() as any;

      expect(result.providerConfigs[0].config.password).toBe('***');
      expect(result.providerConfigs[1].config.apiKey).toBe('***');
      expect(result.providerConfigs[2].config.apiKey).toBe('***');
      expectNoSecretLeak(result, [FAKE_PASSWORD, FAKE_KEY, ref, resendRef]);
    });
  });
});
