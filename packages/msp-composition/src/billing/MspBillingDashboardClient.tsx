'use client';

import React, { useCallback } from 'react';
import BillingDashboard from '@alga-psa/billing/components/billing-dashboard/BillingDashboard';
import ClientQuickView from '@alga-psa/clients/components/clients/ClientQuickView';
import type { IClient } from '@alga-psa/types';
import { MspClientCrossFeatureProvider } from '../clients/MspClientCrossFeatureProvider';

type MspBillingDashboardClientProps = Omit<
  React.ComponentProps<typeof BillingDashboard>,
  'renderClientDetails'
>;

export default function MspBillingDashboardClient(props: MspBillingDashboardClientProps) {
  const renderClientDetails = useCallback(
    ({ id, client }: { id: string; client: IClient }) => (
      <MspClientCrossFeatureProvider>
        <ClientQuickView id={id} client={client} isInDrawer={true} quickView={true} />
      </MspClientCrossFeatureProvider>
    ),
    []
  );

  return <BillingDashboard {...props} renderClientDetails={renderClientDetails} />;
}
