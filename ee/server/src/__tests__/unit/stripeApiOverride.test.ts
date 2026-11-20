import { describe, expect, it } from 'vitest';
import { stripeApiOverride } from '../../lib/stripe/stripeApiOverride';

describe('Stripe simulator boundary', () => {
  it('keeps production on real Stripe without explicit local-review opt-in', () => {
    expect(stripeApiOverride('sk_test_fake', { NODE_ENV: 'production', STRIPE_API_BASE_URL: 'http://127.0.0.1:9174' })).toEqual({});
  });
  it.each(['sk_test_fake', 'rk_test_fake'])('permits a local production review build with %s', (key) => {
    expect(stripeApiOverride(key, { NODE_ENV: 'production', ALGA_STRIPE_LOCAL_REVIEW: 'true', STRIPE_API_BASE_URL: 'http://127.0.0.1:9174' }))
      .toEqual({ host: '127.0.0.1', port: 9174, protocol: 'http' });
  });
  it.each([
    ['sk_live_secret', 'http://127.0.0.1:9174'],
    ['rk_live_secret', 'http://127.0.0.1:9174'],
    ['sk_test_fake', 'https://external.example'],
    ['sk_test_fake', 'http://user:password@127.0.0.1:9174'],
  ])('refuses unsafe production review settings', (key, base) => {
    expect(() => stripeApiOverride(key, { NODE_ENV: 'production', ALGA_STRIPE_LOCAL_REVIEW: 'true', STRIPE_API_BASE_URL: base })).toThrow();
  });
  it('continues to support development emulator configuration', () => {
    expect(stripeApiOverride('sk_test_fake', { NODE_ENV: 'development', STRIPE_API_BASE_URL: 'http://127.0.0.1:9174' })).toMatchObject({ port: 9174 });
  });
});
