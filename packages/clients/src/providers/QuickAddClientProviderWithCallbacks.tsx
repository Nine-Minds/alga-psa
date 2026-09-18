'use client';

import React, { useMemo, useCallback, type ReactNode } from 'react';
import { QuickAddClientProvider } from '@alga-psa/ui/context';
import type { QuickAddClientCallbacks, QuickAddClientRenderProps, QuickAddContactRenderProps, QuickAddInteractionRenderProps } from '@alga-psa/ui/context';
import QuickAddClient from '../components/clients/QuickAddClient';
import QuickAddContact from '../components/contacts/QuickAddContact';
import { QuickAddInteraction } from '../components/interactions/QuickAddInteraction';
import InteractionDetails from '../components/interactions/InteractionDetails';
import { getInteractionById } from '../actions/queryActions';
import { useDrawer } from '@alga-psa/ui';
import {
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export function QuickAddClientProviderWithCallbacks({ children }: { children: ReactNode }) {
  const { openDrawer } = useDrawer();
  const renderQuickAddClient = useCallback(
    (props: QuickAddClientRenderProps) => (
      <QuickAddClient
        open={props.open}
        onOpenChange={props.onOpenChange}
        onClientAdded={props.onClientAdded}
        trigger={props.trigger}
        skipSuccessDialog={props.skipSuccessDialog}
      />
    ),
    []
  );

  const renderQuickAddContact = useCallback(
    (props: QuickAddContactRenderProps) => (
      <QuickAddContact
        isOpen={props.isOpen}
        onClose={props.onClose}
        onContactAdded={props.onContactAdded}
        clients={props.clients}
        selectedClientId={props.selectedClientId}
      />
    ),
    []
  );

  const renderQuickAddInteraction = useCallback(
    (props: QuickAddInteractionRenderProps) => (
      <QuickAddInteraction
        id={props.id}
        isOpen={props.isOpen}
        onClose={props.onClose}
        entityId={props.entityId}
        entityType={props.entityType}
        clientId={props.clientId}
        ticketId={props.ticketId}
        onInteractionAdded={props.onInteractionAdded}
      />
    ),
    []
  );

  const openInteractionDetails = useCallback(async (interactionId: string, onChanged?: () => void) => {
    try {
      const interaction = await getInteractionById(interactionId);
      if (isActionMessageError(interaction) || isActionPermissionError(interaction)) {
        handleError(interaction);
        return;
      }

      openDrawer(
        <InteractionDetails
          interaction={interaction}
          isInDrawer
          onInteractionDeleted={onChanged}
          onInteractionUpdated={onChanged ? () => onChanged() : undefined}
        />,
      );
    } catch (error) {
      handleError(error);
    }
  }, [openDrawer]);

  const value = useMemo<QuickAddClientCallbacks>(
    () => ({
      renderQuickAddClient,
      renderQuickAddContact,
      renderQuickAddInteraction,
      openInteractionDetails,
    }),
    [renderQuickAddClient, renderQuickAddContact, renderQuickAddInteraction, openInteractionDetails]
  );

  return (
    <QuickAddClientProvider value={value}>
      {children}
    </QuickAddClientProvider>
  );
}
