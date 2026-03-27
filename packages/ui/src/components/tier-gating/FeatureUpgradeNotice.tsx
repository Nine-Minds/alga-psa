'use client';

import { Lock } from 'lucide-react';
import Link from 'next/link';
import { type TenantTier, TIER_LABELS } from '@alga-psa/types';

interface FeatureUpgradeNoticeProps {
  /** The name of the feature being gated (e.g., "Billing") */
  featureName: string;
  /** The minimum tier required for this feature */
  requiredTier: TenantTier;
  /** Optional description of the feature */
  description?: string;
}

/**
 * Placeholder shown when a user lacks tier access to a feature.
 * Displays an icon, heading, description, and a link to view plans.
 */
export function FeatureUpgradeNotice({
  featureName,
  requiredTier,
  description,
}: FeatureUpgradeNoticeProps) {
  const tierLabel = TIER_LABELS[requiredTier];

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
      <div className="rounded-full bg-muted p-4 mb-6">
        <Lock className="w-8 h-8 text-muted-foreground" />
      </div>

      <h2 className="text-xl font-semibold mb-2">
        {featureName} requires {tierLabel}
      </h2>

      <p className="text-muted-foreground max-w-md mb-6">
        {description ||
          `Upgrade to the ${tierLabel} tier to unlock ${featureName} and more powerful features.`}
      </p>

      <Link
        href="/msp/account"
        className="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground hover:bg-primary/90 font-medium rounded-lg transition-colors"
      >
        View Plans
      </Link>
    </div>
  );
}
