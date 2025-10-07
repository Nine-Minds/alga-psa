'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ITicketListItem, ITicketCategory, ITicketListFilters } from 'server/src/interfaces/ticket.interfaces';
import { IBoard, IUser } from 'server/src/interfaces';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { BoardPicker } from 'server/src/components/settings/general/BoardPicker';
import { CategoryPicker } from 'server/src/components/tickets/CategoryPicker';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { getTicketsForListWithCursor } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { deleteTicket } from 'server/src/lib/actions/ticket-actions/ticketActions';
import { XCircle } from 'lucide-react';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { useDrawer } from "server/src/context/DrawerContext";
import TicketDetails from 'server/src/components/tickets/ticket/TicketDetails';
import { getConsolidatedTicketData } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { toast } from 'react-hot-toast';
import { QuickAddTicket } from 'server/src/components/tickets/QuickAddTicket';
import { createTicketColumns } from 'server/src/lib/utils/ticket-columns';
import { getTicketingDisplaySettings, TicketingDisplaySettings } from 'server/src/lib/actions/ticket-actions/ticketDisplaySettings';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { findTagsByEntityIds } from 'server/src/lib/actions/tagActions';
import { useTagPermissions } from 'server/src/hooks/useTagPermissions';
import { TagFilter } from 'server/src/components/tags';

interface CompanyTicketsProps {
  companyId: string;
  companyName?: string;
  initialBoards?: IBoard[];
  initialStatuses?: SelectOption[];
  initialPriorities?: SelectOption[];
  initialCategories?: ITicketCategory[];
  initialTags?: string[];
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

const CompanyTickets: React.FC<CompanyTicketsProps> = ({
  companyId,
  companyName = '',
  initialBoards = [],
  initialStatuses = [],
  initialPriorities = [],
  initialCategories = [],
  initialTags = []
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

  const debouncedSearchQuery = useDebounce(searchQuery, 500);

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
        companyId: companyId,
        boardId: selectedBoard || undefined,
        statusId: selectedStatus,
        priorityId: selectedPriority,
        categoryId: selectedCategories.length > 0 ? selectedCategories[0] : undefined,
        searchQuery: debouncedSearchQuery,
        boardFilterState: boardFilterState,
        showOpenOnly: selectedStatus === 'open',
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      };

      const result = await getTicketsForListWithCursor(currentUser, filters, cursor);
      
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
  }, [companyId, currentUser, selectedBoard, selectedStatus, selectedPriority, selectedCategories, debouncedSearchQuery, boardFilterState, selectedTags]);

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
      await deleteTicket(ticketToDelete, currentUser);
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
      const ticketData = await getConsolidatedTicketData(ticketId, currentUser);
      
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
          initialCompany={ticketData.company}
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
          initialCompanies={ticketData.companies}
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
      showClient: false, // Don't show client column since we're already on company page
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Company Tickets</h3>
        <Button
          id="add-company-ticket-btn"
          onClick={() => setIsQuickAddTicketOpen(true)}
          className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] transition-colors"
        >
          Add Ticket
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {initialBoards.length > 0 && (
          <BoardPicker
            id="company-tickets-board-picker"
            boards={initialBoards}
            onSelect={(boardId) => setSelectedBoard(boardId)}
            selectedBoardId={selectedBoard}
            filterState={boardFilterState}
            onFilterStateChange={setBoardFilterState}
          />
        )}
        
        {initialStatuses.length > 0 && (
          <CustomSelect
            data-automation-id="company-tickets-status-select"
            options={initialStatuses}
            value={selectedStatus}
            onValueChange={(value) => setSelectedStatus(value)}
            placeholder="Select Status"
          />
        )}
        
        {initialPriorities.length > 0 && (
          <CustomSelect
            data-automation-id="company-tickets-priority-select"
            options={initialPriorities}
            value={selectedPriority}
            onValueChange={(value) => setSelectedPriority(value)}
            placeholder="All Priorities"
          />
        )}
        
        {initialCategories.length > 0 && (
          <CategoryPicker
            id="company-tickets-category-picker"
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
        
        <Input
          id="company-tickets-search-input"
          placeholder="Search tickets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-[38px] min-w-[200px] text-sm"
          containerClassName=""
        />
        
        {allUniqueTags.length > 0 && (
          <TagFilter
            allTags={allUniqueTags}
            selectedTags={selectedTags}
            onTagSelect={(tag) => {
              setSelectedTags(prev => 
                prev.includes(tag) 
                  ? prev.filter(t => t !== tag)
                  : [...prev, tag]
              );
            }}
          />
        )}
        
        <Button
          id="company-tickets-reset-filters-btn"
          variant="outline"
          onClick={handleResetFilters}
          className="whitespace-nowrap flex items-center gap-2"
        >
          <XCircle className="h-4 w-4" />
          Reset Filters
        </Button>
      </div>

      {/* Tickets Table */}
      <DataTable
        data={ticketsWithIds}
        columns={columns}
      />

      {/* Load More Button */}
      {nextCursor && (
        <div className="flex justify-center mt-4">
          <Button
            id="company-tickets-load-more-btn"
            onClick={handleLoadMore}
            disabled={isLoading}
            variant="outline"
          >
            {isLoading ? 'Loading...' : 'Load More Tickets'}
          </Button>
        </div>
      )}

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
        prefilledCompany={{
          id: companyId,
          name: companyName
        }}
      />
    </div>
  );
};

export default CompanyTickets;