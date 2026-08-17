'use client';

import React, { useMemo, useCallback, type ReactNode } from 'react';
import { ClientCrossFeatureProvider } from '@alga-psa/clients/context/ClientCrossFeatureContext';
import type {
  ClientCrossFeatureCallbacks,
  QuickAddTicketRenderProps,
  ClientTicketsRenderProps,
  ContactTicketsRenderProps,
  HourBlocksRenderProps,
} from '@alga-psa/clients/context/ClientCrossFeatureContext';
import { HourBlocksSection } from '@alga-psa/billing/components/hour-blocks/HourBlocksSection';
import { QuickAddTicket } from '@alga-psa/tickets/components/QuickAddTicket';
import { getTicketFormOptions } from '@alga-psa/tickets/actions/optimizedTicketActions';
import MspClientTickets from './MspClientTickets';
import MspContactTickets from './MspContactTickets';
import { useTicketDetailsDrawer } from './useTicketDetailsDrawer';

const renderNothing = () => null;

export function AlgaDeskClientCrossFeatureProvider({ children }: { children: ReactNode }) {
  const openTicketDetails = useTicketDetailsDrawer();

  const renderQuickAddTicket = useCallback(
    (props: QuickAddTicketRenderProps) => (
      <QuickAddTicket
        id={props.id}
        open={props.open}
        onOpenChange={props.onOpenChange}
        onTicketAdded={props.onTicketAdded}
        prefilledClient={props.prefilledClient}
        prefilledContact={props.prefilledContact}
        prefilledDescription={props.prefilledDescription}
        isAlgaDeskMode
      />
    ),
    []
  );

  const renderClientTickets = useCallback(
    (props: ClientTicketsRenderProps) => (
      <MspClientTickets
        clientId={props.clientId}
        clientName={props.clientName}
        initialBoards={props.initialBoards}
        initialStatuses={props.initialStatuses}
        initialPriorities={props.initialPriorities}
        initialCategories={props.initialCategories}
        initialTags={props.initialTags}
        initialUsers={props.initialUsers}
      />
    ),
    []
  );

  const renderContactTickets = useCallback(
    (props: ContactTicketsRenderProps) => (
      <MspContactTickets
        contactId={props.contactId}
        contactName={props.contactName}
        clientId={props.clientId}
        clientName={props.clientName}
        initialBoards={props.initialBoards}
        initialStatuses={props.initialStatuses}
        initialPriorities={props.initialPriorities}
        initialCategories={props.initialCategories}
        initialTags={props.initialTags}
        initialUsers={props.initialUsers}
      />
    ),
    []
  );

  const renderHourBlocks = useCallback(
    (props: HourBlocksRenderProps) => (
      <HourBlocksSection clientId={props.clientId} currencyCode={props.currencyCode} />
    ),
    []
  );

  const value = useMemo<ClientCrossFeatureCallbacks>(
    () => ({
      renderQuickAddTicket,
      getTicketFormOptions,
      renderSurveySummaryCard: () => null,
      renderClientAssets: () => null,
      renderClientTickets,
      renderContactTickets,
      renderContractWizard: () => renderNothing(),
      renderContractQuickAdd: () => renderNothing(),
      renderHourBlocks,
      openTicketDetails,
      getSlaPolicies: async () => [],
    }),
    [renderQuickAddTicket, renderClientTickets, renderContactTickets, renderHourBlocks, openTicketDetails]
  );

  return (
    <ClientCrossFeatureProvider value={value}>
      {children}
    </ClientCrossFeatureProvider>
  );
}
