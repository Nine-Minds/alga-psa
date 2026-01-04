import { getConsolidatedTicketListData } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getTicketingDisplaySettings } from 'server/src/lib/actions/ticket-actions/ticketDisplaySettings';
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

    // Parse pagination parameters
    const page = params?.page && typeof params.page === 'string' ? parseInt(params.page, 10) : 1;
    const pageSize = params?.pageSize && typeof params.pageSize === 'string' ? parseInt(params.pageSize, 10) : 10;

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
      const normalizeTags = (raw: string | string[]) => {
        const values = Array.isArray(raw) ? raw : raw.split(',');
        const decoded = values
          .map(tag => (typeof tag === 'string' ? decodeURIComponent(tag) : String(tag)).trim())
          .filter(tag => tag.length > 0);
        return Array.from(new Set(decoded));
      };

      filtersFromURL.tags = normalizeTags(params.tags);
    }
    const allowedSortKeys = [
      'ticket_number',
      'title',
      'status_name',
      'priority_name',
      'board_name',
      'category_name',
      'client_name',
      'entered_at',
      'entered_by_name'
    ] as const;

    if (params?.sortBy && typeof params.sortBy === 'string') {
      if ((allowedSortKeys as readonly string[]).includes(params.sortBy)) {
        filtersFromURL.sortBy = params.sortBy as ITicketListFilters['sortBy'];
      }
    }
    if (params?.sortDirection && typeof params.sortDirection === 'string') {
      const sortDirection = params.sortDirection.toLowerCase();
      if (sortDirection === 'asc' || sortDirection === 'desc') {
        filtersFromURL.sortDirection = sortDirection;
      }
    }
    if (params?.bundleView && typeof params.bundleView === 'string') {
      const bundleView = params.bundleView;
      if (bundleView === 'bundled' || bundleView === 'individual') {
        filtersFromURL.bundleView = bundleView;
      }
    }

    // Apply defaults for missing parameters
    const initialFilters: Partial<ITicketListFilters> = {
      boardFilterState: 'active',
      statusId: 'open',
      priorityId: 'all',
      bundleView: 'bundled',
      sortBy: filtersFromURL.sortBy ?? 'entered_at',
      sortDirection: filtersFromURL.sortDirection ?? 'desc',
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
      tags: initialFilters.tags || undefined,
      sortBy: initialFilters.sortBy || 'entered_at',
      sortDirection: initialFilters.sortDirection || 'desc',
      bundleView: initialFilters.bundleView || 'bundled'
    };

    // Fetch consolidated data for the ticket list with initial filters and pagination
    const [consolidatedData, displaySettings] = await Promise.all([
      getConsolidatedTicketListData(user!, fetchFilters, page, pageSize),
      getTicketingDisplaySettings()
    ]);

    return (
      <div id="tickets-page-container" className="bg-gray-100">
        <TicketingDashboardContainer
          consolidatedData={consolidatedData}
          currentUser={user!}
          initialFilters={initialFilters}
          initialPage={page}
          initialPageSize={pageSize}
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
