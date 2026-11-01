import {
  type TIER_FEATURES,
  FEATURE_MINIMUM_TIER,
  tierHasFeature,
  TIER_LABELS,
} from '@alga-psa/types';
import { isEnterprise } from '@alga-psa/core/features';
import { resolveTenantTier } from './tenant-tier';

export class TierAccessError extends Error {
  public readonly feature: TIER_FEATURES;
  public readonly requiredTier: string;
  public readonly currentTier: string;
  public readonly statusCode = 403;
  public readonly code = 'TIER_ACCESS_DENIED';

  constructor(feature: TIER_FEATURES, requiredTier: string, currentTier: string) {
    const requiredLabel = TIER_LABELS[requiredTier as keyof typeof TIER_LABELS] || requiredTier;
    super(`This feature requires the ${requiredLabel} plan or higher.`);
    this.name = 'TierAccessError';
    this.feature = feature;
    this.requiredTier = requiredTier;
    this.currentTier = currentTier;
  }
}

/** Throws TierAccessError if the tenant's tier lacks `feature`. CE has no tier restrictions. */
export async function assertTenantTierAccess(tenantId: string, feature: TIER_FEATURES): Promise<void> {
  if (!isEnterprise) return;

  const tier = await resolveTenantTier(tenantId);

  if (!tierHasFeature(tier, feature)) {
    const requiredTier = FEATURE_MINIMUM_TIER[feature];
    throw new TierAccessError(feature, requiredTier, tier);
  }
}
