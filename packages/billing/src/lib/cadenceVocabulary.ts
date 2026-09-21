/**
 * One canonical cadence vocabulary shared by contracts and quotes.
 *
 * Both the contract service-period materializers and the quote cadence bands
 * need to answer the same question — "which canonical billing cycle is this
 * raw `billing_frequency`?" — and historically each answered it with its own
 * private switch. Keeping the mapping here (rather than re-deriving it per
 * consumer) is what makes a quote's cadence bands and a contract's cadence
 * periods agree on the same four canonical cycles.
 *
 * Unknown values normalize to `null`; callers that want to preserve an
 * unrecognized cadence (the quote adapter gives each its own band) fall back to
 * their own trimmed/lower-cased raw value.
 */

export const CADENCE_MONTHLY = 'monthly';
export const CADENCE_QUARTERLY = 'quarterly';
export const CADENCE_SEMI_ANNUALLY = 'semi-annually';
export const CADENCE_ANNUALLY = 'annually';

const CANONICAL_CADENCE: Record<string, string> = {
  monthly: CADENCE_MONTHLY,
  quarterly: CADENCE_QUARTERLY,
  'semi-annually': CADENCE_SEMI_ANNUALLY,
  semiannually: CADENCE_SEMI_ANNUALLY,
  'semi-annual': CADENCE_SEMI_ANNUALLY,
  annually: CADENCE_ANNUALLY,
  annual: CADENCE_ANNUALLY,
};

/**
 * Normalize a raw `billing_frequency` to its canonical cadence, or `null` when
 * it is blank or unrecognized.
 */
export function normalizeCadenceBillingCycle(
  value: string | null | undefined,
): string | null {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw) return null;
  return CANONICAL_CADENCE[raw] ?? null;
}
