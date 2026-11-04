'use client';

import React, { useCallback } from 'react';
import TicketingDashboardContainer from '@alga-psa/tickets/components/TicketingDashboardContainer';
import ClientQuickView from '@alga-psa/clients/components/clients/ClientQuickView';
import ContactDetailsView from '@alga-psa/clients/components/contacts/ContactDetailsView';
import type { IClient, IContact } from '@alga-psa/types';
import { MspClientQuickViewProvider } from '../clients/MspClientQuickViewProvider';

type MspTicketsPageClientProps = Omit<
  React.ComponentProps<typeof TicketingDashboardContainer>,
  'renderClientDetails' | 'renderContactDetails'
>;

export default function MspTicketsPageClient(props: MspTicketsPageClientProps) {
  const renderClientDetails = useCallback(({ id, client }: { id: string; client: IClient }) => {
    return (
      <MspClientQuickViewProvider>
        <ClientQuickView id={id} client={client} isInDrawer={true} quickView={true} />
      </MspClientQuickViewProvider>
    );
  }, []);

  const renderContactDetails = useCallback(
    ({ id, contact, clients, userId }: { id: string; contact: IContact; clients: IClient[]; userId?: string }) => {
      return (
        // The contact drawer can open the owning client's quick view from its
        // client row, so it needs the same lightweight cross-feature provider.
        <MspClientQuickViewProvider>
          <ContactDetailsView
            id={id}
            initialContact={contact}
            clients={clients}
            isInDrawer={true}
            userId={userId}
            quickView={true}
            showDocuments={false}
            showInteractions={true}
            clientReadOnly={true}
          />
        </MspClientQuickViewProvider>
      );
    },
    []
  );

  return (
    <TicketingDashboardContainer
      {...props}
      renderClientDetails={renderClientDetails}
      renderContactDetails={renderContactDetails}
    />
  );
}
