'use client';

/**
 * Client "Passwords" tab — edition-swapped wrapper (same trio as
 * HuduClientTab). The webpack `@enterprise` alias resolves to the real EE tab
 * in EE builds and to the packages/ee null stub in CE builds.
 */

import dynamic from 'next/dynamic';

export interface HuduClientPasswordsTabProps {
  clientId: string;
}

const HuduClientPasswordsTab = dynamic<HuduClientPasswordsTabProps>(
  () =>
    import('@enterprise/components/integrations/hudu/HuduClientPasswordsTab').then(
      (mod) => mod.HuduClientPasswordsTab
    ),
  {
    ssr: false,
    loading: () => null,
  }
);

export { HuduClientPasswordsTab };
export default HuduClientPasswordsTab;
