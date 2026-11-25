import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  sent: [] as Array<Record<string, any>>,
  systemProviderCreates: 0,
}));
const smtp = vi.hoisted(() => ({ createTransport: vi.fn() }));

vi.mock('nodemailer', () => ({ default: { createTransport: smtp.createTransport } }));

vi.mock('@alga-psa/core/logger', () => ({
  default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@alga-psa/core/rateLimit', () => ({
  TokenBucketRateLimiter: { getInstance: () => ({ isReady: () => false }) },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('../features', () => ({ isEnterprise: true }));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => ({ transaction: async (operation: (trx: {}) => Promise<unknown>) => operation({}) })),
  isTenantSuspended: vi.fn(async () => false),
  tenantDb: () => ({
    table: (table: string) => {
      if (table === 'tenant_email_settings') return {
        forUpdate: vi.fn().mockReturnThis(),
        first: vi.fn(async () => tenantSettingsRow),
        update: vi.fn(async ({ provider_configs }: { provider_configs: string }) => {
          tenantSettingsRow.provider_configs = JSON.parse(provider_configs);
          return 1;
        }),
      };
      if (table === 'email_sending_logs') return { insert: vi.fn(async () => 1) };
      if (table === 'email_sender_addresses' || table === 'email_sender_routes') return { select: vi.fn(async () => []) };
      throw new Error(`Unexpected table in system Resend fallback smoke: ${table}`);
    },
  }),
}));

vi.mock('../senderIdentity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../senderIdentity')>()),
  resolveTenantCompanyName: vi.fn(async () => 'Tenant Services'),
}));

vi.mock('../system/SystemEmailProviderFactory', () => ({
  SystemEmailProviderFactory: {
    getConfigFingerprint: vi.fn(() => 'system-resend-fallback-smoke'),
    createProvider: vi.fn(async () => {
      runtime.systemProviderCreates += 1;
      return {
        providerId: 'system-resend-provider',
        providerType: 'resend',
        sendEmail: vi.fn(async (message: Record<string, any>) => {
          runtime.sent.push(message);
          return { success: true, messageId: 'system-resend-message', providerType: 'resend' };
        }),
      };
    }),
  },
}));

import { TenantEmailService } from '../TenantEmailService';
import { connectionFingerprint } from '@alga-psa/core/providerConnectionIdentity';

const tenantId = 'tenant-system-resend-fallback-smoke';
const tenantSettingsRow: any = {
  tenant: tenantId,
  default_from_domain: 'tenant.example',
  ticketing_from_email: null,
  ticketing_from_name: null,
  custom_domains: [],
  email_provider: 'smtp',
  provider_configs: [legacySmtpProvider()],
  tracking_enabled: false,
  created_at: new Date('2026-08-28T00:00:00.000Z'),
  updated_at: new Date('2026-08-28T00:00:00.000Z'),
};

function legacySmtpProvider(): any {
  return {
    providerId: 'tenant-smtp-provider',
    providerType: 'smtp',
    isEnabled: true,
    // Kept in the pre-upgrade shape so the service's trusted database read
    // must bind it before real manager initialization reaches Nodemailer.
    config: {
      host: 'smtp.tenant.example', port: 587, username: 'legacy-user',
      password: 'synthetic-legacy-password', from: 'service@tenant.example',
    },
  };
}

describe('TenantEmailService system-Resend fallback smoke', () => {
  const originalEmailFrom = process.env.EMAIL_FROM;

  beforeEach(async () => {
    runtime.sent.length = 0;
    runtime.systemProviderCreates = 0;
    smtp.createTransport.mockReset().mockReturnValue({
      verify: vi.fn(async () => { throw new Error('simulated SMTP connection refused'); }),
      sendMail: vi.fn(),
    });
    tenantSettingsRow.provider_configs = [legacySmtpProvider()];
    process.env.EMAIL_FROM = 'Platform Mail <verified@system.example>';
    await TenantEmailService.invalidateTenantSettings(tenantId);
  });

  afterEach(async () => {
    await TenantEmailService.invalidateTenantSettings(tenantId);
    if (originalEmailFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalEmailFrom;
  });

  it('binds a legacy credential before an ordinary SMTP initialization failure and preserves Enterprise fallback', async () => {
    const service = TenantEmailService.getInstance(tenantId);

    await expect(service.sendEmail({
      mailClass: 'general',
      tenantId,
      to: 'customer@example.test',
      subject: 'Fallback status',
      html: '<p>Fallback status</p>',
    })).resolves.toMatchObject({ success: true, messageId: 'system-resend-message' });

    expect(tenantSettingsRow.provider_configs[0].config.__secretFingerprint).toEqual(expect.any(String));
    expect(smtp.createTransport).toHaveBeenCalledTimes(1);
    expect(runtime.systemProviderCreates).toBe(1);
    expect(runtime.sent).toEqual([expect.objectContaining({
      from: { email: 'verified@system.example', name: 'Tenant Services' },
      replyTo: { email: 'service@tenant.example', name: 'Tenant Services' },
    })]);
  });

  it('rejects a present-but-mismatched fingerprint before SMTP or Enterprise fallback', async () => {
    const original = legacySmtpProvider();
    original.config.__secretFingerprint = connectionFingerprint(original.config, 'smtp', original.providerId);
    original.config.host = 'smtp.changed.example.test';
    tenantSettingsRow.provider_configs = [original];

    const service = TenantEmailService.getInstance(tenantId);
    await expect(service.sendEmail({
      mailClass: 'general',
      tenantId,
      to: 'customer@example.test',
      subject: 'Mismatched credential',
      html: '<p>Must fail closed</p>',
    })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Credentials no longer match this server'),
    });

    expect(smtp.createTransport).not.toHaveBeenCalled();
    expect(runtime.systemProviderCreates).toBe(0);
    expect(runtime.sent).toHaveLength(0);
  });
});
