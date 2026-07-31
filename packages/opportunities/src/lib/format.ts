import { formatCurrencyFromMinorUnits } from '@alga-psa/core';

export interface OpportunityValueParts {
  /** Formatted currency amount for the leading value. */
  amount: string;
  /** True when the leading value is recurring (render with a /mo suffix). */
  recurring: boolean;
  /** Formatted secondary amount (one-time) when both recurring and one-time values exist. */
  secondaryAmount?: string;
}

/**
 * Picks the leading value for a deal per the design language: MRR leads when
 * present; one-time (NRR + hardware) leads otherwise. Both shown when both exist.
 */
export function opportunityValueParts(
  mrrCents: number,
  nrrCents: number,
  hardwareCents: number,
  currencyCode: string,
  locale?: string
): OpportunityValueParts {
  const oneTime = nrrCents + hardwareCents;
  const fmt = (cents: number) => formatCurrencyFromMinorUnits(cents, locale, currencyCode);
  if (mrrCents > 0) {
    return {
      amount: fmt(mrrCents),
      recurring: true,
      secondaryAmount: oneTime > 0 ? fmt(oneTime) : undefined,
    };
  }
  return { amount: fmt(oneTime), recurring: false };
}
