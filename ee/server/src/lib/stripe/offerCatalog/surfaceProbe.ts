import { runWithBillingCatalogContext, type BillingCatalogContext } from '@alga-psa/licensing';
import { getStripeService } from '../StripeService';
import { CO_MANAGED_SEAT_OFFER_KEY } from './types';

/** Load request-current platform catalog settings; no module registration or process cache. */
export async function loadBillingCatalogContext(): Promise<BillingCatalogContext> {
  let livemode = /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY_PLATFORM ?? '');
  let stripeAccount: string | null = null;
  let setting: { price_id: string } | null = null;
  try {
    const service = getStripeService();
    const catalog = await service.getOfferCatalog();
    livemode = await catalog.deploymentLivemode();
    const effective = await catalog.effectiveAccountSetting(livemode);
    stripeAccount = effective.stripeAccount;
    setting = await catalog.inspectAccountSetting(livemode);
    if (!stripeAccount || effective.accountSource === 'ambiguous') throw new Error('Stripe catalog account is not configured unambiguously');
    const offer = await catalog.resolveCurrentOffer(CO_MANAGED_SEAT_OFFER_KEY, 'month');
    if (setting && setting.price_id !== offer.priceId) throw new Error('Configured account price does not match the current catalog version');
    return { mode: livemode ? 'live' : 'test', stripeAccount, priceId: offer.priceId,
      source: effective.priceSource === 'database setting' || effective.priceSource === 'database catalog' ? 'database' : 'environment', sellable: true };
  } catch {
    return { mode: livemode ? 'live' : 'test', stripeAccount,
      priceId: (setting?.price_id ?? process.env.STRIPE_CO_MANAGED_USER_PRICE_ID) || null,
      source: setting ? 'database' : process.env.STRIPE_CO_MANAGED_USER_PRICE_ID ? 'environment' : 'unconfigured', sellable: false };
  }
}

export async function withBillingCatalogContext<T>(work: () => T | Promise<T>): Promise<T> {
  const context = await loadBillingCatalogContext();
  return runWithBillingCatalogContext(context, work);
}
