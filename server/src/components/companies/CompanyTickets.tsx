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

interface CompanyTicketsProps {
  companyId: string;
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

const CompanyTickets: React.FC<CompanyTicketsProps> = ({
  companyId,
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
        companyId: companyId,
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
  }, [companyId, currentUser, selectedChannel, selectedStatus, selectedPriority, selectedCategories, debouncedSearchQuery, channelFilterState]);

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
    },
    {
      title: 'Status',
      dataIndex: 'status_name',
    },
    {
      title: 'Priority',
      dataIndex: 'priority_name',
    },
    {
      title: 'Channel',
      dataIndex: 'channel_name',
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
      title: 'Created By',
      dataIndex: 'entered_by_name',
    },
    {
      title: 'Actions',
      dataIndex: 'actions',
      width: '5%',
      render: (value: string, record: ITicketListItem) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`company-ticket-actions-${record.ticket_id}`}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-white z-50">
            <DropdownMenuItem
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 text-red-600 flex items-center"
              onSelect={() => handleDeleteTicket(record.ticket_id as string, record.title || record.ticket_number)}
            >
              <Trash2 className="mr-2 h-4 w-4" /> 
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    }
  ], [handleTicketClick]);

  const columns = useMemo(() => createTicketColumns(initialCategories), [initialCategories, createTicketColumns]);

  const ticketsWithIds = useMemo(() =>
    tickets.map((ticket): any => ({
      ...ticket,
      id: ticket.ticket_id 
    })), [tickets]);

  const handleResetFilters = useCallback(() => {
    setSelectedChannel(null);
    setSelectedStatus('open');
    setSelectedPriority('all');
    setSelectedCategories([]);
    setExcludedCategories([]);
    setSearchQuery('');
    setChannelFilterState('active');
  }, []);

  const handleCategorySelect = useCallback((newSelectedCategories: string[], newExcludedCategories: string[]) => {
    setSelectedCategories(newSelectedCategories);
    setExcludedCategories(newExcludedCategories);
  }, []);

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
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {initialChannels.length > 0 && (
          <ChannelPicker
            id="company-tickets-channel-picker"
            channels={initialChannels}
            onSelect={(channelId) => setSelectedChannel(channelId)}
            selectedChannelId={selectedChannel}
            filterState={channelFilterState}
            onFilterStateChange={setChannelFilterState}
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
    </div>
  );
};

export default CompanyTickets;