/**
 * POST /api/v1/billing-catalog/portal-purchases
 *   { purchaseId, entitlementId, licenseTenantId, offerKey, interval, offerRef, quantity, checkoutSessionId }
 *
 * Persist the portal checkout -> appliance entitlement association BEFORE payment. `purchaseId` is a
 * UUID the storefront generates and also puts in the Checkout session's `metadata` and
 * `subscription_data.metadata` (as `portal_purchase_id`) when it creates the session. The reviewed
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
    if (body.purchaseId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.purchaseId))) {
      throw new BadRequest('purchaseId must be a UUID');
    }
    const row = await getStripeService().bindCoManagedPortalPurchase({
      entitlementId: str(body.entitlementId, 'entitlementId'), licenseTenantId: str(body.licenseTenantId, 'licenseTenantId'),
      offerKey: str(body.offerKey, 'offerKey'), interval: interval as 'month', offerRef: typeof body.offerRef === 'string' ? body.offerRef : undefined,
      quantity: body.quantity as number, checkoutSessionId: str(body.checkoutSessionId, 'checkoutSessionId'),
      purchaseId: body.purchaseId === undefined ? undefined : str(body.purchaseId, 'purchaseId'),
    });
    return { purchaseId: row.purchase_id, priceId: row.price_id, offerVersionId: row.offer_version_id, quantity: row.quantity };
  }, 201);
}
