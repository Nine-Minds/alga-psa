'use client';

import React from 'react';
import { MspBillingDashboardClient } from '@alga-psa/msp-composition/billing';
import { useTierFeature } from '@/context/TierContext';
import { TIER_FEATURES } from '@alga-psa/types';

type BillingPageClientProps = Omit<
  React.ComponentProps<typeof MspBillingDashboardClient>,
  'canUseVisualDesigner'
>;

export default function BillingPageClient(props: BillingPageClientProps) {
  const canUseVisualDesigner = useTierFeature(TIER_FEATURES.INVOICE_DESIGNER);
  return <MspBillingDashboardClient {...props} canUseVisualDesigner={canUseVisualDesigner} />;
}
