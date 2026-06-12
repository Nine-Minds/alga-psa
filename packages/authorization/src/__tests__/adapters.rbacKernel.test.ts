import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

const hasPermissionMock = vi.hoisted(() => vi.fn());

vi.mock('../rbac', () => ({
  hasPermission: hasPermissionMock,
}));

import { createAuthorizationKernelWithDefaultRbac, defaultRbacEvaluator } from '../adapters/rbac';
import { BuiltinAuthorizationKernelProvider, type AuthorizationEvaluationInput } from '../kernel';

const stubKnex = { __stub: true } as unknown as Knex;

function baseInput(overrides: Partial<AuthorizationEvaluationInput> = {}): AuthorizationEvaluationInput {
  return {
    subject: {
      tenant: 'tenant-a',
      userId: 'user-1',
      userType: 'client',
    },
    resource: {
      type: 'invoice',
      action: 'read',
    },
    knex: stubKnex,
    ...overrides,
  };
}

beforeEach(() => {
  hasPermissionMock.mockReset();
});

describe('defaultRbacEvaluator', () => {
  it('maps the kernel subject and resource onto hasPermission arguments, including tenant', async () => {
    hasPermissionMock.mockResolvedValue(true);

    const result = await defaultRbacEvaluator(baseInput());

    expect(result).toBe(true);
    expect(hasPermissionMock).toHaveBeenCalledTimes(1);
    expect(hasPermissionMock).toHaveBeenCalledWith(
      {
        tenant: 'tenant-a',
        user_id: 'user-1',
        user_type: 'client',
      },
      'invoice',
      'read',
      stubKnex
    );
  });

  it('returns the deny verdict unchanged', async () => {
    hasPermissionMock.mockResolvedValue(false);

    await expect(defaultRbacEvaluator(baseInput())).resolves.toBe(false);
  });
});

describe('createAuthorizationKernelWithDefaultRbac', () => {
  it('builds a kernel whose RBAC gate is the default hasPermission-backed evaluator', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const kernel = createAuthorizationKernelWithDefaultRbac({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
    });

    const decision = await kernel.authorizeResource(baseInput());

    expect(decision.allowed).toBe(false);
    expect(decision.scope.denied).toBe(true);
    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: 'tenant-a', user_id: 'user-1' }),
      'invoice',
      'read',
      stubKnex
    );
  });

  it('allows access when the default evaluator grants the permission', async () => {
    hasPermissionMock.mockResolvedValue(true);

    const kernel = createAuthorizationKernelWithDefaultRbac({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
    });

    const decision = await kernel.authorizeResource(baseInput());

    expect(decision.allowed).toBe(true);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ stage: 'rbac', code: 'rbac_allowed' })])
    );
  });

  it('prefers an explicitly supplied rbacEvaluator over the default', async () => {
    const customEvaluator = vi.fn(async () => true);

    const kernel = createAuthorizationKernelWithDefaultRbac({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      rbacEvaluator: customEvaluator,
    });

    const decision = await kernel.authorizeResource(baseInput());

    expect(decision.allowed).toBe(true);
    expect(customEvaluator).toHaveBeenCalledTimes(1);
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });
});
