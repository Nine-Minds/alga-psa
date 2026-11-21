import { describe, expect, it, vi } from 'vitest';

import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  CREATE_CANDIDATE_DENIED_CODE,
  createAuthorizationKernel,
  prerequisiteActionsFor,
  registerBuiltinRuleResolver,
  unregisterBuiltinRuleResolver,
  type AuthorizationEvaluationInput,
  type AuthorizationRecord,
  type AuthorizationSubject,
  type BundleNarrowingRule,
} from '../kernel';

// S14 / F010: `create` is evaluated against the record about to be written.

const narrowed: AuthorizationSubject = {
  tenant: 'tenant-a', userId: 'user-a', userType: 'internal', portfolioClientIds: ['client-a'],
};
const unrestricted: AuthorizationSubject = { tenant: 'tenant-a', userId: 'user-u', userType: 'internal' };

const portfolioRead: BundleNarrowingRule = {
  id: 'read-portfolio', bundleId: 'bundle-1', resource: 'ticket', action: 'read', templateKey: 'client_portfolio',
};

function buildKernel(rules: BundleNarrowingRule[]) {
  const resolveRules = vi.fn(async () => rules);
  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({ relationshipRules: [] }),
    bundleProvider: new BundleAuthorizationKernelProvider({ resolveRules }),
    rbacEvaluator: async () => true,
  });
  return { kernel, resolveRules };
}

function createInput(subject: AuthorizationSubject, record?: AuthorizationRecord): AuthorizationEvaluationInput {
  return { subject, resource: { type: 'ticket', action: 'create' }, record };
}

describe('authorization kernel: create is evaluated against the candidate record', () => {
  it('allows a candidate whose client is in the subject portfolio', async () => {
    const { kernel } = buildKernel([portfolioRead]);
    const decision = await kernel.authorizeMutation(createInput(narrowed, { clientId: 'client-a' }));
    expect(decision.allowed).toBe(true);
    expect(decision.reasons.some((reason) => reason.code === CREATE_CANDIDATE_DENIED_CODE)).toBe(false);
  });

  it('denies a candidate for a client outside the portfolio and names the reason', async () => {
    const { kernel } = buildKernel([portfolioRead]);
    const decision = await kernel.authorizeMutation(createInput(narrowed, { clientId: 'client-c' }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContainEqual(expect.objectContaining({ code: 'bundle_portfolio_denied' }));
    expect(decision.reasons).toContainEqual(
      expect.objectContaining({
        stage: 'mutation',
        code: CREATE_CANDIDATE_DENIED_CODE,
        metadata: { resource: 'ticket', action: 'create', clientId: 'client-c' },
      })
    );
    expect(CREATE_CANDIDATE_DENIED_CODE).toBe('create_candidate_denied');
  });

  it('emits the same reason from the resource decision', async () => {
    const { kernel } = buildKernel([portfolioRead]);
    const decision = await kernel.authorizeResource(createInput(narrowed, { clientId: 'client-c' }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((reason) => reason.code === CREATE_CANDIDATE_DENIED_CODE)).toBe(true);
  });

  it('denies a narrowed subject when the candidate client cannot be resolved', async () => {
    const { kernel } = buildKernel([portfolioRead]);
    for (const record of [{ clientId: null }, {}, undefined]) {
      const decision = await kernel.authorizeMutation(createInput(narrowed, record));
      expect(decision.allowed).toBe(false);
    }
  });

  it('is not affected for an unrestricted subject, with or without a candidate', async () => {
    const { kernel } = buildKernel([]);
    expect((await kernel.authorizeMutation(createInput(unrestricted, { clientId: 'client-c' }))).allowed).toBe(true);
    expect((await kernel.authorizeMutation(createInput(unrestricted))).allowed).toBe(true);
    expect((await kernel.authorizeMutation(createInput(unrestricted, { clientId: null }))).allowed).toBe(true);
  });

  it('lets a closed bundle that does not name create deny it, as for any unnamed action', async () => {
    const { kernel } = buildKernel([
      { id: 'other', bundleId: 'bundle-closed', revisionId: 'rev-1', baseline: 'closed', resource: 'ticket', action: 'read', templateKey: 'client_portfolio' },
    ]);
    const decision = await kernel.authorizeMutation(createInput(narrowed, { clientId: 'client-a' }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContainEqual(expect.objectContaining({ code: 'bundle_closed_baseline_denied' }));
  });

  it('allows an in-scope candidate under a closed bundle that names create and read', async () => {
    const closed = { bundleId: 'bundle-closed', revisionId: 'rev-1', baseline: 'closed' as const };
    const { kernel } = buildKernel([
      { id: 'closed-read', ...closed, resource: 'ticket', action: 'read', templateKey: 'client_portfolio' },
      { id: 'closed-create', ...closed, resource: 'ticket', action: 'create' },
    ]);
    expect((await kernel.authorizeMutation(createInput(narrowed, { clientId: 'client-a' }))).allowed).toBe(true);
    const outOfScope = await kernel.authorizeMutation(createInput(narrowed, { clientId: 'client-c' }));
    expect(outOfScope.allowed).toBe(false);
    expect(outOfScope.reasons).toContainEqual(expect.objectContaining({ code: 'bundle_portfolio_denied' }));
  });

  it('keeps the client fence when an exact create rule also exists', async () => {
    const { kernel } = buildKernel([
      portfolioRead,
      { id: 'create-any', bundleId: 'bundle-1', resource: 'ticket', action: 'create' },
    ]);
    expect((await kernel.authorizeMutation(createInput(narrowed, { clientId: 'client-c' }))).allowed).toBe(false);
    expect((await kernel.authorizeMutation(createInput(narrowed, { clientId: 'client-a' }))).allowed).toBe(true);
  });

  it('applies selected_clients and same_client read rules to the candidate too', async () => {
    const { kernel } = buildKernel([
      { id: 'sel', bundleId: 'b', resource: 'ticket', action: 'read', templateKey: 'selected_clients', selectedClientIds: ['client-b'] },
    ]);
    expect((await kernel.authorizeMutation(createInput(narrowed, { clientId: 'client-b' }))).allowed).toBe(true);
    expect((await kernel.authorizeMutation(createInput(narrowed, { clientId: 'client-a' }))).allowed).toBe(false);
  });

  it('ignores read rules that are not about the client (ownership, redaction)', async () => {
    const { kernel } = buildKernel([
      { id: 'own', bundleId: 'b', resource: 'ticket', action: 'read', templateKey: 'own' },
    ]);
    expect((await kernel.authorizeMutation(createInput(narrowed, { clientId: 'client-c' }))).allowed).toBe(true);
  });

  it('applies a built-in resolver client rule to the candidate', async () => {
    registerBuiltinRuleResolver({
      id: 'test-create-resolver',
      appliesTo: () => true,
      resolveRules: () => [{ id: 'r1', resource: 'ticket', action: 'read', templateKey: 'client_portfolio' }],
    });
    try {
      const { kernel } = buildKernel([]);
      const denied = await kernel.authorizeMutation(createInput(narrowed, { clientId: 'client-c' }));
      expect(denied.allowed).toBe(false);
      expect(denied.reasons).toContainEqual(expect.objectContaining({ code: 'resolver_template_denied' }));
      expect((await kernel.authorizeMutation(createInput(narrowed, { clientId: 'client-a' }))).allowed).toBe(true);
    } finally {
      unregisterBuiltinRuleResolver('test-create-resolver');
    }
  });

  it('does not run the read prerequisite against a record that does not exist', async () => {
    expect(prerequisiteActionsFor('create')).toEqual([]);
    const { kernel, resolveRules } = buildKernel([portfolioRead]);
    await kernel.authorizeMutation(createInput(narrowed, { clientId: 'client-a' }));
    // One rule load: only the create evaluation, no extra pass for a `read` prerequisite.
    expect(resolveRules).toHaveBeenCalledTimes(1);
    const inputs = resolveRules.mock.calls.map((call) => (call as unknown as [AuthorizationEvaluationInput])[0]);
    expect(inputs.every((input) => input.resource.action === 'create')).toBe(true);
  });

  it('is still refused when RBAC denies, without evaluating the candidate', async () => {
    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider({ relationshipRules: [] }),
      rbacEvaluator: async () => false,
    });
    const decision = await kernel.authorizeMutation(createInput(unrestricted, { clientId: 'client-a' }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons[0]?.code).toBe('rbac_denied');
  });
});
