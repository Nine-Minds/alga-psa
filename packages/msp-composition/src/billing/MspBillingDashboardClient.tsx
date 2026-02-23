'use client';

import React, { useCallback } from 'react';
import { BillingDashboard } from '@alga-psa/billing';
import ClientDetails from '@alga-psa/clients/components/clients/ClientDetails';
import type { IClient } from '@alga-psa/types';

type MspBillingDashboardClientProps = Omit<
  React.ComponentProps<typeof BillingDashboard>,
  'renderClientDetails'
>;

export default function MspBillingDashboardClient(props: MspBillingDashboardClientProps) {
  const renderClientDetails = useCallback(
    ({ id, client }: { id: string; client: IClient }) => (
      <ClientDetails id={id} client={client} isInDrawer={true} quickView={true} />
    ),
    []
  );

  return <BillingDashboard {...props} renderClientDetails={renderClientDetails} />;
}
