import Stripe from 'stripe';

/** Build Stripe clients consistently, preserving SDK defaults outside simulator runs. */
export function createStripeClient(secretKey: string): Stripe {
  const options: Stripe.StripeConfig = { apiVersion: '2024-12-18.acacia' as any, typescript: true };
  const configuredBaseUrl = process.env.STRIPE_API_BASE_URL;
  if (configuredBaseUrl) {
    let base: URL;
    try {
      base = new URL(configuredBaseUrl);
    } catch {
      throw new Error(`Invalid STRIPE_API_BASE_URL: ${configuredBaseUrl}`);
    }
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error(`Invalid STRIPE_API_BASE_URL protocol: ${base.protocol}`);
    if (base.pathname !== '/' && base.pathname !== '/v1') throw new Error('STRIPE_API_BASE_URL must be an origin or /v1 URL');
    options.host = base.hostname;
    options.port = base.port ? Number(base.port) : (base.protocol === 'https:' ? 443 : 80);
    options.protocol = base.protocol === 'https:' ? 'https' : 'http';
  }
  return new Stripe(secretKey, options);
}
