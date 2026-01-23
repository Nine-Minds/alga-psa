'use client';

/**
 * Asset Alerts Section - CE Stub
 *
 * Community Edition does not include RMM integration features.
 * This stub returns null to gracefully handle when the component is imported.
 */

import type { Asset } from '@alga-psa/types';

interface AssetAlertsSectionProps {
  asset: Asset;
  className?: string;
}

export function AssetAlertsSection(_props: AssetAlertsSectionProps) {
  // CE version returns null - no RMM features
  return null;
}

export default AssetAlertsSection;
