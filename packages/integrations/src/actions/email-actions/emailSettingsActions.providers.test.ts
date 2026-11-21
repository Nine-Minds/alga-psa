import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailProviderConfig, TenantEmailSettings } from '@alga-psa/types';
import { connectionFingerprint } from '@alga-psa/core/providerConnectionIdentity';

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
      config: { apiKey: 'secret-key', from: 'support@acme.test', __secretFingerprint: connectionFingerprint({ providerId: 'custom-resend' }, 'resend') },
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
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('secret-key');
    expect(serialized).not.toContain('__secretFingerprint');
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
          __secretFingerprint: connectionFingerprint({ host: 'relay.acme.test', port: 587, username: 'mailer', password: 'stored-password', from: 'support@acme.test' }, 'smtp'),
        },
      },
      {
        providerId: 'resend-provider',
        providerType: 'resend',
        isEnabled: true,
        config: { apiKey: 'stored-api-key', from: 'support@acme.test', __secretFingerprint: connectionFingerprint({ providerId: 'resend-provider' }, 'resend', 'resend-provider') },
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
      maxDailyEmails: 250,
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
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ max_daily_emails: 250 }));
    expect(invalidateTenantSettingsMock).toHaveBeenCalledWith('tenant-123');
    const persistedPayload = updateMock.mock.calls[0]?.[0];
    expect(persistedPayload).toBeDefined();
    const persisted = JSON.parse(persistedPayload?.provider_configs as string);
    const smtpRef = persisted[0].config.secretRefs.password;
    const resendRef = persisted[1].config.secretRefs.apiKey;
    expect(persisted).toEqual([
      expect.objectContaining({
        providerType: 'smtp',
        isEnabled: true,
        config: expect.objectContaining({
          secretRefs: expect.objectContaining({ password: smtpRef }),
          __secretFingerprint: connectionFingerprint(existingSettings.providerConfigs[0].config, 'smtp'),
        }),
      }),
      expect.objectContaining({
        providerType: 'resend',
        isEnabled: false,
        config: expect.objectContaining({
          secretRefs: expect.objectContaining({ apiKey: resendRef }),
          __secretFingerprint: connectionFingerprint(existingSettings.providerConfigs[1].config, 'resend', 'resend-provider'),
        }),
      }),
    ]);
    expect(secretStore.data.get(smtpRef)).toBe('stored-password');
    expect(secretStore.data.get(resendRef)).toBe('stored-api-key');
    expect(persistedPayload?.provider_configs).not.toContain('stored-password');
    expect(persistedPayload?.provider_configs).not.toContain('stored-api-key');
  });

  it('never returns stored passwords, API keys, or internal fingerprints to clients', async () => {
    const smtp: any = { providerId: 'smtp-main', providerType: 'smtp', isEnabled: true, config: { host: 'smtp.test', port: 587, username: 'mailer', password: 'password-value', from: 'support@example.test' } };
    smtp.config.__secretFingerprint = connectionFingerprint(smtp.config, 'smtp');
    const resend: any = { providerId: 'resend-main', providerType: 'resend', isEnabled: false, config: { apiKey: 'api-key-value', from: 'support@example.test' } };
    resend.config.__secretFingerprint = connectionFingerprint(resend.config, 'resend');
    getTenantEmailSettingsMock.mockResolvedValue(buildSettings('smtp', [smtp, resend]));

    const { getEmailSettings } = await import('./emailSettingsActions');
    const result = await getEmailSettings();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('password-value');
    expect(serialized).not.toContain('api-key-value');
    expect(serialized).not.toContain('__secretFingerprint');
    expect(result).toMatchObject({ providerConfigs: expect.arrayContaining([
      expect.objectContaining({ providerType: 'smtp', config: expect.objectContaining({ password: '***' }) }),
      expect.objectContaining({ providerType: 'resend', config: expect.objectContaining({ apiKey: '***' }) }),
    ]) });
  });

  it('returns legacy Resend api_key masked through the authenticated settings action', async () => {
    const config = { api_key: 'synthetic-resend-secret', from: 'support@example.test' };
    const settings = buildSettings('resend', [{ providerId: 'resend-legacy', providerType: 'resend', isEnabled: true, config }]);
    getTenantEmailSettingsMock.mockResolvedValue(settings);

    const { getEmailSettings } = await import('./emailSettingsActions');
    const result = await getEmailSettings();
    const serialized = JSON.stringify(result);
    expect(result).toMatchObject({ providerConfigs: expect.arrayContaining([
      expect.objectContaining({ providerType: 'resend', config: expect.objectContaining({ apiKey: '***', from: 'support@example.test' }) }),
    ]) });
    expect(serialized).not.toContain('synthetic-resend-secret');
    expect(serialized).not.toContain('api_key');
    expect(serialized).not.toContain('__secretFingerprint');
  });

  it('preserves alias-backed Resend credentials across unchanged-scope masked edits and canonicalizes them', async () => {
    const original: Record<string, any> = { api_key: 'synthetic-resend-secret', from: 'support@example.test' };
    original.__secretFingerprint = connectionFingerprint(original, 'resend', 'resend-main');
    const existing = buildSettings('resend', [{ providerId: 'resend-main', providerType: 'resend', isEnabled: true, config: original }]);
    const updateMock = vi.fn(async (_value: Record<string, any>) => 1);
    const query = { where: vi.fn(() => query), whereNotNull: vi.fn(() => query), first: vi.fn(async () => ({ tenant: 'tenant-123' })), select: vi.fn(async () => []), update: updateMock } as any;
    const knexMock: any = vi.fn(() => query);
    knexMock.transaction = async (callback: (trx: any) => Promise<unknown>) => callback(knexMock);
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });
    getTenantEmailSettingsMock.mockResolvedValue(existing);

    const { updateEmailSettings } = await import('./emailSettingsActions');
    await updateEmailSettings({ maxDailyEmails: 123, providerConfigs: [{ ...existing.providerConfigs[0], config: { api_key: '***', from: 'support@example.test' } }] });
    const saved = JSON.parse(String(updateMock.mock.calls[0]?.[0]?.provider_configs))[0].config;
    expect(secretStore.data.get(saved.secretRefs.apiKey)).toBe('synthetic-resend-secret');
    expect(saved).toMatchObject({ __secretFingerprint: connectionFingerprint(original, 'resend', 'resend-main') });
    expect(saved).not.toHaveProperty('apiKey');
    expect(saved).not.toHaveProperty('api_key');
  });

  it('accepts alias-backed replacement secrets and writes a canonical fingerprint', async () => {
    const oldConfig = { api_key: 'old-synthetic-secret', from: 'support@example.test' };
    const oldStored = { ...oldConfig, __secretFingerprint: connectionFingerprint(oldConfig, 'resend', 'resend-main') };
    const existing = buildSettings('resend', [{ providerId: 'resend-main', providerType: 'resend', isEnabled: true, config: oldStored }]);
    const updateMock = vi.fn(async (_value: Record<string, any>) => 1);
    const query: any = { where: vi.fn(() => query), whereNotNull: vi.fn(() => query), first: vi.fn(async () => ({ tenant: 'tenant-123' })), select: vi.fn(async () => []), update: updateMock };
    const knexMock: any = vi.fn(() => query);
    knexMock.transaction = async (callback: (trx: any) => Promise<unknown>) => callback(knexMock);
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });
    getTenantEmailSettingsMock.mockResolvedValue(existing);
    const { updateEmailSettings } = await import('./emailSettingsActions');
    await updateEmailSettings({ providerConfigs: [{ ...existing.providerConfigs[0], config: { api_key: 'replacement-synthetic-secret', from: 'support@example.test' } }] });
    const saved = JSON.parse(String(updateMock.mock.calls[0]?.[0]?.provider_configs))[0].config;
    expect(secretStore.data.get(saved.secretRefs.apiKey)).toBe('replacement-synthetic-secret');
    expect(saved).not.toHaveProperty('apiKey');
    expect(saved).not.toHaveProperty('api_key');
    expect(saved.__secretFingerprint).toBe(connectionFingerprint(saved, 'resend', 'resend-main'));
  });

  it('requires a real stored Resend secret before honoring an alias mask', async () => {
    const existing = buildSettings('resend', [{ providerId: 'resend-main', providerType: 'resend', isEnabled: true, config: { from: 'support@example.test' } }]);
    getTenantEmailSettingsMock.mockResolvedValue(existing);
    const transactionMock = vi.fn();
    const knexMock: any = vi.fn();
    knexMock.transaction = transactionMock;
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });
    const { updateEmailSettings } = await import('./emailSettingsActions');
    const result = await updateEmailSettings({ providerConfigs: [{ ...existing.providerConfigs[0], config: { api_key: '***', from: 'support@example.test' } }] });
    expect(JSON.stringify(result)).toContain('secretRequiredAfterConnectionChange');
    expect(transactionMock).not.toHaveBeenCalled();
    expect(JSON.stringify(existing.providerConfigs)).not.toContain('api_key');
  });

  it('rejects an alias when a provider-type change would make it unsupported', async () => {
    const existing = buildSettings('resend', [{ providerId: 'shared-id', providerType: 'resend', isEnabled: true, config: { api_key: 'stored-synthetic-secret' } }]);
    getTenantEmailSettingsMock.mockResolvedValue(existing);
    const transactionMock = vi.fn();
    const knexMock: any = vi.fn();
    knexMock.transaction = transactionMock;
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });
    const { updateEmailSettings } = await import('./emailSettingsActions');
    const result = await updateEmailSettings({ providerConfigs: [{ providerId: 'shared-id', providerType: 'smtp', isEnabled: true, config: { host: 'smtp.example.test', port: 587, api_key: 'synthetic-resend-secret' } }] });
    expect(JSON.stringify(result)).toContain('secretRequiredAfterConnectionChange');
    expect(JSON.stringify(result)).not.toContain('synthetic-resend-secret');
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejects conflicting Resend secret spellings without persisting or returning either secret', async () => {
    const existing = buildSettings('resend', [{ providerId: 'resend-main', providerType: 'resend', isEnabled: true, config: { apiKey: 'stored-synthetic-secret', __secretFingerprint: connectionFingerprint({}, 'resend') } }]);
    getTenantEmailSettingsMock.mockResolvedValue(existing);
    const transactionMock = vi.fn();
    const knexMock: any = vi.fn();
    knexMock.transaction = transactionMock;
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });
    const { updateEmailSettings } = await import('./emailSettingsActions');
    const result = await updateEmailSettings({ providerConfigs: [{ ...existing.providerConfigs[0], config: { apiKey: 'canonical-synthetic-secret', api_key: 'alias-synthetic-secret' } }] });
    expect(transactionMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('canonical-synthetic-secret');
    expect(JSON.stringify(result)).not.toContain('alias-synthetic-secret');
    expect(JSON.stringify(result)).toContain('secretRequiredAfterConnectionChange');
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

  it('rejects a changed SMTP host with a masked password before writing settings', async () => {
    const smtp = { providerId: 'smtp-main', providerType: 'smtp' as const, isEnabled: true, config: { host: 'smtp.old.test', port: 587, username: 'mailer', password: 'credential-value', secure: false, requireTLS: true, rejectUnauthorized: true, from: 'support@example.test' } as Record<string, any> };
    smtp.config.__secretFingerprint = connectionFingerprint(smtp.config, 'smtp');
    const existing = buildSettings('smtp', [smtp]);
    const rowBefore = JSON.stringify(existing.providerConfigs);
    const updateMock = vi.fn(async () => 1);
    const transactionMock = vi.fn();
    const knexMock = vi.fn(() => ({ first: vi.fn(async () => ({ provider_configs: rowBefore })), update: updateMock })) as any;
    knexMock.transaction = transactionMock;
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });
    getTenantEmailSettingsMock.mockResolvedValue(existing);

    const { updateEmailSettings } = await import('./emailSettingsActions');
    const result = await updateEmailSettings({ providerConfigs: [{ ...smtp, config: { ...smtp.config, host: 'smtp.new.test', password: '***' } }] });

    expect(JSON.stringify(result)).toContain('secretRequiredAfterConnectionChange');
    expect(JSON.stringify(existing.providerConfigs)).toBe(rowBefore);
    expect(updateMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it.each([
    ['port', 2525], ['secure', true], ['username', 'different-user'], ['ignoreTLS', true], ['requireTLS', false], ['rejectUnauthorized', false],
  ])('rejects masked-secret reuse when SMTP %s changes', async (field, value) => {
    const config: Record<string, any> = { host: 'smtp.example.test', port: 587, username: 'mailer', password: 'credential-value', secure: false, requireTLS: true, rejectUnauthorized: true, from: 'support@example.test' };
    config.__secretFingerprint = connectionFingerprint(config, 'smtp');
    const existing = buildSettings('smtp', [{ providerId: 'smtp-main', providerType: 'smtp', isEnabled: true, config }]);
    getTenantEmailSettingsMock.mockResolvedValue(existing);
    const { updateEmailSettings } = await import('./emailSettingsActions');
    const result = await updateEmailSettings({ providerConfigs: [{ ...existing.providerConfigs[0], config: { ...config, [field]: value, password: '***' } }] });
    expect(JSON.stringify(result)).toContain('secretRequiredAfterConnectionChange');
  });

  it('requires an existing secret before honoring a mask', async () => {
    const existing = buildSettings('smtp', [{ providerId: 'smtp-main', providerType: 'smtp', isEnabled: true, config: { host: 'smtp.example.test', port: 587, username: '', from: 'support@example.test' } }]);
    getTenantEmailSettingsMock.mockResolvedValue(existing);
    const { updateEmailSettings } = await import('./emailSettingsActions');
    const result = await updateEmailSettings({ providerConfigs: [{ ...existing.providerConfigs[0], config: { ...existing.providerConfigs[0].config, password: '***' } }] });
    expect(JSON.stringify(result)).toContain('secretRequiredAfterConnectionChange');
  });

  it('does not let a provider id reused under a different type inherit the prior secret', async () => {
    const config: Record<string, any> = { host: 'smtp.example.test', port: 587, username: 'mailer', password: 'credential-value' };
    config.__secretFingerprint = connectionFingerprint(config, 'smtp');
    const existing = buildSettings('smtp', [{ providerId: 'shared-id', providerType: 'smtp', isEnabled: true, config }]);
    getTenantEmailSettingsMock.mockResolvedValue(existing);
    const { updateEmailSettings } = await import('./emailSettingsActions');
    const result = await updateEmailSettings({ providerConfigs: [{ providerId: 'shared-id', providerType: 'resend', isEnabled: true, config: { apiKey: '***' } }] });
    expect(JSON.stringify(result)).toContain('secretRequiredAfterConnectionChange');
  });

  it('accepts a changed host with a replacement password and stores its new fingerprint', async () => {
    const oldConfig: Record<string, any> = { host: 'smtp.old.test', port: 587, username: 'mailer', password: 'old-secret', secure: false, requireTLS: false, rejectUnauthorized: true, from: 'support@example.test' };
    oldConfig.__secretFingerprint = connectionFingerprint(oldConfig, 'smtp');
    const existing = buildSettings('smtp', [{ providerId: 'smtp-main', providerType: 'smtp', isEnabled: true, config: oldConfig }]);
    const updateMock = vi.fn(async (_value: Record<string, unknown>) => 1);
    const makeQuery = (table: string) => {
      const query: any = {
        where: vi.fn(() => query), whereNotNull: vi.fn(() => query),
        first: vi.fn(async () => table === 'tenant_email_settings' ? { tenant: 'tenant-123' } : null),
        select: vi.fn(async () => []), update: updateMock, insert: vi.fn(async () => 1),
      };
      return query;
    };
    const knexMock: any = vi.fn((table: string) => makeQuery(table));
    knexMock.transaction = async (callback: (trx: any) => Promise<unknown>) => callback(knexMock);
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });
    getTenantEmailSettingsMock.mockResolvedValue(existing);

    const { updateEmailSettings } = await import('./emailSettingsActions');
    await updateEmailSettings({ providerConfigs: [{ ...existing.providerConfigs[0], config: { ...oldConfig, host: 'smtp.new.test', password: 'new-secret' } }] });

    const persisted = JSON.parse(String(updateMock.mock.calls[0]?.[0]?.provider_configs));
    const savedConfig = persisted[0].config;
    expect(secretStore.data.get(savedConfig.secretRefs.password)).toBe('new-secret');
    expect(savedConfig).not.toHaveProperty('password');
    expect(savedConfig.__secretFingerprint).toBe(connectionFingerprint(savedConfig, 'smtp'));
    expect(savedConfig.__secretFingerprint).not.toBe(oldConfig.__secretFingerprint);
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
