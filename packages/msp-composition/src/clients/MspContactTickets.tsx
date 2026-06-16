'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ITicketListItem, ITicketCategory, ITicketListFilters } from '@alga-psa/types';
import { IBoard, IUser } from '@alga-psa/types';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { BoardPicker } from '@alga-psa/ui/components/settings/general/BoardPicker';
import CategoryPicker from '@alga-psa/tickets/components/CategoryPicker';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { getTicketsForListWithCursor } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { XCircle } from 'lucide-react';
import { useDrawer } from "@alga-psa/ui";
import TicketDetails from '@alga-psa/tickets/components/ticket/TicketDetails';
import { getConsolidatedTicketData } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { useRouter } from 'next/navigation';
import { buildCreateTicketHref } from '@alga-psa/tickets/lib/createTicketRoute';
import { createTicketColumns } from '@alga-psa/tickets/lib';
import { getTicketingDisplaySettings, type TicketingDisplaySettings } from '@alga-psa/tickets/actions/ticketDisplaySettings';
import { ITag } from '@alga-psa/types';
import { findTagsByEntityIds } from '@alga-psa/tags/actions';
import { useTagPermissions } from '@alga-psa/tags/hooks';
import ClientQuickView from '@alga-psa/clients/components/clients/ClientQuickView';
import { getClientById } from '@alga-psa/clients/actions';
import { TagFilter } from '@alga-psa/ui/components';
import MultiUserPicker from '@alga-psa/ui/components/MultiUserPicker';
import { MspClientCrossFeatureProvider } from './MspClientCrossFeatureProvider';
import {
  isTicketStatusOpenFilter,
  TICKET_STATUS_FILTER_OPEN,
} from '@alga-psa/tickets/lib';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ContactTicketsProps {
  contactId: string;
  contactName?: string;
  clientId?: string;
  clientName?: string;
  initialBoards?: IBoard[];
  initialStatuses?: SelectOption[];
  initialPriorities?: SelectOption[];
  initialCategories?: ITicketCategory[];
  initialTags?: ITag[];
  initialUsers?: IUser[];
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

const MspContactTickets: React.FC<ContactTicketsProps> = ({
  contactId,
  contactName = '',
  clientId = '',
  clientName = '',
  initialBoards = [],
  initialStatuses = [],
  initialPriorities = [],
  initialCategories = [],
  initialTags = [],
  initialUsers = []
}) => {
  const { t } = useTranslation('msp/contacts');
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
        contactId: contactId, // Filter by contact instead of client
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
  }, [contactId, currentUser, selectedBoard, selectedStatus, selectedPriority, selectedCategories, debouncedSearchQuery, boardFilterState, selectedTags, selectedAssignees, includeUnassigned]);

  // Load tickets when filters change
  useEffect(() => {
    loadTickets(undefined, true);
  }, [loadTickets]);

  const handleTicketClick = useCallback(async (ticketId: string) => {
    if (!currentUser) {
      toast.error(t('contactTabs.tickets.toasts.userNotAuthenticated', { defaultValue: 'User not authenticated' }));
      return;
    }

    try {
      const ticketData = await getConsolidatedTicketData(ticketId);

      if (!ticketData) {
        toast.error(t('contactTabs.tickets.toasts.loadTicketFailed', { defaultValue: 'Failed to load ticket' }));
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
      handleError(error, t('contactTabs.tickets.toasts.openTicketFailed', { defaultValue: 'Failed to open ticket' }));
    }
  }, [currentUser, openDrawer]);

  const handleTagsChange = useCallback((ticketId: string, tags: ITag[]) => {
    ticketTagsRef.current[ticketId] = tags;
  }, []);

  const handleClientClick = useCallback(async (clickedClientId: string) => {
    try {
      const client = await getClientById(clickedClientId);
      if (client) {
        openDrawer(
          <MspClientCrossFeatureProvider>
            <ClientQuickView
              client={client}
              isInDrawer={true}
              quickView={true}
            />
          </MspClientCrossFeatureProvider>
        );
      } else {
        toast.error(t('contactTabs.tickets.toasts.clientNotFound', { defaultValue: 'Client not found' }));
      }
    } catch (error) {
      handleError(error, t('contactTabs.tickets.toasts.loadClientFailed', { defaultValue: 'Failed to load client details' }));
    }
  }, [openDrawer]);

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

  const columns = useMemo(() =>
    createTicketColumns({
      categories: initialCategories,
      boards: initialBoards,
      displaySettings: displaySettings || undefined,
      onTicketClick: handleTicketClick,
      ticketTagsRef,
      onTagsChange: handleTagsChange,
      showClient: true, // Show client column in contact view
      onClientClick: handleClientClick,
    }), [initialCategories, initialBoards, displaySettings, handleTicketClick, handleTagsChange, handleClientClick]);

  const handleCategorySelect = (
    selectedCategories: string[],
    excludedCategories: string[]
  ) => {
    setSelectedCategories(selectedCategories);
    setExcludedCategories(excludedCategories);
  };

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

  const resetFilters = () => {
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
  };

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

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-32">
        <span>{t('contactTabs.tickets.loading', { defaultValue: 'Loading...' })}</span>
      </div>
    );
  }

  return (
    <ReflectionContainer id="contact-tickets" label="Contact Tickets">
      <div className="bg-white shadow rounded-lg">
        {/* Sticky Header and Filters */}
        <div className="sticky top-0 z-40 bg-white rounded-t-lg p-6 border-b border-gray-100">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900">{t('contactTabs.tickets.title', { defaultValue: 'Contact Tickets' })}</h3>
            <Button
              id="add-contact-ticket-btn"
              onClick={() => router.push(buildCreateTicketHref({ client: { id: clientId, name: clientName }, contact: { id: contactId, name: contactName } }))}
              className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] transition-colors"
            >
              {t('contactTabs.tickets.addTicket', { defaultValue: 'Add Ticket' })}
            </Button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-4">
            {initialBoards.length > 0 && (
              <BoardPicker
                id="contact-tickets-board-picker"
                boards={initialBoards}
                selectedBoardId={selectedBoard}
                onSelect={(boardId) => setSelectedBoard(boardId)}
                filterState={boardFilterState}
                onFilterStateChange={setBoardFilterState}
              />
            )}

            {initialStatuses.length > 0 && (
              <CustomSelect
                id="contact-tickets-status-select"
                options={initialStatuses}
                value={selectedStatus}
                onValueChange={(value) => setSelectedStatus(value)}
                placeholder={t('contactTabs.tickets.filters.statusPlaceholder', { defaultValue: 'Select Status' })}
              />
            )}

            {initialPriorities.length > 0 && (
              <CustomSelect
                id="contact-tickets-priority-select"
                options={initialPriorities}
                value={selectedPriority}
                onValueChange={(value) => setSelectedPriority(value)}
                placeholder={t('contactTabs.tickets.filters.allPriorities', { defaultValue: 'All Priorities' })}
              />
            )}

            {initialUsers.length > 0 && (
              <MultiUserPicker
                id="contact-tickets-assignee-filter"
                users={initialUsers}
                values={selectedAssignees}
                onValuesChange={setSelectedAssignees}
                filterMode={true}
                includeUnassigned={includeUnassigned}
                onUnassignedChange={setIncludeUnassigned}
                placeholder={t('contactTabs.tickets.filters.allAssignees', { defaultValue: 'All Assignees' })}
                showSearch={true}
                compactDisplay={true}
              />
            )}

            <div className="h-6 w-px bg-gray-200 mx-1 shrink-0" />

            {initialCategories.length > 0 && (
              <CategoryPicker
                id="contact-tickets-category-picker"
                categories={initialCategories}
                selectedCategories={selectedCategories}
                excludedCategories={excludedCategories}
                onSelect={handleCategorySelect}
                placeholder={t('contactTabs.tickets.filters.categoryPlaceholder', { defaultValue: 'Filter by category' })}
                multiSelect={true}
                showExclude={true}
                showReset={true}
                allowEmpty={true}
                className="text-sm min-w-[200px]"
              />
            )}

            <div className="h-6 w-px bg-gray-200 mx-1 shrink-0" />

            <Input
              id="contact-tickets-search-input"
              placeholder={t('contactTabs.tickets.filters.searchPlaceholder', { defaultValue: 'Search tickets...' })}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-[38px] min-w-[350px] text-sm"
              containerClassName=""
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
                onClick={resetFilters}
                className={`shrink-0 flex items-center gap-1 ${isFiltered ? 'text-gray-500 hover:text-gray-700' : 'invisible'}`}
                disabled={!isFiltered}
                id="contact-tickets-reset-filters-btn"
              >
                <XCircle className="h-4 w-4" />
                {t('contactTabs.tickets.filters.reset', { defaultValue: 'Reset' })}
              </Button>
          </div>
        </div>

        {/* Tickets Table */}
        <div className="p-6">
          {isLoading && tickets.length === 0 ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-gray-200 rounded w-full animate-pulse"></div>
              ))}
            </div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-lg">
              <p className="text-gray-600 mb-4">{t('contactTabs.tickets.empty', { defaultValue: 'No tickets found for this contact' })}</p>
            </div>
          ) : (
            <>
              <DataTable
                id="contact-tickets-table"
                data={(() => {
                  // Filter tickets by selected tags
                  const filteredTickets = selectedTags.length === 0
                    ? tickets
                    : tickets.filter(ticket => {
                        if (!ticket.ticket_id) return false;
                        const ticketTags = ticketTagsRef.current[ticket.ticket_id] || [];
                        const ticketTagTexts = ticketTags.map(tag => tag.tag_text);
                        return selectedTags.some(selectedTag => ticketTagTexts.includes(selectedTag));
                      });

                  return filteredTickets.map(ticket => ({ ...ticket, id: ticket.ticket_id }));
                })()}
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
                    id="contact-tickets-load-more-btn"
                    onClick={() => loadTickets(nextCursor)}
                    disabled={isLoading}
                    variant="outline"
                  >
                    {isLoading ? t('contactTabs.tickets.loadMore.loading', { defaultValue: 'Loading...' }) : t('contactTabs.tickets.loadMore.label', { defaultValue: 'Load More Tickets' })}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

      </div>
    </ReflectionContainer>
  );
};

export default MspContactTickets;
