/**
 * POST /api/v1/billing-catalog/portal-purchases
 *   { entitlementId, licenseTenantId, offerKey, interval, offerRef, quantity, checkoutSessionId }
 *
 * Persist the portal checkout -> appliance entitlement association BEFORE payment. The reviewed
 * `offerRef` must still be current, otherwise 409 with the fresh terms. Idempotent per checkout.
 * Granting nothing: capacity only follows verified payment through the reconcile endpoint.
 */
import { NextRequest } from 'next/server';
import { getStripeService } from '@ee/lib/stripe/StripeService';
import { BadRequest, catalogRoute, readJson, str } from '@ee/lib/stripe/offerCatalog/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return catalogRoute(request, async () => {
    const body = await readJson(request);
    const interval = str(body.interval, 'interval');
    if (!['day', 'week', 'month', 'year'].includes(interval)) throw new BadRequest('interval is invalid');
    if (!Number.isInteger(body.quantity)) throw new BadRequest('quantity must be an integer');
    const row = await getStripeService().bindCoManagedPortalPurchase({
      entitlementId: str(body.entitlementId, 'entitlementId'), licenseTenantId: str(body.licenseTenantId, 'licenseTenantId'),
      offerKey: str(body.offerKey, 'offerKey'), interval: interval as 'month', offerRef: typeof body.offerRef === 'string' ? body.offerRef : undefined,
      quantity: body.quantity as number, checkoutSessionId: str(body.checkoutSessionId, 'checkoutSessionId'),
    });
    return { purchaseId: row.purchase_id, priceId: row.price_id, offerVersionId: row.offer_version_id, quantity: row.quantity };
  }, 201);
}
