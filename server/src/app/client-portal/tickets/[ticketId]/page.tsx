import React from 'react';
import { getClientTicketDetails } from 'server/src/lib/actions/client-portal-actions/client-tickets';
import { getTicketStatuses } from 'server/src/lib/actions/status-actions/statusActions';
import TicketDetailsContainer from './TicketDetailsContainer';

interface TicketPageProps {
  params: Promise<{
    ticketId: string;
  }>;
}

export default async function TicketPage({ params }: TicketPageProps) {
  const resolvedParams = await params;
  const { ticketId } = resolvedParams;

  try {
    // Fetch ticket details and statuses server-side
    const [ticketData, statuses] = await Promise.all([
      getClientTicketDetails(ticketId),
      getTicketStatuses()
    ]);

    return (
      <div className="w-full">
        <TicketDetailsContainer
          ticketId={ticketId}
          ticketData={ticketData}
          statuses={statuses}
        />
      </div>
    );
  } catch (error) {
    console.error(`Error fetching ticket with id ${ticketId}:`, error);
    return (
      <div id="ticket-error-message" className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-700">
          Error: {error instanceof Error ? error.message : 'Failed to load ticket details'}
        </p>
      </div>
    );
  }
}

export const dynamic = "force-dynamic";
