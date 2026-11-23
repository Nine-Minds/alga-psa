import { hasBillingCatalogScope, registerBillingCatalogContextLoader, runWithBillingCatalogContext, type BillingCatalogContext } from '@alga-psa/licensing';
import { getStripeService } from '../StripeService';
import { loadBillingCatalogContextFrom } from './catalogContext';

export { resetLoggedContextLoadFailures } from './catalogContext';

/** Load request-current platform catalog settings through StripeService; no process cache. Registered below as the licensing loader. */
export const loadBillingCatalogContext = (tenantId?: string): Promise<BillingCatalogContext> =>
  loadBillingCatalogContextFrom(() => getStripeService().getOfferCatalog(), tenantId);

/**
 * Optional since the gate resolves the context itself. Kept as an explicit request entry point: it loads
 * the context once and pins it for everything `work` awaits, however many gate checks that makes. Inside an
 * already-open request scope (withAuth opens one for every server action) it joins that scope instead, so
 * the request still loads once.
 */
export async function withBillingCatalogContext<T>(work: () => T | Promise<T>, tenantId?: string): Promise<T> {
  if (hasBillingCatalogScope()) return work();
  const context = await loadBillingCatalogContext(tenantId);
  return runWithBillingCatalogContext(context, work);
}

/**
 * Import side effect: the gate in @alga-psa/licensing resolves the catalog context through this loader
 * whether or not the caller wrapped in `withBillingCatalogContext`. Every EE entry that can reach the
 * gate imports this module (see capabilityEntryPoints.contract.test.ts). The CE alias of this file registers nothing.
 */
registerBillingCatalogContextLoader(loadBillingCatalogContext);
