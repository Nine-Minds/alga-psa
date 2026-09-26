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
  const originalSmtpFrom = process.env.SMTP_FROM;

  beforeEach(() => {
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_FROM_NAME;
    delete process.env.SMTP_FROM;
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

    if (originalSmtpFrom === undefined) {
      delete process.env.SMTP_FROM;
    } else {
      process.env.SMTP_FROM = originalSmtpFrom;
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
      name: 'AlgaPSA Notifications',
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

  it('uses a board route ahead of the ticket class route and keeps route display-name precedence', () => {
    const settings = buildSettings({
      outboundSenders: [
        { tenant: 'ignored', sender_id: 'ticket-sender', email_address: 'support@acme.com', display_name: 'Support Team', microsoft_provider_id: null, verification_status: 'verified', verified_at: new Date(), last_verification_error: null, created_at: new Date(), updated_at: new Date() },
        { tenant: 'ignored', sender_id: 'default-sender', email_address: 'general@acme.com', display_name: 'General Team', microsoft_provider_id: null, verification_status: 'verified', verified_at: new Date(), last_verification_error: null, created_at: new Date(), updated_at: new Date() },
      ],
      outboundRoutes: [
        { tenant: 'ignored', route_id: 'route-class', route_type: 'mail_class', mail_class: 'ticket', board_id: null, sender_id: 'default-sender', display_name: null, created_at: new Date(), updated_at: new Date() },
        { tenant: 'ignored', route_id: 'route-board', route_type: 'board', mail_class: null, board_id: 'board-1', sender_id: 'ticket-sender', display_name: 'North Support', created_at: new Date(), updated_at: new Date() },
      ],
    });

    expect(resolveMessageFrom(settings, { mailClass: 'ticket', boardId: 'board-1' })).toEqual({
      email: 'support@acme.com',
      name: 'North Support',
    });
    expect(resolveMessageFrom(settings, { mailClass: 'ticket', boardId: 'board-1', fromName: 'VIP Support' })).toEqual({
      email: 'support@acme.com',
      name: 'VIP Support',
    });
  });

  it('fails closed for unverified routed senders instead of silently using the default', () => {
    const settings = buildSettings({
      outboundSenders: [{ tenant: 'ignored', sender_id: 'unverified', email_address: 'draft@acme.com', display_name: null, microsoft_provider_id: null, verification_status: 'unverified', verified_at: null, last_verification_error: null, created_at: new Date(), updated_at: new Date() }],
      outboundRoutes: [{ tenant: 'ignored', route_id: 'route-billing', route_type: 'mail_class', mail_class: 'billing', board_id: null, sender_id: 'unverified', display_name: null, created_at: new Date(), updated_at: new Date() }],
    });
    expect(() => resolveMessageFrom(settings, { mailClass: 'billing' })).toThrow(/cannot be used/);
  });

  it('forces the verified system sender and tenant reply address for a system fallback', () => {
    const settings = buildSettings({
      defaultFromDomain: 'tenant.example',
      providerConfigs: [{
        providerId: 'microsoft-provider',
        providerType: 'microsoft',
        isEnabled: true,
        config: { from: 'service@tenant.example' },
      }],
    });

    expect(resolveMessageFrom(settings, {
      from: { email: 'spoofed@unverified.example', name: 'Spoofed' },
      fromName: 'Spoofed name',
      resolvedSystemFallbackFromAddress: { email: 'noreply@algapsa.com', name: 'Tenant Services' },
      resolvedSystemFallbackReplyTo: { email: 'service@tenant.example', name: 'Tenant Services' },
    })).toEqual({ email: 'noreply@algapsa.com', name: 'Tenant Services' });
  });

  it.each([
    [undefined, 'System fallback sender is missing or malformed'],
    ['not-an-email', 'System fallback sender is missing or malformed'],
  ])('rejects a %s system fallback sender configuration', (emailFrom, expectedError) => {
    if (emailFrom) {
      process.env.EMAIL_FROM = emailFrom;
    }

    const service = TenantEmailService.getInstance(`tenant-${Math.random().toString(36).slice(2)}`);

    expect(() => (service as any).buildSystemFallbackFromAddress('Tenant Services'))
      .toThrow(expectedError);
  });

  it('uses SMTP_FROM when it is the configured system sender', () => {
    process.env.SMTP_FROM = 'Platform Mail <noreply@algapsa.com>';
    const service = TenantEmailService.getInstance(`tenant-${Math.random().toString(36).slice(2)}`);

    expect((service as any).buildSystemFallbackFromAddress('Tenant Services')).toEqual({
      email: 'noreply@algapsa.com',
      name: 'Tenant Services',
    });
  });
});
