import Stripe from 'stripe';
import type { CoManagedPurchaseBlockedReason } from '@alga-psa/licensing';
import { OfferTermsChangedError, OfferUnavailableError } from './offerCatalog/types';
import { StripeOwnershipError } from './stripeCustomerOwnership';

/** A server-owned, browser-safe classification for expected quote failures. */
export class CoManagedPurchaseBlockedError extends Error {
  constructor(readonly reason: CoManagedPurchaseBlockedReason) {
    super(`Co-managed purchase is blocked: ${reason}`);
    this.name = 'CoManagedPurchaseBlockedError';
  }
}

/** Converts provider and catalog exceptions into the deliberately small public taxonomy. */
export function coManagedPurchaseBlockedReason(error: unknown): CoManagedPurchaseBlockedReason | null {
  if (error instanceof CoManagedPurchaseBlockedError) return error.reason;
  if (error instanceof StripeOwnershipError) return 'customer_unverified';
  if (error instanceof Stripe.errors.StripeConnectionError || error instanceof Stripe.errors.StripeAPIError ||
      error instanceof Stripe.errors.StripeRateLimitError) return 'temporarily_unavailable';
  if (error instanceof OfferTermsChangedError) return 'offer_changed';
  if (error instanceof OfferUnavailableError) {
    if (error.reason === 'no_current_version') return 'offer_paused';
    if (['stripe_unavailable', 'catalog_unavailable', 'scope_unavailable'].includes(error.reason)) return 'temporarily_unavailable';
    return 'misconfigured';
  }
  return null;
}
