'use client';

import React, { useMemo, useCallback, type ReactNode } from 'react';
import { ClientCrossFeatureProvider } from '@alga-psa/clients/context/ClientCrossFeatureContext';
import type { ClientCrossFeatureCallbacks, QuickAddTicketRenderProps, SurveySummaryRenderProps, ClientAssetsRenderProps, ClientTicketsRenderProps, ContactTicketsRenderProps, ContractWizardRenderProps, ContractQuickAddRenderProps } from '@alga-psa/clients/context/ClientCrossFeatureContext';
import { QuickAddTicket } from '@alga-psa/tickets/components/QuickAddTicket';
import { getTicketFormOptions } from '@alga-psa/tickets/actions/optimizedTicketActions';
import ClientSurveySummaryCard from '@alga-psa/surveys/components/ClientSurveySummaryCard';
import { getSlaPolicies } from '@alga-psa/sla/actions';
import { ContractWizard, ContractDialog } from '@alga-psa/billing/components';
import ClientAssets from './MspClientAssets';
import MspClientTickets from './MspClientTickets';
import MspContactTickets from './MspContactTickets';

export function MspClientCrossFeatureProvider({ children }: { children: ReactNode }) {
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

  const renderClientAssets = useCallback(
    (props: ClientAssetsRenderProps) => (
      <ClientAssets clientId={props.clientId} />
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

  const renderContractWizard = useCallback(
    (props: ContractWizardRenderProps) => (
      <ContractWizard
        open={props.open}
        onOpenChange={props.onOpenChange}
        onComplete={props.onComplete}
        initialClientId={props.clientId}
      />
    ),
    []
  );

  const renderContractQuickAdd = useCallback(
    (props: ContractQuickAddRenderProps) => (
      <ContractDialog
        isOpen={props.open}
        onOpenChange={props.onOpenChange}
        onContractSaved={props.onSaved}
        initialClientId={props.clientId}
      />
    ),
    []
  );

  const value = useMemo<ClientCrossFeatureCallbacks>(
    () => ({
      renderQuickAddTicket,
      getTicketFormOptions,
      renderSurveySummaryCard,
      renderClientAssets,
      renderClientTickets,
      renderContactTickets,
      renderContractWizard,
      renderContractQuickAdd,
      getSlaPolicies,
    }),
    [renderQuickAddTicket, renderSurveySummaryCard, renderClientAssets, renderClientTickets, renderContactTickets, renderContractWizard, renderContractQuickAdd]
  );

  return (
    <ClientCrossFeatureProvider value={value}>
      {children}
    </ClientCrossFeatureProvider>
  );
}
