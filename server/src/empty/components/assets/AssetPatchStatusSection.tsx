'use client';

/**
 * Asset Patch Status Section - CE Stub
 *
 * Community Edition does not include RMM integration features.
 * This stub returns null to gracefully handle when the component is imported.
 */

import type { Asset } from '../../../interfaces/asset.interfaces';

interface AssetPatchStatusSectionProps {
  asset: Asset;
  className?: string;
}

export function AssetPatchStatusSection(_props: AssetPatchStatusSectionProps) {
  // CE version returns null - no RMM features
  return null;
}

export default AssetPatchStatusSection;
