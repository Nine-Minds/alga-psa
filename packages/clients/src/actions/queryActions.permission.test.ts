import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionAsyncMock = vi.fn();
const createTenantKnexMock = vi.fn(async () => ({ knex: {} as any }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: () => createTenantKnexMock(),
  withTransaction: vi.fn(),
}));

vi.mock('../lib/authHelpers', () => ({
  hasPermissionAsync: (...args: any[]) => hasPermissionAsyncMock(...args),
}));

describe('queryActions contact read permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T297/T329: getContactsByClient rejects without contact read permission before opening tenant DB access', async () => {
    hasPermissionAsyncMock.mockResolvedValue(false);

    const { getContactsByClient } = await import('./queryActions');
    await expect(getContactsByClient('client-1')).rejects.toThrow(
      'Permission denied: Cannot read contacts'
    );

    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(hasPermissionAsyncMock).toHaveBeenCalledWith(
      { user_id: 'user-1' },
      'contact',
      'read'
    );
  });

  it('T297/T329: getAllContacts rejects without contact read permission before opening tenant DB access', async () => {
    hasPermissionAsyncMock.mockResolvedValue(false);

    const { getAllContacts } = await import('./queryActions');
    await expect(getAllContacts()).rejects.toThrow(
      'Permission denied: Cannot read contacts'
    );

    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(hasPermissionAsyncMock).toHaveBeenCalledWith(
      { user_id: 'user-1' },
      'contact',
      'read'
    );
  });
});
