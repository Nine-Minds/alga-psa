'use client';

import React from 'react';
import IntegrationsSettingsPage from '@alga-psa/integrations/components/settings/integrations/IntegrationsSettingsPage';
import TaxDelegationNudge from '@alga-psa/billing/components/tax/TaxDelegationNudge';
import QboSyncHealthPanel from '@alga-psa/billing/components/accounting/QboSyncHealthPanel';
import { QboOnboardingWizardEntry } from '@alga-psa/billing/components/accounting/QboOnboardingWizard';
import { useTierFeature } from '@/context/TierContext';
import { TIER_FEATURES } from '@alga-psa/types';

export default function IntegrationsSettingsBody(): React.JSX.Element {
  const canUseCipp = useTierFeature(TIER_FEATURES.CIPP);
  const canUseEntraSync = useTierFeature(TIER_FEATURES.ENTRA_SYNC);

  return (
    <>
      <TaxDelegationNudge />
      <IntegrationsSettingsPage
        canUseEntraSync={canUseEntraSync}
        canUseCipp={canUseCipp}
        qboSyncHealthSlot={<QboSyncHealthPanel />}
        qboOnboardingSlot={<QboOnboardingWizardEntry />}
      />
    </>
  );
}
