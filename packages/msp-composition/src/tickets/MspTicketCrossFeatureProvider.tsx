'use client';

import React, { useMemo, useCallback, type ReactNode } from 'react';
import { TicketCrossFeatureProvider } from '@alga-psa/tickets/context/TicketCrossFeatureContext';
import type { TicketCrossFeatureCallbacks, SlaStatusBadgeRenderProps, SlaIndicatorRenderProps } from '@alga-psa/tickets/context/TicketCrossFeatureContext';
import { SlaStatusBadge } from '@alga-psa/sla/components';
import { SlaIndicator } from '@alga-psa/sla/components';
import { registerSlaIntegration } from './registerSlaIntegration';

// Register SLA service integrations at module load time
registerSlaIntegration();

export function MspTicketCrossFeatureProvider({ children }: { children: ReactNode }) {
  const renderSlaStatusBadge = useCallback(
    (props: SlaStatusBadgeRenderProps) => (
      <SlaStatusBadge
        status={props.status}
        responseRemainingMinutes={props.responseRemainingMinutes}
        resolutionRemainingMinutes={props.resolutionRemainingMinutes}
        isPaused={props.isPaused}
        size={props.size}
        showIcon={props.showIcon}
      />
    ),
    []
  );

  const renderSlaIndicator = useCallback(
    (props: SlaIndicatorRenderProps) => (
      <SlaIndicator
        status={props.status}
        remainingMinutes={props.remainingMinutes}
        isPaused={props.isPaused}
      />
    ),
    []
  );

  const value = useMemo<TicketCrossFeatureCallbacks>(
    () => ({
      renderSlaStatusBadge,
      renderSlaIndicator,
    }),
    [renderSlaStatusBadge, renderSlaIndicator]
  );

  return (
    <TicketCrossFeatureProvider value={value}>
      {children}
    </TicketCrossFeatureProvider>
  );
}
