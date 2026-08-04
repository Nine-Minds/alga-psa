import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  companyName: 'Example MSP',
  initializedSettings: [] as Array<Record<string, any>>,
  sent: [] as Array<{ config: Record<string, any>; message: Record<string, any> }>,
  settingsRow: null as Record<string, any> | null,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@alga-psa/core/rateLimit', () => ({
  TokenBucketRateLimiter: {
    getInstance: () => ({ isReady: () => false }),
  },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  getConnection: vi.fn(async () => ({})),
  isTenantSuspended: vi.fn(async () => false),
  tenantDb: () => ({
    table: (table: string) => {
      if (table === 'tenant_email_settings') {
        return { first: vi.fn(async () => runtime.settingsRow) };
      }
      if (table === 'email_sending_logs') {
        return { insert: vi.fn(async () => 1) };
      }
      throw new Error(`Unexpected table in email freshness test: ${table}`);
    },
  }),
}));

vi.mock('../senderIdentity', () => ({
  applyFromNameOverride: (
    address: string | { email: string; name?: string },
    fromName?: string
  ) => {
    const resolved = typeof address === 'string' ? { email: address } : address;
    return fromName?.trim() ? { ...resolved, name: fromName.trim() } : resolved;
  },
  resolveDefaultFromAddress: (settings: Record<string, any> | null, companyName?: string | null) => {
    const provider = settings?.providerConfigs?.find((config: Record<string, any>) => config.isEnabled);
    return {
      email: provider?.config?.from || 'notifications@example.test',
      name: provider?.config?.fromName?.trim() || companyName || 'Alga PSA Notifications',
    };
  },
  resolveTenantCompanyName: vi.fn(async () => runtime.companyName),
}));

vi.mock('../providers/EmailProviderManager', () => ({
  EmailProviderManager: class {
    private provider: Record<string, any> | null = null;

    async initialize(settings: Record<string, any>) {
      runtime.initializedSettings.push(settings);
      const config = settings.providerConfigs.find((candidate: Record<string, any>) => candidate.isEnabled);
      const capturedConfig = { ...config.config };
      this.provider = {
        providerId: config.providerId,
        providerType: config.providerType,
        sendEmail: vi.fn(async (message: Record<string, any>) => {
          runtime.sent.push({ config: capturedConfig, message });
          return {
            success: true,
            messageId: `message-${runtime.sent.length}`,
            providerId: config.providerId,
            providerType: config.providerType,
            sentAt: new Date(),
          };
        }),
      };
    }

    async getAvailableProviders() {
      return this.provider ? [this.provider] : [];
    }
  },
}));

import { TenantEmailService } from '../TenantEmailService';

function buildSettingsRow(config: { password: string; from: string; fromName: string }) {
  return {
    tenant: 'tenant-settings-freshness',
    default_from_domain: 'example.test',
    ticketing_from_email: 'tickets@example.test',
    ticketing_from_name: 'Ticket Support',
    custom_domains: [],
    email_provider: 'smtp',
    provider_configs: [{
      providerId: 'smtp-provider',
      providerType: 'smtp',
      isEnabled: true,
      config: {
        host: 'smtp.example.test',
        username: 'mailer',
        ...config,
      },
    }],
    tracking_enabled: false,
    created_at: new Date('2026-08-04T12:00:00.000Z'),
    updated_at: new Date('2026-08-04T12:00:00.000Z'),
  };
}

describe('TenantEmailService settings freshness', () => {
  beforeEach(async () => {
    runtime.initializedSettings.length = 0;
    runtime.sent.length = 0;
    runtime.companyName = 'Example MSP';
    runtime.settingsRow = buildSettingsRow({
      password: 'old-password',
      from: 'old-notifications@example.test',
      fromName: 'Old Notifications',
    });
    await TenantEmailService.invalidateTenantSettings('tenant-settings-freshness');
  });

  it('reloads provider credentials and notification identity on a reused instance', async () => {
    const service = TenantEmailService.getInstance('tenant-settings-freshness');
    const params = {
      tenantId: 'tenant-settings-freshness',
      to: 'client@example.test',
      subject: 'Status update',
      html: '<p>Status update</p>',
    };

    await expect(service.sendEmail(params)).resolves.toMatchObject({ success: true });

    // Keep updated_at unchanged deliberately: freshness is based on the actual
    // persisted provider settings, not a timestamp or optimistic UI state.
    runtime.settingsRow = buildSettingsRow({
      password: 'new-password',
      from: 'new-notifications@example.test',
      fromName: 'New Notifications',
    });

    await expect(service.sendEmail(params)).resolves.toMatchObject({ success: true });
    await expect(service.sendEmail(params)).resolves.toMatchObject({ success: true });

    expect(TenantEmailService.getInstance('tenant-settings-freshness')).toBe(service);
    expect(runtime.initializedSettings).toHaveLength(2);
    expect(runtime.sent.map(send => ({
      password: send.config.password,
      from: send.message.from,
    }))).toEqual([
      {
        password: 'old-password',
        from: { email: 'old-notifications@example.test', name: 'Old Notifications' },
      },
      {
        password: 'new-password',
        from: { email: 'new-notifications@example.test', name: 'New Notifications' },
      },
      {
        password: 'new-password',
        from: { email: 'new-notifications@example.test', name: 'New Notifications' },
      },
    ]);
  });

  it('keeps an in-flight send paired with the provider settings it resolved', async () => {
    const service = TenantEmailService.getInstance('tenant-settings-freshness');
    let releaseTemplate!: () => void;
    let markTemplateStarted!: () => void;
    const templateStarted = new Promise<void>((resolve) => {
      markTemplateStarted = resolve;
    });
    const templateRelease = new Promise<void>((resolve) => {
      releaseTemplate = resolve;
    });

    const firstSend = service.sendEmail({
      tenantId: 'tenant-settings-freshness',
      to: 'first@example.test',
      templateProcessor: {
        process: async () => {
          markTemplateStarted();
          await templateRelease;
          return { subject: 'First', html: '<p>First</p>', text: 'First' };
        },
      },
    });
    await templateStarted;

    runtime.settingsRow = buildSettingsRow({
      password: 'new-password',
      from: 'new-notifications@example.test',
      fromName: 'New Notifications',
    });
    await service.sendEmail({
      tenantId: 'tenant-settings-freshness',
      to: 'second@example.test',
      subject: 'Second',
      html: '<p>Second</p>',
    });

    releaseTemplate();
    await firstSend;

    expect(runtime.sent.map(send => ({
      password: send.config.password,
      from: send.message.from,
    }))).toEqual([
      {
        password: 'new-password',
        from: { email: 'new-notifications@example.test', name: 'New Notifications' },
      },
      {
        password: 'old-password',
        from: { email: 'old-notifications@example.test', name: 'Old Notifications' },
      },
    ]);
  });
});
