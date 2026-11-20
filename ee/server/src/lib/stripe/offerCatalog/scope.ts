import type Stripe from 'stripe';
import type { CatalogScope, EnvLike } from './types';

/**
 * Merchant scope from trusted server configuration. The mode follows the secret key, the account
 * is `STRIPE_ACCOUNT_ID` when configured, otherwise the account the key belongs to. Nothing here
 * accepts browser input. Failures throw; callers decide whether that fails closed.
 */
export function createScopeResolver(
  stripe: Pick<Stripe, 'accounts'>,
  secretKey: string,
  env: EnvLike = process.env,
  loadDatabaseAccount?: (livemode: boolean) => Promise<string | undefined>,
): () => Promise<CatalogScope> {
  return async () => {
    const livemode = /^(sk|rk)_live_/.test(secretKey);
    if (!livemode && !/^(sk|rk)_test_/.test(secretKey)) throw new Error('Stripe secret key has no recognisable test/live prefix');
    const stripeAccount = await loadDatabaseAccount?.(livemode) || env.STRIPE_ACCOUNT_ID || (await stripe.accounts.retrieve()).id;
    if (!stripeAccount) throw new Error('Stripe account id could not be determined');
    return { stripeAccount, livemode };
  };
}
