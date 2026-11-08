/**
 * Lets a local Stripe emulator stand in for Stripe. Defaults to real Stripe (returns `{}`).
 *
 * The override is only honoured for a LOOPBACK endpoint together with an `sk_test_` key. Anything
 * else is refused (throws) rather than silently ignored when it is explicitly requested, so a
 * misconfigured production deployment can never send a live key to a non-Stripe host. In production
 * the override additionally needs the explicit ALGA_STRIPE_LOCAL_REVIEW opt-in; without it the
 * variable is ignored and production talks to real Stripe.
 */
export function stripeApiOverride(secretKey: string, env: NodeJS.ProcessEnv = process.env): {
  host?: string; port?: number; protocol?: 'http' | 'https';
} {
  const base = env.STRIPE_API_BASE_URL;
  if (!base) return {};
  const production = env.NODE_ENV === 'production';
  if (production && env.ALGA_STRIPE_LOCAL_REVIEW !== 'true') return {};
  const parsed = new URL(base);
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Invalid Stripe API override.');
  if (production && (!loopback || !secretKey.startsWith('sk_test_'))) {
    throw new Error('Local Stripe review requires a loopback endpoint and a test key.');
  }
  if (parsed.protocol === 'http:' && !loopback) throw new Error('Stripe API override requires HTTPS outside loopback.');
  return { host: parsed.hostname, ...(parsed.port ? { port: Number(parsed.port) } : {}),
    protocol: parsed.protocol === 'https:' ? 'https' : 'http' };
}
