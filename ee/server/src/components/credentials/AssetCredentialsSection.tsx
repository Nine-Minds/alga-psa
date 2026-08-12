'use client';

/**
 * Asset detail "Passwords" section (EE-only, Pro tier, flag-gated).
 *
 * Lists native credentials attached to the asset and offers create-preattached
 * (new credentials are created with `assetId` so they appear in the section
 * immediately). Reuses the shared CredentialsScreen list body scoped to the
 * asset; the screen re-checks the `release-v1.5-feature` flag and tier, so
 * this section renders nothing when the feature is off.
 */

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { KeyRound } from 'lucide-react';
import { CredentialsScreen } from './CredentialsScreen';

interface AssetCredentialsSectionProps {
  assetId: string;
  clientId: string;
}

export function AssetCredentialsSection({ assetId, clientId }: AssetCredentialsSectionProps) {
  const { t } = useTranslation('msp/credentials');

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
