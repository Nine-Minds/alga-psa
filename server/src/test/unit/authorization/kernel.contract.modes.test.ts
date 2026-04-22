import { describe, expect, it } from 'vitest';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  createAuthorizationKernel,
  type AuthorizationEvaluationInput,
} from 'server/src/lib/authorization/kernel';

function baseInput(): AuthorizationEvaluationInput {
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
    record: {
      id: 'ticket-1',
      ownerUserId: 'user-a',
    },
  };
}

describe('authorization kernel shared contract across ce and ee modes', () => {
  it('exposes single-resource, scope, mutation, and explainability entry points in CE mode', async () => {
    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      rbacEvaluator: async () => true,
    });

    const decision = await kernel.authorizeResource(baseInput());
    const scope = await kernel.resolveScope(baseInput());
    const mutation = await kernel.authorizeMutation({
      ...baseInput(),
      mutation: { kind: 'approve' },
    });
    const reasons = await kernel.explainDecision(baseInput());

    expect(typeof decision.allowed).toBe('boolean');
    expect(scope).toMatchObject({ allowAll: expect.any(Boolean), denied: expect.any(Boolean) });
    expect(typeof mutation.allowed).toBe('boolean');
    expect(Array.isArray(reasons)).toBe(true);
  });

  it('uses the same shared contract in EE bundle-overlay mode', async () => {
    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      bundleProvider: new BundleAuthorizationKernelProvider({
        resolveRules: async () => [],
      }),
      rbacEvaluator: async () => true,
    });

    const decision = await kernel.authorizeResource(baseInput());
    const scope = await kernel.resolveScope(baseInput());
    const mutation = await kernel.authorizeMutation({
      ...baseInput(),
      mutation: { kind: 'approve' },
    });
    const reasons = await kernel.explainDecision(baseInput());

    expect(typeof decision.allowed).toBe('boolean');
    expect(scope).toMatchObject({ allowAll: expect.any(Boolean), denied: expect.any(Boolean) });
    expect(typeof mutation.allowed).toBe('boolean');
    expect(Array.isArray(reasons)).toBe(true);
  });
});
