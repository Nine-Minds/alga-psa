import React from 'react';
import { cache } from 'react';
import { getClientTicketDetails } from '@alga-psa/client-portal/actions';
import { getTicketStatuses } from '@alga-psa/reference-data/actions';
import { TicketDetailsContainer } from '@alga-psa/client-portal/components';
import logger from '@alga-psa/core/logger';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import type { Metadata } from 'next';

const getCachedTicket = cache((id: string) => getClientTicketDetails(id));

interface TicketPageProps {
  params: Promise<{
    ticketId: string;
  }>;
}

export async function generateMetadata({ params }: TicketPageProps): Promise<Metadata> {
  try {
    const { ticketId } = await params;
    const ticket = await getCachedTicket(ticketId);
    if (ticket) {
      return { title: `Ticket #${ticket.ticket_number} - ${ticket.title}` };
    }
  } catch (error) {
    console.error('[generateMetadata] Failed to fetch ticket title:', error);
  }
  return { title: 'Ticket Details' };
}

export default async function TicketPage({ params }: TicketPageProps) {
  const resolvedParams = await params;
  const { ticketId } = resolvedParams;

  try {
    const ticketData = await getCachedTicket(ticketId);
    const statuses = await getTicketStatuses(ticketData.board_id);
    const productCode = await getCurrentTenantProduct();

    return (
      <div className="w-full">
        <TicketDetailsContainer
          ticketId={ticketId}
          ticketData={ticketData}
          statuses={statuses}
          productCode={productCode}
        />
      </div>
    );
  } catch (error) {
    logger.error('[ClientPortal] Failed to fetch ticket details', {
      ticketId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    return (
      <Alert id="ticket-error-message" variant="destructive">
        <AlertDescription>
          Error: {error instanceof Error ? error.message : 'Failed to load ticket details'}
        </AlertDescription>
      </Alert>
    );
  }
}

export const dynamic = "force-dynamic";
