import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const getTenantEmailSettingsMock = vi.fn();
const invalidateTenantSettingsMock = vi.fn();

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

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: {
    getTenantEmailSettings: getTenantEmailSettingsMock,
    invalidateTenantSettings: invalidateTenantSettingsMock,
  },
  resolveTenantCompanyName: vi.fn(async () => 'Example MSP'),
  resolveDefaultFromAddress: vi.fn(() => ({
    email: 'notifications@acme.com',
    name: 'Example MSP',
  })),
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
    invalidateTenantSettingsMock.mockReset();
    invalidateTenantSettingsMock.mockResolvedValue(undefined);
  });

  it('updates tenant email settings without persisting sender identities', async () => {
    const updateMock = vi.fn(async () => 1);
    const firstMock = vi.fn(async () => ({ tenant: 'tenant-123' }));
    const whereMock = vi.fn(() => ({
      first: firstMock,
      update: updateMock,
      whereNotNull: vi.fn(() => ({ update: updateMock })),
      select: vi.fn(async () => []),
    }));

    const knexMock = vi.fn((_table: string) => ({
      where: whereMock,
      insert: vi.fn(async () => 1),
      select: vi.fn(async () => []),
    })) as any;
    knexMock.transaction = async (callback: (trx: any) => Promise<unknown>) => callback(knexMock);

    createTenantKnexMock.mockResolvedValue({ knex: knexMock, tenant: 'tenant-123' });
    getTenantEmailSettingsMock
      .mockResolvedValueOnce({
        tenantId: 'tenant-123',
        defaultFromDomain: 'acme.com',
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
        customDomains: [],
        emailProvider: 'resend',
        providerConfigs: [],
        trackingEnabled: false,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-02T00:00:00.000Z'),
      });

    const { updateEmailSettings } = await import('./emailSettingsActions');
    const updated = await updateEmailSettings({ defaultFromDomain: 'acme.com' });

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      default_from_domain: 'acme.com',
    }));
    expect('actionError' in updated).toBe(false);
    if ('actionError' in updated) return;
    expect(updated.defaultFromDomain).toBe('acme.com');
  });

  it('does not persist sender identities in tenant email settings', async () => {
    const updateMock = vi.fn(async () => 1);
    const firstMock = vi.fn(async () => ({ tenant: 'tenant-123' }));
    const whereMock = vi.fn(() => ({
      first: firstMock,
      update: updateMock,
      whereNotNull: vi.fn(() => ({ update: updateMock })),
      select: vi.fn(async () => []),
    }));

    const knexMock = vi.fn((_table: string) => ({
      where: whereMock,
      insert: vi.fn(async () => 1),
      select: vi.fn(async () => []),
    })) as any;
    knexMock.transaction = async (callback: (trx: any) => Promise<unknown>) => callback(knexMock);

    createTenantKnexMock.mockResolvedValue({ knex: knexMock, tenant: 'tenant-123' });
    getTenantEmailSettingsMock
      .mockResolvedValueOnce({
        tenantId: 'tenant-123',
        defaultFromDomain: 'acme.com',
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
        customDomains: [],
        emailProvider: 'resend',
        providerConfigs: [],
        trackingEnabled: false,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-02T00:00:00.000Z'),
      });

    const { updateEmailSettings } = await import('./emailSettingsActions');
    const updated = await updateEmailSettings({ trackingEnabled: true });
    expect(updateMock).toHaveBeenCalledWith(expect.not.objectContaining({ ticketing_from_email: expect.anything(), ticketing_from_name: expect.anything() }));
    expect('actionError' in updated).toBe(false);
  });
});
