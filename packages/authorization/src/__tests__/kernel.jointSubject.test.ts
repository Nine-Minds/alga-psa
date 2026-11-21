import { describe, expect, it, vi } from 'vitest';

import {
  createAuthorizationKernel,
  type AuthorizationEvaluationInput,
  type AuthorizationSubject,
  type BuiltinAuthorizationProvider,
} from '../kernel';

const ALLOW_ALL = { allowAll: true, denied: false, constraints: [] };

function subject(userId: string): AuthorizationSubject {
  return { tenant: 'tenant-a', userId, userType: 'internal' };
}

/**
 * RBAC allows the users in `rbacAllowed`. The built-in provider applies a
 * record-level rule: a subject may act only on a record it owns or is assigned to.
 */
function buildKernel(rbacAllowed: string[]) {
  const evaluate = vi.fn(async (input: AuthorizationEvaluationInput) => {
    const allowed =
      input.record?.ownerUserId === input.subject.userId ||
      (input.record?.assignedUserIds ?? []).includes(input.subject.userId);
    return {
      allowed,
      scope: allowed ? ALLOW_ALL : { allowAll: false, denied: true, constraints: [] },
      reasons: [
        {
          stage: 'builtin' as const,
          sourceType: 'builtin' as const,
          code: allowed ? 'record_rule_allowed' : 'record_rule_denied',
          message: 'record-level rule',
          metadata: { evaluatedFor: input.subject.userId },
        },
      ],
    };
  });
  const authorizeMutation = vi.fn(async (input: AuthorizationEvaluationInput) => ({
    allowed: input.subject.userId !== 'blocked-from-mutation',
    reasons: [],
  }));
  const builtinProvider: BuiltinAuthorizationProvider = {
    evaluate,
    authorizeMutation,
    resolveFieldRedactions: vi.fn(async (input: AuthorizationEvaluationInput) => ({
      fields: input.subject.userId === 'user-b' ? ['secret'] : [],
      reasons: [],
    })),
  };
  const rbacEvaluator = vi.fn(async (input: AuthorizationEvaluationInput) =>
    rbacAllowed.includes(input.subject.userId)
  );
  return { kernel: createAuthorizationKernel({ builtinProvider, rbacEvaluator }), evaluate, rbacEvaluator, authorizeMutation };
}

const resource = { type: 'ticket', action: 'update' };
const sharedRecord = { id: 'r1', assignedUserIds: ['user-a', 'user-b'] };

describe('authorization kernel: joint (two-subject) evaluation', () => {
  it('allows only when both subjects allow', async () => {
    const { kernel } = buildKernel(['user-a', 'user-b']);
    const both = await kernel.authorizeResource({
      subject: subject('user-a'),
      jointSubject: subject('user-b'),
      resource,
      record: sharedRecord,
    });
    expect(both.allowed).toBe(true);
  });

  it('denies when the second subject is denied by RBAC', async () => {
    const { kernel } = buildKernel(['user-a']);
    const decision = await kernel.authorizeResource({
      subject: subject('user-a'),
      jointSubject: subject('user-b'),
      resource,
      record: sharedRecord,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.scope.denied).toBe(true);
  });

  it('denies when the first subject is denied by RBAC', async () => {
    const { kernel } = buildKernel(['user-b']);
    const decision = await kernel.authorizeResource({
      subject: subject('user-a'),
      jointSubject: subject('user-b'),
      resource,
      record: sharedRecord,
    });
    expect(decision.allowed).toBe(false);
  });

  it('evaluates record-level rules for each subject and records the rules per subject', async () => {
    const { kernel, evaluate } = buildKernel(['user-a', 'user-b']);
    const record = { id: 'r2', assignedUserIds: ['user-a'] };
    const decision = await kernel.authorizeResource({
      subject: subject('user-a'),
      jointSubject: subject('user-b'),
      resource,
      record,
    });

    const evaluatedSubjects = evaluate.mock.calls.map(([input]) => input.subject.userId);
    expect(evaluatedSubjects).toEqual(['user-a', 'user-b']);
    for (const [input] of evaluate.mock.calls) {
      expect(input.record).toBe(record);
      expect(input.jointSubject).toBeUndefined();
    }

    // user-b is not assigned to the record, so the record-level rule denies the pair.
    expect(decision.allowed).toBe(false);
    const ruleReasons = decision.reasons.filter((reason) => reason.stage === 'builtin');
    expect(ruleReasons.map((reason) => [reason.subjectUserId, reason.code])).toEqual([
      ['user-a', 'record_rule_allowed'],
      ['user-b', 'record_rule_denied'],
    ]);
  });

  it('unions field redactions from both subjects', async () => {
    const { kernel } = buildKernel(['user-a', 'user-b']);
    const redacted = await kernel.resolveFieldRedactions({
      subject: subject('user-a'),
      jointSubject: subject('user-b'),
      resource,
      record: sharedRecord,
    });
    expect(redacted).toEqual(['secret']);
  });

  it('applies mutation guards for both subjects', async () => {
    const { kernel, authorizeMutation } = buildKernel(['user-a', 'blocked-from-mutation']);
    const record = { id: 'r3', assignedUserIds: ['user-a', 'blocked-from-mutation'] };
    const decision = await kernel.authorizeMutation({
      subject: subject('user-a'),
      jointSubject: subject('blocked-from-mutation'),
      resource,
      record,
      mutation: { kind: 'update' },
    });
    expect(decision.allowed).toBe(false);
    expect(authorizeMutation).toHaveBeenCalledTimes(2);
  });

  it('single-subject calls are unchanged: one evaluation, untagged reasons, same decision', async () => {
    const { kernel, evaluate, rbacEvaluator } = buildKernel(['user-a']);
    const decision = await kernel.authorizeResource({
      subject: subject('user-a'),
      resource,
      record: sharedRecord,
    });

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(rbacEvaluator).toHaveBeenCalledTimes(1);
    expect(decision).toEqual({
      allowed: true,
      scope: { allowAll: false, denied: false, constraints: [] },
      redactedFields: [],
      reasons: [
        expect.objectContaining({ code: 'rbac_allowed' }),
        expect.objectContaining({ code: 'record_rule_allowed' }),
      ],
    });
    expect(decision.reasons.every((reason) => reason.subjectUserId === undefined)).toBe(true);

    const mutation = await kernel.authorizeMutation({
      subject: subject('user-a'),
      resource,
      record: sharedRecord,
      mutation: { kind: 'update' },
    });
    expect(mutation.allowed).toBe(true);
    expect(mutation.reasons.every((reason) => reason.subjectUserId === undefined)).toBe(true);
  });
});
