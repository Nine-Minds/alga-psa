import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUserMock = vi.fn();
const hasPermissionMock = vi.fn();
const getDeletionConfigMock = vi.fn();
const validateDeletionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();

vi.mock('./getCurrentUser', () => ({
  getCurrentUser: (...args: any[]) => getCurrentUserMock(...args)
}));

vi.mock('./rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args)
}));

vi.mock('@alga-psa/core', () => ({
  getDeletionConfig: (...args: any[]) => getDeletionConfigMock(...args),
  validateDeletion: (...args: any[]) => validateDeletionMock(...args)
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args)
}));

import { preCheckDeletion } from './preCheckDeletion';

describe('preCheckDeletion permission mapping', () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
    hasPermissionMock.mockReset();
    getDeletionConfigMock.mockReset();
    validateDeletionMock.mockReset();
    createTenantKnexMock.mockReset();
    withTransactionMock.mockReset();

    getCurrentUserMock.mockResolvedValue({ user_id: 'u1', tenant: 't1' });
    getDeletionConfigMock.mockReturnValue({ entityType: 'tax_rate', dependencies: [] });
    hasPermissionMock.mockResolvedValue(true);
    createTenantKnexMock.mockResolvedValue({ knex: {}, tenant: 't1' });
    withTransactionMock.mockImplementation(async (_knex: unknown, fn: any) => fn({}));
    validateDeletionMock.mockResolvedValue({ canDelete: true, dependencies: [], alternatives: [] });
  });

  it('checks billing:delete (not tax_rate:delete) when validating tax_rate deletion', async () => {
    await preCheckDeletion('tax_rate', 'rate-1');

    expect(hasPermissionMock).toHaveBeenCalledTimes(1);
    const [, resource, action] = hasPermissionMock.mock.calls[0];
    expect(resource).toBe('billing');
    expect(action).toBe('delete');
  });

  it('returns PERMISSION_DENIED for tax_rate when user lacks billing:delete', async () => {
    hasPermissionMock.mockResolvedValueOnce(false);

    const result = await preCheckDeletion('tax_rate', 'rate-1');

    expect(result.canDelete).toBe(false);
    expect(result.code).toBe('PERMISSION_DENIED');
  });

  it('still uses the entity type as resource for unmapped entities', async () => {
    getDeletionConfigMock.mockReturnValueOnce({ entityType: 'project', dependencies: [] });

    await preCheckDeletion('project', 'p-1');

    const [, resource] = hasPermissionMock.mock.calls[0];
    expect(resource).toBe('project');
  });
});
