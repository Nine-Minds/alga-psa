'use client';

/**
 * Unified client "Passwords" tab — edition-swapped wrapper. The webpack
 * `@enterprise` alias resolves to the real EE tab in EE builds and to the
 * packages/ee null stub in CE builds.
 */

import dynamic from 'next/dynamic';

export interface ClientCredentialsTabProps {
  clientId: string;
}

const ClientCredentialsTab = dynamic<ClientCredentialsTabProps>(
  () =>
    import('@enterprise/components/credentials/ClientCredentialsTab').then(
      (mod) => mod.ClientCredentialsTab
    ),
  {
    ssr: false,
    loading: () => null,
  }
);

export { ClientCredentialsTab };
export default ClientCredentialsTab;
