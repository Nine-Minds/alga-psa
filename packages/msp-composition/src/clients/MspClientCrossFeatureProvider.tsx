'use client';

import React, { useMemo, useCallback, type ReactNode } from 'react';
import { ClientCrossFeatureProvider } from '@alga-psa/clients/context/ClientCrossFeatureContext';
import type { ClientCrossFeatureCallbacks, QuickAddTicketRenderProps, SurveySummaryRenderProps } from '@alga-psa/clients/context/ClientCrossFeatureContext';
import { QuickAddTicket } from '@alga-psa/tickets/components/QuickAddTicket';
import { getTicketFormOptions } from '@alga-psa/tickets/actions/optimizedTicketActions';
import ClientSurveySummaryCard from '@alga-psa/surveys/components/ClientSurveySummaryCard';

export function MspClientCrossFeatureProvider({ children }: { children: ReactNode }) {
  const renderQuickAddTicket = useCallback(
    (props: QuickAddTicketRenderProps) => (
      <QuickAddTicket
        id={props.id}
        open={props.open}
        onOpenChange={props.onOpenChange}
        onTicketAdded={props.onTicketAdded}
        prefilledClient={props.prefilledClient}
      />
    ),
    []
  );

  const renderSurveySummaryCard = useCallback(
    (props: SurveySummaryRenderProps) => (
      <ClientSurveySummaryCard summary={props.summary} />
    ),
    []
  );

  const value = useMemo<ClientCrossFeatureCallbacks>(
    () => ({
      renderQuickAddTicket,
      getTicketFormOptions,
      renderSurveySummaryCard,
    }),
    [renderQuickAddTicket, renderSurveySummaryCard]
  );

  return (
    <ClientCrossFeatureProvider value={value}>
      {children}
    </ClientCrossFeatureProvider>
  );
}
