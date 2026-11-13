'use client';

import { AssetAuditsList } from '@alga-psa/assets/components/audits/AssetAuditsList';
import { MspAssetCrossFeatureProvider } from './MspAssetCrossFeatureProvider';

export function MspAssetAudits({ clientId }: { clientId?: string } = {}) {
  return (
    <MspAssetCrossFeatureProvider>
      <AssetAuditsList clientId={clientId} embedded={Boolean(clientId)} />
    </MspAssetCrossFeatureProvider>
  );
}
