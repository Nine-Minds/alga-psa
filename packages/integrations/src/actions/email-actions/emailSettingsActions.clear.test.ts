import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const getTenantEmailSettingsMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
    unscoped: (table: string) => conn(table),
  }),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) => fn({ id: 'user-1' }, { tenant: 'tenant-123' }, ...args),
}));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: {
    getTenantEmailSettings: getTenantEmailSettingsMock,
  },
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

describe('updateEmailSettings clear behavior', () => {
  beforeEach(() => {
    createTenantKnexMock.mockReset();
    getTenantEmailSettingsMock.mockReset();
  });

  it('persists null when clearing the ticketing From address', async () => {
    const updateMock = vi.fn(async () => 1);
    const firstMock = vi.fn(async () => ({ tenant: 'tenant-123' }));
    const whereMock = vi.fn(() => ({
      first: firstMock,
      update: updateMock,
    }));

    const knexMock = vi.fn((_table: string) => ({
      where: whereMock,
      insert: vi.fn(async () => 1),
    })) as any;

    createTenantKnexMock.mockResolvedValue({ knex: knexMock, tenant: 'tenant-123' });
    getTenantEmailSettingsMock
      .mockResolvedValueOnce({
        tenantId: 'tenant-123',
        defaultFromDomain: 'acme.com',
        ticketingFromEmail: 'support@acme.com',
        customDomains: [],
        emailProvider: 'resend',
        providerConfigs: [],
        trackingEnabled: false,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        tenantId: 'tenant-123',
        defaultFromDomain: 'acme.com',
        ticketingFromEmail: null,
        customDomains: [],
        emailProvider: 'resend',
        providerConfigs: [],
        trackingEnabled: false,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-02T00:00:00.000Z'),
      });

    const { updateEmailSettings } = await import('./emailSettingsActions');
    const updated = await updateEmailSettings({ ticketingFromEmail: null });

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      ticketing_from_email: null,
      default_from_domain: 'acme.com',
    }));
    expect('actionError' in updated).toBe(false);
    if ('actionError' in updated) return;
    expect(updated.ticketingFromEmail).toBeNull();
  });

  it('persists the normalized ticketing sender display name', async () => {
    const updateMock = vi.fn(async () => 1);
    const firstMock = vi.fn(async () => ({ tenant: 'tenant-123' }));
    const whereMock = vi.fn(() => ({
      first: firstMock,
      update: updateMock,
    }));

    const knexMock = vi.fn((_table: string) => ({
      where: whereMock,
      insert: vi.fn(async () => 1),
    })) as any;

    createTenantKnexMock.mockResolvedValue({ knex: knexMock, tenant: 'tenant-123' });
    getTenantEmailSettingsMock
      .mockResolvedValueOnce({
        tenantId: 'tenant-123',
        defaultFromDomain: 'acme.com',
        ticketingFromEmail: 'support@acme.com',
        ticketingFromName: null,
        customDomains: [],
        emailProvider: 'resend',
        providerConfigs: [],
        trackingEnabled: false,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        tenantId: 'tenant-123',
        defaultFromDomain: 'acme.com',
        ticketingFromEmail: 'support@acme.com',
        ticketingFromName: 'Support Team',
        customDomains: [],
        emailProvider: 'resend',
        providerConfigs: [],
        trackingEnabled: false,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-02T00:00:00.000Z'),
      });

    const { updateEmailSettings } = await import('./emailSettingsActions');
    const updated = await updateEmailSettings({
      ticketingFromName: ' Support Team ',
    });

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      ticketing_from_email: 'support@acme.com',
      ticketing_from_name: 'Support Team',
    }));
    expect('actionError' in updated).toBe(false);
    if ('actionError' in updated) return;
    expect(updated.ticketingFromName).toBe('Support Team');
  });
});
