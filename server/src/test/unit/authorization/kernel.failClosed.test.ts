import { describe, expect, it, vi } from 'vitest';

import {
  ALLOW_ALL_SCOPE,
  BuiltinAuthorizationKernelProvider,
  DENY_ALL_SCOPE,
  createAuthorizationKernel,
  intersectAuthorizationScopes,
  type AuthorizationEvaluationInput,
  type BundleAuthorizationProvider,
} from 'server/src/lib/authorization';

function baseInput(overrides: Partial<AuthorizationEvaluationInput> = {}): AuthorizationEvaluationInput {
  return {
    subject: {
      tenant: 'tenant-a',
      userId: 'user-a',
      userType: 'internal',
    },
    resource: {
      type: 'ticket',
      action: 'read',
    },
    ...overrides,
  };
}

describe('authorization kernel fail-closed behavior', () => {
  it('denies with a deny-all scope when no relationship rule matches the record', async () => {
    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider({
        relationshipRules: [{ template: 'own' }, { template: 'assigned' }],
      }),
      rbacEvaluator: async () => true,
    });

    const decision = await kernel.authorizeResource(
      baseInput({
        record: {
          id: 'ticket-1',
          ownerUserId: 'someone-else',
          assignedUserIds: ['someone-else'],
        },
      })
    );

    expect(decision.allowed).toBe(false);
    expect(decision.scope.denied).toBe(true);
    expect(decision.scope.allowAll).toBe(false);
    expect(decision.scope.constraints).toEqual([]);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'builtin', code: 'relationship_rules_denied' }),
      ])
    );
  });

  it('denies overall when the bundle scope denies even though builtin allows', async () => {
    const bundleProvider: BundleAuthorizationProvider = {
      evaluateNarrowing: async () => ({
        scope: { allowAll: false, denied: true, constraints: [] },
        reasons: [
          {
            stage: 'bundle',
            sourceType: 'bundle',
            code: 'bundle_template_denied',
            message: 'Bundle narrowing denied access.',
          },
        ],
      }),
    };

    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      bundleProvider,
      rbacEvaluator: async () => true,
    });

    const decision = await kernel.authorizeResource(
      baseInput({ record: { id: 'ticket-2' } })
    );

    expect(decision.allowed).toBe(false);
    expect(decision.scope.denied).toBe(true);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'bundle_template_denied' })])
    );
  });

  it('propagates RBAC evaluator failures instead of resolving to an allow', async () => {
    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      rbacEvaluator: async () => {
        throw new Error('rbac backend unavailable');
      },
    });

    await expect(kernel.authorizeResource(baseInput())).rejects.toThrow('rbac backend unavailable');
  });

  it('short-circuits mutation authorization when RBAC denies, without running guards', async () => {
    const guard = vi.fn(async () => ({ allowed: true, reasons: [] }));
    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider({ mutationGuards: [guard] }),
      rbacEvaluator: async () => false,
    });

    const decision = await kernel.authorizeMutation(
      baseInput({ mutation: { kind: 'update' } })
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ stage: 'rbac', code: 'rbac_denied' })])
    );
    expect(guard).not.toHaveBeenCalled();
  });

  it('short-circuits mutation authorization when relationship rules deny the record', async () => {
    const guard = vi.fn(async () => ({ allowed: true, reasons: [] }));
    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider({
        relationshipRules: [{ template: 'own' }],
        mutationGuards: [guard],
      }),
      rbacEvaluator: async () => true,
    });

    const decision = await kernel.authorizeMutation(
      baseInput({
        record: { id: 'ticket-3', ownerUserId: 'someone-else' },
        mutation: { kind: 'update' },
      })
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'builtin', code: 'relationship_rules_denied' }),
      ])
    );
    expect(guard).not.toHaveBeenCalled();
  });
});

describe('intersectAuthorizationScopes', () => {
  it('returns allow-all for an empty scope list', () => {
    expect(intersectAuthorizationScopes()).toEqual(ALLOW_ALL_SCOPE);
  });

  it('lets a single denied scope dominate the intersection and drops constraints', () => {
    const result = intersectAuthorizationScopes(
      {
        allowAll: false,
        denied: false,
        constraints: [{ field: 'client_id', operator: 'eq', value: 'client-1' }],
      },
      DENY_ALL_SCOPE
    );

    expect(result).toEqual(DENY_ALL_SCOPE);
    expect(result.constraints).toEqual([]);
  });

  it('concatenates constraints from every scope (narrowing, never widening)', () => {
    const result = intersectAuthorizationScopes(
      {
        allowAll: false,
        denied: false,
        constraints: [{ field: 'client_id', operator: 'in', value: ['client-1'] }],
      },
      {
        allowAll: false,
        denied: false,
        constraints: [{ field: 'board_id', operator: 'eq', value: 'board-9' }],
      }
    );

    expect(result.denied).toBe(false);
    expect(result.constraints).toEqual([
      { field: 'client_id', operator: 'in', value: ['client-1'] },
      { field: 'board_id', operator: 'eq', value: 'board-9' },
    ]);
  });

  it('never reports allow-all after an intersection, even of allow-all scopes', () => {
    const result = intersectAuthorizationScopes(ALLOW_ALL_SCOPE, ALLOW_ALL_SCOPE);

    expect(result.allowAll).toBe(false);
    expect(result.denied).toBe(false);
    expect(result.constraints).toEqual([]);
  });
});
