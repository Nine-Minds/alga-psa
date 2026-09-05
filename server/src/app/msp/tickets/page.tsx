import { getConsolidatedTicketListData } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { getCurrentUser, getCurrentUserPermissions, getUserPreference } from '@alga-psa/user-composition/actions';
import { getTicketingDisplaySettings } from '@alga-psa/tickets/actions/ticketDisplaySettings';
import { getTeams, isTeamActionError } from '@alga-psa/teams/actions';
import type { ITicketListFilters } from '@alga-psa/types';
import MspTicketsPageClient from '@alga-psa/msp-composition/tickets/MspTicketsPageClient';
import { findBoardById } from '@alga-psa/tickets/actions/board-actions/boardActions';
import {
  isTicketStatusOpenFilter,
  TICKET_STATUS_FILTER_OPEN,
} from '@alga-psa/tickets/lib';
import {
  hasBoardFilterParam,
  hasTicketViewFilterParams,
  TICKETS_LAST_ACTIVE_BOARD_SETTING,
} from '@alga-psa/tickets/lib/boardTabs';
import {
  buildBoardArrivalFilters,
  resolveTicketViewSettings,
  sanitizeStoredTicketView,
  validateCapturedFilters,
} from '@alga-psa/tickets/lib/ticketViewSettings';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.tickets.title', { defaultValue: 'Tickets' }),
  };
}

interface TicketsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function isReturnedActionError(value: unknown): value is { actionError: string } | { permissionError: string } {
  const candidate = value as Record<string, unknown>;
  return (
    typeof value === 'object' &&
    value !== null &&
    (
      typeof candidate.actionError === 'string' ||
      typeof candidate.permissionError === 'string'
    )
  );
}

export default async function TicketsPage({ searchParams }: TicketsPageProps) {
  try {
    const user = await getCurrentUser();
    const productCode = await getCurrentTenantProduct();
    const allowSlaStatusFilter = productCode === 'psa';
    const useAlgaDeskQuickAddForm = productCode === 'algadesk';
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
    let pageSize = 10;
    if (params?.pageSize && typeof params.pageSize === 'string') {
      const parsed = parseInt(params.pageSize, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        pageSize = parsed;
      }
    } else {
      // No URL override — honor the user's saved preference so SSR data
      // matches what the client will display after the preference loads.
      const saved = await getUserPreference(user!.user_id, 'tickets_list_page_size').catch(() => null);
      if (typeof saved === 'number' && Number.isFinite(saved) && saved > 0) {
        pageSize = saved;
      }
    }

    // Parse search parameters into filter values
    const filtersFromURL: Partial<ITicketListFilters> = {};

    if (params?.boardId && typeof params.boardId === 'string') {
      filtersFromURL.boardId = params.boardId;
    }
    if (params?.boardIds && typeof params.boardIds === 'string') {
      const boardIds = params.boardIds.split(',').filter(id => id.trim().length > 0);
      if (boardIds.length > 0) {
        filtersFromURL.boardIds = boardIds;
      }
    }
    if (params?.excludeBoardIds && typeof params.excludeBoardIds === 'string') {
      const excludeBoardIds = params.excludeBoardIds.split(',').filter(id => id.trim().length > 0);
      if (excludeBoardIds.length > 0) {
        filtersFromURL.excludeBoardIds = excludeBoardIds;
      }
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
    if (params?.categoryIds && typeof params.categoryIds === 'string') {
      const categoryIds = params.categoryIds.split(',').filter(id => id.trim().length > 0);
      if (categoryIds.length > 0) {
        filtersFromURL.categoryIds = categoryIds;
      }
    }
    if (params?.excludeCategoryIds && typeof params.excludeCategoryIds === 'string') {
      const excludeCategoryIds = params.excludeCategoryIds.split(',').filter(id => id.trim().length > 0);
      if (excludeCategoryIds.length > 0) {
        filtersFromURL.excludeCategoryIds = excludeCategoryIds;
      }
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
    if (params?.assignedToIds && typeof params.assignedToIds === 'string') {
      const assignedToIds = params.assignedToIds.split(',').filter(id => id.trim().length > 0);
      if (assignedToIds.length > 0) {
        filtersFromURL.assignedToIds = assignedToIds;
      }
    }
    if (params?.assignedTeamIds && typeof params.assignedTeamIds === 'string') {
      const assignedTeamIds = params.assignedTeamIds.split(',').filter(id => id.trim().length > 0);
      if (assignedTeamIds.length > 0) {
        filtersFromURL.assignedTeamIds = assignedTeamIds;
      }
    }
    if (params?.includeUnassigned === 'true') {
      filtersFromURL.includeUnassigned = true;
    }
    // Parse due date filter from URL
    if (params?.dueDateFilter && typeof params.dueDateFilter === 'string') {
      const allowedDueDateFilters = ['all', 'overdue', 'upcoming', 'today', 'no_due_date', 'before', 'after', 'custom'] as const;
      if ((allowedDueDateFilters as readonly string[]).includes(params.dueDateFilter)) {
        filtersFromURL.dueDateFilter = params.dueDateFilter as ITicketListFilters['dueDateFilter'];
      }
    }
    // Parse due date range values from URL
    if (params?.dueDateFrom && typeof params.dueDateFrom === 'string') {
      filtersFromURL.dueDateFrom = params.dueDateFrom;
    }
    if (params?.dueDateTo && typeof params.dueDateTo === 'string') {
      filtersFromURL.dueDateTo = params.dueDateTo;
    }
    if (params?.responseState && typeof params.responseState === 'string') {
      const allowedResponseStates = ['all', 'awaiting_client', 'awaiting_internal', 'none'] as const;
      if ((allowedResponseStates as readonly string[]).includes(params.responseState)) {
        filtersFromURL.responseState = params.responseState as ITicketListFilters['responseState'];
      }
    }
    if (allowSlaStatusFilter && params?.slaStatusFilter && typeof params.slaStatusFilter === 'string') {
      const allowedSlaStatuses = ['all', 'has_sla', 'no_sla', 'on_track', 'breached', 'paused'] as const;
      if ((allowedSlaStatuses as readonly string[]).includes(params.slaStatusFilter)) {
        filtersFromURL.slaStatusFilter = params.slaStatusFilter as ITicketListFilters['slaStatusFilter'];
      }
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
      'entered_by_name',
      'due_date'
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

    // ── Board memory, resolved before first paint ──────────────────────────
    //
    // The remembered board tab used to be restored by a client effect that fired
    // once the preference resolved — a second list fetch, a board that visibly
    // jumped a beat after the list had already rendered, and a
    // history.replaceState late enough to land *after* a ticket click and bounce
    // the user back to the list. Resolving it here means first paint is already
    // the remembered board and nothing re-writes history on arrival.
    //
    // A URL that names a board still wins outright, and a URL carrying filter
    // intent still outranks the board's stored view: a shared link is about
    // *these tickets*, not about the board's usual way of looking at them.
    const searchString = new URLSearchParams(
      Object.entries(params ?? {}).flatMap(([key, value]): [string, string][] => {
        if (value === undefined) return [];
        return Array.isArray(value) ? value.map(item => [key, item]) : [[key, value]];
      })
    ).toString();

    // Hoisted out of the list fetch below: the board's stored view resolves
    // through the tenant layer, so both must be in hand before the filters the
    // list is fetched with are decided.
    const [displaySettings, rememberedBoardId] = await Promise.all([
      getTicketingDisplaySettings(),
      hasBoardFilterParam(searchString)
        ? Promise.resolve(null)
        : getUserPreference(user!.user_id, TICKETS_LAST_ACTIVE_BOARD_SETTING).catch(() => null),
    ]);

    const storedBoardId = typeof rememberedBoardId === 'string' ? rememberedBoardId.trim() : '';
    if (storedBoardId) {
      // A stored board that no longer exists (or is no longer readable) is
      // ignored rather than rendering a tab that cannot be there — the same
      // 'board-unavailable' rule the client resolver applied.
      const board = await findBoardById(storedBoardId).catch(() => undefined);
      if (board && !isReturnedActionError(board) && board.board_id) {
        filtersFromURL.boardIds = [board.board_id];

        if (!hasTicketViewFilterParams(searchString)) {
          const resolvedView = resolveTicketViewSettings({
            board: sanitizeStoredTicketView(board.list_view_settings),
            tenant: sanitizeStoredTicketView(displaySettings?.list),
          });
          const arrivalFilters = buildBoardArrivalFilters({
            baseline: {
              statusId: TICKET_STATUS_FILTER_OPEN,
              priorityId: 'all',
              showOpenOnly: true,
              boardFilterState: 'active',
              bundleView: 'bundled',
              searchQuery: '',
              sortBy: 'entered_at',
              sortDirection: 'desc',
            },
            boardSelection: {
              boardIds: [board.board_id],
              statusId: TICKET_STATUS_FILTER_OPEN,
              showOpenOnly: true,
            },
            viewFilters: validateCapturedFilters(
              resolvedView.filters,
              {},
              // Pseudo-filters, not ids: they must survive validation untouched.
              [TICKET_STATUS_FILTER_OPEN, 'all'],
            ),
          });
          if (!allowSlaStatusFilter) {
            delete arrivalFilters.slaStatusFilter;
          }
          Object.assign(filtersFromURL, arrivalFilters);
        }
      }
    }

    // Apply defaults for missing parameters
    const initialFilters: Partial<ITicketListFilters> = {
      boardFilterState: 'active',
      statusId: TICKET_STATUS_FILTER_OPEN,
      priorityId: 'all',
      bundleView: 'bundled',
      sortBy: filtersFromURL.sortBy ?? 'entered_at',
      sortDirection: filtersFromURL.sortDirection ?? 'desc',
      ...filtersFromURL
    };

    // Create full filter object for data fetching
    const fetchFilters: ITicketListFilters = {
      boardId: initialFilters.boardId || undefined,
      boardIds: initialFilters.boardIds || undefined,
      excludeBoardIds: initialFilters.excludeBoardIds || undefined,
      statusId: initialFilters.statusId || TICKET_STATUS_FILTER_OPEN,
      priorityId: initialFilters.priorityId || 'all',
      categoryId: initialFilters.categoryId || undefined,
      categoryIds: initialFilters.categoryIds || undefined,
      excludeCategoryIds: initialFilters.excludeCategoryIds || undefined,
      clientId: initialFilters.clientId || undefined,
      searchQuery: initialFilters.searchQuery || '',
      boardFilterState: initialFilters.boardFilterState || 'active',
      showOpenOnly: isTicketStatusOpenFilter(initialFilters.statusId),
      tags: initialFilters.tags || undefined,
      assignedToIds: initialFilters.assignedToIds || undefined,
      assignedTeamIds: initialFilters.assignedTeamIds || undefined,
      includeUnassigned: initialFilters.includeUnassigned || undefined,
      dueDateFilter: initialFilters.dueDateFilter || undefined,
      dueDateFrom: initialFilters.dueDateFrom || undefined,
      dueDateTo: initialFilters.dueDateTo || undefined,
      responseState: initialFilters.responseState || undefined,
      slaStatusFilter: initialFilters.slaStatusFilter || undefined,
      sortBy: initialFilters.sortBy || 'entered_at',
      sortDirection: initialFilters.sortDirection || 'desc',
      bundleView: initialFilters.bundleView || 'bundled'
    };

    // Fetch consolidated data for the ticket list with initial filters and pagination
    const [consolidatedData, teams, userPermissions] = await Promise.all([
      getConsolidatedTicketListData(fetchFilters, page, pageSize),
      getTeams().catch(() => []),
      getCurrentUserPermissions().catch(() => [] as string[])
    ]);

    const canUpdateTickets = userPermissions.includes('ticket:update');
    const initialTeams = isTeamActionError(teams) ? [] : teams;

    if (isReturnedActionError(consolidatedData)) {
      const message = 'permissionError' in consolidatedData
        ? consolidatedData.permissionError
        : consolidatedData.actionError;
      return <div id="tickets-error-message">{message}</div>;
    }

    return (
      <div id="tickets-page-container" className="bg-[rgb(var(--color-app-ground))]">
        <MspTicketsPageClient
          consolidatedData={consolidatedData}
          initialFormOptions={consolidatedData.options}
          currentUser={user!}
          initialFilters={initialFilters}
          initialPage={page}
          initialPageSize={pageSize}
          displaySettings={displaySettings}
          initialTeams={initialTeams}
          canUpdateTickets={canUpdateTickets}
          allowSlaStatusFilter={allowSlaStatusFilter}
          useAlgaDeskQuickAddForm={useAlgaDeskQuickAddForm}
        />
      </div>
    );
  } catch (error) {
    console.error('Error fetching user or tickets:', error);
    const { t } = await getServerTranslation(undefined, 'common');
    return <div id="tickets-error-message">{t('pages.errors.genericError')}</div>;
  }
}

export const dynamic = "force-dynamic";
