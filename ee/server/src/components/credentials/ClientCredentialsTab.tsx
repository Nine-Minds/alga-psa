'use client';

/**
 * Unified client Passwords tab (EE-only, Pro tier).
 *
 * The shared CredentialsScreen scoped to the client: native + Hudu rows merged
 * (Hudu rows keep their reveal-proxy behavior inside the unified list). The
 * screen re-checks the tier, rendering nothing when unavailable.
 */

import React from 'react';
import { CredentialsScreen } from './CredentialsScreen';

interface ClientCredentialsTabProps {
  clientId: string;
}

export function ClientCredentialsTab({ clientId }: ClientCredentialsTabProps) {
  return (
    <div id="client-credentials-tab" className="space-y-4">
      <CredentialsScreen clientId={clientId} />
    </div>
  );
}

export default ClientCredentialsTab;
