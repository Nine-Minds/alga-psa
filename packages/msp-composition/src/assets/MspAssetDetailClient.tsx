'use client';

import React from 'react';
import { AssetDetailView } from '@alga-psa/assets/components/AssetDetailView';
import { MspContactDrawerProvider } from '../clients/MspContactDrawerProvider';
import { MspAssetCrossFeatureProvider } from './MspAssetCrossFeatureProvider';

export default function MspAssetDetailClient({ assetId }: { assetId: string }) {
  return (
    <MspAssetCrossFeatureProvider>
      {/* The assignee row opens the contact here instead of navigating to
          /msp/contacts/[id], which left the asset behind. */}
      <MspContactDrawerProvider>
        <AssetDetailView assetId={assetId} />
      </MspContactDrawerProvider>
    </MspAssetCrossFeatureProvider>
  );
}
