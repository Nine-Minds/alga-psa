'use client';

/**
 * Asset Software Inventory - CE Stub
 *
 * Community Edition does not include RMM integration features.
 * This stub returns null to gracefully handle when the component is imported.
 */

import type { Asset } from '@alga-psa/types';

interface AssetSoftwareInventoryProps {
  asset: Asset;
  className?: string;
}

export function AssetSoftwareInventory(_props: AssetSoftwareInventoryProps) {
  // CE version returns null - no RMM features
  return null;
}

export default AssetSoftwareInventory;
