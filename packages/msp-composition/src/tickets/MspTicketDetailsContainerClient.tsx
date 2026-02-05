'use client';

import React, { useCallback } from 'react';
import TicketDetailsContainer from '@alga-psa/tickets/components/ticket/TicketDetailsContainer';
import ContactDetailsView from '@alga-psa/clients/components/contacts/ContactDetailsView';
import ClientDetails from '@alga-psa/clients/components/clients/ClientDetails';
import type { IClient, IContact } from '@alga-psa/types';
import CreateTaskFromTicketDialog from '@alga-psa/projects/components/CreateTaskFromTicketDialog';

type MspTicketDetailsContainerClientProps = Omit<
  React.ComponentProps<typeof TicketDetailsContainer>,
  'renderContactDetails' | 'renderClientDetails'
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

  const renderCreateProjectTask = useCallback(
    ({ ticket }: { ticket: any }) => <CreateTaskFromTicketDialog ticket={ticket} />,
    []
  );

  const renderClientDetails = useCallback(
    ({ id, client }: { id: string; client: IClient }) => {
      return <ClientDetails id={id} client={client} isInDrawer={true} quickView={true} />;
    },
    []
  );

  return (
    (
    <TicketDetailsContainer
      {...props}
      renderContactDetails={renderContactDetails}
      renderCreateProjectTask={renderCreateProjectTask}
      renderClientDetails={renderClientDetails}
    />
  )
  );
}
