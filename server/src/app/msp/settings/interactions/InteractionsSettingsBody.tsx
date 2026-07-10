'use client';

import React, { Suspense } from 'react';
import SettingsTabSkeleton from '@alga-psa/ui/components/skeletons/SettingsTabSkeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import InteractionSettings from '@/components/settings/general/InteractionSettings';

export default function InteractionsSettingsBody(): React.JSX.Element {
  const { t } = useTranslation('msp/settings');
  return (
    <Suspense
      fallback={
        <SettingsTabSkeleton
          title={t('tabs.interactions')}
          description={t('tabs.loadingInteractions')}
          showTabs={false}
        />
      }
    >
      <InteractionSettings />
    </Suspense>
  );
}
