'use client';

import { CustodyQueue } from '@alga-psa/assets/components/custody/CustodyQueue';
import { MspAssetCrossFeatureProvider } from './MspAssetCrossFeatureProvider';

export function MspCustodyQueue() {
  return <MspAssetCrossFeatureProvider><CustodyQueue /></MspAssetCrossFeatureProvider>;
}
