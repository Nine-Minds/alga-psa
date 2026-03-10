'use client';

import React from 'react';
import { AssetDetailView } from '@alga-psa/assets/components/AssetDetailView';
import { MspAssetCrossFeatureProvider } from './MspAssetCrossFeatureProvider';

export default function MspAssetDetailClient({ assetId }: { assetId: string }) {
  return (
    <MspAssetCrossFeatureProvider>
      <AssetDetailView assetId={assetId} />
    </MspAssetCrossFeatureProvider>
  );
}
