import React from 'react';
import { cache } from 'react';
import { getConsolidatedTicketData } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { Suspense } from 'react';
import { TicketDetailsSkeleton } from '@alga-psa/tickets/components/ticket/TicketDetailsSkeleton';
import { getSurveyTicketSummary } from '@alga-psa/surveys/actions/survey-actions/surveyDashboardActions';
import AssociatedAssets from '@alga-psa/assets/components/AssociatedAssets';
import { MspTicketDetailsContainerClient } from '@alga-psa/msp-composition/tickets';

import { getTicketById } from '@alga-psa/tickets/actions/ticketActions';
import { AIChatContextBoundary } from '@product/chat/context';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { Metadata } from 'next';

const getCachedTicket = cache((id: string) => getTicketById(id));

export async function generateMetadata({ params }: TicketDetailsPageProps): Promise<Metadata> {
  try {
    const { id } = await params;
    const ticket = await getCachedTicket(id);
    if (ticket && 'ticket_number' in ticket) {
      return { title: `Ticket #${ticket.ticket_number} - ${ticket.title}` };
    }
  } catch (error) {
    console.error('[generateMetadata] Failed to fetch ticket title:', error);
  }
  return { title: 'Ticket Details' };
}

interface TicketDetailsPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function TicketDetailsPage({ params }: TicketDetailsPageProps) {
  const resolvedParams = await params;
  const { id } = resolvedParams;
  const productCode = await getCurrentTenantProduct();
  const isAlgadesk = productCode === 'algadesk';
  
  // Get current user for authorization
  const user = await getCurrentUser();
  if (!user) {
    const { t } = await getServerTranslation(undefined, 'common');
    return <div id="ticket-error-message">{t('pages.errors.userNotAuthenticatedError')}</div>;
  }

  try {
    const [ticketData, surveySummary] = await Promise.all([
      getConsolidatedTicketData(id),
      (isAlgadesk ? Promise.resolve(null) : getSurveyTicketSummary(id)).catch((error) => {
        console.error('[TicketDetailsPage] Failed to load survey summary', error);
        return null;
      }),
    ]);

    const associatedAssets =
      !isAlgadesk && ticketData.ticket?.client_id && ticketData.ticket?.ticket_id ? (
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
    
    const detailsContent = (
      <div id="ticket-details-container" className="bg-gray-100">
        <Suspense fallback={<TicketDetailsSkeleton />}>
          <MspTicketDetailsContainerClient
            ticketData={ticketData}
            surveySummary={surveySummary ?? null}
            associatedAssets={associatedAssets}
            isAlgadeskMode={isAlgadesk}
          />
        </Suspense>
      </div>
    );

    return isAlgadesk ? detailsContent : (
      <AIChatContextBoundary
        value={{
          pathname: `/msp/tickets/${id}`,
          screen: {
            key: 'tickets.detail',
            label: 'Ticket Details',
          },
          record: {
            type: 'ticket',
            id,
          },
        }}
      >
        {detailsContent}
      </AIChatContextBoundary>
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
