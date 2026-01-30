'use client';

import React, { useCallback } from 'react';
import TicketDetailsContainer from '@alga-psa/tickets/components/ticket/TicketDetailsContainer';
import ContactDetailsView from '@alga-psa/clients/components/contacts/ContactDetailsView';
import type { IClient, IContact } from '@alga-psa/types';

type MspTicketDetailsContainerClientProps = Omit<
  React.ComponentProps<typeof TicketDetailsContainer>,
  'renderContactDetails'
>;

export default function MspTicketDetailsContainerClient(props: MspTicketDetailsContainerClientProps) {
  const renderContactDetails = useCallback(
    ({ id, contact, clients, userId }: { id: string; contact: IContact; clients: IClient[]; userId?: string }) => {
      return (
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
      );
    },
    []
  );

  return <TicketDetailsContainer {...props} renderContactDetails={renderContactDetails} />;
}

