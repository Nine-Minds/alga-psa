/**
 * Tier feature constants and utilities
 *
 * Maps tier-gated features to the tiers that have access to them.
 * This is the authoritative source for feature-to-tier mapping.
 */

import { TenantTier } from './tenantTiers';

/**
 * Features that can be gated by tier.
 * Add new features here as they become tier-gated.
 */
export enum TIER_FEATURES {
  ENTRA_SYNC = 'ENTRA_SYNC',
  CIPP = 'CIPP',
  TEAMS_INTEGRATION = 'TEAMS_INTEGRATION',
}

/**
 * Alias for TIER_FEATURES for shorter usage.
 */
export type TierFeature = TIER_FEATURES;

/**
 * Maps each tier to the features it has access to.
 * - pro: All standard features (no gated features — pro is the full baseline)
 * - premium: All pro features plus premium exclusives
 */
export const TIER_FEATURE_MAP: Record<TenantTier, readonly TIER_FEATURES[]> = {
  pro: [],
  premium: [
    TIER_FEATURES.ENTRA_SYNC,
    TIER_FEATURES.CIPP,
    TIER_FEATURES.TEAMS_INTEGRATION,
  ],
} as const;

/**
 * Reverse mapping: minimum tier required for each feature.
 */
export const FEATURE_MINIMUM_TIER: Record<TIER_FEATURES, TenantTier> = {
  [TIER_FEATURES.ENTRA_SYNC]: 'premium',
  [TIER_FEATURES.CIPP]: 'premium',
  [TIER_FEATURES.TEAMS_INTEGRATION]: 'premium',
} as const;

/**
 * Check if a tier has access to a specific feature.
 *
 * @param tier - The tenant's tier
 * @param feature - The feature to check
 * @returns True if the tier has access to the feature
 */
export function tierHasFeature(tier: TenantTier, feature: TIER_FEATURES): boolean {
  return TIER_FEATURE_MAP[tier].includes(feature);
}
