import { describe, expect, it, vi } from 'vitest';

import {
  BuiltinAuthorizationKernelProvider,
  createAuthorizationKernel,
  type AuthorizationEvaluationInput,
  type AuthorizationReason,
  type AuthorizationScope,
  type BundleAuthorizationProvider,
  RequestLocalAuthorizationCache,
} from 'server/src/lib/authorization/kernel';

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

describe('authorization kernel engine', () => {
  it('enforces RBAC as the prerequisite gate', async () => {
    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      rbacEvaluator: vi.fn(async () => false),
    });

    const decision = await kernel.authorizeResource(baseInput());

    expect(decision.allowed).toBe(false);
    expect(decision.scope.denied).toBe(true);
    expect(decision.reasons[0]?.stage).toBe('rbac');
    expect(decision.reasons[0]?.code).toBe('rbac_denied');
  });

  it('intersects builtin and bundle scopes instead of widening', async () => {
    const builtinProvider = new BuiltinAuthorizationKernelProvider();
    const bundleProvider: BundleAuthorizationProvider = {
      evaluateNarrowing: vi.fn(async () => ({
        scope: {
          allowAll: false,
          denied: false,
          constraints: [
            { field: 'client_id', operator: 'in', value: ['client-1'] },
          ],
        },
        reasons: [
          {
            stage: 'bundle',
            code: 'bundle_narrowing_applied',
            message: 'bundle',
          },
        ],
      })),
    };

    const kernel = createAuthorizationKernel({
      builtinProvider,
      bundleProvider,
      rbacEvaluator: vi.fn(async () => true),
    });

    const scope = await kernel.resolveScope(baseInput({
      record: {
        id: 'ticket-1',
      },
    }));

    expect(scope.denied).toBe(false);
    expect(scope.allowAll).toBe(false);
    expect(scope.constraints).toEqual([
      { field: 'client_id', operator: 'in', value: ['client-1'] },
    ]);
  });

  it('returns stage-aware explainability reasons', async () => {
    const builtinProvider = new BuiltinAuthorizationKernelProvider({
      relationshipRules: [{ template: 'own' }],
      fieldRedactionResolver: async () => ['internal_notes'],
    });

    const kernel = createAuthorizationKernel({
      builtinProvider,
      rbacEvaluator: vi.fn(async () => true),
    });

    const reasons = await kernel.explainDecision(baseInput({
      record: {
        id: 'ticket-2',
        ownerUserId: 'user-a',
      },
    }));

    const stages = new Set(reasons.map((reason) => reason.stage));
    expect(stages.has('rbac')).toBe(true);
    expect(stages.has('builtin')).toBe(true);
    expect(stages.has('redaction')).toBe(true);
  });

  it('memoizes RBAC evaluation in request-local cache', async () => {
    const cache = new RequestLocalAuthorizationCache();
    const rbacEvaluator = vi.fn(async () => true);

    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      rbacEvaluator,
    });

    const input = baseInput({ requestCache: cache });

    await kernel.authorizeResource(input);
    await kernel.authorizeResource(input);

    expect(rbacEvaluator).toHaveBeenCalledTimes(1);
  });

  it('combines mutation checks with authorization reasons', async () => {
    const builtinProvider = new BuiltinAuthorizationKernelProvider({
      mutationGuards: [
        async () => ({
          allowed: false,
          reasons: [
            {
              stage: 'mutation',
              code: 'not_self_approver',
              message: 'User cannot approve their own entry.',
            } as AuthorizationReason,
          ],
        }),
      ],
    });

    const kernel = createAuthorizationKernel({
      builtinProvider,
      rbacEvaluator: vi.fn(async () => true),
    });

    const decision = await kernel.authorizeMutation(baseInput({
      mutation: {
        kind: 'approve',
      },
    }));

    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((reason) => reason.code === 'not_self_approver')).toBe(true);
  });

  it('applies bundle not-self-approver mutation guard and bundle redaction fields', async () => {
    const bundleProvider: BundleAuthorizationProvider = {
      evaluateNarrowing: vi.fn(async () => ({
        scope: {
          allowAll: false,
          denied: false,
          constraints: [],
        },
        reasons: [],
        mutationDeniedReason: {
          stage: 'mutation',
          code: 'not_self_approver_denied',
          message: 'bundle mutation denied',
        },
        redactedFields: ['cost_basis'],
      })),
    };

    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      bundleProvider,
      rbacEvaluator: vi.fn(async () => true),
    });

    const decision = await kernel.authorizeResource(
      baseInput({
        record: {
          id: 'ticket-3',
          ownerUserId: 'user-a',
        },
      })
    );
    expect(decision.redactedFields).toContain('cost_basis');

    const mutationDecision = await kernel.authorizeMutation(
      baseInput({
        record: {
          id: 'ticket-3',
          ownerUserId: 'user-a',
        },
        mutation: { kind: 'approve' },
      })
    );

    expect(mutationDecision.allowed).toBe(false);
    expect(mutationDecision.reasons.some((reason) => reason.code === 'not_self_approver_denied')).toBe(true);
  });

  it('reports explainability across rbac, builtin, and bundle narrowing sources', async () => {
    const bundleProvider: BundleAuthorizationProvider = {
      evaluateNarrowing: vi.fn(async () => ({
        scope: {
          allowAll: false,
          denied: false,
          constraints: [{ field: 'client_id', operator: 'in', value: ['client-1'] }],
        },
        reasons: [
          {
            stage: 'bundle',
            sourceType: 'bundle',
            code: 'bundle_narrowing_applied',
            message: 'bundle intersection',
          },
        ],
        redactedFields: [],
        mutationDeniedReason: null,
      })),
    };

    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider({
        relationshipRules: [{ template: 'own' }],
      }),
      bundleProvider,
      rbacEvaluator: vi.fn(async () => true),
    });

    const reasons = await kernel.explainDecision(
      baseInput({
        record: {
          id: 'ticket-42',
          ownerUserId: 'user-a',
          clientId: 'client-1',
        },
      })
    );

    const reasonCodes = reasons.map((reason) => `${reason.stage}:${reason.code}`);
    expect(reasonCodes).toEqual(
      expect.arrayContaining([
        'rbac:rbac_allowed',
        'builtin:relationship_rules_allowed',
        'bundle:bundle_narrowing_applied',
      ])
    );
  });
});
