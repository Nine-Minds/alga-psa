import { NextRequest } from 'next/server';
import { getStripeService } from '@ee/lib/stripe/StripeService';
import { BadRequest, catalogRoute, readJson, str } from '@ee/lib/stripe/offerCatalog/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return catalogRoute(request, async () => {
    const catalog = await getStripeService().getOfferCatalog();
    const activeScope = await catalog.scope();
    const rows = await Promise.all([false, true].map(async (livemode) => {
      const setting = await catalog.inspectAccountSetting(livemode);
      const currentMode = livemode === activeScope.livemode;
      const environmentAccount = currentMode ? process.env.STRIPE_ACCOUNT_ID || null : null;
      const offer = currentMode ? await catalog.inspect('co_managed_technician_seat', 'month') : null;
      const accountSource = setting ? 'database' : environmentAccount ? 'environment bootstrap' : 'unconfigured';
      const priceId = setting?.price_id ?? offer?.current?.price_id ?? (currentMode ? process.env.STRIPE_CO_MANAGED_USER_PRICE_ID || null : null);
      const priceSource = setting ? 'database setting' : offer?.current ? 'database offer catalog' : priceId ? 'environment bootstrap' : 'unconfigured';
      return { mode: livemode ? 'live' : 'test', account: setting?.stripe_account ?? environmentAccount,
        priceId, accountSource, priceSource };
    }));
    return { settings: rows };
  });
}

export async function POST(request: NextRequest) {
  return catalogRoute(request, async (operator) => {
    const body = await readJson(request);
    if (body.mode !== 'test' && body.mode !== 'live') throw new BadRequest('mode must be test or live');
    const expectedAccount = body.expectedAccount === null ? null : str(body.expectedAccount, 'expectedAccount');
    const expectedPriceId = body.expectedPriceId === null ? null : str(body.expectedPriceId, 'expectedPriceId');
    const result = await getStripeService().setBillingCatalogAccount(operator, {
      livemode: body.mode === 'live', stripeAccount: str(body.stripeAccount, 'stripeAccount'),
      priceId: str(body.priceId, 'priceId'), expectedAccount, expectedPriceId, confirmSwitch: body.confirmSwitch === true,
    });
    return result;
  });
}
