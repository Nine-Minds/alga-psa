import type { CadenceOwner } from '@alga-psa/types';

import {
  resolveBillingCycleAlignmentForCompatibility,
  type BillingCycleAlignment,
} from './billingCycleAlignmentCompatibility';
import { resolveCadenceOwner } from './recurringTiming';

export type RecurringBillingTiming = 'arrears' | 'advance';

export const DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER: CadenceOwner = 'client';
export const DEFAULT_RECURRING_AUTHORING_BILLING_TIMING: RecurringBillingTiming = 'arrears';

type ResolveRecurringAuthoringPolicyInput = {
  cadenceOwner?: CadenceOwner | null;
  fallbackCadenceOwner?: CadenceOwner | null;
  defaultCadenceOwner?: CadenceOwner | null;
  billingTiming?: RecurringBillingTiming | null;
  fallbackBillingTiming?: RecurringBillingTiming | null;
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
    billingTiming:
      input.billingTiming
      ?? input.fallbackBillingTiming
      ?? DEFAULT_RECURRING_AUTHORING_BILLING_TIMING,
    enableProration,
    billingCycleAlignment: resolveBillingCycleAlignmentForCompatibility({
      billingCycleAlignment: input.billingCycleAlignment,
      enableProration,
      fallbackAlignment: input.fallbackBillingCycleAlignment,
    }),
  };
}
