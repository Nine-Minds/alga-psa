/**
 * Server-to-server surface of the shared offer catalog (nm-store / licensing portal -> platform).
 * Gate: the existing master-tenant authority (`x-api-key` of MASTER_BILLING_TENANT_ID), the same
 * service credential nm-store already presents to alga-psa. Read and fulfillment endpoints only;
 * catalog WRITES are never exposed over HTTP (operator CLI only).
 */
import { NextRequest, NextResponse } from 'next/server';
import { OfferPublishError, type CatalogOperator, OfferTermsChangedError, OfferUnavailableError, UnmappedPriceError, type ResolvedOffer } from './types';
import { operatorFromRequest } from './operatorAuth';
import { isMasterTenantAuthError } from '../../auth/masterTenantAccess';
import { PortalPurchaseOwnershipError } from '../coManagedFulfillment';

/** Stable wire shape. Amount, currency and interval are Stripe-derived at the time of the call. */
export function serializeOffer(offer: ResolvedOffer) {
  return {
    offerRef: offer.versionId ?? `price:${offer.priceId}`, source: offer.source, offerKey: offer.offerKey, interval: offer.interval,
    versionId: offer.versionId, versionNumber: offer.versionNumber, priceId: offer.priceId,
    terms: offer.terms, merchant: { stripeAccount: offer.scope.stripeAccount, livemode: offer.scope.livemode },
  };
}

// LEVERAGE: pattern master-gated-json-route — the gate + error-to-status mapping around operator routes is rewritten per route family; a shared wrapper belongs below.
export class BadRequest extends Error {}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch { /* fall through */ }
  throw new BadRequest('A JSON object body is required');
}

export const str = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value || value.length > 200) throw new BadRequest(`${name} is required`);
  return value;
};

export async function catalogRoute(request: NextRequest, handler: (operator: CatalogOperator) => Promise<unknown>, status = 200): Promise<NextResponse> {
  try {
    const operator = await operatorFromRequest(request);
    return NextResponse.json({ success: true, data: await handler(operator) }, { status });
  } catch (error) {
    if (error instanceof OfferPublishError && error.code === 'UNAUTHORIZED' || isMasterTenantAuthError(error)) {
      return NextResponse.json({ success: false, error: (error as Error).message }, { status: 403 });
    }
    if (error instanceof OfferPublishError) {
      // Operator-correctable publication problem: say exactly what to fix.
      return NextResponse.json({ success: false, code: error.code, error: error.message, problems: error.problems }, { status: error.code === 'STALE_EXPECTED_VERSION' || error.code === 'BOUND_TO_OTHER_OFFER' ? 409 : 422 });
    }
    if (error instanceof BadRequest) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    if (error instanceof OfferTermsChangedError) {
      return NextResponse.json({ success: false, code: error.code, error: error.message, current: serializeOffer(error.current) }, { status: 409 });
    }
    if (error instanceof OfferUnavailableError) {
      // New sales are paused or cannot be validated: fail closed, with a reason an operator can act on.
      return NextResponse.json({ success: false, code: error.code, reason: error.reason, error: error.message }, { status: error.reason === 'not_configured' || error.reason === 'no_current_version' ? 404 : 503 });
    }
    if (error instanceof UnmappedPriceError) return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: 422 });
    if (error instanceof PortalPurchaseOwnershipError) return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: 403 });
    console.error('[billing-catalog] unexpected error', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
