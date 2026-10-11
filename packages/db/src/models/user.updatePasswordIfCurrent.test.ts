import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAdminConnectionMock, tenantDbMock } = vi.hoisted(() => ({
  getAdminConnectionMock: vi.fn(),
  tenantDbMock: vi.fn(),
}));

vi.mock('../lib/admin', () => ({ getAdminConnection: getAdminConnectionMock }));
vi.mock('../lib/tenantDb', () => ({ tenantDb: tenantDbMock }));

import User from './user';

function queryBuilder(updatedRows: number) {
  const builder: any = {};
  builder.table = vi.fn(() => builder);
  builder.where = vi.fn(() => builder);
  builder.whereNull = vi.fn(() => builder);
  builder.update = vi.fn().mockResolvedValue(updatedRows);
  return builder;
}

describe('User.updatePasswordIfCurrent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminConnectionMock.mockResolvedValue({});
  });

  it('updates only when the row still contains the observed nonempty hash', async () => {
    const builder = queryBuilder(1);
    tenantDbMock.mockReturnValue(builder);

    await expect(
      User.updatePasswordIfCurrent('user-1', 'tenant-1', 'observed-placeholder', 'replacement-hash'),
    ).resolves.toBe(true);

    expect(builder.where).toHaveBeenNthCalledWith(1, { user_id: 'user-1' });
    expect(builder.where).toHaveBeenNthCalledWith(2, { hashed_password: 'observed-placeholder' });
    expect(builder.whereNull).not.toHaveBeenCalled();
    expect(builder.update).toHaveBeenCalledWith({ hashed_password: 'replacement-hash' });
  });

  it('matches SQL NULL when no hash was observed and returns false when another writer won', async () => {
    const builder = queryBuilder(0);
    tenantDbMock.mockReturnValue(builder);

    await expect(
      User.updatePasswordIfCurrent('user-1', 'tenant-1', null, 'replacement-hash'),
    ).resolves.toBe(false);

    expect(builder.whereNull).toHaveBeenCalledWith('hashed_password');
    expect(builder.where).toHaveBeenCalledTimes(1);
  });

  it('matches an observed empty-string hash as a value rather than SQL NULL', async () => {
    const builder = queryBuilder(1);
    tenantDbMock.mockReturnValue(builder);

    await expect(
      User.updatePasswordIfCurrent('user-1', 'tenant-1', '', 'replacement-hash'),
    ).resolves.toBe(true);

    expect(builder.where).toHaveBeenNthCalledWith(2, { hashed_password: '' });
    expect(builder.whereNull).not.toHaveBeenCalled();
  });
});
