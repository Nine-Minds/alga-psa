'use client';

import React, { useCallback } from 'react';
import TicketingDashboardContainer from '@alga-psa/tickets/components/TicketingDashboardContainer';
import ClientDetails from '@alga-psa/clients/components/clients/ClientDetails';
import type { IClient } from '@alga-psa/types';

type MspTicketsPageClientProps = Omit<
  React.ComponentProps<typeof TicketingDashboardContainer>,
  'renderClientDetails'
>;

export default function MspTicketsPageClient(props: MspTicketsPageClientProps) {
  const renderClientDetails = useCallback(({ id, client }: { id: string; client: IClient }) => {
    return <ClientDetails id={id} client={client} isInDrawer={true} quickView={true} />;
  }, []);

  return <TicketingDashboardContainer {...props} renderClientDetails={renderClientDetails} />;
}

