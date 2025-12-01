'use client';

/**
 * Asset Alerts Section - Dynamic Import Wrapper
 *
 * Dynamically imports the EE or CE version of the AssetAlertsSection.
 * EE version displays RMM alerts with acknowledge/ticket actions.
 * CE version renders nothing.
 */

import dynamic from 'next/dynamic';
import type { Asset } from '../../interfaces/asset.interfaces';

interface AssetAlertsSectionProps {
  asset: Asset;
  className?: string;
}

// Dynamic import that resolves to EE or CE version based on webpack alias
const AssetAlertsSection = dynamic(
  () => import('@ee/components/assets/AssetAlertsSection').then(mod => mod.AssetAlertsSection),
  {
    ssr: false,
    loading: () => null, // Don't show loading state
  }
);

export { AssetAlertsSection };
export type { AssetAlertsSectionProps };
export default AssetAlertsSection;
