import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  sent: [] as Array<Record<string, any>>,
  systemProviderCreates: 0,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@alga-psa/core/rateLimit', () => ({
  TokenBucketRateLimiter: { getInstance: () => ({ isReady: () => false }) },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../features', () => ({ isEnterprise: true }));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => ({})),
  isTenantSuspended: vi.fn(async () => false),
  tenantDb: () => ({
    table: (table: string) => {
      if (table === 'tenant_email_settings') return { first: vi.fn(async () => tenantSettingsRow) };
      if (table === 'email_sending_logs') return { insert: vi.fn(async () => 1) };
      throw new Error(`Unexpected table in system Resend fallback smoke: ${table}`);
    },
  }),
}));

vi.mock('../senderIdentity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../senderIdentity')>()),
  resolveTenantCompanyName: vi.fn(async () => 'Tenant Services'),
}));

vi.mock('../providers/EmailProviderManager', () => ({
  EmailProviderManager: class {
    async initialize() {
      throw new Error('tenant Microsoft provider initialization failed');
    }
  },
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

const tenantId = 'tenant-system-resend-fallback-smoke';
const tenantSettingsRow = {
  tenant: tenantId,
  default_from_domain: 'tenant.example',
  ticketing_from_email: null,
  ticketing_from_name: null,
  custom_domains: [],
  email_provider: 'microsoft',
  provider_configs: [{
    providerId: 'tenant-microsoft-provider',
    providerType: 'microsoft',
    isEnabled: true,
    config: { from: 'service@tenant.example' },
  }],
  tracking_enabled: false,
  created_at: new Date('2026-08-28T00:00:00.000Z'),
  updated_at: new Date('2026-08-28T00:00:00.000Z'),
};

describe('TenantEmailService system-Resend fallback smoke', () => {
  const originalEmailFrom = process.env.EMAIL_FROM;

  beforeEach(async () => {
    runtime.sent.length = 0;
    runtime.systemProviderCreates = 0;
    process.env.EMAIL_FROM = 'Platform Mail <verified@system.example>';
    await TenantEmailService.invalidateTenantSettings(tenantId);
  });

  afterEach(async () => {
    await TenantEmailService.invalidateTenantSettings(tenantId);
    if (originalEmailFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalEmailFrom;
  });

  it('selects the system Resend provider after tenant initialization fails and preserves the tenant reply identity', async () => {
    const service = TenantEmailService.getInstance(tenantId);

    await expect(service.sendEmail({
      tenantId,
      to: 'customer@example.test',
      subject: 'Fallback status',
      html: '<p>Fallback status</p>',
    })).resolves.toMatchObject({ success: true, messageId: 'system-resend-message' });

    expect(runtime.systemProviderCreates).toBe(1);
    expect(runtime.sent).toEqual([expect.objectContaining({
      from: { email: 'verified@system.example', name: 'Tenant Services' },
      replyTo: { email: 'service@tenant.example', name: 'Tenant Services' },
    })]);
  });
});
