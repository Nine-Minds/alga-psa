import { runWithBillingCatalogContext, type BillingCatalogContext } from '@alga-psa/licensing';
import { getStripeService } from '../StripeService';
import { CO_MANAGED_SEAT_OFFER_KEY } from './types';

/** Load request-current platform catalog settings; no module registration or process cache. */
export async function loadBillingCatalogContext(): Promise<BillingCatalogContext> {
  let livemode = /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY_PLATFORM ?? '');
  let context: BillingCatalogContext = { mode: livemode ? 'live' : 'test', stripeAccount: null,
    priceId: null, source: 'unconfigured', sellable: false };
  try {
    const catalog = await getStripeService().getOfferCatalog();
    livemode = await catalog.deploymentLivemode();
    const effective = await catalog.effectiveAccountSetting(livemode);
    context = {
      mode: livemode ? 'live' : 'test',
      stripeAccount: effective.stripeAccount,
      priceId: effective.priceId,
      source: effective.priceSource === 'database setting' || effective.priceSource === 'database catalog'
        ? 'database' : effective.priceSource === 'environment bootstrap' ? 'environment' : 'unconfigured',
      sellable: false,
    };
    if (!context.stripeAccount || !context.priceId) return context;
    const offer = await catalog.resolveCurrentOffer(CO_MANAGED_SEAT_OFFER_KEY, 'month');
    return { ...context, sellable: offer.scope.stripeAccount === context.stripeAccount &&
      offer.scope.livemode === livemode && offer.priceId === context.priceId };
  } catch {
    return context;
  }
}

export async function withBillingCatalogContext<T>(work: () => T | Promise<T>): Promise<T> {
  const context = await loadBillingCatalogContext();
  return runWithBillingCatalogContext(context, work);
}
