import React from 'react';
import { getConsolidatedTicketData } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import TicketDetailsContainer from './TicketDetailsContainer';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { Suspense } from 'react';
import { TicketDetailsSkeleton } from 'server/src/components/tickets/ticket/TicketDetailsSkeleton';

interface TicketDetailsPageProps {
  params: {
    id: string;
  };
}

export default async function TicketDetailsPage({ params }: TicketDetailsPageProps) {
  const { id } = params;
  
  // Get current user for authorization
  const user = await getCurrentUser();
  if (!user) {
    return <div id="ticket-error-message">Error: User not authenticated</div>;
  }

  try {
    // Fetch all ticket data in a single consolidated request
    const ticketData = await getConsolidatedTicketData(id, user);
    
    return (
      <div id="ticket-details-container" className="bg-gray-100">
        <Suspense fallback={<TicketDetailsSkeleton />}>
          <TicketDetailsContainer ticketData={ticketData} />
        </Suspense>
      </div>
    );
  } catch (error) {
    console.error(`Error fetching ticket with id ${id}:`, error);
    return (
      <div id="ticket-error-message">
        Error: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
}