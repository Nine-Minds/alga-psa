'use client';

import React from 'react';
import { AssetDetailView } from '@alga-psa/assets/components/AssetDetailView';
import { AssetSurfaceAccessProvider } from '@alga-psa/assets/context/AssetSurfaceAccessContext';
import type { AssetSurfaceAccess } from '@alga-psa/assets/actions/assetActions';
import { MspContactDrawerProvider } from '../clients/MspContactDrawerProvider';
import { MspAssetCrossFeatureProvider } from './MspAssetCrossFeatureProvider';

export default function MspAssetDetailClient({ assetId, surfaceAccess }: { assetId: string; surfaceAccess?: AssetSurfaceAccess }) {
  return (
    <MspAssetCrossFeatureProvider>
      {/* The assignee row opens the contact here instead of navigating to
          /msp/contacts/[id], which left the asset behind. */}
      <MspContactDrawerProvider>
        <AssetSurfaceAccessProvider access={surfaceAccess}>
          <AssetDetailView assetId={assetId} />
        </AssetSurfaceAccessProvider>
      </MspContactDrawerProvider>
    </MspAssetCrossFeatureProvider>
  );
}
