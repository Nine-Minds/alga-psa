'use client';

import React, { useCallback } from 'react';
import { BillingDashboard } from '@alga-psa/billing/components';
import ClientDetails from '@alga-psa/clients/components/clients/ClientDetails';
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
        <ClientDetails id={id} client={client} isInDrawer={true} quickView={true} />
      </MspClientCrossFeatureProvider>
    ),
    []
  );

  return <BillingDashboard {...props} renderClientDetails={renderClientDetails} />;
}
