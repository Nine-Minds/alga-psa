'use client';

/**
 * Asset Patch Status Section - Dynamic Import Wrapper
 *
 * Dynamically imports the EE or CE version of the AssetPatchStatusSection.
 * EE version displays patch compliance and antivirus status.
 * CE version renders nothing.
 */

import dynamic from 'next/dynamic';
import type { Asset } from '@alga-psa/types';

interface AssetPatchStatusSectionProps {
  asset: Asset;
  className?: string;
}

// Dynamic import that resolves to EE or CE version based on webpack alias
const AssetPatchStatusSection = dynamic(
  () => import('@enterprise/components/assets/AssetPatchStatusSection').then(mod => mod.AssetPatchStatusSection),
  {
    ssr: false,
    loading: () => null, // Don't show loading state
  }
);

export { AssetPatchStatusSection };
export type { AssetPatchStatusSectionProps };
export default AssetPatchStatusSection;
