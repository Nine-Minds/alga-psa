'use client';

import React, { useCallback } from 'react';
import TicketingDashboardContainer from '@alga-psa/tickets/components/TicketingDashboardContainer';
import ClientQuickView from '@alga-psa/clients/components/clients/ClientQuickView';
import type { IClient } from '@alga-psa/types';
import { MspClientQuickViewProvider } from '../clients/MspClientQuickViewProvider';

type MspTicketsPageClientProps = Omit<
  React.ComponentProps<typeof TicketingDashboardContainer>,
  'renderClientDetails'
>;

export default function MspTicketsPageClient(props: MspTicketsPageClientProps) {
  const renderClientDetails = useCallback(({ id, client }: { id: string; client: IClient }) => {
    return (
      <MspClientQuickViewProvider>
        <ClientQuickView id={id} client={client} isInDrawer={true} quickView={true} />
      </MspClientQuickViewProvider>
    );
  }, []);

  return <TicketingDashboardContainer {...props} renderClientDetails={renderClientDetails} />;
}
