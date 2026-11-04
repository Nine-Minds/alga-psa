import { describe, expect, it } from 'vitest';

import {
  BundleAuthorizationKernelProvider,
  isSelfApprovalAttempt,
  isSelfApprovalBlocked,
  type AuthorizationEvaluationInput,
} from '../kernel';

// alga-2026-0002597: every self-approval enforcement site must reach the same decision
// for the same input. The builtin guards (quoteActions, ApiQuoteController, EE simulator)
// all delegate to `isSelfApprovalBlocked`; the bundle `not_self_approver` rule must agree.

const OWNER = 'user-owner';

function approveInput(
  overrides: { subjectUserId?: string; ownerUserId?: string | null; allowSelfApproval?: boolean; kind?: 'approve' | 'update' } = {}
): AuthorizationEvaluationInput {
  return {
    subject: { tenant: 't1', userId: overrides.subjectUserId ?? OWNER, userType: 'internal' },
    resource: { type: 'billing', action: 'approve', id: 'q1' },
    record: { id: 'q1', ownerUserId: overrides.ownerUserId === undefined ? OWNER : overrides.ownerUserId },
    mutation: {
      kind: overrides.kind ?? 'approve',
      record: { id: 'q1', ownerUserId: overrides.ownerUserId === undefined ? OWNER : overrides.ownerUserId },
      ...(overrides.allowSelfApproval === undefined ? {} : { allowSelfApproval: overrides.allowSelfApproval }),
    },
  } as AuthorizationEvaluationInput;
}

async function bundleDenies(input: AuthorizationEvaluationInput): Promise<boolean> {
  const provider = new BundleAuthorizationKernelProvider({
    resolveRules: async () => [
      { id: 'rule-1', resource: 'billing', action: 'approve', constraintKey: 'not_self_approver' },
    ],
  });
  const result = await provider.evaluateNarrowing(input);
  return result.mutationDeniedReason?.code === 'not_self_approver_denied';
}

describe('self-approval decision parity', () => {
  const cases: Array<[string, AuthorizationEvaluationInput, boolean]> = [
    ['owner approving, other approver exists (no flag)', approveInput(), true],
    ['owner approving, flag explicitly false', approveInput({ allowSelfApproval: false }), true],
    ['owner approving, sole approver (flag true)', approveInput({ allowSelfApproval: true }), false],
    ['someone else approving', approveInput({ subjectUserId: 'user-other' }), false],
    ['someone else approving with flag', approveInput({ subjectUserId: 'user-other', allowSelfApproval: true }), false],
    ['record has no owner', approveInput({ ownerUserId: null }), false],
    ['non-approve mutation by owner', approveInput({ kind: 'update' }), false],
  ];

  it.each(cases)('%s', async (_label, input, expectedBlocked) => {
    expect(isSelfApprovalBlocked(input)).toBe(expectedBlocked);
    expect(await bundleDenies(input)).toBe(expectedBlocked);
  });

  it('flags a self-approval attempt for auditing regardless of the sole-approver flag', () => {
    expect(isSelfApprovalAttempt(approveInput({ allowSelfApproval: true }))).toBe(true);
    expect(isSelfApprovalAttempt(approveInput({ allowSelfApproval: false }))).toBe(true);
    expect(isSelfApprovalAttempt(approveInput({ subjectUserId: 'user-other' }))).toBe(false);
    expect(isSelfApprovalAttempt(approveInput({ kind: 'update' }))).toBe(false);
  });
});
