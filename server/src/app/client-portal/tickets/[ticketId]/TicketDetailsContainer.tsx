'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { TicketDetails } from 'server/src/components/client-portal/tickets/TicketDetails';
import { useTranslation } from 'server/src/lib/i18n/client';
import { ITicketWithDetails } from 'server/src/interfaces/ticket.interfaces';
import { IStatus } from 'server/src/interfaces/status.interface';

interface TicketDetailsContainerProps {
  ticketId: string;
  ticketData: ITicketWithDetails;
  statuses: IStatus[];
}

export default function TicketDetailsContainer({ ticketId, ticketData, statuses }: TicketDetailsContainerProps) {
  const router = useRouter();
  const { t } = useTranslation('clientPortal');

  const handleClose = () => {
    router.push('/client-portal/tickets');
  };

  // Validate required ticket data
  if (!ticketData || (!ticketData.ticket_id && !ticketId)) {
    return (
      <div id="ticket-invalid-data" className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-700">{t('tickets.invalidTicketData', 'Invalid ticket data')}</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <Button
        id="back-to-tickets-button"
        variant="soft"
        onClick={handleClose}
        className="mb-2"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        {t('tickets.backToTickets', 'Back to Tickets')}
      </Button>

      <TicketDetails
        ticketId={ticketData.ticket_id ?? ticketId}
        isOpen={true}
        onClose={handleClose}
        asStandalone={true}
        initialTicket={ticketData}
        initialDocuments={ticketData.documents || []}
        initialStatusOptions={statuses}
      />
    </div>
  );
}
