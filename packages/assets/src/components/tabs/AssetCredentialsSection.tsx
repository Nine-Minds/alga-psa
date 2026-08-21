'use client';

/**
 * Asset Passwords Section — flag-gated dynamic import wrapper.
 *
 * With the `release-v1-5-feature` flag OFF this renders the exact legacy
 * "Passwords & Secrets — coming soon" placeholder card that existed before the
 * credentials vault (in both EE and CE builds), so flag-off asset pages are
 * byte-preserved. With the flag ON it dynamically imports the EE/CE vault
 * section via `@enterprise` (EE renders the flag/tier-gated credential list
 * attached to the asset; CE renders nothing).
 */

import React from 'react';
import dynamic from 'next/dynamic';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';

interface AssetCredentialsSectionProps {
  assetId: string;
  clientId: string;
}

const VaultAssetCredentialsSection = dynamic(
  () =>
    import('@enterprise/components/credentials/AssetCredentialsSection').then(
      (mod) => mod.AssetCredentialsSection
    ),
  {
    ssr: false,
    loading: () => null,
  }
);

export function AssetCredentialsSection({ assetId, clientId }: AssetCredentialsSectionProps) {
  const { t } = useTranslation('msp/assets');
  const releaseFlag = useFeatureFlag('release-v1-5-feature', { defaultValue: false });
  const flagEnabled = typeof releaseFlag === 'boolean' ? releaseFlag : releaseFlag?.enabled ?? false;

  if (!flagEnabled) {
    // Legacy placeholder (pre-vault): preserved exactly so flag-off asset
    // pages keep the "coming soon" card in EE and CE alike.
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {t('documentsPasswordsTab.passwords.title', {
              defaultValue: 'Passwords & Secrets',
            })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-gray-500">
              {t('documentsPasswordsTab.passwords.comingSoon', {
                defaultValue: 'Secure password management coming soon.',
              })}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return <VaultAssetCredentialsSection assetId={assetId} clientId={clientId} />;
}

export type { AssetCredentialsSectionProps };
export default AssetCredentialsSection;
