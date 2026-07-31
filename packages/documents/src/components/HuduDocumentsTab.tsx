'use client';

/**
 * Documents page "Hudu" tab — edition-swapped wrapper (HuduClientTab
 * precedent). The webpack `@enterprise` alias resolves to the real EE tab in
 * EE builds and to the packages/ee null stub in CE builds.
 */

import dynamic from 'next/dynamic';

const HuduDocumentsTab = dynamic(
  () =>
    import('@enterprise/components/integrations/hudu/HuduDocumentsTab').then(
      (mod) => mod.HuduDocumentsTab
    ),
  {
    ssr: false,
    loading: () => null,
  }
);

export { HuduDocumentsTab };
export default HuduDocumentsTab;
