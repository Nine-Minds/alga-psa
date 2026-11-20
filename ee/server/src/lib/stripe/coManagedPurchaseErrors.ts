import { CoManagedProSubscriptionRequiredError } from './coManagedSubscription';
import { OfferTermsChangedError, OfferUnavailableError } from './offerCatalog/types';
import { StripeOwnershipError } from './stripeCustomerOwnership';

export type CoManagedPurchaseBlockedReason =
  | 'customer_unverified'
  | 'no_current_pro'
  | 'offer_paused'
  | 'offer_changed'
  | 'misconfigured';

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
  if (error instanceof CoManagedProSubscriptionRequiredError) return 'no_current_pro';
  if (error instanceof OfferTermsChangedError) return 'offer_changed';
  if (error instanceof OfferUnavailableError) {
    return error.reason === 'no_current_version' ? 'offer_paused' : 'misconfigured';
  }
  return null;
}
