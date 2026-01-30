'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ITicketListItem, ITicketCategory, ITicketListFilters } from '@alga-psa/types';
import { IBoard, IUser } from '@alga-psa/types';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { getCurrentUserAsync } from '../../lib/usersHelpers';
import { BoardPicker } from '@alga-psa/ui/components/settings/general/BoardPicker';
import CategoryPicker from '@alga-psa/tickets/components/CategoryPicker';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { getTicketsForListWithCursor } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { deleteTicket } from '@alga-psa/tickets/actions/ticketActions';
import { XCircle } from 'lucide-react';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useDrawer } from "@alga-psa/ui";
import TicketDetails from '@alga-psa/tickets/components/ticket/TicketDetails';
import { getConsolidatedTicketData } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { toast } from 'react-hot-toast';
import { QuickAddTicket } from '@alga-psa/tickets/components/QuickAddTicket';
import { createTicketColumns } from '@alga-psa/tickets/lib';
import { getTicketingDisplaySettings, type TicketingDisplaySettings } from '@alga-psa/tickets/actions/ticketDisplaySettings';
import { ITag } from '@alga-psa/types';
import { findTagsByEntityIds } from '@alga-psa/tags/actions';
import { useTagPermissions } from '@alga-psa/tags/hooks';
import { TagFilter } from '@alga-psa/ui/components';
import MultiUserPicker from '@alga-psa/ui/components/MultiUserPicker';

interface ClientTicketsProps {
  clientId: string;
  clientName?: string;
  initialBoards?: IBoard[];
  initialStatuses?: SelectOption[];
  initialPriorities?: SelectOption[];
  initialCategories?: ITicketCategory[];
  initialTags?: string[];
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

const ClientTickets: React.FC<ClientTicketsProps> = ({
  clientId,
  clientName = '',
  initialBoards = [],
  initialStatuses = [],
  initialPriorities = [],
  initialCategories = [],
  initialTags = [],
  initialUsers = []
}) => {
  const [tickets, setTickets] = useState<ITicketListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<IUser | null>(null);
  const [displaySettings, setDisplaySettings] = useState<TicketingDisplaySettings | null>(null);
  const ticketTagsRef = useRef<Record<string, ITag[]>>({});
  const [ticketToDelete, setTicketToDelete] = useState<string | null>(null);
  const [ticketToDeleteName, setTicketToDeleteName] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isQuickAddTicketOpen, setIsQuickAddTicketOpen] = useState(false);
  
  const { openDrawer } = useDrawer();

  // Filter states
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>('open');
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

  // Pre-fetch tag permissions
  useTagPermissions(['ticket']);

  // Initialize user and settings
  useEffect(() => {
    const fetchUserAndSettings = async () => {
      try {
        const [user, settings] = await Promise.all([
          getCurrentUserAsync(),
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
        showOpenOnly: selectedStatus === 'open',
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
  }, [clientId, currentUser, selectedBoard, selectedStatus, selectedPriority, selectedCategories, debouncedSearchQuery, boardFilterState, selectedTags, selectedAssignees, includeUnassigned]);

  // Load tickets when filters change
  useEffect(() => {
    loadTickets(undefined, true);
  }, [loadTickets]);

  const handleDeleteTicket = (ticketId: string, ticketNameOrNumber: string) => {
    setTicketToDelete(ticketId);
    setTicketToDeleteName(ticketNameOrNumber);
    setDeleteError(null);
  };

  const confirmDeleteTicket = async () => {
    if (!ticketToDelete || !currentUser) return;

    try {
      await deleteTicket(ticketToDelete);
      setTickets(prev => prev.filter(t => t.ticket_id !== ticketToDelete));
      setTicketToDelete(null);
      setTicketToDeleteName(null);
      setDeleteError(null);
    } catch (error: any) {
      console.error('Failed to delete ticket:', error);
      if (error.message && error.message.startsWith('VALIDATION_ERROR:')) {
        setDeleteError(error.message.replace('VALIDATION_ERROR: ', ''));
      } else {
        setDeleteError('An unexpected error occurred while deleting the ticket.');
      }
    }
  };

  const handleTicketClick = useCallback(async (ticketId: string) => {
    if (!currentUser) {
      toast.error('User not authenticated');
      return;
    }

    try {
      const ticketData = await getConsolidatedTicketData(ticketId);
      
      if (!ticketData) {
        toast.error('Failed to load ticket');
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
      console.error('Error opening ticket:', error);
      toast.error('Failed to open ticket');
    }
  }, [currentUser, openDrawer]);

  const handleTagsChange = useCallback((ticketId: string, tags: ITag[]) => {
    ticketTagsRef.current[ticketId] = tags;
  }, []);

  // Initialize available tags from props (only once)
  const tagsInitializedRef = useRef(false);
  useEffect(() => {
    if (!tagsInitializedRef.current && initialTags.length > 0) {
      const uniqueTags = initialTags.map((tagText, index) => ({
        tag_id: `temp-${index}`,
        tag_text: tagText,
        tagged_type: 'ticket' as const,
        tagged_id: '',
        tenant: '',
        created_at: new Date(),
        updated_at: new Date()
      }));
      setAllUniqueTags(uniqueTags);
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
      onDeleteClick: handleDeleteTicket,
      ticketTagsRef,
      onTagsChange: handleTagsChange,
      showClient: false, // Don't show client column since we're already on client page
    }), [initialCategories, initialBoards, displaySettings, handleTicketClick, handleDeleteTicket, handleTagsChange]);

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

  const handleResetFilters = useCallback(() => {
    setSelectedBoard(null);
    setSelectedStatus('open');
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

  const handleTicketAdded = useCallback(() => {
    // Refresh the tickets list
    loadTickets(undefined, true);
    setIsQuickAddTicketOpen(false);
  }, [loadTickets]);

  const handleLoadMore = () => {
    if (nextCursor) {
      loadTickets(nextCursor, false);
    }
  };

  if (isLoading && tickets.length === 0) {
    return (
      <div className="flex justify-center items-center h-32">
        <span>Loading tickets...</span>
      </div>
    );
  }

  return (
    <div className="bg-white shadow rounded-lg">
      {/* Sticky Header and Filters */}
      <div className="sticky top-0 z-40 bg-white rounded-t-lg p-6 border-b border-gray-100">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Client Tickets</h3>
          <Button
            id="add-client-ticket-btn"
            onClick={() => setIsQuickAddTicketOpen(true)}
            className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] transition-colors"
          >
            Add Ticket
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
          {initialBoards.length > 0 && (
            <BoardPicker
              id="client-tickets-board-picker"
              boards={initialBoards}
              onSelect={(boardId) => setSelectedBoard(boardId)}
              selectedBoardId={selectedBoard}
              filterState={boardFilterState}
              onFilterStateChange={setBoardFilterState}
            />
          )}

          {initialStatuses.length > 0 && (
            <CustomSelect
              data-automation-id="client-tickets-status-select"
              options={initialStatuses}
              value={selectedStatus}
              onValueChange={(value) => setSelectedStatus(value)}
              placeholder="Select Status"
            />
          )}

          {initialPriorities.length > 0 && (
            <CustomSelect
              data-automation-id="client-tickets-priority-select"
              options={initialPriorities}
              value={selectedPriority}
              onValueChange={(value) => setSelectedPriority(value)}
              placeholder="All Priorities"
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
              placeholder="All Assignees"
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
              placeholder="Filter by category"
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
            placeholder="Search tickets..."
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

          <div className="h-6 w-px bg-gray-200 mx-1 shrink-0" />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetFilters}
            className="text-gray-500 hover:text-gray-700 shrink-0"
            id="client-tickets-reset-filters-btn"
          >
            <XCircle className="h-4 w-4 mr-1" />
            Reset
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
              {isLoading ? 'Loading...' : 'Load More Tickets'}
            </Button>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={!!ticketToDelete}
        onClose={() => {
          setTicketToDelete(null);
          setTicketToDeleteName(null);
          setDeleteError(null);
        }}
        onConfirm={confirmDeleteTicket}
        title="Delete Ticket"
        message={
          deleteError
            ? deleteError
            : `Are you sure you want to delete ticket "${ticketToDeleteName || ticketToDelete}"? This action cannot be undone.`
        }
        confirmLabel={deleteError ? undefined : "Delete"}
        cancelLabel={deleteError ? "Close" : "Cancel"}
      />

      {/* Quick Add Ticket Dialog */}
      <QuickAddTicket
        open={isQuickAddTicketOpen}
        onOpenChange={setIsQuickAddTicketOpen}
        onTicketAdded={handleTicketAdded}
        prefilledClient={{
          id: clientId,
          name: clientName
        }}
      />
    </div>
  );
};

export default ClientTickets;
