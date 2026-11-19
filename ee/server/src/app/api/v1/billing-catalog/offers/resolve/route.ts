/**
 * POST /api/v1/billing-catalog/offers/resolve   { offerKey, interval }
 *
 * NEW-SALE selection for a storefront (the licensing portal): the same resolver hosted Account
 * Management uses. Returns the offer reference, version, Price ID and Stripe-derived terms for
 * review. Fails closed (404/503) when there is no sellable mapping. Master-tenant service auth.
 */
import { NextRequest } from 'next/server';
import { getStripeService } from '@ee/lib/stripe/StripeService';
import { BadRequest, catalogRoute, readJson, serializeOffer, str } from '@ee/lib/stripe/offerCatalog/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return catalogRoute(request, async () => {
    const body = await readJson(request);
    const interval = str(body.interval, 'interval');
    if (!['day', 'week', 'month', 'year'].includes(interval)) throw new BadRequest('interval is invalid');
    const catalog = await getStripeService().getOfferCatalog();
    return serializeOffer(await catalog.resolveCurrentOffer(str(body.offerKey, 'offerKey'), interval as 'month'));
  });
}
