'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { TicketDetails } from './TicketDetails';
import { useTranslation } from 'server/src/lib/i18n/client';

export function TicketDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const ticketId = params.ticketId as string;
  const { t } = useTranslation('clientPortal');

  const handleClose = () => {
    router.push('/client-portal/tickets');
  };

  return (
    <div className="w-full">
      <button
        id="back-to-tickets-button"
        onClick={handleClose}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('tickets.backToTickets', 'Back to Tickets')}
      </button>
      {/* Render TicketDetails as a standalone component */}
      <TicketDetails
        ticketId={ticketId}
        isOpen={true}
        onClose={handleClose}
        asStandalone={true}
      />
    </div>
  );
}
