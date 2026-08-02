import React from 'react';

interface SsoProviderButtonsProps {
  callbackUrl: string;
  tenantHint?: string;
  portalDomainHint?: string;
  email?: string;
  publicWorkstation?: boolean;
  onError?: (message: string) => void;
  authSurface?: 'msp' | 'client_portal';
  discoveryEndpoint?: string;
  resolveEndpoint?: string;
  storageKey?: string;
}

export default function SsoProviderButtons({
  callbackUrl,
  tenantHint,
}: SsoProviderButtonsProps): React.ReactElement | null {
  return null;
}
