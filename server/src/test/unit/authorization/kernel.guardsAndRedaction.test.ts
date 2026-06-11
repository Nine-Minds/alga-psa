import { describe, expect, it, vi } from 'vitest';

import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  createAuthorizationKernel,
  type AuthorizationEvaluationInput,
  type BundleAuthorizationProvider,
  type MutationGuardResult,
} from 'server/src/lib/authorization';

function baseInput(overrides: Partial<AuthorizationEvaluationInput> = {}): AuthorizationEvaluationInput {
  return {
    subject: {
      tenant: 'tenant-a',
      userId: 'user-a',
      userType: 'internal',
    },
    resource: {
      type: 'expense',
      action: 'approve',
    },
    ...overrides,
  };
}

describe('builtin mutation guard chain', () => {
  it('runs guards in order and stops at the first denial', async () => {
    const calls: string[] = [];
    const denyResult: MutationGuardResult = {
      allowed: false,
      reasons: [
        {
          stage: 'mutation',
          sourceType: 'builtin',
          code: 'first_guard_denied',
          message: 'denied by first guard',
        },
      ],
    };
    const firstGuard = vi.fn(async () => {
      calls.push('first');
      return denyResult;
    });
    const secondGuard = vi.fn(async () => {
      calls.push('second');
      return { allowed: true, reasons: [] };
    });

    const provider = new BuiltinAuthorizationKernelProvider({
      mutationGuards: [firstGuard, secondGuard],
    });

    const result = await provider.authorizeMutation(baseInput({ mutation: { kind: 'approve' } }));

    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual(denyResult.reasons);
    expect(calls).toEqual(['first']);
    expect(secondGuard).not.toHaveBeenCalled();
  });

  it('passes the full evaluation input (including mutation kind) to each guard', async () => {
    const guard = vi.fn(async () => ({ allowed: true, reasons: [] }));
    const provider = new BuiltinAuthorizationKernelProvider({ mutationGuards: [guard] });

    const input = baseInput({
      record: { id: 'expense-1', ownerUserId: 'user-a' },
      mutation: { kind: 'approve', next: { status: 'approved' } },
    });
    await provider.authorizeMutation(input);

    expect(guard).toHaveBeenCalledWith(input);
  });

  it('reports a passing guard chain with an explainability reason', async () => {
    const provider = new BuiltinAuthorizationKernelProvider({
      mutationGuards: [async () => ({ allowed: true, reasons: [] })],
    });

    const result = await provider.authorizeMutation(baseInput({ mutation: { kind: 'approve' } }));

    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([
      expect.objectContaining({ stage: 'mutation', code: 'mutation_guards_passed' }),
    ]);
  });
});

describe('field redaction merging', () => {
  it('merges and dedupes builtin and bundle redacted fields', async () => {
    const bundleProvider: BundleAuthorizationProvider = {
      evaluateNarrowing: async () => ({
        scope: { allowAll: false, denied: false, constraints: [] },
        reasons: [],
        redactedFields: ['internal_cost', 'margin'],
        mutationDeniedReason: null,
      }),
    };

    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider({
        fieldRedactionResolver: async () => ['internal_cost', 'private_notes'],
      }),
      bundleProvider,
      rbacEvaluator: async () => true,
    });

    const fields = await kernel.resolveFieldRedactions(baseInput({ record: { id: 'expense-2' } }));

    expect(fields.sort()).toEqual(['internal_cost', 'margin', 'private_notes']);
    expect(fields.filter((field) => field === 'internal_cost')).toHaveLength(1);
  });
});

describe('bundle narrowing rule matching', () => {
  it('ignores rules registered for a different resource or action', async () => {
    const provider = new BundleAuthorizationKernelProvider({
      resolveRules: async () => [
        {
          id: 'rule-other-resource',
          resource: 'ticket',
          action: 'approve',
          templateKey: 'own',
        },
        {
          id: 'rule-other-action',
          resource: 'expense',
          action: 'read',
          templateKey: 'own',
        },
      ],
    });

    const result = await provider.evaluateNarrowing(
      baseInput({ record: { id: 'expense-3', ownerUserId: 'someone-else' } })
    );

    expect(result.scope.allowAll).toBe(true);
    expect(result.scope.denied).toBe(false);
    expect(result.reasons).toEqual([]);
    expect(result.redactedFields).toEqual([]);
  });

  it('fails closed on client_visible_only when no record context is available', async () => {
    const provider = new BundleAuthorizationKernelProvider({
      resolveRules: async () => [
        {
          id: 'rule-cv',
          resource: 'expense',
          action: 'approve',
          constraintKey: 'client_visible_only',
        },
      ],
    });

    const result = await provider.evaluateNarrowing(baseInput());

    expect(result.scope.denied).toBe(true);
  });
});

describe('not_self_approver bundle guard through the kernel', () => {
  function buildKernel() {
    return createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      bundleProvider: new BundleAuthorizationKernelProvider({
        resolveRules: async () => [
          {
            id: 'rule-nsa',
            resource: 'expense',
            action: 'approve',
            constraintKey: 'not_self_approver',
          },
        ],
      }),
      rbacEvaluator: async () => true,
    });
  }

  it('denies approving a record the subject owns', async () => {
    const decision = await buildKernel().authorizeMutation(
      baseInput({
        record: { id: 'expense-4', ownerUserId: 'user-a' },
        mutation: { kind: 'approve' },
      })
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'mutation', code: 'not_self_approver_denied' }),
      ])
    );
  });

  it('allows approving a record owned by someone else', async () => {
    const decision = await buildKernel().authorizeMutation(
      baseInput({
        record: { id: 'expense-5', ownerUserId: 'user-b' },
        mutation: { kind: 'approve' },
      })
    );

    expect(decision.allowed).toBe(true);
  });

  it('does not apply to non-approve mutations on owned records', async () => {
    const decision = await buildKernel().authorizeMutation(
      baseInput({
        record: { id: 'expense-6', ownerUserId: 'user-a' },
        mutation: { kind: 'update' },
      })
    );

    expect(decision.allowed).toBe(true);
  });
});
