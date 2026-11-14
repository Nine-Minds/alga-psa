'use client';

import React from 'react';
import AssetDashboard from '@alga-psa/assets/components/AssetDashboard';
import { AssetSurfaceAccessProvider } from '@alga-psa/assets/context/AssetSurfaceAccessContext';
import type { AssetSurfaceAccess } from '@alga-psa/assets/actions/assetActions';
import { MspAssetCrossFeatureProvider } from './MspAssetCrossFeatureProvider';

export default function MspAssetDashboardClient({ surfaceAccess, ...props }: React.ComponentProps<typeof AssetDashboard> & { surfaceAccess?: AssetSurfaceAccess }) {
  return (
    <MspAssetCrossFeatureProvider>
      <AssetSurfaceAccessProvider access={surfaceAccess}>
        <AssetDashboard {...props} />
      </AssetSurfaceAccessProvider>
    </MspAssetCrossFeatureProvider>
  );
}
