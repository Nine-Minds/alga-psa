'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { EMPTY_MSP_BRANDING as EMPTY, type MspBranding } from './mspBranding';

export type { MspBranding };

const MspBrandingContext = createContext<MspBranding>(EMPTY);

export const useMspBranding = () => useContext(MspBrandingContext);

/**
 * Carries the Enterprise white-label logo down to the MSP shell. The server
 * layout only fills it when the tenant uploaded one, so an unset context is
 * exactly the stock chrome.
 */
export function MspBrandingProvider({
  children,
  branding,
}: {
  children: React.ReactNode;
  branding?: MspBranding | null;
}) {
  const value = useMemo(() => branding ?? EMPTY, [branding]);
  return <MspBrandingContext value={value}>{children}</MspBrandingContext>;
}
