import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TenantEmailSettings } from '@alga-psa/types';
import { TenantEmailService } from '../TenantEmailService';

function buildSettings(overrides: Partial<TenantEmailSettings> = {}): TenantEmailSettings {
  return {
    tenantId: `tenant-${Math.random().toString(36).slice(2)}`,
    defaultFromDomain: 'acme.com',
    ticketingFromEmail: null,
    ticketingFromName: null,
    customDomains: [],
    emailProvider: 'smtp',
    providerConfigs: [],
    trackingEnabled: false,
    createdAt: new Date('2026-07-05T00:00:00.000Z'),
    updatedAt: new Date('2026-07-05T00:00:00.000Z'),
    ...overrides,
  };
}

function resolveFromAddress(settings: TenantEmailSettings, tenantCompanyName?: string | null) {
  const service = TenantEmailService.getInstance(settings.tenantId);
  (service as any).tenantSettings = settings;
  return (service as any).buildTenantFromAddress(tenantCompanyName);
}

function resolveMessageFrom(settings: TenantEmailSettings, params: Record<string, unknown>) {
  const service = TenantEmailService.getInstance(settings.tenantId);
  (service as any).tenantSettings = settings;
  return (service as any).getFromAddress(params);
}

describe('TenantEmailService from address resolution', () => {
  const originalEmailFrom = process.env.EMAIL_FROM;
  const originalEmailFromName = process.env.EMAIL_FROM_NAME;

  beforeEach(() => {
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_FROM_NAME;
  });

  afterEach(() => {
    if (originalEmailFrom === undefined) {
      delete process.env.EMAIL_FROM;
    } else {
      process.env.EMAIL_FROM = originalEmailFrom;
    }

    if (originalEmailFromName === undefined) {
      delete process.env.EMAIL_FROM_NAME;
    } else {
      process.env.EMAIL_FROM_NAME = originalEmailFromName;
    }
  });

  it('uses the enabled provider address, re-homed onto the configured outbound domain', () => {
    const from = resolveFromAddress(buildSettings({
      providerConfigs: [{
        providerId: 'smtp-provider',
        providerType: 'smtp',
        isEnabled: true,
        config: {
          from: 'Provider Sender <provider@example.net>',
        },
      }],
    }));

    expect(from).toEqual({
      email: 'provider@acme.com',
      name: 'Provider Sender',
    });
  });

  it('falls back to EMAIL_FROM when no provider is configured', () => {
    process.env.EMAIL_FROM = 'Env Sender <env@acme.com>';

    const from = resolveFromAddress(buildSettings({
      providerConfigs: [],
    }));

    expect(from).toEqual({
      email: 'env@acme.com',
      name: 'Env Sender',
    });
  });

  it('falls back to the product default name and outbound domain when nothing else is set', () => {
    const from = resolveFromAddress(buildSettings({
      providerConfigs: [],
    }));

    expect(from).toEqual({
      email: 'notifications@acme.com',
      name: 'Alga PSA Notifications',
    });
  });

  it('uses the provider display name before the tenant company name', () => {
    const from = resolveFromAddress(buildSettings({
      providerConfigs: [{
        providerId: 'smtp-provider',
        providerType: 'smtp',
        isEnabled: true,
        config: { from: 'notifications@example.net', fromName: 'Configured Sender' },
      }],
    }), 'Acme Services');

    expect(from).toEqual({ email: 'notifications@acme.com', name: 'Configured Sender' });
  });

  it.each(['smtp', 'resend'] as const)(
    'uses the tenant company for a blank %s provider display name',
    (providerType) => {
      const from = resolveFromAddress(buildSettings({
        emailProvider: providerType,
        providerConfigs: [{
          providerId: `${providerType}-provider`,
          providerType,
          isEnabled: true,
          config: { from: 'notifications@example.net', fromName: '  ' },
        }],
      }), 'Acme Services');

      expect(from).toEqual({ email: 'notifications@acme.com', name: 'Acme Services' });
    }
  );

  it('uses the tenant company before environment branding', () => {
    process.env.EMAIL_FROM = 'Environment Sender <env@example.net>';
    process.env.EMAIL_FROM_NAME = 'Environment Name';

    const from = resolveFromAddress(buildSettings(), 'Acme Services');

    expect(from).toEqual({ email: 'env@acme.com', name: 'Acme Services' });
  });

  it('applies a per-message display name without changing the resolved address', () => {
    const settings = buildSettings({
      providerConfigs: [{
        providerId: 'smtp-provider',
        providerType: 'smtp',
        isEnabled: true,
        config: { from: 'notifications@example.net' },
      }],
    });

    const from = resolveMessageFrom(settings, {
      fromName: 'Acme Services Portal',
      resolvedTenantCompanyName: 'Acme Services',
    });

    expect(from).toEqual({ email: 'notifications@acme.com', name: 'Acme Services Portal' });
  });

  it('preserves an explicit ticket identity unless a name override is supplied', () => {
    const settings = buildSettings();

    expect(resolveMessageFrom(settings, {
      from: { email: 'support@acme.com', name: 'Acme Support' },
    })).toEqual({ email: 'support@acme.com', name: 'Acme Support' });

    expect(resolveMessageFrom(settings, {
      from: { email: 'support@acme.com', name: 'Acme Support' },
      fromName: 'Escalations',
    })).toEqual({ email: 'support@acme.com', name: 'Escalations' });
  });
});
