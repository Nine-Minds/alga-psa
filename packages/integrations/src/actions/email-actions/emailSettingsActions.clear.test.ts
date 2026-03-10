import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const getTenantEmailSettingsMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) => fn({ id: 'user-1' }, { tenant: 'tenant-123' }, ...args),
}));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: {
    getTenantEmailSettings: getTenantEmailSettingsMock,
  },
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
    expect(updated.ticketingFromEmail).toBeNull();
  });
});
