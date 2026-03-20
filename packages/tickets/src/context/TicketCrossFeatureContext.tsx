'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { SlaTimerStatus } from '@alga-psa/types';

export interface SlaStatusBadgeRenderProps {
  status: SlaTimerStatus;
  responseRemainingMinutes?: number;
  resolutionRemainingMinutes?: number;
  isPaused: boolean;
  size?: 'sm' | 'md';
  showIcon?: boolean;
}

export interface SlaIndicatorRenderProps {
  status: SlaTimerStatus;
  remainingMinutes: number;
  isPaused: boolean;
}

export interface TicketCrossFeatureCallbacks {
  renderSlaStatusBadge: (props: SlaStatusBadgeRenderProps) => ReactNode;
  renderSlaIndicator: (props: SlaIndicatorRenderProps) => ReactNode;
}

const TicketCrossFeatureContext = createContext<TicketCrossFeatureCallbacks | null>(null);

export function useTicketCrossFeature(): TicketCrossFeatureCallbacks {
  const ctx = useContext(TicketCrossFeatureContext);
  if (!ctx) {
    throw new Error(
      'useTicketCrossFeature must be used within a TicketCrossFeatureProvider. ' +
      'Wrap your ticket page in a provider from the composition layer.'
    );
  }
  return ctx;
}

export function TicketCrossFeatureProvider({
  value,
  children,
}: {
  value: TicketCrossFeatureCallbacks;
  children: ReactNode;
}) {
  return (
    <TicketCrossFeatureContext.Provider value={value}>
      {children}
    </TicketCrossFeatureContext.Provider>
  );
}
