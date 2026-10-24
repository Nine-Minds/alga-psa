import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailProviderConfig, TenantEmailSettings } from '@alga-psa/types';

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  appSecrets: new Map<string, string>(),
  getTenantSecret: vi.fn(),
  getAppSecret: vi.fn(),
  smtpInit: vi.fn(async () => undefined),
  resendInit: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: h.getTenantSecret,
    getAppSecret: h.getAppSecret,
    setTenantSecret: vi.fn(),
    deleteTenantSecret: vi.fn(),
  })),
}));
vi.mock('@alga-psa/db', () => ({ getConnection: vi.fn(), tenantDb: vi.fn() }));
vi.mock('@alga-psa/shared/services/email/microsoftEmailProviderConfig', () => ({
  buildMicrosoftEmailProviderConfig: vi.fn(),
}));
vi.mock('../SMTPEmailProvider', () => ({
  SMTPEmailProvider: class {
    providerType = 'smtp';
    constructor(public providerId: string) {}
    initialize = h.smtpInit;
  },
}));
vi.mock('../ResendEmailProvider', () => ({
  ResendEmailProvider: class {
    providerType = 'resend';
    constructor(public providerId: string) {}
    initialize = h.resendInit;
  },
}));

import { EmailProviderManager } from '../EmailProviderManager';

const REF = 'email_outbound_smtp_password_3f2a9c1e-1111-4222-8333-444455556666';
const RESEND_REF = 'email_outbound_resend_api_key_3f2a9c1e-1111-4222-8333-444455556666';

function settings(config: EmailProviderConfig): TenantEmailSettings {
  return {
    tenantId: 'tenant-1', customDomains: [], emailProvider: config.providerType as any,
    providerConfigs: [config], trackingEnabled: false, createdAt: new Date(), updatedAt: new Date(),
  };
}

describe('EmailProviderManager secret resolution', () => {
  beforeEach(() => {
    h.store.clear();
    h.appSecrets.clear();
    h.smtpInit.mockClear();
    h.resendInit.mockClear();
    h.getTenantSecret.mockReset().mockImplementation(async (_t: string, name: string) => h.store.get(name));
    h.getAppSecret.mockReset().mockImplementation(async (name: string) => h.appSecrets.get(name));
    delete process.env.RESEND_API_KEY;
  });

  it('initializes SMTP with the resolved password', async () => {
    h.store.set(REF, 'fake-resolved-pw');
    await new EmailProviderManager().initialize(settings({
      providerId: 'smtp-provider', providerType: 'smtp', isEnabled: true,
      config: { host: 'h', port: 587, username: 'u', secretRefs: { password: REF } },
    }));
    expect(h.smtpInit).toHaveBeenCalledWith(expect.objectContaining({ password: 'fake-resolved-pw', host: 'h' }));
    expect((h.smtpInit.mock.calls[0] as any[])[0]).not.toHaveProperty('secretRefs');
  });

  it('fails fast when the SMTP ref is unreadable', async () => {
    await expect(new EmailProviderManager().initialize(settings({
      providerId: 'smtp-provider', providerType: 'smtp', isEnabled: true,
      config: { host: 'h', secretRefs: { password: REF } },
    }))).rejects.toMatchObject({ errorCode: 'EMAIL_PROVIDER_SECRET_MISSING' });
    expect(h.smtpInit).not.toHaveBeenCalled();
  });

  it('Resend with a ref does not consult env or app fallbacks', async () => {
    h.store.set(RESEND_REF, 'fake-tenant-key');
    h.appSecrets.set('resend_api_key', 'fake-app-key');
    process.env.RESEND_API_KEY = 'fake-env-key';
    await new EmailProviderManager().initialize(settings({
      providerId: 'resend-provider', providerType: 'resend', isEnabled: true,
      config: { from: 'a@b.test', secretRefs: { apiKey: RESEND_REF } },
    }));
    expect(h.resendInit).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'fake-tenant-key' }));
    expect(h.getAppSecret).not.toHaveBeenCalled();
    expect(h.getTenantSecret).toHaveBeenCalledTimes(1);
    expect(h.getTenantSecret).toHaveBeenCalledWith('tenant-1', RESEND_REF);
  });

  it('Resend with a legacy inline key uses it without fallbacks', async () => {
    await new EmailProviderManager().initialize(settings({
      providerId: 'resend-provider', providerType: 'resend', isEnabled: true,
      config: { apiKey: 'fake-legacy-key' },
    }));
    expect(h.resendInit).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'fake-legacy-key' }));
    expect(h.getAppSecret).not.toHaveBeenCalled();
  });

  it('Resend with nothing falls back to the tenant/app/env chain as before', async () => {
    h.appSecrets.set('resend_api_key', 'fake-app-key');
    await new EmailProviderManager().initialize(settings({
      providerId: 'resend-provider', providerType: 'resend', isEnabled: true, config: { apiKey: '' },
    }));
    expect(h.resendInit).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'fake-app-key' }));

    h.appSecrets.clear();
    process.env.RESEND_API_KEY = 'fake-env-key';
    await new EmailProviderManager().initialize(settings({
      providerId: 'resend-provider', providerType: 'resend', isEnabled: true, config: {},
    }));
    expect(h.resendInit).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'fake-env-key' }));
  });
});
