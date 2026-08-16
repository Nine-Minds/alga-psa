'use client';

/**
 * CE stub for the unified client Passwords tab
 * (ee/server/src/components/credentials/ClientCredentialsTab.tsx, resolved via
 * the edition-swapped `@enterprise` alias). Render nothing in Community Edition.
 */

interface ClientCredentialsTabProps {
  clientId: string;
}

export function ClientCredentialsTab(_props: ClientCredentialsTabProps) {
  return null;
}

export default ClientCredentialsTab;
