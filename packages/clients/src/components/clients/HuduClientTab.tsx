'use client';

/**
 * Client "Hudu" tab — edition-swapped wrapper (AssetAlertsSection precedent).
 * The webpack `@enterprise` alias resolves to the real EE tab in EE builds
 * and to the packages/ee null stub in CE builds.
 */

import dynamic from 'next/dynamic';

export interface HuduClientTabProps {
  clientId: string;
}

const HuduClientTab = dynamic<HuduClientTabProps>(
  () =>
    import('@enterprise/components/integrations/hudu/HuduClientTab').then(
      (mod) => mod.HuduClientTab
    ),
  {
    ssr: false,
    loading: () => null,
  }
);

export { HuduClientTab };
export default HuduClientTab;
