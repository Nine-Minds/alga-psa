import type Stripe from 'stripe';
import type { BillingInterval, OfferTerms } from './types';

export interface PriceExpectation {
  interval: BillingInterval;
  livemode: boolean;
  /** Product the offer has always been sold under; absent only for an offer's first publication. */
  productId?: string;
  /** New sales need an active price; recognising a historical price does not. */
  requireActive: boolean;
}

export const priceProductId = (price: Stripe.Price): string =>
  typeof price.product === 'string' ? price.product : price.product.id;

/**
 * Every reason this price cannot back a per-seat offer. Empty means valid. Amount and currency are
 * never judged or hardcoded here: Stripe stays the authority and they are only echoed for review.
 */
export function priceProblems(price: Stripe.Price, expected: PriceExpectation): string[] {
  const problems: string[] = [];
  if (price.livemode !== expected.livemode) problems.push(`price is ${price.livemode ? 'live' : 'test'} mode but this catalog is ${expected.livemode ? 'live' : 'test'} mode`);
  if (expected.requireActive && !price.active) problems.push('price is not active, so it cannot be sold');
  if (price.type !== 'recurring' || !price.recurring) problems.push('price is not recurring');
  else {
    if (price.recurring.interval !== expected.interval) problems.push(`price interval is ${price.recurring.interval}, expected ${expected.interval}`);
    if (price.recurring.interval_count !== 1) problems.push('price interval_count must be 1');
    if (price.recurring.usage_type !== 'licensed') problems.push('price must use licensed (per-seat quantity) billing, not metered');
  }
  if (price.billing_scheme !== 'per_unit') problems.push(`price billing scheme is ${price.billing_scheme}, expected per_unit`);
  if (price.transform_quantity) problems.push('price transforms quantity, so a seat count would not map 1:1 to the billed quantity');
  if (typeof price.unit_amount !== 'number' || !Number.isInteger(price.unit_amount) || price.unit_amount <= 0) problems.push('price has no positive unit amount');
  if (!price.currency) problems.push('price has no currency');
  if (expected.productId && priceProductId(price) !== expected.productId) problems.push(`price belongs to product ${priceProductId(price)}, expected ${expected.productId}`);
  return problems;
}

/** Display terms, derived from Stripe at call time. Throws when the price has no unit amount. */
export function termsOf(price: Stripe.Price): OfferTerms {
  if (typeof price.unit_amount !== 'number' || !price.recurring) throw new Error('Price has no recurring unit amount');
  return { unitAmount: price.unit_amount, currency: price.currency, interval: price.recurring.interval as BillingInterval,
    intervalCount: price.recurring.interval_count };
}
