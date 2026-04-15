'use client';

import React, { useMemo, useCallback, useRef, type ReactNode } from 'react';
import { AssetCrossFeatureProvider } from '@alga-psa/assets/context/AssetCrossFeatureContext';
import type { AssetCrossFeatureCallbacks, AssetQuickAddTicketRenderProps, AssetTicketDetailsRenderProps } from '@alga-psa/assets/context/AssetCrossFeatureContext';
import { QuickAddTicket } from '@alga-psa/tickets/components/QuickAddTicket';
import { getConsolidatedTicketData } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { createTicketFromAsset } from '@alga-psa/tickets/actions/ticketActions';
import { getAllBoards } from '@alga-psa/reference-data/actions';
import TicketDetails from '@alga-psa/tickets/components/ticket/TicketDetails';
import { useDrawer } from '@alga-psa/ui';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';

export function MspAssetCrossFeatureProvider({ children }: { children: ReactNode }) {
  const { openDrawer } = useDrawer();
  // Use ref to avoid re-creating callbacks when drawer state changes
  const openDrawerRef = useRef(openDrawer);
  openDrawerRef.current = openDrawer;

  const renderQuickAddTicket = useCallback(
    (props: AssetQuickAddTicketRenderProps) => (
      <QuickAddTicket
        open={props.open}
        onOpenChange={props.onOpenChange}
        onTicketAdded={props.onTicketAdded}
        prefilledClient={props.prefilledClient}
        assetId={props.assetId}
      />
    ),
    []
  );

  const openTicketDetailsDrawer = useCallback(
    async (props: AssetTicketDetailsRenderProps) => {
      try {
        const ticketData = await getConsolidatedTicketData(props.ticketId);

        if (!ticketData) {
          toast.error('Failed to load ticket');
          return;
        }

        openDrawerRef.current(
          <TicketDetails
            isInDrawer={true}
            initialTicket={ticketData.ticket}
            initialComments={ticketData.comments}
            initialBoard={ticketData.board}
            initialClient={ticketData.client}
            initialContactInfo={ticketData.contactInfo}
            initialCreatedByUser={ticketData.createdByUser}
            initialAdditionalAgents={ticketData.additionalAgents}
            initialAvailableAgents={ticketData.availableAgents}
            initialUserMap={ticketData.userMap}
            statusOptions={ticketData.options.status}
            agentOptions={ticketData.options.agent}
            boardOptions={ticketData.options.board}
            priorityOptions={ticketData.options.priority}
            initialCategories={ticketData.categories}
            initialClients={ticketData.clients}
            initialLocations={ticketData.locations}
          />,
          undefined,
          undefined,
          '50vw'
        );
      } catch (error) {
        handleError(error, 'Failed to open ticket');
      }
    },
    []
  );

  const value = useMemo<AssetCrossFeatureCallbacks>(
    () => ({
      renderQuickAddTicket,
      openTicketDetailsDrawer,
      createTicketFromAsset,
      getAllBoards,
    }),
    [renderQuickAddTicket, openTicketDetailsDrawer]
  );

  return (
    <AssetCrossFeatureProvider value={value}>
      {children}
    </AssetCrossFeatureProvider>
  );
}
