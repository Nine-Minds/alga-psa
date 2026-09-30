import type { AuthorizationEvaluationInput } from './contracts';

/**
 * The single decision for "is this approval blocked because the approver owns the record?".
 *
 * Every self-approval enforcement site (quoteActions builtin guard, the REST quote
 * controller guard, the EE builtin guard used by the bundle simulator, and the
 * bundle `not_self_approver` narrowing rule) calls this so they cannot drift.
 *
 * The kernel/provider layer must not reach into the database, so whether the subject
 * is the *only* possible approver (`mutation.allowSelfApproval`) is computed by the
 * caller -- see `allowSelfQuoteApproval` -- and passed in on the mutation input.
 */
export function isSelfApprovalBlocked(input: AuthorizationEvaluationInput): boolean {
  if (input.mutation?.kind !== 'approve') {
    return false;
  }

  if (input.mutation.allowSelfApproval === true) {
    return false;
  }

  const ownerUserId = input.record?.ownerUserId;
  return typeof ownerUserId === 'string' && ownerUserId === input.subject.userId;
}

/** True when the subject is approving a record they own (whether or not that is permitted). */
export function isSelfApprovalAttempt(input: AuthorizationEvaluationInput): boolean {
  if (input.mutation?.kind !== 'approve') {
    return false;
  }

  const ownerUserId = input.record?.ownerUserId;
  return typeof ownerUserId === 'string' && ownerUserId === input.subject.userId;
}
