/**
 * Tier feature constants and utilities
 *
 * Maps tier-gated features to the tiers that have access to them.
 * This is the authoritative source for feature-to-tier mapping.
 */

import { TENANT_TIERS, TenantTier, tierAtLeast } from './tenantTiers';

/**
 * Features that can be gated by tier.
 * Add new features here as they become tier-gated.
 */
export enum TIER_FEATURES {
  INTEGRATIONS = 'INTEGRATIONS',
  EXTENSIONS = 'EXTENSIONS',
  MANAGED_EMAIL = 'MANAGED_EMAIL',
  SSO = 'SSO',
  ADVANCED_ASSETS = 'ADVANCED_ASSETS',
  CLIENT_PORTAL_ADMIN = 'CLIENT_PORTAL_ADMIN',
  WORKFLOW_DESIGNER = 'WORKFLOW_DESIGNER',
  MOBILE_ACCESS = 'MOBILE_ACCESS',
  ENTRA_SYNC = 'ENTRA_SYNC',
  CIPP = 'CIPP',
  TEAMS_INTEGRATION = 'TEAMS_INTEGRATION',
}

/**
 * Alias for TIER_FEATURES for shorter usage.
 */
export type TierFeature = TIER_FEATURES;

/**
 * Reverse mapping: minimum tier required for each feature.
 */
export const FEATURE_MINIMUM_TIER: Record<TIER_FEATURES, TenantTier> = {
  [TIER_FEATURES.INTEGRATIONS]: 'pro',
  [TIER_FEATURES.EXTENSIONS]: 'pro',
  [TIER_FEATURES.MANAGED_EMAIL]: 'pro',
  [TIER_FEATURES.SSO]: 'pro',
  [TIER_FEATURES.ADVANCED_ASSETS]: 'pro',
  [TIER_FEATURES.CLIENT_PORTAL_ADMIN]: 'pro',
  [TIER_FEATURES.WORKFLOW_DESIGNER]: 'pro',
  [TIER_FEATURES.MOBILE_ACCESS]: 'pro',
  [TIER_FEATURES.ENTRA_SYNC]: 'premium',
  [TIER_FEATURES.CIPP]: 'premium',
  [TIER_FEATURES.TEAMS_INTEGRATION]: 'premium',
} as const;

const ALL_TIER_FEATURES = Object.values(TIER_FEATURES) as TIER_FEATURES[];

/**
 * Maps each tier to the features it has access to.
 * Derived from FEATURE_MINIMUM_TIER and tier rank ordering.
 */
export const TIER_FEATURE_MAP: Record<TenantTier, readonly TIER_FEATURES[]> = TENANT_TIERS.reduce(
  (featureMap, tier) => {
    featureMap[tier] = ALL_TIER_FEATURES.filter((feature) =>
      tierAtLeast(tier, FEATURE_MINIMUM_TIER[feature])
    );
    return featureMap;
  },
  {} as Record<TenantTier, readonly TIER_FEATURES[]>
);

/**
 * Check if a tier has access to a specific feature.
 *
 * @param tier - The tenant's tier
 * @param feature - The feature to check
 * @returns True if the tier has access to the feature
 */
export function tierHasFeature(tier: TenantTier, feature: TIER_FEATURES): boolean {
  return tierAtLeast(tier, FEATURE_MINIMUM_TIER[feature]);
}
