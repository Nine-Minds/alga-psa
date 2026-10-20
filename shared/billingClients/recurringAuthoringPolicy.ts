import type { CadenceOwner } from '@alga-psa/types';

import {
  resolveBillingCycleAlignmentForCompatibility,
  type BillingCycleAlignment,
} from './billingCycleAlignmentCompatibility';
import {
  ContractLineTimingNotAllowedError,
  isAdvanceTimingAllowedForLineType,
} from './contractLineTimingRule';
import { resolveCadenceOwner } from './recurringTiming';

export type RecurringBillingTiming = 'arrears' | 'advance';

export const DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER: CadenceOwner = 'client';
export const DEFAULT_RECURRING_AUTHORING_BILLING_TIMING: RecurringBillingTiming = 'arrears';

type ResolveRecurringAuthoringPolicyInput = {
  /**
   * The contract line type the policy is resolved for (post-update type on
   * updates). Required on purpose: the timing rule depends on it, so every caller
   * has to state it. `null` means the type is genuinely unknown (no rule applies).
   */
  lineType: string | null;
  cadenceOwner?: CadenceOwner | null;
  fallbackCadenceOwner?: CadenceOwner | null;
  defaultCadenceOwner?: CadenceOwner | null;
  /** The timing the user explicitly asked for. Never coerced. */
  billingTiming?: RecurringBillingTiming | null;
  /** The stored or inherited timing, reused when no explicit value is given. */
  fallbackBillingTiming?: RecurringBillingTiming | null;
  /** A contract-wide timing (wizards) that applies only to lines where it is allowed. */
  contractWideBillingTiming?: RecurringBillingTiming | null;
  enableProration?: boolean | null;
  billingCycleAlignment?: BillingCycleAlignment | null;
  fallbackBillingCycleAlignment?: BillingCycleAlignment | null;
};

export type RecurringAuthoringPolicy = {
  cadenceOwner: CadenceOwner;
  billingTiming: RecurringBillingTiming;
  enableProration: boolean;
  billingCycleAlignment: BillingCycleAlignment;
};

function resolveAuthoringBillingTiming(
  input: ResolveRecurringAuthoringPolicyInput,
): RecurringBillingTiming {
  if (!isAdvanceTimingAllowedForLineType(input.lineType)) {
    // 1. An explicit advance choice on an arrears-only line is a mistake: reject it.
    if (input.billingTiming === 'advance') {
      throw new ContractLineTimingNotAllowedError();
    }
    // 2. Inherited, contract-wide and stale stored values normalize to arrears.
    return 'arrears';
  }
  // 3. Advance is allowed: explicit, then contract-wide, then stored, then the default.
  return (
    input.billingTiming
    ?? input.contractWideBillingTiming
    ?? input.fallbackBillingTiming
    ?? DEFAULT_RECURRING_AUTHORING_BILLING_TIMING
  );
}

// Authoring defaults stay explicit here so wizard, inline edit, preset, repository,
// and API write paths can share one recurrence policy instead of inventing per-path fallbacks.
export function resolveRecurringAuthoringPolicy(
  input: ResolveRecurringAuthoringPolicyInput,
): RecurringAuthoringPolicy {
  const enableProration = Boolean(input.enableProration ?? false);
  const resolvedCadenceOwner =
    input.cadenceOwner
    ?? input.fallbackCadenceOwner
    ?? input.defaultCadenceOwner;

  if (!resolvedCadenceOwner) {
    throw new Error(
      'Recurring authoring requires an explicit cadence owner or a stored cadence owner to reuse.',
    );
  }

  return {
    cadenceOwner: resolveCadenceOwner(resolvedCadenceOwner),
    billingTiming: resolveAuthoringBillingTiming(input),
    enableProration,
    billingCycleAlignment: resolveBillingCycleAlignmentForCompatibility({
      billingCycleAlignment: input.billingCycleAlignment,
      enableProration,
      fallbackAlignment: input.fallbackBillingCycleAlignment,
    }),
  };
}
