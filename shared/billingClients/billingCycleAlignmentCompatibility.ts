export type BillingCycleAlignment = 'start' | 'end' | 'prorated';

export const DEFAULT_BILLING_CYCLE_ALIGNMENT: BillingCycleAlignment = 'start';

export function resolveBillingCycleAlignmentForCompatibility(input: {
  billingCycleAlignment?: BillingCycleAlignment | null;
  enableProration?: boolean | null;
  fallbackAlignment?: BillingCycleAlignment | null;
}): BillingCycleAlignment {
  if (input.billingCycleAlignment) {
    return input.billingCycleAlignment;
  }

  if (input.fallbackAlignment) {
    return input.fallbackAlignment;
  }

  return input.enableProration ? 'prorated' : DEFAULT_BILLING_CYCLE_ALIGNMENT;
}
