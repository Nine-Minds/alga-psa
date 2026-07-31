import { beforeEach, describe, expect, it, vi } from 'vitest';

const { inserts, getAdminConnectionMock, withAdminTransactionMock } = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; value: Record<string, unknown> }>,
  getAdminConnectionMock: vi.fn(),
  withAdminTransactionMock: vi.fn(),
}));

vi.mock('@temporalio/activity', () => ({
  ApplicationFailure: class ApplicationFailure extends Error {},
  Context: {
    current: () => ({
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    }),
  },
}));

vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: getAdminConnectionMock,
  withAdminTransactionRetryReadOnly: withAdminTransactionMock,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (table: string) => ({
      insert: async (value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return 1;
      },
      select: async () => [],
    }),
  }),
}));

vi.mock('@alga-psa/email/providerConfig', () => ({
  createDefaultProviderConfig: (
    providerType: 'smtp' | 'resend',
    { isEnabled }: { isEnabled: boolean }
  ) => ({
    providerId: `${providerType}-provider`,
    providerType,
    isEnabled,
    config: providerType === 'smtp'
      ? { host: '', port: 587, username: '', password: '', from: '' }
      : { apiKey: '', from: '' },
  }),
}));

vi.mock('../../services/stripe-service.js', () => ({
  updateSubscriptionMetadata: vi.fn(),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(),
}));

vi.mock('@ee/lib/stripe/stripeTierMapping.js', () => ({
  tierFromStripeProduct: vi.fn(),
}));

describe('setupTenantDataInDB email settings seed', () => {
  beforeEach(() => {
    inserts.length = 0;
    getAdminConnectionMock.mockReset();
    withAdminTransactionMock.mockReset();

    const knex = { fn: { now: () => new Date('2026-07-14T00:00:00.000Z') } };
    const trx = { raw: (sql: string) => sql };
    getAdminConnectionMock.mockResolvedValue(knex);
    withAdminTransactionMock.mockImplementation(async (callback: (trx: unknown) => unknown) => callback(trx));
  });

  it('seeds a blank disabled SMTP config when explicitly requested', async () => {
    const { setupTenantDataInDB } = await import('../tenant-operations');

    await setupTenantDataInDB({
      tenantId: 'tenant-appliance',
      adminUserId: 'admin-1',
      emailProvider: 'smtp',
    });

    const emailSettings = inserts.find(insert => insert.table === 'tenant_email_settings');
    expect(emailSettings?.value).toMatchObject({
      tenant: 'tenant-appliance',
      email_provider: 'smtp',
    });
    expect(JSON.parse(emailSettings?.value.provider_configs as string)).toEqual([
      {
        providerId: 'smtp-provider',
        providerType: 'smtp',
        isEnabled: false,
        config: { host: '', port: 587, username: '', password: '', from: '' },
      },
    ]);
  });

  it('keeps Resend as the hosted default and seeds it disabled', async () => {
    const { setupTenantDataInDB } = await import('../tenant-operations');

    await setupTenantDataInDB({
      tenantId: 'tenant-hosted',
      adminUserId: 'admin-2',
    });

    const emailSettings = inserts.find(insert => insert.table === 'tenant_email_settings');
    expect(emailSettings?.value.email_provider).toBe('resend');
    expect(JSON.parse(emailSettings?.value.provider_configs as string)).toEqual([
      {
        providerId: 'resend-provider',
        providerType: 'resend',
        isEnabled: false,
        config: { apiKey: '', from: '' },
      },
    ]);
  });
});
