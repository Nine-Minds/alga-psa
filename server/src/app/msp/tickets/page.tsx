import { getConsolidatedTicketListData } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getTicketingDisplaySettings } from 'server/src/lib/actions/ticket-actions/ticketDisplaySettings';
import TicketingDashboardContainer from 'server/src/components/tickets/TicketingDashboardContainer';
import { Suspense } from 'react';
import TicketsLoading from './loading';
import { ITicketListFilters } from 'server/src/interfaces/ticket.interfaces';

interface TicketsPageProps {
  searchParams?: { [key: string]: string | string[] | undefined };
}

export default async function TicketsPage({ searchParams }: TicketsPageProps) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('User not found');
    }

    // Parse search parameters into filter values
    const filtersFromURL: Partial<ITicketListFilters> = {};
    
    if (searchParams?.channelId && typeof searchParams.channelId === 'string') {
      filtersFromURL.channelId = searchParams.channelId;
    }
    if (searchParams?.companyId && typeof searchParams.companyId === 'string') {
      filtersFromURL.companyId = searchParams.companyId;
    }
    if (searchParams?.statusId && typeof searchParams.statusId === 'string') {
      filtersFromURL.statusId = searchParams.statusId;
    }
    if (searchParams?.priorityId && typeof searchParams.priorityId === 'string') {
      filtersFromURL.priorityId = searchParams.priorityId;
    }
    if (searchParams?.categoryId && typeof searchParams.categoryId === 'string') {
      filtersFromURL.categoryId = searchParams.categoryId;
    }
    if (searchParams?.searchQuery && typeof searchParams.searchQuery === 'string') {
      filtersFromURL.searchQuery = searchParams.searchQuery;
    }
    if (searchParams?.channelFilterState && typeof searchParams.channelFilterState === 'string') {
      const channelFilterState = searchParams.channelFilterState;
      if (channelFilterState === 'active' || channelFilterState === 'inactive' || channelFilterState === 'all') {
        filtersFromURL.channelFilterState = channelFilterState;
      }
    }
    if (searchParams?.tags && typeof searchParams.tags === 'string') {
      // Decode each tag to handle special characters that were encoded
      filtersFromURL.tags = searchParams.tags.split(',').map(tag => decodeURIComponent(tag));
    }

    // Apply defaults for missing parameters
    const initialFilters: Partial<ITicketListFilters> = {
      channelFilterState: 'active',
      statusId: 'open',
      priorityId: 'all',
      ...filtersFromURL
    };

    // Create full filter object for data fetching
    const fetchFilters: ITicketListFilters = {
      channelId: initialFilters.channelId || undefined,
      statusId: initialFilters.statusId || 'open',
      priorityId: initialFilters.priorityId || 'all',
      categoryId: initialFilters.categoryId || undefined,
      companyId: initialFilters.companyId || undefined,
      searchQuery: initialFilters.searchQuery || '',
      channelFilterState: initialFilters.channelFilterState || 'active',
      showOpenOnly: (initialFilters.statusId === 'open') || false,
      tags: initialFilters.tags || undefined
    };

    // Fetch consolidated data for the ticket list with initial filters
    const [consolidatedData, displaySettings] = await Promise.all([
      getConsolidatedTicketListData(user, fetchFilters),
      getTicketingDisplaySettings()
    ]);

    return (
      <div id="tickets-page-container" className="bg-gray-100">
        <Suspense fallback={<TicketsLoading />}>
          <TicketingDashboardContainer 
            consolidatedData={consolidatedData} 
            currentUser={user}
            initialFilters={initialFilters}
            displaySettings={displaySettings}
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
