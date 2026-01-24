import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasPermission } from '@alga-psa/auth/rbac';

const createTenantKnex = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => true),
}));

describe('deleteContract action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasPermission).mockReturnValue(true);
    delete process.env.E2E_AUTH_BYPASS;
    createTenantKnex.mockResolvedValue({ knex: vi.fn() });
  });

  it('user without contract delete permission cannot discard drafts (T064)', async () => {
    vi.mocked(hasPermission).mockImplementation((_user, _domain, action) => action !== 'delete');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { deleteContract } = await import('../src/actions/contractActions');
    try {
      await expect(deleteContract('contract-1')).rejects.toThrow('Permission denied: Cannot delete billing contracts');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
