'use client';

import React, { useState, useCallback, useEffect } from 'react';
import TicketingDashboard from './TicketingDashboard';
import { fetchTicketsWithPagination } from '../actions/optimizedTicketActions';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { ITicketListItem, ITicketCategory, ITicketListFilters, ITag, ITeam } from '@alga-psa/types';
import { IClient } from '@alga-psa/types';
import { IUser } from '@alga-psa/types';
import { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { IBoard } from '@alga-psa/types';
import type { TicketingDisplaySettings } from '../actions/ticketDisplaySettings';
import { useUserPreference } from '@alga-psa/user-composition/hooks';
import { useTicketFormOptions } from '../hooks/useTicketFormOptions';

const TICKETS_PAGE_SIZE_SETTING = 'tickets_list_page_size';

export interface TicketListMetadata {
  agentAvatarUrls: Record<string, string | null>;
  teamAvatarUrls: Record<string, string | null>;
  ticketTags: Record<string, ITag[]>;
}

interface TicketingDashboardContainerProps {
  consolidatedData: {
    options: {
      statusOptions: SelectOption[];
      priorityOptions: SelectOption[];
      boardOptions: IBoard[];
      agentOptions: SelectOption[];
      categories: ITicketCategory[];
      clients: IClient[];
      users: IUser[];
      tags?: ITag[];
    };
    tickets: ITicketListItem[];
    totalCount: number;
    metadata?: TicketListMetadata;
  };
  currentUser: IUser;
  initialFilters?: Partial<ITicketListFilters>;
  initialPage?: number;
  initialPageSize?: number;
  displaySettings?: TicketingDisplaySettings;
  initialTeams?: ITeam[];
  initialFormOptions?: {
    statusOptions: SelectOption[];
    priorityOptions: SelectOption[];
    boardOptions: IBoard[];
    agentOptions: SelectOption[];
    categories: ITicketCategory[];
    clients: IClient[];
    users: IUser[];
    tags?: ITag[];
  } | null;
  canUpdateTickets?: boolean;
  renderClientDetails?: React.ComponentProps<typeof TicketingDashboard>['renderClientDetails'];
}

export default function TicketingDashboardContainer({
  consolidatedData,
  currentUser,
  initialFilters,
  initialPage = 1,
  initialPageSize = 10,
  displaySettings,
  initialTeams,
  initialFormOptions,
  canUpdateTickets,
  renderClientDetails,
}: TicketingDashboardContainerProps) {
  const defaultSortBy = initialFilters?.sortBy ?? 'entered_at';
  const defaultSortDirection = initialFilters?.sortDirection ?? 'desc';

  // Use cached form options (two-phase: sessionStorage → server)
  // initialFormOptions or consolidatedData.options populates the cache on first load
  const { options: cachedFormOptions } = useTicketFormOptions(
    initialFormOptions ?? consolidatedData.options ?? null
  );
  // Effective options: cached hook result, or fall back to server-provided consolidated data
  const effectiveOptions = cachedFormOptions ?? consolidatedData.options;

  const emptyMetadata: TicketListMetadata = { agentAvatarUrls: {}, teamAvatarUrls: {}, ticketTags: {} };
  const [isLoading, setIsLoading] = useState(false);
  const [tickets, setTickets] = useState<ITicketListItem[]>(consolidatedData.tickets);
  const [totalCount, setTotalCount] = useState<number>(consolidatedData.totalCount);
  const [ticketMetadata, setTicketMetadata] = useState<TicketListMetadata>(consolidatedData.metadata ?? emptyMetadata);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [sortBy, setSortBy] = useState<string>(defaultSortBy);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(defaultSortDirection);

  const [activeFilters, setActiveFilters] = useState<Partial<ITicketListFilters>>(() => {
    return {
      statusId: 'open',
      priorityId: 'all',
      searchQuery: '',
      boardFilterState: 'active',
      showOpenOnly: true,
      bundleView: initialFilters?.bundleView ?? 'bundled',
      boardId: undefined,
      categoryId: undefined,
      clientId: undefined,
      assignedToIds: undefined,
      assignedTeamIds: undefined,
      includeUnassigned: false,
      dueDateFilter: undefined,
      sortBy: defaultSortBy,
      sortDirection: defaultSortDirection,
      ...initialFilters,
    };
  });

  // Sync state when consolidatedData changes (e.g., from router.refresh())
  useEffect(() => {
    setTickets(consolidatedData.tickets);
    setTotalCount(consolidatedData.totalCount);
    if (consolidatedData.metadata) {
      setTicketMetadata(consolidatedData.metadata);
    }
  }, [consolidatedData.tickets, consolidatedData.totalCount, consolidatedData.metadata]);

  const {
    value: storedPageSize,
    setValue: setStoredPageSize,
    hasLoadedInitial: hasLoadedPageSizePreference
  } = useUserPreference<number>(
    TICKETS_PAGE_SIZE_SETTING,
    {
      defaultValue: initialPageSize,
      localStorageKey: TICKETS_PAGE_SIZE_SETTING,
      debounceMs: 300
    }
  );

  // Function to sync filter state and pagination to URL
  const updateURLWithFilters = useCallback((filters: Partial<ITicketListFilters>, page?: number, pageSize?: number) => {
    const params = new URLSearchParams();

    // Add pagination params
    if (page && page !== 1) params.set('page', String(page));
    if (pageSize && pageSize !== 10) params.set('pageSize', String(pageSize));

    // Only add non-default/non-empty values to URL
    if (filters.boardId) params.set('boardId', filters.boardId);
    if (filters.clientId) params.set('clientId', filters.clientId);
    if (filters.statusId && filters.statusId !== 'open') params.set('statusId', filters.statusId);
    if (filters.priorityId && filters.priorityId !== 'all') params.set('priorityId', filters.priorityId);
    if (filters.categoryId) params.set('categoryId', filters.categoryId);
    if (filters.searchQuery) params.set('searchQuery', filters.searchQuery);
    if (filters.boardFilterState && filters.boardFilterState !== 'active') {
      params.set('boardFilterState', filters.boardFilterState);
    }
    if (filters.tags && Array.isArray(filters.tags) && filters.tags.length > 0) {
      // Encode each tag to handle special characters like commas
      const encodedTags = filters.tags.map(tag => encodeURIComponent(String(tag)));
      params.set('tags', encodedTags.join(','));
    }
    if (filters.sortBy && filters.sortBy !== 'entered_at') {
      params.set('sortBy', filters.sortBy);
    }
    if (filters.sortDirection && filters.sortDirection !== 'desc') {
      params.set('sortDirection', filters.sortDirection);
    }
    if (filters.assignedToIds && Array.isArray(filters.assignedToIds) && filters.assignedToIds.length > 0) {
      params.set('assignedToIds', filters.assignedToIds.join(','));
    }
    if (filters.assignedTeamIds && Array.isArray(filters.assignedTeamIds) && filters.assignedTeamIds.length > 0) {
      params.set('assignedTeamIds', filters.assignedTeamIds.join(','));
    }
    if (filters.includeUnassigned) {
      params.set('includeUnassigned', 'true');
    }
    if (filters.dueDateFilter && filters.dueDateFilter !== 'all') {
      params.set('dueDateFilter', filters.dueDateFilter);
    }
    if (filters.dueDateFrom) {
      params.set('dueDateFrom', filters.dueDateFrom);
    }
    if (filters.dueDateTo) {
      params.set('dueDateTo', filters.dueDateTo);
    }
    if (filters.responseState && filters.responseState !== 'all') {
      params.set('responseState', filters.responseState);
    }
    if (filters.slaStatusFilter && filters.slaStatusFilter !== 'all') {
      params.set('slaStatusFilter', filters.slaStatusFilter);
    }
    if (filters.bundleView && filters.bundleView !== 'bundled') {
      params.set('bundleView', filters.bundleView);
    }

    // Update URL without triggering a server-side re-render
    const newURL = params.toString() ? `/msp/tickets?${params.toString()}` : '/msp/tickets';
    window.history.replaceState(null, '', newURL);
  }, []);

  const fetchTickets = useCallback(async (
    filters: Partial<ITicketListFilters>,
    page: number,
    pageSize: number,
    overrides?: { sortBy?: string; sortDirection?: 'asc' | 'desc' }
  ) => {
    console.log('[Container] fetchTickets called with:', { filters, page, pageSize });
    if (!currentUser) {
      toast.error('You must be logged in to perform this action');
      return;
    }
    setIsLoading(true);
    try {
      const effectiveSortBy = overrides?.sortBy ?? filters.sortBy ?? sortBy ?? 'entered_at';
      const effectiveSortDirection: 'asc' | 'desc' =
        overrides?.sortDirection ?? filters.sortDirection ?? sortDirection ?? 'desc';

      const currentFiltersWithDefaults: ITicketListFilters = {
        boardId: filters.boardId || undefined,
        statusId: filters.statusId || 'all',
        priorityId: filters.priorityId || 'all',
        categoryId: filters.categoryId || undefined,
        clientId: filters.clientId || undefined,
        searchQuery: filters.searchQuery || '',
        boardFilterState: filters.boardFilterState || 'active',
        showOpenOnly: (filters.statusId === 'open') || (filters.showOpenOnly === true),
        tags: filters.tags && filters.tags.length > 0 ? Array.from(new Set(filters.tags)) : undefined,
        assignedToIds: filters.assignedToIds && filters.assignedToIds.length > 0 ? filters.assignedToIds : undefined,
        assignedTeamIds: filters.assignedTeamIds && filters.assignedTeamIds.length > 0 ? filters.assignedTeamIds : undefined,
        includeUnassigned: filters.includeUnassigned || undefined,
        dueDateFilter: filters.dueDateFilter || undefined,
        dueDateFrom: filters.dueDateFrom || undefined,
        dueDateTo: filters.dueDateTo || undefined,
        responseState: filters.responseState || undefined,
        slaStatusFilter: filters.slaStatusFilter || undefined,
        sortBy: effectiveSortBy,
        sortDirection: effectiveSortDirection,
        bundleView: filters.bundleView || 'bundled'
      };

      console.log('[Container] Fetching with defaults:', currentFiltersWithDefaults);
      const result = await fetchTicketsWithPagination(
        currentFiltersWithDefaults,
        page,
        pageSize
      );

      console.log('[Container] Fetch completed, got tickets:', result.tickets.length);
      setTickets(result.tickets);
      setTotalCount(result.totalCount);
      if (result.metadata) {
        setTicketMetadata(result.metadata);
      }
      setActiveFilters(currentFiltersWithDefaults);
      setSortBy(effectiveSortBy);
      setSortDirection(effectiveSortDirection);

    } catch (error) {
      handleError(error, 'Failed to fetch tickets');
      setTickets([]);
      setTotalCount(0);
    } finally {
      console.log('[Container] Setting isLoading to false');
      setIsLoading(false);
    }
  }, [currentUser, sortBy, sortDirection]);

  useEffect(() => {
    if (!hasLoadedPageSizePreference) {
      return;
    }

    const normalizedPageSize = storedPageSize ?? initialPageSize;
    if (normalizedPageSize === pageSize) {
      return;
    }

    setCurrentPage(1);
    setPageSize(normalizedPageSize);
    updateURLWithFilters(activeFilters, 1, normalizedPageSize);
    void fetchTickets(activeFilters, 1, normalizedPageSize);
  }, [
    hasLoadedPageSizePreference,
    storedPageSize,
    pageSize,
    initialPageSize,
    activeFilters,
    updateURLWithFilters,
    fetchTickets
  ]);

  const handlePageChange = useCallback(async (newPage: number) => {
    setCurrentPage(newPage);
    updateURLWithFilters(activeFilters, newPage, pageSize);
    await fetchTickets(activeFilters, newPage, pageSize);
  }, [fetchTickets, activeFilters, pageSize, updateURLWithFilters]);

  const handlePageSizeChange = useCallback(async (newPageSize: number) => {
    setPageSize(newPageSize);
    setStoredPageSize(newPageSize);
    setCurrentPage(1); // Reset to page 1 when page size changes
    updateURLWithFilters(activeFilters, 1, newPageSize);
    await fetchTickets(activeFilters, 1, newPageSize);
  }, [fetchTickets, activeFilters, updateURLWithFilters, setStoredPageSize]);

  const handleFiltersChanged = useCallback(async (newFilters: Partial<ITicketListFilters>) => {
    console.log('[Container] handleFiltersChanged called with:', newFilters);
    setCurrentPage(1); // Reset to page 1 when filters change
    const mergedFilters = {
      ...newFilters,
      sortBy,
      sortDirection,
    };
    setActiveFilters(mergedFilters);
    updateURLWithFilters(mergedFilters, 1, pageSize);
    await fetchTickets(mergedFilters, 1, pageSize);
  }, [fetchTickets, pageSize, updateURLWithFilters, sortBy, sortDirection]);

  const handleSortChange = useCallback(async (columnId: string, direction: 'asc' | 'desc') => {
    const updatedFilters = {
      ...activeFilters,
      sortBy: columnId,
      sortDirection: direction,
    };
    setActiveFilters(updatedFilters);
    setSortBy(columnId);
    setSortDirection(direction);
    setCurrentPage(1);
    updateURLWithFilters(updatedFilters, 1, pageSize);
    await fetchTickets(updatedFilters, 1, pageSize, { sortBy: columnId, sortDirection: direction });
  }, [activeFilters, fetchTickets, pageSize, updateURLWithFilters]);

  const mappedAndFilteredBoards = effectiveOptions.boardOptions.map(board => ({
    ...board,
    board_id: board.board_id || '',
    board_name: board.board_name || 'Unnamed Board',
    tenant: board.tenant || currentUser.tenant || '',
    is_inactive: board.is_inactive || false,
  })).filter(board => board.board_id !== '');

  const initialBoardsForDashboard: Array<IBoard & { board_id: string; board_name: string; tenant: string; is_inactive: boolean }> = mappedAndFilteredBoards;

  return (
    <TicketingDashboard
      id="ticketing-dashboard"
      initialTickets={tickets}
      initialBoards={initialBoardsForDashboard}
      initialStatuses={effectiveOptions.statusOptions}
      initialPriorities={effectiveOptions.priorityOptions}
      initialCategories={effectiveOptions.categories}
      initialClients={effectiveOptions.clients}
      initialTags={effectiveOptions.tags || []}
      initialUsers={effectiveOptions.users}
      totalCount={totalCount}
      currentPage={currentPage}
      pageSize={pageSize}
      onPageChange={handlePageChange}
      onPageSizeChange={handlePageSizeChange}
      onFiltersChanged={handleFiltersChanged}
      initialFilterValues={activeFilters}
      isLoadingMore={isLoading}
      user={currentUser}
      displaySettings={displaySettings}
      sortBy={sortBy}
      sortDirection={sortDirection}
      onSortChange={handleSortChange}
      renderClientDetails={renderClientDetails}
      initialAgentAvatarUrls={ticketMetadata.agentAvatarUrls}
      initialTeamAvatarUrls={ticketMetadata.teamAvatarUrls}
      initialTicketTags={ticketMetadata.ticketTags}
      initialTeams={initialTeams}
      canUpdateTickets={canUpdateTickets}
    />
  );
}
