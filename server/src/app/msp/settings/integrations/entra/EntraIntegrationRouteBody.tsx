'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { FeatureUpgradeNotice } from '@alga-psa/ui/components/tier-gating/FeatureUpgradeNotice';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { EntraIntegrationPage } from '@alga-psa/integrations/entra/components/entry';
import { FEATURE_MINIMUM_TIER, TIER_FEATURES } from '@alga-psa/types';
import { useTierFeature } from '@/context/TierContext';

/**
 * Tier gate for the Entra route. Access is edition + tier + RBAC and nothing
 * else — there is no UI feature flag on this surface, and no "disabled" 404:
 * a tenant below Pro sees the upgrade notice here and gets a 403 from
 * assertTierAccess on the API routes behind it.
 */
export default function EntraIntegrationRouteBody(): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const canUseEntraSync = useTierFeature(TIER_FEATURES.ENTRA_SYNC);
  const canUseCipp = useTierFeature(TIER_FEATURES.CIPP);

  return (
    <div className="space-y-4">
      <Link
        href="/msp/settings/integrations?category=identity"
        id="entra-back-to-integrations"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('integrations.entra.summary.backToIntegrations')}
      </Link>

      {canUseEntraSync ? (
        <EntraIntegrationPage canUseCipp={canUseCipp} />
      ) : (
        <FeatureUpgradeNotice
          featureName={t('integrations.items.entra.name')}
          requiredTier={FEATURE_MINIMUM_TIER[TIER_FEATURES.ENTRA_SYNC]}
        />
      )}
    </div>
  );
}
