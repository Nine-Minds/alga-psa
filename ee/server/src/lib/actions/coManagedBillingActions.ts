'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { isCoManagedPurchaseSurfaceOpen } from '@alga-psa/licensing';
import { getStripeService } from '../stripe/StripeService';
import { coManagedPurchaseBlockedReason } from '../stripe/coManagedPurchaseErrors';
import '../stripe/offerCatalog/surfaceProbe';
import { OfferTermsChangedError, OfferUnavailableError } from '../stripe/offerCatalog/types';

/** Actionable, browser-safe outcome: the terms changed (show a fresh review) or new sales are paused. */
export type CoManagedOfferOutcome =
  | { kind: 'review_required'; offerRef: string; unitAmount: number; currency: string; interval: string }
  | { kind: 'unavailable'; reason: string };

function offerOutcome(error: unknown): CoManagedOfferOutcome | null {
  if (error instanceof OfferTermsChangedError) {
    const { terms } = error.current;
    return { kind: 'review_required', offerRef: error.current.versionId ?? `price:${error.current.priceId}`, unitAmount: terms.unitAmount, currency: terms.currency, interval: terms.interval };
  }
  if (error instanceof OfferUnavailableError) return { kind: 'unavailable', reason: error.reason };
  return null;
}

// LEVERAGE: pattern co-managed-purchase-admission — every purchase entry point repeats "internal user + account_management:update + surface open"; a shared guard belongs below.
async function requirePurchaser(user: { user_type: string }, tenant: string): Promise<void> {
  if (user.user_type !== 'internal' || !await hasPermission(user as never, 'account_management', 'update')) throw new Error('Permission denied');
  // Kill switch, release flag and price: a closed surface is inert, not merely hidden.
  if (!await isCoManagedPurchaseSurfaceOpen(tenant)) throw new Error('Co-managed purchasing is not available');
}

export const previewCoManagedSeatsAction = withAuth(async (user, { tenant }, quantity: number) => {
  await requirePurchaser(user, tenant);
  try {
    const quote = await getStripeService().previewCoManagedSeats(tenant, quantity);
    return { kind: 'quote', ...quote } as const;
  } catch (error) {
    // Expected failures cross the server-action boundary as codes. Provider details stay on the server.
    const reason = coManagedPurchaseBlockedReason(error);
    if (reason) return { kind: 'blocked', reason } as const;
    throw error;
  }
});

export const purchaseCoManagedSeatsAction = withAuth(async (user, { tenant }, input: { quantity: number; operationId: string; offerRef?: string }) => {
  await requirePurchaser(user, tenant);
  const service = getStripeService();
  try {
    const result = await service.purchaseCoManagedSeats(tenant, input.quantity, input.operationId, input.offerRef);
    return { ...result, publishableKey: result.kind === 'checkout' ? await service.getPublishableKey() : null };
  } catch (error) {
    // A changed price is an outcome, not a failure: nothing was charged and a fresh review follows.
    const outcome = offerOutcome(error);
    if (outcome) return { ...outcome, publishableKey: null };
    throw error;
  }
});
