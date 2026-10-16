import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAdminConnectionMock, tenantDbMock, updateMock } = vi.hoisted(() => ({
  getAdminConnectionMock: vi.fn(),
  tenantDbMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('../lib/admin', () => ({ getAdminConnection: getAdminConnectionMock }));
vi.mock('../lib/tenantDb', () => ({ tenantDb: tenantDbMock }));

import User from './user';

describe('User.updatePassword', () => {
  beforeEach(() => {
    getAdminConnectionMock.mockResolvedValue({});
    updateMock.mockReset();
    tenantDbMock.mockReturnValue({
      table: () => ({ where: () => ({ update: updateMock }) }),
    });
  });

  it('fails when the tenant-scoped account update affects no rows', async () => {
    updateMock.mockResolvedValue(0);

    await expect(User.updatePassword('user-1', 'tenant-1', 'hashed-password'))
      .rejects.toThrow(/Expected to update one password row/);
    expect(tenantDbMock).toHaveBeenCalledWith({}, 'tenant-1');
  });

  it('accepts exactly one updated account row', async () => {
    updateMock.mockResolvedValue(1);

    await expect(User.updatePassword('user-1', 'tenant-1', 'hashed-password')).resolves.toBeUndefined();
  });
});
