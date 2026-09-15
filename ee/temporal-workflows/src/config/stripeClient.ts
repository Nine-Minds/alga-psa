import Stripe from 'stripe';

/** Shared worker factory: credentials remain owned by each caller's existing secret path. */
export function createWorkerStripeClient(secretKey: string, env: NodeJS.ProcessEnv = process.env): Stripe {
  const options: Stripe.StripeConfig = { apiVersion: '2024-12-18.acacia' as any, typescript: true };
  if (env.STRIPE_API_BASE_URL) {
    const url = new URL(env.STRIPE_API_BASE_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || !['/', '/v1', '/v1/'].includes(url.pathname)) {
      throw new Error('STRIPE_API_BASE_URL must be an HTTP(S) origin or /v1 endpoint without credentials, query or fragment');
    }
    options.host = url.hostname;
    options.protocol = url.protocol === 'https:' ? 'https' : 'http';
    options.port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  }
  return new Stripe(secretKey, options);
}
