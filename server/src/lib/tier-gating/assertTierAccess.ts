// server/src/lib/tier-gating/assertTierAccess.ts

import {
  type TIER_FEATURES,
  FEATURE_MINIMUM_TIER,
  resolveTier,
  tierHasFeature,
  TIER_LABELS,
} from '@alga-psa/types';
import { getSession } from '@alga-psa/auth';
import { hasActiveSoloProTrial, resolveTenantTier } from '@alga-psa/licensing';
import { isEnterprise } from '../features';

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

/**
 * Server-side assertion that throws if the current tenant doesn't have access to a feature.
 * Use this in server actions to gate functionality by tier.
 *
 * @example
 * async function saveSsoSettings() {
 *   'use server';
 *   await assertTierAccess(TIER_FEATURES.SSO);
 *   // ... rest of the action
 * }
 */
export async function assertTierAccess(feature: TIER_FEATURES): Promise<void> {
  // CE edition: no tier restrictions on compiled-in features
  if (!isEnterprise) return;

  const session = await getSession();
  const tenantId = session?.user?.tenant;

  const effectiveTier = tenantId
    ? await resolveTenantTier(tenantId)
    : (() => {
        // No tenant in session: resolve from the session's effectiveTier
        // (self-host override) when present, else the Stripe plan.
        const { tier } = resolveTier(session?.user?.effectiveTier ?? session?.user?.plan);
        return tier === 'solo' && hasActiveSoloProTrial(session?.user?.solo_pro_trial_end)
          ? 'pro'
          : tier;
      })();

  if (!tierHasFeature(effectiveTier, feature)) {
    const requiredTier = FEATURE_MINIMUM_TIER[feature];
    throw new TierAccessError(feature, requiredTier, effectiveTier);
  }
}

export async function assertTenantTierAccess(tenantId: string, feature: TIER_FEATURES): Promise<void> {
  if (!isEnterprise) return;

  const tier = await resolveTenantTier(tenantId);

  if (!tierHasFeature(tier, feature)) {
    const requiredTier = FEATURE_MINIMUM_TIER[feature];
    throw new TierAccessError(feature, requiredTier, tier);
  }
}
