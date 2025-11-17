import React from 'react';

interface SsoProviderButtonsProps {
  callbackUrl: string;
  tenantHint?: string;
}

export default function SsoProviderButtons({
  callbackUrl,
  tenantHint,
}: SsoProviderButtonsProps): React.ReactElement | null {
  return null;
}
