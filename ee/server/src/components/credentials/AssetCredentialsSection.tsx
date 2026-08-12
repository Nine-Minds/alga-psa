'use client';

/**
 * Asset detail "Passwords" section (EE-only, Pro tier, flag-gated).
 *
 * Lists native credentials attached to the asset and offers create-preattached
 * (new credentials are created with `assetId` so they appear in the section
 * immediately). The ENTIRE section — Card and header included — is gated on
 * the `release-v1.5-feature` flag: flag off renders nothing (the shared
 * packages/assets wrapper shows the legacy placeholder card in its place), so
 * flag-off asset pages never show an empty title-only vault card. Below-Pro
 * tenants get a one-line upgrade teaser in the card instead of the vault (the
 * nav item and client tab are hidden for them, so this is where they learn
 * the feature exists); the full FeatureUpgradeNotice stays on the global
 * screen.
 */

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { KeyRound, Lock } from 'lucide-react';
import { TIER_FEATURES } from '@alga-psa/types';
import { useTier } from 'server/src/context/TierContext';
import { CredentialsScreen } from './CredentialsScreen';

interface AssetCredentialsSectionProps {
  assetId: string;
  clientId: string;
}

export function AssetCredentialsSection({ assetId, clientId }: AssetCredentialsSectionProps) {
  const { t } = useTranslation('msp/credentials');
  const releaseFlag = useFeatureFlag('release-v1.5-feature', { defaultValue: false });
  const flagEnabled = typeof releaseFlag === 'boolean' ? releaseFlag : releaseFlag?.enabled ?? false;
  const { hasFeature } = useTier();

  if (!flagEnabled) {
    return null;
  }

  if (!hasFeature(TIER_FEATURES.CREDENTIALS)) {
    return (
      <Card id="asset-credentials-tier-teaser">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 shrink-0" />
            {t('credentials.assetSection.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <Lock className="h-4 w-4 shrink-0" />
              {t('credentials.assetSection.tierTeaser')}
            </p>
            <Link
              id="asset-credentials-view-plans"
              href="/msp/account"
              className="text-sm font-medium text-[rgb(var(--color-primary-600))] hover:underline"
            >
              {t('credentials.assetSection.viewPlans')}
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="asset-credentials-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4 shrink-0" />
          {t('credentials.assetSection.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CredentialsScreen assetId={assetId} defaultClientId={clientId} />
      </CardContent>
    </Card>
  );
}

export default AssetCredentialsSection;
