'use client';

/**
 * Client Documents tab "Hudu Documentation" section — edition-swapped wrapper
 * (same trio as HuduClientTab). The webpack `@enterprise` alias resolves to
 * the real EE section in EE builds and to the packages/ee null stub in CE
 * builds.
 */

import dynamic from 'next/dynamic';

export interface HuduClientDocumentsSectionProps {
  clientId: string;
}

const HuduClientDocumentsSection = dynamic<HuduClientDocumentsSectionProps>(
  () =>
    import('@enterprise/components/integrations/hudu/HuduClientDocumentsSection').then(
      (mod) => mod.HuduClientDocumentsSection
    ),
  {
    ssr: false,
    loading: () => null,
  }
);

export { HuduClientDocumentsSection };
export default HuduClientDocumentsSection;
