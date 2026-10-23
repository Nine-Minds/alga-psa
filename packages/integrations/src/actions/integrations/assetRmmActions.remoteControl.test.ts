import { describe, expect, it, vi } from 'vitest';

const permissionMocks = vi.hoisted(() => ({ hasPermission: vi.fn() }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => unknown) => (...args: any[]) =>
    action({ user_id: 'read-only-user' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: permissionMocks.hasPermission,
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(() => { throw new Error('Database access should not occur'); }),
  tenantDb: vi.fn(),
}));

import { getAssetRemoteControlUrl } from './assetRmmActions';

describe('getAssetRemoteControlUrl permissions', () => {
  it('rejects users with asset:read but without asset:update', async () => {
    permissionMocks.hasPermission.mockImplementation(async (_user, resource, action) =>
      resource === 'asset' && action === 'read'
    );

    await expect(getAssetRemoteControlUrl('asset-1', 'splashtop'))
      .rejects.toThrow('Permission denied: Cannot update assets');
    expect(permissionMocks.hasPermission).toHaveBeenCalledWith(
      { user_id: 'read-only-user' },
      'asset',
      'update'
    );
  });
});
