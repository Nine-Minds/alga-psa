'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { TicketDetails } from './TicketDetails';
import { useTranslation } from 'server/src/lib/i18n/client';
import { Button } from 'server/src/components/ui/Button';

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
      <Button
        id="back-to-tickets-button"
        variant="soft"
        onClick={handleClose}
        className="mb-2"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        {t('tickets.backToTickets', '← Back to Tickets')}
      </Button>
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
