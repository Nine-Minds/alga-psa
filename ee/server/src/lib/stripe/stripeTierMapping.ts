/**
 * Stripe product to tenant tier mapping
 *
 * Maps Stripe product names to tenant tiers. This allows automatic
 * tier assignment based on which Stripe product a customer purchased.
 */

import type { TenantTier } from '@alga-psa/types';

/**
 * Maps Stripe product names to tenant tiers.
 * - Current products: alga-psa-preview → pro
 * - Future products: alga-psa-pro, alga-psa-premium
 */
export const STRIPE_PRODUCT_TIER_MAP: Record<string, TenantTier> = {
  // Current product (preview/beta customers)
  'alga-psa-preview': 'pro',

  // Early adopters (grandfathered customers migrated from preview pricing)
  'alga-psa-early-adopters': 'pro',

  // Future products (pre-mapped for when they're created in Stripe)
  'alga-psa-pro': 'pro',
  'alga-psa-premium': 'premium',
} as const;

/**
 * Default tier for unknown Stripe products.
 * Pro is used as the default to avoid accidentally restricting
 * features for customers with misconfigured products.
 */
const DEFAULT_TIER: TenantTier = 'pro';

/**
 * Resolves a Stripe product name to a tenant tier.
 *
 * @param productName - The Stripe product name
 * @returns The corresponding tenant tier (defaults to 'pro' if unknown)
 */
export function tierFromStripeProduct(productName: string | null | undefined): TenantTier {
  if (!productName) {
    console.warn('[stripeTierMapping] No product name provided, defaulting to pro');
    return DEFAULT_TIER;
  }
  const tier = STRIPE_PRODUCT_TIER_MAP[productName];
  if (!tier) {
    console.warn(`[stripeTierMapping] Unknown Stripe product name "${productName}", defaulting to pro`);
  }
  return tier ?? DEFAULT_TIER;
}
