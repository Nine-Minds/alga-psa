'use client';

import React from 'react';
import IntegrationsSettingsPage from '@alga-psa/integrations/components/settings/integrations/IntegrationsSettingsPage';
import TaxDelegationNudge from '@alga-psa/billing/components/tax/TaxDelegationNudge';
import QboSyncHealthPanel from '@alga-psa/billing/components/accounting/QboSyncHealthPanel';
import { QboOnboardingWizardEntry } from '@alga-psa/billing/components/accounting/QboOnboardingWizard';
import { useTier, useTierFeature } from '@/context/TierContext';
import { ADD_ONS, TIER_FEATURES } from '@alga-psa/types';

export default function IntegrationsSettingsBody(): React.JSX.Element {
  const { hasAddOn } = useTier();
  const canUseCipp = useTierFeature(TIER_FEATURES.CIPP);
  const canUseEntraSync = useTierFeature(TIER_FEATURES.ENTRA_SYNC);
  const canUseTeams = hasAddOn(ADD_ONS.TEAMS);
  const canUseTelephony = hasAddOn(ADD_ONS.TELEPHONY);

  return (
    <>
      <TaxDelegationNudge />
      <IntegrationsSettingsPage
        canUseEntraSync={canUseEntraSync}
        canUseCipp={canUseCipp}
        canUseTeams={canUseTeams}
        canUseTelephony={canUseTelephony}
        qboSyncHealthSlot={<QboSyncHealthPanel />}
        qboOnboardingSlot={<QboOnboardingWizardEntry />}
      />
    </>
  );
}
