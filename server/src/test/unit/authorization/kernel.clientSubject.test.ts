import { describe, expect, it } from 'vitest';

import {
  ALLOW_ALL_SCOPE,
  BuiltinAuthorizationKernelProvider,
  DENY_ALL_SCOPE,
  createAuthorizationKernel,
  resolveDefaultBuiltinRelationshipRules,
  type AuthorizationEvaluationInput,
  type AuthorizationSubject,
  type BundleAuthorizationProvider,
} from 'server/src/lib/authorization';

function clientSubject(overrides: Partial<AuthorizationSubject> = {}): AuthorizationSubject {
  return {
    tenant: 'tenant-a',
    userId: 'client-user-1',
    userType: 'client',
    clientId: 'client-a',
    ...overrides,
  };
}

function internalSubject(overrides: Partial<AuthorizationSubject> = {}): AuthorizationSubject {
  return {
    tenant: 'tenant-a',
    userId: 'internal-user-1',
    userType: 'internal',
    ...overrides,
  };
}

function input(overrides: Partial<AuthorizationEvaluationInput> = {}): AuthorizationEvaluationInput {
  return {
    subject: internalSubject(),
    resource: { type: 'ticket', action: 'read' },
    ...overrides,
  };
}

function kernelWith(
  overrides: {
    subject?: AuthorizationSubject;
    record?: AuthorizationEvaluationInput['record'];
    bundleProvider?: BundleAuthorizationProvider;
    rbac?: boolean;
  } = {}
) {
  const builtinProvider = new BuiltinAuthorizationKernelProvider({
    resolveRelationshipRules: resolveDefaultBuiltinRelationshipRules,
  });
  return createAuthorizationKernel({
    builtinProvider,
    bundleProvider:
      overrides.bundleProvider ??
      ({
        evaluateNarrowing: async () => ({
          scope: ALLOW_ALL_SCOPE,
          reasons: [],
        }),
      } as BundleAuthorizationProvider),
    rbacEvaluator: async () => overrides.rbac ?? true,
  });
}

describe('built-in subject-aware same_client rule (CE and EE default)', () => {
  it('internal subjects resolve to an empty rule set (RBAC/bundle behavior unchanged)', () => {
    expect(
      resolveDefaultBuiltinRelationshipRules({
        subject: internalSubject(),
        resource: { type: 'ticket', action: 'read' },
      })
    ).toEqual([]);

    expect(
      resolveDefaultBuiltinRelationshipRules({
        subject: clientSubject(),
        resource: { type: 'ticket', action: 'read' },
      })
    ).toEqual([{ template: 'same_client' }]);
  });

  it('allows a client subject to read a same-client record', async () => {
    const kernel = kernelWith({
      subject: clientSubject(),
      record: { id: 'ticket-1', clientId: 'client-a' },
    });

    const decision = await kernel.authorizeResource(
      input({
        subject: clientSubject(),
        record: { id: 'ticket-1', clientId: 'client-a' },
      })
    );

    expect(decision.allowed).toBe(true);
    expect(decision.scope.denied).toBe(false);
  });

  it('denies a client subject reading a different-client record', async () => {
    const kernel = kernelWith();

    const decision = await kernel.authorizeResource(
      input({ subject: clientSubject(), record: { id: 'ticket-1', clientId: 'client-b' } })
    );

    expect(decision.allowed).toBe(false);
    expect(decision.scope.denied).toBe(true);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ stage: 'builtin' })])
    );
  });

  it('denies a record without a client ID for a client subject', async () => {
    const kernel = kernelWith();

    const decision = await kernel.authorizeResource(
      input({ subject: clientSubject(), record: { id: 'ticket-1', clientId: undefined } })
    );

    expect(decision.allowed).toBe(false);
    expect(decision.scope.denied).toBe(true);
  });

  it('denies a same-client-looking record when the subject has no resolvable client ID', async () => {
    const kernel = kernelWith();

    const decision = await kernel.authorizeResource(
      input({
        subject: clientSubject({ clientId: undefined }),
        record: { id: 'ticket-1', clientId: 'client-a' },
      })
    );

    expect(decision.allowed).toBe(false);
    expect(decision.scope.denied).toBe(true);
  });

  it('constrains scope-only evaluation for a client subject with a client ID (never allow-all)', async () => {
    const kernel = kernelWith({ subject: clientSubject() });

    const decision = await kernel.authorizeResource(input({ subject: clientSubject() }));

    expect(decision.allowed).toBe(true);
    expect(decision.scope.allowAll).toBe(false);
    expect(decision.scope.denied).toBe(false);
    expect(decision.scope.constraints).toEqual([
      { field: 'client_id', operator: 'eq', value: 'client-a' },
    ]);
  });

  it('denies scope-only evaluation for a client subject without a client ID', async () => {
    const kernel = kernelWith();

    const decision = await kernel.authorizeResource(
      input({ subject: clientSubject({ clientId: undefined }) })
    );

    expect(decision.allowed).toBe(false);
    expect(decision.scope.denied).toBe(true);
    expect(decision.scope.allowAll).toBe(false);
  });

  it('leaves internal no-record scope as allow-all (builtin_no_record_scope)', async () => {
    const kernel = kernelWith();

    const decision = await kernel.authorizeResource(input({ subject: internalSubject() }));

    expect(decision.allowed).toBe(true);
    expect(decision.scope.denied).toBe(false);
    // The built-in layer reports the unconstrained no-record scope; only the
    // bundle intersection (an allow-all scope) narrows allowAll to false.
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'builtin', code: 'builtin_no_record_scope' }),
      ])
    );
  });

  it('enterprise bundle allow cannot widen a same-client denial', async () => {
    // A bundle provider that would allow everything cannot override the
    // built-in same_client denial for a different-client record.
    const kernel = kernelWith();

    const decision = await kernel.authorizeResource(
      input({
        subject: clientSubject(),
        record: { id: 'ticket-1', clientId: 'client-b' },
      })
    );

    expect(decision.allowed).toBe(false);
    expect(decision.scope.denied).toBe(true);
  });
});
