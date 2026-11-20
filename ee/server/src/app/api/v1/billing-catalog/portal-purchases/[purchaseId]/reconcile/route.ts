/**
 * POST /api/v1/billing-catalog/portal-purchases/:purchaseId/reconcile
 *
 * Re-read Stripe, verify ownership / paid state / billed price (historical recognition), and queue
 * and deliver the absolute co-managed seat count to the licensing service. Safe to call repeatedly
 * (webhook, return page, repair job): duplicates and stale facts are no-ops, an issuer outage leaves
 * the fulfillment pending for retry, and nothing here can charge.
 */
import { NextRequest } from 'next/server';
import { getStripeService } from '@ee/lib/stripe/StripeService';
import { catalogRoute, str } from '@ee/lib/stripe/offerCatalog/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ purchaseId: string }> }) {
  return catalogRoute(request, async () => {
    const outcome = await getStripeService().reconcileCoManagedPortalPurchase(str((await params).purchaseId, 'purchaseId'));
    return 'fulfillment' in outcome ? { kind: outcome.kind, delivery: outcome.delivery, coManagedSeats: outcome.fulfillment.co_managed_seats } : outcome;
  });
}
