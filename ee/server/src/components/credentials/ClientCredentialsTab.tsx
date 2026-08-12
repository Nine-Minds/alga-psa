'use client';

/**
 * Unified client Passwords tab (EE-only, Pro tier, flag-gated).
 *
 * The shared CredentialsScreen scoped to the client: native + Hudu rows merged
 * (Hudu rows keep their reveal-proxy behavior inside the unified list). The
 * screen re-checks the `release-v1.5-feature` flag and tier, rendering nothing
 * when the feature is off — so flag-off preserves the legacy Hudu-only tab
 * (registered separately in ClientDetails).
 */

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { CredentialsScreen } from './CredentialsScreen';

interface ClientCredentialsTabProps {
  clientId: string;
}

export function ClientCredentialsTab({ clientId }: ClientCredentialsTabProps) {
  const { t } = useTranslation('msp/credentials');

  return (
    <div id="client-credentials-tab" className="space-y-4">
      <p id="client-credentials-tab-subtitle" className="text-sm text-gray-500">
        {t('credentials.clientTab.subtitle')}
      </p>
      <CredentialsScreen clientId={clientId} />
    </div>
  );
}

export default ClientCredentialsTab;
