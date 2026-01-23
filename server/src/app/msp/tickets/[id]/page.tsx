import React from 'react';
import { getConsolidatedTicketData } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { getCurrentUser } from '@alga-psa/users/actions';
import { Suspense } from 'react';
import { TicketDetailsSkeleton } from '@alga-psa/tickets/components/ticket/TicketDetailsSkeleton';
import { getSurveyTicketSummary } from '@alga-psa/surveys/actions/survey-actions/surveyDashboardActions';
import TicketDetailsContainer from '@alga-psa/tickets/components/ticket/TicketDetailsContainer';
import AssociatedAssets from '@alga-psa/assets/components/AssociatedAssets';

interface TicketDetailsPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function TicketDetailsPage({ params }: TicketDetailsPageProps) {
  const resolvedParams = await params;
  const { id } = resolvedParams;
  
  // Get current user for authorization
  const user = await getCurrentUser();
  if (!user) {
    return <div id="ticket-error-message">Error: User not authenticated</div>;
  }

  try {
    const [ticketData, surveySummary] = await Promise.all([
      getConsolidatedTicketData(id, user),
      getSurveyTicketSummary(id).catch((error) => {
        console.error('[TicketDetailsPage] Failed to load survey summary', error);
        return null;
      }),
    ]);

    const associatedAssets =
      ticketData.ticket?.client_id && ticketData.ticket?.ticket_id ? (
        <Suspense fallback={<div id="associated-assets-skeleton" className="animate-pulse bg-gray-200 h-32 rounded-lg"></div>}>
          <AssociatedAssets
            id="ticket-details-associated-assets"
            entityId={ticketData.ticket.ticket_id}
            entityType="ticket"
            clientId={ticketData.ticket.client_id}
            defaultBoardId={ticketData.ticket.board_id}
          />
        </Suspense>
      ) : null;
    
    return (
      <div id="ticket-details-container" className="bg-gray-100">
        <Suspense fallback={<TicketDetailsSkeleton />}>
          <TicketDetailsContainer
            ticketData={ticketData}
            surveySummary={surveySummary ?? null}
            associatedAssets={associatedAssets}
          />
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

export const dynamic = "force-dynamic";
