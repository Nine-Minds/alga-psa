import { getConsolidatedTicketListData } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import TicketingDashboardContainer from 'server/src/components/tickets/TicketingDashboardContainer';
import { Suspense } from 'react';
import TicketsLoading from './loading';

export default async function TicketsPage() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('User not found');
    }

    // Fetch consolidated data for the ticket list
    const consolidatedData = await getConsolidatedTicketListData(user, {
      channelFilterState: 'active'
    });

    return (
      <div id="tickets-page-container" className="bg-gray-100">
        <Suspense fallback={<TicketsLoading />}>
          <TicketingDashboardContainer 
            consolidatedData={consolidatedData} 
            currentUser={user} 
          />
        </Suspense>
      </div>
    );
  } catch (error) {
    console.error('Error fetching user or tickets:', error);
    return <div id="tickets-error-message">An error occurred. Please try again later.</div>;
  }
}

export const dynamic = "force-dynamic";
