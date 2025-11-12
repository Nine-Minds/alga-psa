import React from 'react';
import { getConsolidatedTicketData } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import TicketDetailsContainer from './TicketDetailsContainer';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { Suspense } from 'react';
import { TicketDetailsSkeleton } from 'server/src/components/tickets/ticket/TicketDetailsSkeleton';
import { getSurveyTicketSummary } from 'server/src/lib/actions/survey-actions/surveyDashboardActions';

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
    const [ticketData, surveySummary] = await Promise.all([
      getConsolidatedTicketData(id, user),
      getSurveyTicketSummary(id).catch((error) => {
        console.error('[TicketDetailsPage.alt] Failed to load survey summary', error);
        return null;
      }),
    ]);
    
    return (
      <div id="ticket-details-container" className="bg-gray-100">
        <Suspense fallback={<TicketDetailsSkeleton />}>
          <TicketDetailsContainer ticketData={ticketData} surveySummary={surveySummary ?? null} />
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
