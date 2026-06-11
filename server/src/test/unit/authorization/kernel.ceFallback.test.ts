import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadEnterpriseAuthorizationKernelFactoryMock = vi.hoisted(() =>
  vi.fn(async () => null)
);

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

// The kernel's default rbacEvaluator resolves roles via User.getUserRolesWithPermissions.
vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    getUserRolesWithPermissions: vi.fn(async () => [
      {
        role_id: 'role-admin',
        role_name: 'Admin',
        description: '',
        msp: true,
        client: true,
        permissions: [{ permission_id: 'ticket-read', resource: 'ticket', action: 'read', msp: true, client: true }],
      },
    ]),
  },
}));

vi.mock('server/src/lib/authorization/kernel/enterpriseEntry', () => ({
  loadEnterpriseAuthorizationKernelFactory: (...args: unknown[]) =>
    loadEnterpriseAuthorizationKernelFactoryMock(...args),
}));

import {
  getAuthorizationKernel,
  resetAuthorizationKernelForTests,
} from 'server/src/lib/authorization/kernel';

describe('authorization kernel CE fallback behavior', () => {
  beforeEach(() => {
    resetAuthorizationKernelForTests();
    loadEnterpriseAuthorizationKernelFactoryMock.mockReset();
    loadEnterpriseAuthorizationKernelFactoryMock.mockResolvedValue(null);
  });

  it('uses builtin kernel path when enterprise kernel factory is unavailable', async () => {
    const kernel = await getAuthorizationKernel();

    const decision = await kernel.authorizeResource({
      knex: {} as any,
      subject: {
        tenant: 'tenant-fallback',
        userId: 'user-fallback',
        userType: 'internal',
      },
      resource: {
        type: 'ticket',
        action: 'read',
      },
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'rbac', code: 'rbac_allowed' }),
        expect.objectContaining({ stage: 'builtin', code: 'builtin_no_record_scope' }),
      ])
    );
  });
});
