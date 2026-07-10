'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ITicketListItem, ITicketCategory, ITicketListFilters } from '@alga-psa/types';
import { IBoard, IUser } from '@alga-psa/types';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { getCurrentUser } from '@alga-psa/user-composition/actions/userQueryActions';
import { BoardPicker } from '@alga-psa/ui/components/settings/general/BoardPicker';
import CategoryPicker from '@alga-psa/tickets/components/CategoryPicker';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { getTicketsForListWithCursor } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { XCircle } from 'lucide-react';
import { useDrawer } from "@alga-psa/ui";
import TicketDetails from '@alga-psa/tickets/components/ticket/TicketDetails';
import { getConsolidatedTicketData } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { toast } from 'react-hot-toast';
import {
  getErrorMessage,
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useRouter } from 'next/navigation';
import { buildCreateTicketHref } from '@alga-psa/tickets/lib/createTicketRoute';
import { createTicketColumns } from '@alga-psa/tickets/lib';
import { getTicketingDisplaySettings, type TicketingDisplaySettings } from '@alga-psa/tickets/actions/ticketDisplaySettings';
import { ITag } from '@alga-psa/types';
import { findTagsByEntityIds } from '@alga-psa/tags/actions/tagActions';
import { isTagActionError } from '@alga-psa/tags/actions/tagActionErrors';
import { useTagPermissions } from '@alga-psa/tags/hooks';
import { TagFilter } from '@alga-psa/ui/components';
import MultiUserPicker from '@alga-psa/ui/components/MultiUserPicker';
import {
  isTicketStatusOpenFilter,
  TICKET_STATUS_FILTER_OPEN,
} from '@alga-psa/tickets/lib';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ClientTicketsProps {
  clientId: string;
  clientName?: string;
  initialBoards?: IBoard[];
  initialStatuses?: SelectOption[];
  initialPriorities?: SelectOption[];
  initialCategories?: ITicketCategory[];
  initialTags?: ITag[];
  initialUsers?: IUser[];
}

function isReturnedActionError(value: unknown): value is { actionError: string } | { permissionError: string } {
  return isActionMessageError(value) || isActionPermissionError(value);
}

const useDebounce = <T,>(value: T, delay: number): T => {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
};

const MspClientTickets: React.FC<ClientTicketsProps> = ({
  clientId,
  clientName = '',
  initialBoards = [],
  initialStatuses = [],
  initialPriorities = [],
  initialCategories = [],
  initialTags = [],
  initialUsers = []
}) => {
  const { t } = useTranslation('msp/clients');
  const router = useRouter();
  const [tickets, setTickets] = useState<ITicketListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<IUser | null>(null);
  const [displaySettings, setDisplaySettings] = useState<TicketingDisplaySettings | null>(null);
  const ticketTagsRef = useRef<Record<string, ITag[]>>({});

  const { openDrawer } = useDrawer();

  // Filter states
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>(TICKET_STATUS_FILTER_OPEN);
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [excludedCategories, setExcludedCategories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [boardFilterState, setBoardFilterState] = useState<'active' | 'inactive' | 'all'>('active');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [allUniqueTags, setAllUniqueTags] = useState<ITag[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [includeUnassigned, setIncludeUnassigned] = useState<boolean>(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  const debouncedSearchQuery = useDebounce(searchQuery, 500);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedBoard, selectedStatus, selectedPriority, selectedCategories, debouncedSearchQuery, boardFilterState, selectedTags, selectedAssignees, includeUnassigned]);

  // Pre-fetch tag permissions
  useTagPermissions(['ticket']);

  // Initialize user and settings
  useEffect(() => {
    const fetchUserAndSettings = async () => {
      try {
        const [user, settings] = await Promise.all([
          getCurrentUser(),
          getTicketingDisplaySettings()
        ]);
        setCurrentUser(user);
        setDisplaySettings(settings);
      } catch (error) {
        console.error('Error fetching user or settings:', error);
      }
    };
    fetchUserAndSettings();
  }, []);

  // Load tickets when filters change
  const loadTickets = useCallback(async (cursor?: string, resetTickets = false) => {
    if (!currentUser) return;

    try {
      setIsLoading(true);

      const filters: ITicketListFilters = {
        clientId: clientId,
        boardId: selectedBoard || undefined,
        statusId: selectedStatus,
        priorityId: selectedPriority,
        categoryId: selectedCategories.length > 0 ? selectedCategories[0] : undefined,
        searchQuery: debouncedSearchQuery,
        boardFilterState: boardFilterState,
        showOpenOnly: isTicketStatusOpenFilter(selectedStatus),
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        assignedToIds: selectedAssignees.length > 0 ? selectedAssignees : undefined,
        includeUnassigned: includeUnassigned,
      };

      const result = await getTicketsForListWithCursor(filters, cursor);
      if (isReturnedActionError(result)) {
        handleError(getErrorMessage(result));
        if (resetTickets) {
          setTickets([]);
        }
        setNextCursor(null);
        return;
      }

      if (resetTickets) {
        setTickets(result.tickets);
      } else {
        setTickets(prev => [...prev, ...result.tickets]);
      }

      setNextCursor(result.nextCursor);
    } catch (error) {
      console.error('Error loading tickets:', error);
    } finally {
      setIsLoading(false);
    }
  }, [clientId, currentUser, selectedBoard, selectedStatus, selectedPriority, selectedCategories, debouncedSearchQuery, boardFilterState, selectedTags, selectedAssignees, includeUnassigned]);

  // Load tickets when filters change
  useEffect(() => {
    loadTickets(undefined, true);
  }, [loadTickets]);

  const handleTicketClick = useCallback(async (ticketId: string) => {
    if (!currentUser) {
      toast.error(t('clientTabs.tickets.toasts.userNotAuthenticated', { defaultValue: 'User not authenticated' }));
      return;
    }

    try {
      const ticketData = await getConsolidatedTicketData(ticketId);

      if (!ticketData) {
        toast.error(t('clientTabs.tickets.toasts.loadTicketFailed', { defaultValue: 'Failed to load ticket' }));
        return;
      }

      openDrawer(
        <TicketDetails
          isInDrawer={true}
          initialTicket={ticketData.ticket}
          initialComments={ticketData.comments}
          initialBoard={ticketData.board}
          initialClient={ticketData.client}
          initialContacts={ticketData.contacts}
          initialContactInfo={ticketData.contactInfo}
          initialCreatedByUser={ticketData.createdByUser}
          initialAdditionalAgents={ticketData.additionalAgents}
          initialAvailableAgents={ticketData.availableAgents}
          initialUserMap={ticketData.userMap}
          statusOptions={ticketData.options.status}
          agentOptions={ticketData.options.agent}
          boardOptions={ticketData.options.board}
          priorityOptions={ticketData.options.priority}
          initialCategories={ticketData.categories}
          initialClients={ticketData.clients}
          initialLocations={ticketData.locations}
          currentUser={currentUser}
        />
      );
    } catch (error) {
      handleError(error, t('clientTabs.tickets.toasts.openTicketFailed', { defaultValue: 'Failed to open ticket' }));
    }
  }, [currentUser, openDrawer]);

  const handleTagsChange = useCallback((ticketId: string, tags: ITag[]) => {
    ticketTagsRef.current[ticketId] = tags;
  }, []);

  // Initialize available tags from props (only once)
  const tagsInitializedRef = useRef(false);
  useEffect(() => {
    if (!tagsInitializedRef.current && initialTags.length > 0) {
      setAllUniqueTags(initialTags);
      tagsInitializedRef.current = true;
    }
  }, [initialTags]);

  // Fetch tags for tickets
  useEffect(() => {
    const fetchTags = async () => {
      if (tickets.length === 0) return;

      try {
        const ticketIds = tickets.map(t => t.ticket_id).filter(Boolean) as string[];
        const tags = await findTagsByEntityIds(ticketIds, 'ticket');
        if (isTagActionError(tags)) {
          console.error('Error fetching tags:', tags);
          return;
        }

        const newTicketTags: Record<string, ITag[]> = {};
        tags.forEach(tag => {
          if (!newTicketTags[tag.tagged_id]) {
            newTicketTags[tag.tagged_id] = [];
          }
          newTicketTags[tag.tagged_id].push(tag);
        });

        ticketTagsRef.current = newTicketTags;
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };
    fetchTags();
  }, [tickets]);


  // Dispatcher preset for the client context: the drawer is narrower than the
  // full tickets screen, and the auto-fit hides trailing columns — so this
  // list keeps the triage set (number/title/status/priority/SLA/assignee/due)
  // and drops board/category/created/created-by, which stay available on the
  // main tickets screen. Explicit widths keep the whole set admitted at
  // drawer width (computeColumnFit prioritizes width-bearing columns) and
  // stop Title's 320px natural width from crowding out assignee and due date.
  const clientDisplaySettings = useMemo(() => displaySettings ? ({
    ...displaySettings,
    list: {
      ...displaySettings.list,
      columnVisibility: {
        ...displaySettings.list?.columnVisibility,
        sla: true,
        board: false,
        category: false,
        created: false,
        created_by: false,
      },
    },
  }) : undefined, [displaySettings]);

  // SLA deliberately carries no width: width-bearing columns are admitted
  // first, so when space runs out SLA yields before assignee and due date —
  // the two facts a dispatcher can't triage without.
  const CLIENT_LIST_COLUMN_WIDTHS: Record<string, string> = {
    ticket_number: '100px',
    title: '220px',
    status_name: '110px',
    priority_name: '110px',
    assigned_to_name: '140px',
    due_date: '120px',
  };

  const columns = useMemo(() =>
    createTicketColumns({
      categories: initialCategories,
      boards: initialBoards,
      displaySettings: clientDisplaySettings,
      onTicketClick: handleTicketClick,
      ticketTagsRef,
      onTagsChange: handleTagsChange,
      showClient: false, // Don't show client column since we're already on client page
    }).map((column) => {
      const columnId = Array.isArray(column.dataIndex) ? column.dataIndex.join('_') : column.dataIndex;
      // Every shared ticket column declares a percent width, which makes them
      // all equal priority — so SLA's width is stripped (not just left alone)
      // to actually demote it below assignee/due date.
      if (columnId === 'sla_policy_id') {
        return { ...column, width: undefined };
      }
      const width = CLIENT_LIST_COLUMN_WIDTHS[columnId];
      return width ? { ...column, width } : column;
    }), [initialCategories, initialBoards, clientDisplaySettings, handleTicketClick, handleTagsChange]);

  // Filter tickets by selected tags
  const filteredTickets = useMemo(() => {
    if (selectedTags.length === 0) return tickets;

    return tickets.filter(ticket => {
      if (!ticket.ticket_id) return false;
      const ticketTags = ticketTagsRef.current[ticket.ticket_id] || [];
      const ticketTagTexts = ticketTags.map(tag => tag.tag_text);

      // Check if ticket has any of the selected tags
      return selectedTags.some(selectedTag => ticketTagTexts.includes(selectedTag));
    });
  }, [tickets, selectedTags]);

  const ticketsWithIds = useMemo(() =>
    filteredTickets.map((ticket): any => ({
      ...ticket,
      id: ticket.ticket_id
    })), [filteredTickets]);

  const isFiltered = useMemo(() => {
    return selectedBoard !== null ||
      selectedStatus !== TICKET_STATUS_FILTER_OPEN ||
      selectedPriority !== 'all' ||
      selectedCategories.length > 0 ||
      excludedCategories.length > 0 ||
      searchQuery !== '' ||
      selectedTags.length > 0 ||
      selectedAssignees.length > 0 ||
      includeUnassigned;
  }, [selectedBoard, selectedStatus, selectedPriority, selectedCategories, excludedCategories, searchQuery, selectedTags, selectedAssignees, includeUnassigned]);

  const handleResetFilters = useCallback(() => {
    setSelectedBoard(null);
    setSelectedStatus(TICKET_STATUS_FILTER_OPEN);
    setSelectedPriority('all');
    setSelectedCategories([]);
    setExcludedCategories([]);
    setSearchQuery('');
    setBoardFilterState('active');
    setSelectedTags([]);
    setSelectedAssignees([]);
    setIncludeUnassigned(false);
  }, []);

  const handleCategorySelect = useCallback((newSelectedCategories: string[], newExcludedCategories: string[]) => {
    setSelectedCategories(newSelectedCategories);
    setExcludedCategories(newExcludedCategories);
  }, []);

  // Tickets are created via the create-ticket modal route now. This list fetches
  // client-side, so it won't react to router.refresh(); reload it on the cross-feature
  // "created" event (mirrored in CreateTicketRouteClient).
  useEffect(() => {
    const onCreated = (event: Event) => {
      const detail = (event as CustomEvent<{ entity?: string }>).detail;
      if (detail?.entity === 'ticket') {
        loadTickets(undefined, true);
      }
    };
    window.addEventListener('alga:quick-create:created', onCreated);
    return () => window.removeEventListener('alga:quick-create:created', onCreated);
  }, [loadTickets]);

  const handleLoadMore = () => {
    if (nextCursor) {
      loadTickets(nextCursor, false);
    }
  };

  if (isLoading && tickets.length === 0) {
    return (
      <div className="flex justify-center items-center h-32">
        <span>{t('clientTabs.tickets.loading', { defaultValue: 'Loading tickets...' })}</span>
      </div>
    );
  }

  return (
    <div className="bg-white shadow rounded-lg">
      {/* Sticky Header and Filters */}
      <div className="sticky top-0 z-40 bg-white rounded-t-lg p-6 border-b border-gray-100">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900">{t('clientTabs.tickets.title', { defaultValue: 'Tickets' })}</h3>
          <Button
            id="add-client-ticket-btn"
            onClick={() => router.push(buildCreateTicketHref({ client: { id: clientId, name: clientName } }))}
            className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] transition-colors"
          >
            {t('clientTabs.tickets.addTicket', { defaultValue: 'Add Ticket' })}
          </Button>
        </div>

        {/* Filters */}
        {/* Wraps instead of overflowing — this toolbar renders inside the
            focus drawer, not just the full-page tickets screen. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {initialBoards.length > 0 && (
            <BoardPicker
              id="client-tickets-board-picker"
              boards={initialBoards}
              onSelect={(boardId) => setSelectedBoard(boardId)}
              selectedBoardId={selectedBoard}
              filterState={boardFilterState}
              onFilterStateChange={setBoardFilterState}
              placeholder="Select board"
            />
          )}

          {initialStatuses.length > 0 && (
            <CustomSelect
              data-automation-id="client-tickets-status-select"
              options={initialStatuses}
              value={selectedStatus}
              onValueChange={(value) => setSelectedStatus(value)}
              placeholder={t('clientTabs.tickets.filters.statusPlaceholder', { defaultValue: 'Select status' })}
            />
          )}

          {initialPriorities.length > 0 && (
            <CustomSelect
              data-automation-id="client-tickets-priority-select"
              options={initialPriorities}
              value={selectedPriority}
              onValueChange={(value) => setSelectedPriority(value)}
              placeholder={t('clientTabs.tickets.filters.allPriorities', { defaultValue: 'All priorities' })}
            />
          )}

          {initialUsers.length > 0 && (
            <MultiUserPicker
              id="client-tickets-assignee-filter"
              users={initialUsers}
              values={selectedAssignees}
              onValuesChange={setSelectedAssignees}
              filterMode={true}
              includeUnassigned={includeUnassigned}
              onUnassignedChange={setIncludeUnassigned}
              placeholder={t('clientTabs.tickets.filters.allAssignees', { defaultValue: 'All assignees' })}
              showSearch={true}
              compactDisplay={true}
            />
          )}

          <div className="h-6 w-px bg-gray-200 mx-1 shrink-0" />

          {initialCategories.length > 0 && (
            <CategoryPicker
              id="client-tickets-category-picker"
              categories={initialCategories}
              selectedCategories={selectedCategories}
              excludedCategories={excludedCategories}
              onSelect={handleCategorySelect}
              placeholder={t('clientTabs.tickets.filters.categoryPlaceholder', { defaultValue: 'All categories' })}
              multiSelect={true}
              showExclude={true}
              showReset={true}
              allowEmpty={true}
              className="text-sm min-w-[200px]"
            />
          )}

          <div className="h-6 w-px bg-gray-200 mx-1 shrink-0" />

          <Input
            id="client-tickets-search-input"
            placeholder={t('clientTabs.tickets.filters.searchPlaceholder', { defaultValue: 'Search tickets...' })}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-[38px] min-w-[220px] text-sm"
            containerClassName="flex-1 min-w-[220px] max-w-[350px]"
          />

          {allUniqueTags.length > 0 && (
            <TagFilter
              tags={allUniqueTags}
              selectedTags={selectedTags}
              onToggleTag={(tag: string) => {
                setSelectedTags(prev =>
                  prev.includes(tag)
                    ? prev.filter(t => t !== tag)
                    : [...prev, tag]
                );
              }}
              onClearTags={() => setSelectedTags([])}
            />
          )}

            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetFilters}
              className={`shrink-0 flex items-center gap-1 ${isFiltered ? 'text-gray-500 hover:text-gray-700' : 'invisible'}`}
              disabled={!isFiltered}
              id="client-tickets-reset-filters-btn"
            >
              <XCircle className="h-4 w-4" />
              {t('clientTabs.tickets.filters.reset', { defaultValue: 'Reset' })}
            </Button>
        </div>
      </div>

      {/* Tickets Table */}
      <div className="p-6">
        <DataTable
          id="client-tickets-table"
          data={ticketsWithIds}
          columns={columns}
          pagination={true}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          pageSize={pageSize}
          onItemsPerPageChange={handlePageSizeChange}
        />

        {/* Load More Button */}
        {nextCursor && (
          <div className="flex justify-center mt-4">
            <Button
              id="client-tickets-load-more-btn"
              onClick={handleLoadMore}
              disabled={isLoading}
              variant="outline"
            >
              {isLoading ? t('clientTabs.tickets.loadMore.loading', { defaultValue: 'Loading...' }) : t('clientTabs.tickets.loadMore.label', { defaultValue: 'Load More Tickets' })}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MspClientTickets;
