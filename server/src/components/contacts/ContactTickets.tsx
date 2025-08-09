'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ITicketListItem, ITicketCategory, ITicketListFilters } from 'server/src/interfaces/ticket.interfaces';
import { IChannel, IUser } from 'server/src/interfaces';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { ChannelPicker } from 'server/src/components/settings/general/ChannelPicker';
import { CategoryPicker } from 'server/src/components/tickets/CategoryPicker';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { getTicketsForListWithCursor } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { deleteTicket } from 'server/src/lib/actions/ticket-actions/ticketActions';
import { MoreVertical, XCircle, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from 'server/src/components/ui/DropdownMenu';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import Link from 'next/link';
import { useDrawer } from "server/src/context/DrawerContext";
import TicketDetails from 'server/src/components/tickets/ticket/TicketDetails';
import { getConsolidatedTicketData } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { toast } from 'react-hot-toast';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { QuickAddTicket } from 'server/src/components/tickets/QuickAddTicket';

interface ContactTicketsProps {
  contactId: string;
  contactName?: string;
  companyId?: string;
  companyName?: string;
  initialChannels?: IChannel[];
  initialStatuses?: SelectOption[];
  initialPriorities?: SelectOption[];
  initialCategories?: ITicketCategory[];
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
  companyId = '',
  companyName = '',
  initialChannels = [],
  initialStatuses = [],
  initialPriorities = [],
  initialCategories = []
}) => {
  const [tickets, setTickets] = useState<ITicketListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<IUser | null>(null);
  const [ticketToDelete, setTicketToDelete] = useState<string | null>(null);
  const [ticketToDeleteName, setTicketToDeleteName] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isQuickAddTicketOpen, setIsQuickAddTicketOpen] = useState(false);
  
  const { openDrawer } = useDrawer();

  // Filter states
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>('open');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [excludedCategories, setExcludedCategories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [channelFilterState, setChannelFilterState] = useState<'active' | 'inactive' | 'all'>('active');

  const debouncedSearchQuery = useDebounce(searchQuery, 500);

  // Initialize user
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await getCurrentUser();
        setCurrentUser(user);
      } catch (error) {
        console.error('Error fetching current user:', error);
      }
    };
    fetchUser();
  }, []);

  // Load tickets when filters change
  const loadTickets = useCallback(async (cursor?: string, resetTickets = false) => {
    if (!currentUser) return;

    try {
      setIsLoading(true);
      
      const filters: ITicketListFilters = {
        contactId: contactId, // Filter by contact instead of company
        channelId: selectedChannel || undefined,
        statusId: selectedStatus,
        priorityId: selectedPriority,
        categoryId: selectedCategories.length > 0 ? selectedCategories[0] : undefined,
        searchQuery: debouncedSearchQuery,
        channelFilterState: channelFilterState,
        showOpenOnly: selectedStatus === 'open',
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
  }, [contactId, currentUser, selectedChannel, selectedStatus, selectedPriority, selectedCategories, debouncedSearchQuery, channelFilterState]);

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
          initialChannel={ticketData.channel}
          initialCompany={ticketData.company}
          initialContactInfo={ticketData.contactInfo}
          initialCreatedByUser={ticketData.createdByUser}
          initialAdditionalAgents={ticketData.additionalAgents}
          initialAvailableAgents={ticketData.availableAgents}
          initialUserMap={ticketData.userMap}
          statusOptions={ticketData.options.status}
          agentOptions={ticketData.options.agent}
          channelOptions={ticketData.options.channel}
          priorityOptions={ticketData.options.priority}
          initialCategories={ticketData.categories}
        />
      );
    } catch (error) {
      console.error('Error opening ticket:', error);
      toast.error('Failed to open ticket');
    }
  }, [currentUser, openDrawer]);

  const createTicketColumns = useCallback((categories: ITicketCategory[]): ColumnDefinition<ITicketListItem>[] => [
    {
      title: 'Ticket Number',
      dataIndex: 'ticket_number',
      render: (value: string, record: ITicketListItem) => (
        <button
          onClick={() => handleTicketClick(record.ticket_id as string)}
          className="text-blue-500 hover:underline cursor-pointer bg-transparent border-none p-0"
        >
          {value}
        </button>
      ),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      render: (value: string, record: ITicketListItem) => (
        <div className="break-words" title={value}>
          {value}
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status_name',
      render: (value: string) => value,
    },
    {
      title: 'Priority',
      dataIndex: 'priority_name',
      render: (value: string, record: ITicketListItem) => (
        <div className="flex items-center gap-2">
          <div 
            className="w-3 h-3 rounded-full border border-gray-300" 
            style={{ backgroundColor: record.priority_color || '#6B7280' }}
          />
          <span>{value}</span>
        </div>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'category_id',
      render: (value: string, record: ITicketListItem) => {
        if (!value && !record.subcategory_id) return 'No Category';

        // If there's a subcategory, use that for display
        if (record.subcategory_id) {
          const subcategory = categories.find(c => c.category_id === record.subcategory_id);
          if (!subcategory) return 'Unknown Category';

          const parent = categories.find(c => c.category_id === subcategory.parent_category);
          return parent ? `${parent.category_name} → ${subcategory.category_name}` : subcategory.category_name;
        }

        // Otherwise use the main category
        const category = categories.find(c => c.category_id === value);
        if (!category) return 'Unknown Category';
        return category.category_name;
      },
    },
    {
      title: 'Board',
      dataIndex: 'channel_name',
      render: (value: string) => value || 'N/A',
    },
    {
      title: 'Created By',
      dataIndex: 'entered_by_name',
      render: (value: string) => value || 'N/A',
    },
    {
      title: 'Actions',
      dataIndex: 'actions',
      width: '5%',
      render: (value: any, record: ITicketListItem) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button id={`contact-ticket-actions-${record.ticket_id}`} variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/msp/tickets/${record.ticket_id}`}>
                Go to ticket
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleTicketClick(record.ticket_id as string)}>
              View details
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => handleDeleteTicket(record.ticket_id as string, record.ticket_number)}
              className="text-red-600"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ], [handleTicketClick, handleDeleteTicket]);

  const columns = useMemo(() => createTicketColumns(initialCategories), [createTicketColumns, initialCategories]);

  const handleCategorySelect = (
    selectedCategories: string[],
    excludedCategories: string[]
  ) => {
    setSelectedCategories(selectedCategories);
    setExcludedCategories(excludedCategories);
  };

  const resetFilters = () => {
    setSelectedChannel(null);
    setSelectedStatus('open');
    setSelectedPriority('all');
    setSelectedCategories([]);
    setExcludedCategories([]);
    setSearchQuery('');
    setChannelFilterState('active');
  };

  const handleTicketAdded = useCallback(() => {
    // Refresh the tickets list
    loadTickets(undefined, true);
    setIsQuickAddTicketOpen(false);
  }, [loadTickets]);

  const isFiltered = selectedChannel || selectedStatus !== 'open' || selectedPriority !== 'all' || 
                    selectedCategories.length > 0 || searchQuery || channelFilterState !== 'active';

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
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <Input
            id="contact-tickets-search-input"
            placeholder="Search tickets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-[38px] min-w-[200px] text-sm"
          />
          
          {initialChannels.length > 0 && (
            <ChannelPicker
              id="contact-tickets-channel-picker"
              channels={initialChannels}
              selectedChannelId={selectedChannel}
              onSelect={(channelId) => setSelectedChannel(channelId)}
              filterState={channelFilterState}
              onFilterStateChange={setChannelFilterState}
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
              data={tickets.map(ticket => ({ ...ticket, id: ticket.ticket_id }))}
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
          prefilledCompany={{
            id: companyId,
            name: companyName
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