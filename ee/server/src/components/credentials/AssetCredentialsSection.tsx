'use client';

/**
 * Asset detail "Passwords" section (EE-only, Pro tier, flag-gated).
 *
 * Lists native credentials attached to the asset and offers create-preattached
 * (new credentials are created with `assetId` so they appear in the section
 * immediately). The ENTIRE section — Card and header included — is gated on
 * the `release-v1.5-feature` flag: flag off renders nothing (the shared
 * packages/assets wrapper shows the legacy placeholder card in its place), so
 * flag-off asset pages never show an empty title-only vault card.
 */

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { KeyRound } from 'lucide-react';
import { CredentialsScreen } from './CredentialsScreen';

interface AssetCredentialsSectionProps {
  assetId: string;
  clientId: string;
}

export function AssetCredentialsSection({ assetId, clientId }: AssetCredentialsSectionProps) {
  const { t } = useTranslation('msp/credentials');
  const releaseFlag = useFeatureFlag('release-v1.5-feature', { defaultValue: false });
  const flagEnabled = typeof releaseFlag === 'boolean' ? releaseFlag : releaseFlag?.enabled ?? false;

  if (!flagEnabled) {
    return null;
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
