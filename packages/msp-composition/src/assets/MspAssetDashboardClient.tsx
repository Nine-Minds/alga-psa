'use client';

import React from 'react';
import AssetDashboard from '@alga-psa/assets/components/AssetDashboard';
import { MspAssetCrossFeatureProvider } from './MspAssetCrossFeatureProvider';

export default function MspAssetDashboardClient(props: React.ComponentProps<typeof AssetDashboard>) {
  return (
    <MspAssetCrossFeatureProvider>
      <AssetDashboard {...props} />
    </MspAssetCrossFeatureProvider>
  );
}
