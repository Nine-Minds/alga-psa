'use client';

/**
 * Asset Software Inventory - Dynamic Import Wrapper
 *
 * Dynamically imports the EE or CE version of the AssetSoftwareInventory.
 * EE version displays installed software from RMM data.
 * CE version renders nothing.
 */

import dynamic from 'next/dynamic';
import type { Asset } from '../../interfaces/asset.interfaces';

interface AssetSoftwareInventoryProps {
  asset: Asset;
  className?: string;
}

// Dynamic import that resolves to EE or CE version based on webpack alias
const AssetSoftwareInventory = dynamic(
  () => import('@ee/components/assets/AssetSoftwareInventory').then(mod => mod.AssetSoftwareInventory),
  {
    ssr: false,
    loading: () => null, // Don't show loading state
  }
);

export { AssetSoftwareInventory };
export type { AssetSoftwareInventoryProps };
export default AssetSoftwareInventory;
