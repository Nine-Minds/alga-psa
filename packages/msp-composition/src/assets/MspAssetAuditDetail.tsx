'use client';

import { AssetAuditDetail } from '@alga-psa/assets/components/audits/AssetAuditDetail';
import { MspAssetCrossFeatureProvider } from './MspAssetCrossFeatureProvider';

export function MspAssetAuditDetail({ auditId }: { auditId: string }) {
  return (
    <MspAssetCrossFeatureProvider>
      <AssetAuditDetail auditId={auditId} />
    </MspAssetCrossFeatureProvider>
  );
}
