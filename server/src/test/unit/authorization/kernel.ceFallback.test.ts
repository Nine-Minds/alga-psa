import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadEnterpriseAuthorizationKernelFactoryMock = vi.hoisted(() =>
  vi.fn(async () => null)
);

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
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
