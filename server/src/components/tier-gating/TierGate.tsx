'use client';

import { type ReactNode } from 'react';
import { type TIER_FEATURES, FEATURE_MINIMUM_TIER, TIER_LABELS } from '@alga-psa/types';
import { useTier } from '@/context/TierContext';
import { FeatureUpgradeNotice } from '@alga-psa/ui/components/tier-gating/FeatureUpgradeNotice';

interface TierGateProps {
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
 * Client-side component that gates content based on tenant tier.
 * Renders children if the tenant has access, otherwise shows FeatureUpgradeNotice.
 */
export function TierGate({
  feature,
  featureName,
  children,
  description,
  fallback,
}: TierGateProps) {
  const { hasFeature, isLoading } = useTier();

  // While loading, show a skeleton to prevent empty flash
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-4 bg-[rgb(var(--color-border-200))] rounded w-1/3" />
        <div className="h-4 bg-[rgb(var(--color-border-200))] rounded w-2/3" />
        <div className="h-4 bg-[rgb(var(--color-border-200))] rounded w-1/2" />
      </div>
    );
  }

  if (!hasFeature(feature)) {
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
