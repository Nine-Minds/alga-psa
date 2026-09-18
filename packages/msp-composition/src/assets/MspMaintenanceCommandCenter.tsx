'use client';

import { MaintenanceCommandCenter } from '@alga-psa/assets/components/MaintenanceCommandCenter';
import { MspAssetCrossFeatureProvider } from './MspAssetCrossFeatureProvider';

export function MspMaintenanceCommandCenter() {
  return <MspAssetCrossFeatureProvider><MaintenanceCommandCenter /></MspAssetCrossFeatureProvider>;
}
