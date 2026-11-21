/**
 * POST /api/v1/billing-catalog/offers/classify   { priceId }
 *
 * RECOGNITION: which offer (and version, current or retired) does the Price actually billed belong
 * to? `data: null` means unmapped; the caller must leave capacity unchanged. Master-tenant service auth.
 */
import { NextRequest } from 'next/server';
import { getStripeService } from '@ee/lib/stripe/StripeService';
import { catalogRoute, readJson, str } from '@ee/lib/stripe/offerCatalog/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return catalogRoute(request, async () => {
    const body = await readJson(request);
    const catalog = await getStripeService().getOfferCatalog();
    return catalog.classifyPrice(await catalog.scope(), str(body.priceId, 'priceId'));
  });
}
