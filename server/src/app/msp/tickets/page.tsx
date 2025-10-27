import { getConsolidatedTicketListData } from '@product/actions/ticket-actions/optimizedTicketActions';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { getTicketingDisplaySettings } from '@product/actions/ticket-actions/ticketDisplaySettings';
import TicketingDashboardContainer from 'server/src/components/tickets/TicketingDashboardContainer';
import { ITicketListFilters } from 'server/src/interfaces/ticket.interfaces';

interface TicketsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function TicketsPage({ searchParams }: TicketsPageProps) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      // In dev, redirect unauthenticated users to login
      // This avoids rendering a 200 with an error message
      // and matches expected NextAuth behavior
      const { redirect } = await import('next/navigation');
      redirect('/auth/signin?callbackUrl=%2Fmsp%2Ftickets');
    }

    // Await searchParams as required in Next.js 15
    const params = await searchParams;

    // Parse search parameters into filter values
    const filtersFromURL: Partial<ITicketListFilters> = {};
    
    if (params?.boardId && typeof params.boardId === 'string') {
      filtersFromURL.boardId = params.boardId;
    }
    if (params?.clientId && typeof params.clientId === 'string') {
      filtersFromURL.clientId = params.clientId;
    }
    if (params?.statusId && typeof params.statusId === 'string') {
      filtersFromURL.statusId = params.statusId;
    }
    if (params?.priorityId && typeof params.priorityId === 'string') {
      filtersFromURL.priorityId = params.priorityId;
    }
    if (params?.categoryId && typeof params.categoryId === 'string') {
      filtersFromURL.categoryId = params.categoryId;
    }
    if (params?.searchQuery && typeof params.searchQuery === 'string') {
      filtersFromURL.searchQuery = params.searchQuery;
    }
    if (params?.boardFilterState && typeof params.boardFilterState === 'string') {
      const boardFilterState = params.boardFilterState;
      if (boardFilterState === 'active' || boardFilterState === 'inactive' || boardFilterState === 'all') {
        filtersFromURL.boardFilterState = boardFilterState;
      }
    }
    if (params?.tags) {
      // Decode each tag to handle special characters that were encoded
      if (typeof params.tags === 'string') {
        filtersFromURL.tags = params.tags.split(',').map(tag => decodeURIComponent(tag));
      } else if (Array.isArray(params.tags)) {
        // Handle case where tags might already be an array
        filtersFromURL.tags = params.tags.map(tag => 
          typeof tag === 'string' ? decodeURIComponent(tag) : String(tag)
        );
      }
    }

    // Apply defaults for missing parameters
    const initialFilters: Partial<ITicketListFilters> = {
      boardFilterState: 'active',
      statusId: 'open',
      priorityId: 'all',
      ...filtersFromURL
    };

    // Create full filter object for data fetching
    const fetchFilters: ITicketListFilters = {
      boardId: initialFilters.boardId || undefined,
      statusId: initialFilters.statusId || 'open',
      priorityId: initialFilters.priorityId || 'all',
      categoryId: initialFilters.categoryId || undefined,
      clientId: initialFilters.clientId || undefined,
      searchQuery: initialFilters.searchQuery || '',
      boardFilterState: initialFilters.boardFilterState || 'active',
      showOpenOnly: (initialFilters.statusId === 'open') || false,
      tags: initialFilters.tags || undefined
    };

    // Fetch consolidated data for the ticket list with initial filters
    const [consolidatedData, displaySettings] = await Promise.all([
      getConsolidatedTicketListData(user!, fetchFilters),
      getTicketingDisplaySettings()
    ]);

    return (
      <div id="tickets-page-container" className="bg-gray-100">
        <TicketingDashboardContainer 
          consolidatedData={consolidatedData} 
          currentUser={user!}
          initialFilters={initialFilters}
          displaySettings={displaySettings}
        />
      </div>
    );
  } catch (error) {
    console.error('Error fetching user or tickets:', error);
    return <div id="tickets-error-message">An error occurred. Please try again later.</div>;
  }
}

export const dynamic = "force-dynamic";
