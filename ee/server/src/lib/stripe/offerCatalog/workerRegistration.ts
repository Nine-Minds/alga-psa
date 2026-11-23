import Stripe from 'stripe';
import { getAdminConnection } from '@alga-psa/db';
import { registerBillingCatalogContextLoader } from '@alga-psa/licensing';
import { stripeApiOverride } from '../stripeApiOverride';
import { createBillingOfferCatalog, resolveStripeSecretKey } from './catalogFactory';
import { loadBillingCatalogContextFrom } from './catalogContext';

/**
 * Worker-safe registration of the billing catalog context loader (the Temporal worker's counterpart of
 * surfaceProbe.ts). It must not import StripeService: that module is not part of the worker's build.
 * The catalog is composed by the same factory StripeService uses, with the Stripe client built from the
 * same secret resolution and API override. Nothing is cached: each load resolves the key, builds a client
 * and asks the admin connection for a pool handle, so an operator's `set-account` or a pool refresh
 * is picked up by the next load.
 */
async function workerCatalog() {
  const secretKey = await resolveStripeSecretKey();
  if (!secretKey) throw Object.assign(new Error('Stripe secret key is not configured'), { code: 'STRIPE_KEY_MISSING' });
  const stripe = new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' as never, typescript: true, ...stripeApiOverride(secretKey) });
  return createBillingOfferCatalog({ db: () => getAdminConnection(), stripe, secretKey });
}

export const loadWorkerBillingCatalogContext = () => loadBillingCatalogContextFrom(workerCatalog);

registerBillingCatalogContextLoader(loadWorkerBillingCatalogContext);
