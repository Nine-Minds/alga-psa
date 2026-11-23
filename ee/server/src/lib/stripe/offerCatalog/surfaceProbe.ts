import { runWithBillingCatalogContext, type BillingCatalogContext } from '@alga-psa/licensing';
import logger from '@alga-psa/core/logger';
import { getStripeService } from '../StripeService';
import { CO_MANAGED_SEAT_OFFER_KEY } from './types';

const probeFailureLoggedTenants = new Set<string>();

/**
 * Load request-current platform catalog settings; no module registration or process cache.
 * A probe *error* still fails closed (`sellable: false`) but is logged once per tenant, so a broken
 * catalog is distinguishable from an offer that is legitimately not sellable.
 */
export async function loadBillingCatalogContext(tenantId?: string): Promise<BillingCatalogContext> {
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
  } catch (error) {
    const tenantKey = tenantId ?? 'unknown';
    if (!probeFailureLoggedTenants.has(tenantKey)) {
      probeFailureLoggedTenants.add(tenantKey);
      const { code, message } = error as { code?: string; message?: string };
      logger.error(`[BillingCatalogProbe] purchase surface probe failed closed: tenant=${tenantKey} code=${code ?? 'unknown'} message=${message ?? String(error)}`);
    }
    return context;
  }
}

export async function withBillingCatalogContext<T>(work: () => T | Promise<T>, tenantId?: string): Promise<T> {
  const context = await loadBillingCatalogContext(tenantId);
  return runWithBillingCatalogContext(context, work);
}
