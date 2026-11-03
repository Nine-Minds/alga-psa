import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentUser: null as null | { user_id: string; tenant: string; user_type: string },
  getLicenseUsage: vi.fn(),
  getConnection: vi.fn(),
  tenantDb: vi.fn(),
}));

vi.mock('./getCurrentUser', () => ({
  getCurrentUserWithRevocationCheck: vi.fn(async () => mocks.currentUser),
}));
vi.mock('./localizeActionError', () => ({ localizeActionError: async (value: unknown) => value }));
vi.mock('next/headers.js', () => ({
  headers: vi.fn(async () => new Headers({ 'x-tenant-id': 'tenant-b' })),
}));
vi.mock('@alga-psa/licensing', () => ({ getLicenseUsage: mocks.getLicenseUsage }));
vi.mock('@alga-psa/db', () => ({
  getConnection: mocks.getConnection,
  tenantDb: mocks.tenantDb,
  runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<unknown>) => callback()),
  getAdminConnection: vi.fn(),
}));

const { getActiveUserCountAction, getLicenseUsageAction } = await import(
  '../../../../server/src/lib/actions/licensingActions'
);

describe('licensing actions enforce authenticated tenant scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser = null;
    mocks.getLicenseUsage.mockResolvedValue({ limit: 12, used: 4, remaining: 8 });
    mocks.getConnection.mockResolvedValue({});
    const query = {
      where: vi.fn().mockReturnThis(),
      count: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ count: '4' }),
    };
    mocks.tenantDb.mockReturnValue({ table: vi.fn(() => query) });
  });

  it('rejects an unauthenticated license usage request before reading tenant data', async () => {
    await expect(getLicenseUsageAction()).rejects.toThrow('User not authenticated');
    expect(mocks.getLicenseUsage).not.toHaveBeenCalled();
  });

  it('uses the authenticated tenant when the request carries another tenant header', async () => {
    mocks.currentUser = { user_id: 'user-a', tenant: 'tenant-a', user_type: 'internal' };

    await expect(getLicenseUsageAction()).resolves.toEqual({
      success: true,
      data: { limit: 12, used: 4, remaining: 8 },
    });
    expect(mocks.getLicenseUsage).toHaveBeenCalledWith('tenant-a');
  });

  it('preserves license limits and active internal user counts for authenticated callers', async () => {
    mocks.currentUser = { user_id: 'user-a', tenant: 'tenant-a', user_type: 'internal' };

    await expect(getLicenseUsageAction()).resolves.toMatchObject({
      success: true,
      data: { limit: 12, used: 4, remaining: 8 },
    });
    await expect(getActiveUserCountAction()).resolves.toEqual({ success: true, data: 4 });
    expect(mocks.getConnection).toHaveBeenCalledWith('tenant-a');
  });

  it('rejects an unauthenticated active-user-count request before querying users', async () => {
    await expect(getActiveUserCountAction()).rejects.toThrow('User not authenticated');
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });
});
