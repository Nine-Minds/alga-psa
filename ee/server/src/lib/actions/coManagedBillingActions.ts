'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { isCoManagedPurchaseFeatureEnabled, isCoManagedPurchaseSurfaceOpen } from '@alga-psa/licensing';
import { getStripeService } from '../stripe/StripeService';
import { withBillingCatalogContext } from '../stripe/offerCatalog/surfaceProbe';
import { coManagedPurchaseBlockedReason } from '../stripe/coManagedPurchaseErrors';
import { CO_MANAGED_SEAT_OFFER_KEY, OfferTermsChangedError, OfferUnavailableError } from '../stripe/offerCatalog/types';

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

async function requirePurchaser(user: { user_type: string }): Promise<void> {
  if (user.user_type !== 'internal' || !await hasPermission(user as never, 'account_management', 'update')) throw new Error('Permission denied');
}

async function requirePurchaseSurface(tenant: string): Promise<void> {
  if (!await isCoManagedPurchaseSurfaceOpen(tenant)) throw new Error('Co-managed purchasing is not available');
}

export const previewCoManagedSeatsAction = withAuth(async (user, { tenant }, quantity: number) => {
  await requirePurchaser(user);
  return withBillingCatalogContext(async () => {
    if (!await isCoManagedPurchaseFeatureEnabled(tenant)) throw new Error('Co-managed purchasing is not available');
    try {
      const service = getStripeService();
      await (await service.getOfferCatalog()).requireSellableOffer(CO_MANAGED_SEAT_OFFER_KEY, 'month');
      return { kind: 'quote', ...(await service.previewCoManagedSeats(tenant, quantity)) } as const;
    } catch (error) {
      const reason = coManagedPurchaseBlockedReason(error);
      if (reason) return { kind: 'blocked', reason } as const;
      throw error;
    }
  }, tenant);
});

export const purchaseCoManagedSeatsAction = withAuth(async (user, { tenant }, input: { quantity: number; operationId: string; offerRef?: string }) => {
  await requirePurchaser(user);
  return withBillingCatalogContext(async () => {
    await requirePurchaseSurface(tenant);
    const service = getStripeService();
    try {
      const result = await service.purchaseCoManagedSeats(tenant, input.quantity, input.operationId, input.offerRef);
      return { ...result, publishableKey: result.kind === 'checkout' ? await service.getPublishableKey() : null };
    } catch (error) {
      const outcome = offerOutcome(error);
      if (outcome) return { ...outcome, publishableKey: null };
      throw error;
    }
  }, tenant);
});
