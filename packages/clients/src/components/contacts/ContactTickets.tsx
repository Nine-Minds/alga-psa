'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ITicketListItem, ITicketCategory, ITicketListFilters } from 'server/src/interfaces/ticket.interfaces';
import { IBoard, IUser } from 'server/src/interfaces';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { BoardPicker } from 'server/src/components/settings/general/BoardPicker';
import CategoryPicker from '@alga-psa/tickets/components/CategoryPicker';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { getTicketsForListWithCursor } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { deleteTicket } from '@alga-psa/tickets/actions/ticketActions';
import { XCircle } from 'lucide-react';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useDrawer } from "server/src/context/DrawerContext";
import TicketDetails from '@alga-psa/tickets/components/ticket/TicketDetails';
import { getConsolidatedTicketData } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { toast } from 'react-hot-toast';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { QuickAddTicket } from '@alga-psa/tickets/components/QuickAddTicket';
import { createTicketColumns } from 'server/src/lib/utils/ticket-columns';
import { getTicketingDisplaySettings, type TicketingDisplaySettings } from '@alga-psa/tickets/actions/ticketDisplaySettings';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { findTagsByEntityIds } from 'server/src/lib/actions/tagActions';
import { useTagPermissions } from 'server/src/hooks/useTagPermissions';
import ClientDetails from '../clients/ClientDetails';
import { getClientById } from '@alga-psa/clients/actions';
import { TagFilter } from '@alga-psa/ui/components';

interface ContactTicketsProps {
  contactId: string;
  contactName?: string;
  clientId?: string;
  clientName?: string;
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

const ContactTickets: React.FC<ContactTicketsProps> = ({
  contactId,
  contactName = '',
  clientId = '',
  clientName = '',
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
        contactId: contactId, // Filter by contact instead of client
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
  }, [contactId, currentUser, selectedBoard, selectedStatus, selectedPriority, selectedCategories, debouncedSearchQuery, boardFilterState, selectedTags]);

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

  const handleClientClick = useCallback(async (clientId: string) => {
    try {
      const client = await getClientById(clientId);
      if (client) {
        openDrawer(
          <ClientDetails
            client={client}
            documents={[]}
            contacts={[]}
            isInDrawer={true}
            quickView={true}
          />
        );
      } else {
        toast.error('Client not found');
      }
    } catch (error) {
      console.error('Error loading client:', error);
      toast.error('Failed to load client details');
    }
  }, [openDrawer]);

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
      showClient: true, // Show client column in contact view
      onClientClick: handleClientClick,
    }), [initialCategories, initialBoards, displaySettings, handleTicketClick, handleDeleteTicket, handleTagsChange, handleClientClick]);

  const handleCategorySelect = (
    selectedCategories: string[],
    excludedCategories: string[]
  ) => {
    setSelectedCategories(selectedCategories);
    setExcludedCategories(excludedCategories);
  };

  const resetFilters = () => {
    setSelectedBoard(null);
    setSelectedStatus('open');
    setSelectedPriority('all');
    setSelectedCategories([]);
    setExcludedCategories([]);
    setSearchQuery('');
    setBoardFilterState('active');
    setSelectedTags([]);
  };

  const handleTicketAdded = useCallback(() => {
    // Refresh the tickets list
    loadTickets(undefined, true);
    setIsQuickAddTicketOpen(false);
  }, [loadTickets]);

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-32">
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <ReflectionContainer id="contact-tickets" label="Contact Tickets">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Contact Tickets</h3>
          <Button
            id="add-contact-ticket-btn"
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
              placeholder="Select Status"
            />
          )}
          
          {initialPriorities.length > 0 && (
            <CustomSelect
              id="contact-tickets-priority-select"
              options={initialPriorities}
              value={selectedPriority}
              onValueChange={(value) => setSelectedPriority(value)}
              placeholder="All Priorities"
            />
          )}
          
          {initialCategories.length > 0 && (
            <CategoryPicker
              id="contact-tickets-category-picker"
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
            id="contact-tickets-search-input"
            placeholder="Search tickets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-[38px] min-w-[200px] text-sm"
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
            id="contact-tickets-reset-filters-btn"
            variant="outline"
            onClick={resetFilters}
            className="whitespace-nowrap flex items-center gap-2"
          >
            <XCircle className="h-4 w-4" />
            Reset Filters
          </Button>
        </div>

        {/* Tickets Table */}
        {isLoading && tickets.length === 0 ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 rounded w-full animate-pulse"></div>
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg">
            <p className="text-gray-600 mb-4">No tickets found for this contact</p>
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
              pagination={false}
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
                  {isLoading ? 'Loading...' : 'Load More Tickets'}
                </Button>
              </div>
            )}
          </>
        )}

        {/* Delete Confirmation Dialog */}
        <ConfirmationDialog
          id="delete-ticket-dialog"
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
              : `Are you sure you want to delete ticket "${ticketToDeleteName}"? This action cannot be undone.`
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
          prefilledContact={{
            id: contactId,
            name: contactName
          }}
        />
      </div>
    </ReflectionContainer>
  );
};

export default ContactTickets;
