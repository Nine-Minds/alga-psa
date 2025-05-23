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

interface ContactTicketsProps {
  contactId: string;
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
        <div className="max-w-xs truncate" title={value}>
          {value}
        </div>
      ),
    },
    {
      title: 'Company',
      dataIndex: 'company_name',
      render: (value: string) => value || 'N/A',
    },
    {
      title: 'Status',
      dataIndex: 'status_name',
      render: (value: string) => (
        <span className={`px-2 py-1 rounded text-xs font-medium ${
          value === 'Open' ? 'bg-green-100 text-green-800' :
          value === 'In Progress' ? 'bg-blue-100 text-blue-800' :
          value === 'Closed' ? 'bg-gray-100 text-gray-800' :
          'bg-gray-100 text-gray-800'
        }`}>
          {value}
        </span>
      ),
    },
    {
      title: 'Priority',
      dataIndex: 'priority_name',
      render: (value: string) => (
        <span className={`px-2 py-1 rounded text-xs font-medium ${
          value === 'Urgent' ? 'bg-red-100 text-red-800' :
          value === 'High' ? 'bg-orange-100 text-orange-800' :
          value === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
          value === 'Low' ? 'bg-gray-100 text-gray-800' :
          'bg-gray-100 text-gray-800'
        }`}>
          {value}
        </span>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'category_name',
      render: (value: string) => value || 'N/A',
    },
    {
      title: 'Assigned To',
      dataIndex: 'assigned_to_name',
      render: (value: string) => value || 'Unassigned',
    },
    {
      title: 'Created',
      dataIndex: 'entered_at',
      render: (value: string) => {
        const date = new Date(value);
        return date.toLocaleDateString();
      },
    },
    {
      title: 'Actions',
      dataIndex: 'actions',
      render: (value: any, record: ITicketListItem) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/msp/tickets/${record.ticket_id}`}>
                View Details
              </Link>
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

  const resetFilters = () => {
    setSelectedChannel(null);
    setSelectedStatus('open');
    setSelectedPriority('all');
    setSelectedCategories([]);
    setExcludedCategories([]);
    setSearchQuery('');
    setChannelFilterState('active');
  };

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
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <Input
              placeholder="Search tickets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
            <ChannelPicker
              channels={initialChannels}
              selectedChannelId={selectedChannel}
              onChannelSelect={setSelectedChannel}
              filterState={channelFilterState}
              onFilterStateChange={setChannelFilterState}
              allowClear={true}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <CustomSelect
              value={selectedStatus}
              onValueChange={setSelectedStatus}
              options={[{ value: 'all', label: 'All Statuses' }, ...initialStatuses]}
              placeholder="Select status"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
            <CustomSelect
              value={selectedPriority}
              onValueChange={setSelectedPriority}
              options={[{ value: 'all', label: 'All Priorities' }, ...initialPriorities]}
              placeholder="Select priority"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <CategoryPicker
              categories={initialCategories}
              selectedCategories={selectedCategories}
              excludedCategories={excludedCategories}
              onCategorySelect={setSelectedCategories}
              onCategoryExclude={setExcludedCategories}
            />
          </div>
        </div>

        {isFiltered && (
          <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-md p-3">
            <span className="text-sm text-blue-800">Filters are active</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="text-blue-600 hover:text-blue-800"
            >
              <XCircle className="h-4 w-4 mr-1" />
              Clear filters
            </Button>
          </div>
        )}

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
          <DataTable
            id="contact-tickets-table"
            data={tickets.map(ticket => ({ ...ticket, id: ticket.ticket_id }))}
            columns={columns}
            pagination={true}
            pageSize={25}
          />
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
      </div>
    </ReflectionContainer>
  );
};

export default ContactTickets;