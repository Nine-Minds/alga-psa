/**
 * SSO Provider Buttons - Default CE stub
 *
 * Returns null in CE. EE provides a real implementation
 * that renders Google/Microsoft SSO buttons.
 */
import React from 'react';

export interface SsoProviderButtonsProps {
  callbackUrl: string;
  tenantHint?: string;
}

export default function SsoProviderButtons({
  callbackUrl,
  tenantHint,
}: SsoProviderButtonsProps): React.ReactElement | null {
  return null;
}
