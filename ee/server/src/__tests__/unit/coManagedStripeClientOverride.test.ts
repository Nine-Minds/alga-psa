import { describe, expect, it } from 'vitest';
import { createIndependentPsaStripeClient } from '../../lib/stripe/coManagedIndependentEntitlement';

const field = (client: unknown, name: string) => (client as { getApiField(n: string): unknown }).getApiField(name);

// The upgrade flow's Stripe clients (checkout context and the worker-side entitlement reader both go
// through createIndependentPsaStripeClient) must honour the same override StripeService does.
describe('independent-upgrade Stripe clients honour the emulator override', () => {
  it('routes to the loopback emulator when STRIPE_API_BASE_URL is set', () => {
    const client = createIndependentPsaStripeClient('sk_test_x', { NODE_ENV: 'development', STRIPE_API_BASE_URL: 'http://127.0.0.1:9174' });
    expect([field(client, 'host'), field(client, 'port'), field(client, 'protocol')]).toEqual(['127.0.0.1', 9174, 'http']);
  });
  it('talks to real Stripe when no override is configured', () => {
    expect(field(createIndependentPsaStripeClient('sk_test_x', { NODE_ENV: 'development' }), 'host')).toBe('api.stripe.com');
  });
  it('keeps production on real Stripe without the explicit local-review opt-in', () => {
    const client = createIndependentPsaStripeClient('sk_test_x', { NODE_ENV: 'production', STRIPE_API_BASE_URL: 'http://127.0.0.1:9174' });
    expect(field(client, 'host')).toBe('api.stripe.com');
  });
  it('refuses a live key against a non-Stripe host in a local-review build', () => {
    expect(() => createIndependentPsaStripeClient('sk_live_x', { NODE_ENV: 'production', ALGA_STRIPE_LOCAL_REVIEW: 'true', STRIPE_API_BASE_URL: 'http://127.0.0.1:9174' })).toThrow();
  });
  it('does not construct a raw Stripe client elsewhere in the flow', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['coManagedUpgradeCheckout.ts', 'coManagedIndependentEntitlement.ts']) {
      const src = readFileSync(new URL(`../../lib/stripe/${f}`, import.meta.url), 'utf8');
      expect(src.match(/new Stripe\(/g)?.length ?? 0).toBe(f === 'coManagedIndependentEntitlement.ts' ? 1 : 0);
    }
  });
});
