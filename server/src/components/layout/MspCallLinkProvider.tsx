'use client';

import React from 'react';
import { ADD_ONS } from '@alga-psa/types';
import { CallLinkProvider } from '@alga-psa/ui/components/CallLink';
import { useTier } from '@/context/TierContext';

/**
 * Supplies click-to-call affordances with the one tenant fact they need: does
 * this tenant have Teams? The Teams deep link is hidden otherwise, while the
 * `tel:` link is always available.
 */
export function MspCallLinkProvider({ children }: { children: React.ReactNode }) {
  const { hasAddOn } = useTier();
  return <CallLinkProvider teamsCallEnabled={hasAddOn(ADD_ONS.TEAMS)}>{children}</CallLinkProvider>;
}

export default MspCallLinkProvider;
