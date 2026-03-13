'use client';

import React, { useCallback, useMemo, type ReactNode } from 'react';
import { ClientIntegrationProvider } from '@alga-psa/projects/context/ClientIntegrationContext';
import type {
  ClientIntegrationContextType,
  QuickAddContactRenderProps,
  QuickAddClientRenderProps,
  ClientDetailsRenderProps,
} from '@alga-psa/projects/context/ClientIntegrationContext';
import QuickAddContact from '@alga-psa/clients/components/contacts/QuickAddContact';
import QuickAddClient from '@alga-psa/clients/components/clients/QuickAddClient';
import ClientDetails from '@alga-psa/clients/components/clients/ClientDetails';
import { getContactsByClient, getAllContacts, getContactByContactNameId } from '@alga-psa/clients/actions';

export function MspClientIntegrationProvider({ children }: { children: ReactNode }) {
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

  const renderQuickAddClient = useCallback(
    (props: QuickAddClientRenderProps) => (
      <QuickAddClient
        open={props.open}
        onOpenChange={props.onOpenChange}
        onClientAdded={props.onClientAdded}
        skipSuccessDialog={props.skipSuccessDialog}
      />
    ),
    []
  );

  const renderClientDetails = useCallback(
    (props: ClientDetailsRenderProps) => (
      <ClientDetails
        client={props.client}
        isInDrawer={props.isInDrawer}
        quickView={props.quickView}
      />
    ),
    []
  );

  const value = useMemo<ClientIntegrationContextType>(
    () => ({
      getContactsByClient,
      getAllContacts,
      getContactByContactNameId,
      renderQuickAddContact,
      renderQuickAddClient,
      renderClientDetails,
    }),
    [renderQuickAddContact, renderQuickAddClient, renderClientDetails]
  );

  return (
    <ClientIntegrationProvider value={value}>
      {children}
    </ClientIntegrationProvider>
  );
}
