import { type ReactNode } from 'react';
import {
  type TIER_FEATURES,
  FEATURE_MINIMUM_TIER,
  resolveTier,
  tierHasFeature,
} from '@alga-psa/types';
import { getSession } from '@alga-psa/auth';
import { FeatureUpgradeNotice } from '@alga-psa/ui/components/tier-gating/FeatureUpgradeNotice';
import { isEnterprise } from '@/lib/features';

interface ServerTierGateProps {
  /** The feature to gate */
  feature: TIER_FEATURES;
  /** The name to display for this feature in the upsell placeholder */
  featureName: string;
  /** Content to render if the tenant has access */
  children: ReactNode;
  /** Optional description for the upsell placeholder */
  description?: string;
  /** Optional custom fallback instead of FeatureUpgradeNotice */
  fallback?: ReactNode;
}

/**
 * Server-side component that gates content based on tenant tier.
 * Reads the session directly to check tier access.
 * In CE (Community Edition), all compiled-in features are unlocked.
 */
export async function ServerTierGate({
  feature,
  featureName,
  children,
  description,
  fallback,
}: ServerTierGateProps) {
  // CE edition: no tier restrictions on compiled-in features
  if (!isEnterprise) {
    return <>{children}</>;
  }

  const session = await getSession();
  const plan = session?.user?.plan;
  const { tier } = resolveTier(plan);

  if (!tierHasFeature(tier, feature)) {
    if (fallback) {
      return <>{fallback}</>;
    }
    return (
      <FeatureUpgradeNotice
        featureName={featureName}
        requiredTier={FEATURE_MINIMUM_TIER[feature]}
        description={description}
      />
    );
  }

  return <>{children}</>;
}
