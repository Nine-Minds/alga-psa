import type { Knex } from 'knex';
import type Stripe from 'stripe';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createOfferCatalog, type OfferCatalog } from './catalog';
import { createScopeResolver, stripeLivemodeFromSecretKey } from './scope';

/**
 * The one composition of the shared offer catalog. StripeService (the web server) and the Temporal
 * worker's loader registration both build it here, so they cannot disagree about scope or mode.
 * Deliberately free of StripeService and of Next, so a worker can import it.
 */

/** Configured billing account for a mode, or undefined when unset or the catalog is not migrated yet. */
export async function loadConfiguredBillingAccount(db: Knex, livemode: boolean): Promise<string | undefined> {
  try {
    const row = await db('stripe_offer_catalog_settings').where({ livemode }).first('stripe_account');
    return row?.stripe_account;
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return undefined;
    throw error;
  }
}

/**
 * Compose a catalog over `db`: a resolver of the admin pool, called per operation (the pool may be rebuilt
 * after a connection reset, so it is never captured). The caller owns the connection's lifetime.
 */
export function createBillingOfferCatalog(input: {
  db: () => Promise<Knex>;
  stripe: Stripe;
  secretKey: string;
  env?: NodeJS.ProcessEnv;
}): OfferCatalog {
  const { db, stripe, secretKey, env = process.env } = input;
  return createOfferCatalog({
    db, stripe, subscriptions: stripe.subscriptions,
    livemode: () => stripeLivemodeFromSecretKey(secretKey),
    scope: createScopeResolver(stripe, secretKey, env, async (livemode, connection) => loadConfiguredBillingAccount(connection ?? await db(), livemode)),
  });
}

/** Platform Stripe secret key: the secret provider first, then STRIPE_SECRET_KEY. Undefined when neither is set. */
export async function resolveStripeSecretKey(): Promise<string | undefined> {
  const provider = await getSecretProviderInstance();
  return (await provider.getAppSecret('stripe_secret_key')) || process.env.STRIPE_SECRET_KEY || undefined;
}
