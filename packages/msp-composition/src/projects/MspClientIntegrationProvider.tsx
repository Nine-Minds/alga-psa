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
import ClientQuickView from '@alga-psa/clients/components/clients/ClientQuickView';
import { getContactsByClient, getAllContacts, getClientById } from '@alga-psa/clients/actions/queryActions';
import { searchClientsForPicker } from '@alga-psa/clients/actions/clientPickerActions';
import { getContactByContactNameId } from '@alga-psa/clients/actions/contact-actions/contactActions';

// searchClientsForPicker caps `ids` lookups at this many per call.
const CLIENT_ID_LOOKUP_CHUNK = 100;

async function getExistingClientIds(clientIds: string[]): Promise<string[]> {
  const unique = Array.from(new Set(clientIds));
  const existing: string[] = [];
  for (let i = 0; i < unique.length; i += CLIENT_ID_LOOKUP_CHUNK) {
    const { clients } = await searchClientsForPicker({ ids: unique.slice(i, i + CLIENT_ID_LOOKUP_CHUNK) });
    existing.push(...clients.map((client) => client.client_id));
  }
  return existing;
}

export function MspClientIntegrationProvider({ children }: { children: ReactNode }) {
  const renderQuickAddContact = useCallback(
    (props: QuickAddContactRenderProps) => (
      <QuickAddContact
        isOpen={props.isOpen}
        onClose={props.onClose}
        onContactAdded={props.onContactAdded}
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
      <ClientQuickView
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
      getClientById: async (clientId: string) => (await getClientById(clientId)) ?? null,
      getExistingClientIds,
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
