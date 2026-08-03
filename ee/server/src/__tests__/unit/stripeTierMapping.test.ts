import { describe, expect, it } from 'vitest';
import { STRIPE_PRODUCT_TIER_MAP, tierFromStripeProduct } from '../../lib/stripe/stripeTierMapping';

describe('stripeTierMapping', () => {
  describe('STRIPE_PRODUCT_TIER_MAP', () => {
    it('T048: maps alga-psa-preview → pro', () => {
      expect(STRIPE_PRODUCT_TIER_MAP['alga-psa-preview']).toBe('pro');
    });

    it('T049: maps Pro and legacy Premium products to Pro', () => {
      expect(STRIPE_PRODUCT_TIER_MAP['alga-psa-solo']).toBe('solo');
      expect(STRIPE_PRODUCT_TIER_MAP['alga-psa-pro']).toBe('pro');
      expect(STRIPE_PRODUCT_TIER_MAP['alga-psa-premium']).toBe('pro');
    });
  });

  describe('tierFromStripeProduct', () => {
    it('T050: tierFromStripeProduct(alga-psa-preview) returns pro', () => {
      expect(tierFromStripeProduct('alga-psa-preview')).toBe('pro');
    });

    it('T051: tierFromStripeProduct(unknown-product) returns pro (default)', () => {
      expect(tierFromStripeProduct('unknown-product')).toBe('pro');
      expect(tierFromStripeProduct('some-random-product')).toBe('pro');
    });

    it('tierFromStripeProduct handles null and undefined', () => {
      expect(tierFromStripeProduct(null)).toBe('pro');
      expect(tierFromStripeProduct(undefined)).toBe('pro');
    });
  });
});
