'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { UnsavedChangesProvider } from '@alga-psa/ui';
import { FeatureUpgradeNotice } from '@alga-psa/ui/components/tier-gating/FeatureUpgradeNotice';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { FEATURE_MINIMUM_TIER } from '@alga-psa/types';
import { useTier } from '@/context/TierContext';
import { useProduct } from '@/context/ProductContext';
import { getAllowedSettingsTabIds } from '@/lib/settingsProductTabs';
import { getSettingsTab } from './settingsTabsRegistry';

const SETTINGS_HOME = '/msp/settings';

interface SettingsTabProps {
  tabId: string;
  children: React.ReactNode;
}

// Per-segment settings shell: the shared chrome (title + UnsavedChangesProvider) plus the
// product / edition / tier gating that used to live inline in the monolithic SettingsPage.
// Each /msp/settings/<id> route renders exactly one tab's body inside this, so the route only
// pulls that tab's feature graph into the RSC manifest.
export function SettingsTab({ tabId, children }: SettingsTabProps): React.JSX.Element {
  const { t } = useTranslation('msp/settings');
  const router = useRouter();
  const { productCode } = useProduct();
  const { hasFeature } = useTier();
  const meta = getSettingsTab(tabId);

  const isAlgaDesk = productCode === 'algadesk';
  const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
  const allowedTabIds = getAllowedSettingsTabIds(productCode);

  // A tab can be off-limits for the current product (AlgaDesk allowlist) or edition
  // (EE-only governance tabs). The sidebar never links there, but a direct URL hit
  // should land back on the settings home rather than render an unavailable surface.
  const notAvailable = !meta || (isAlgaDesk && !allowedTabIds.has(tabId)) || (meta.eeOnly && !isEEAvailable);

  useEffect(() => {
    if (notAvailable) {
      router.replace(SETTINGS_HOME);
    }
  }, [notAvailable, router]);

  let body: React.ReactNode = children;
  if (notAvailable) {
    body = null;
  } else if (meta.requiredFeature && !hasFeature(meta.requiredFeature)) {
    body = (
      <FeatureUpgradeNotice
        featureName={t(meta.labelKey)}
        requiredTier={FEATURE_MINIMUM_TIER[meta.requiredFeature]}
      />
    );
  }

  return (
    <UnsavedChangesProvider
      dialogTitle={t('unsavedChanges.title')}
      dialogMessage={t('unsavedChanges.message')}
    >
      <div className="h-full overflow-y-auto p-6">
        <h1 className="text-3xl font-bold mb-6">{t('page.title')}</h1>
        {body}
      </div>
    </UnsavedChangesProvider>
  );
}
