'use client';

import React, { createContext, useContext, useMemo } from 'react';

export interface MspBranding {
  /** Tenant logo for light surfaces; null keeps the stock Alga mark. */
  logoUrl: string | null;
  /** Optional logo for dark surfaces; falls back to logoUrl. */
  logoDarkUrl: string | null;
  /** Tenant display name shown next to the logo. */
  displayName: string | null;
}

const EMPTY: MspBranding = { logoUrl: null, logoDarkUrl: null, displayName: null };

const MspBrandingContext = createContext<MspBranding>(EMPTY);

export const useMspBranding = () => useContext(MspBrandingContext);

/**
 * Carries the Enterprise white-label logo down to the MSP shell. The server
 * layout only fills it when the tenant opted in, so an unset context is exactly
 * the stock chrome.
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
