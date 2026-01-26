'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IStatus, ITicketWithDetails } from '@alga-psa/types';
import { TicketDetails } from './TicketDetails';

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

  if (!ticketData || (!ticketData.ticket_id && !ticketId)) {
    return (
      <div id="ticket-invalid-data" className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-700">{t('tickets.invalidTicketData', 'Invalid ticket data')}</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <Button id="back-to-tickets-button" variant="soft" onClick={handleClose} className="mb-2">
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

