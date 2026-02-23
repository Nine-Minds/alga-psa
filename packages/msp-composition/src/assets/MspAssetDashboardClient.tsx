'use client';

import React, { useCallback } from 'react';
import AssetDashboard from '@alga-psa/assets/components/AssetDashboard';
import ClientDetails from '@alga-psa/clients/components/clients/ClientDetails';
import type { IClient } from '@alga-psa/types';

type MspAssetDashboardClientProps = Omit<
  React.ComponentProps<typeof AssetDashboard>,
  'renderClientDetails'
>;

export default function MspAssetDashboardClient(props: MspAssetDashboardClientProps) {
  const renderClientDetails = useCallback(
    ({ id, client }: { id: string; client: IClient }) => (
      <ClientDetails id={id} client={client} isInDrawer={true} quickView={true} />
    ),
    []
  );

  return <AssetDashboard {...props} renderClientDetails={renderClientDetails} />;
}
