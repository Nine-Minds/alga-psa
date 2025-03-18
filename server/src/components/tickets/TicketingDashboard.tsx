'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import Link from 'next/link';
import { ITicket, ITicketListItem, ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { QuickAddTicket } from './QuickAddTicket';
import { CategoryPicker } from './CategoryPicker';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { Button } from 'server/src/components/ui/Button';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { ChannelPicker } from 'server/src/components/settings/general/ChannelPicker';
import { CompanyPicker } from 'server/src/components/companies/CompanyPicker';
import { IChannel, ICompany, IUser } from 'server/src/interfaces';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { deleteTicket } from 'server/src/lib/actions/ticket-actions/ticketActions';
import { MoreHorizontal, XCircle, Clock } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';
import { useIntervalTracking } from '../../hooks/useIntervalTracking';
import { IntervalManagementDrawer } from '../time-management/interval-tracking/IntervalManagementDrawer';
import { saveTimeEntry } from '../../lib/actions/timeEntryActions';
import { toast } from 'react-hot-toast';

interface TicketingDashboardProps {
  id?: string;
  initialTickets: ITicketListItem[];
  // Add props for pre-fetched options
  initialChannels: {
    channel_id: string;
    channel_name: string;
    tenant: string;
    is_inactive: boolean;
  }[];
  initialStatuses: SelectOption[];
  initialPriorities: SelectOption[];
  initialCategories: ITicketCategory[];
  initialCompanies: ICompany[];
  nextCursor: string | null;
  onLoadMore: (cursor: string) => Promise<void>;
  isLoadingMore: boolean;
  user?: IUser; // Pass the user prop directly from container
}

const TicketingDashboard: React.FC<TicketingDashboardProps> = ({
  id = 'ticketing-dashboard',
  initialTickets,
  initialChannels,
  initialStatuses,
  initialPriorities,
  initialCategories,
  initialCompanies,
  nextCursor,
  onLoadMore,
  isLoadingMore,
  user
}) => {
  const [tickets, setTickets] = useState<ITicketListItem[]>(initialTickets);
  const [ticketToDelete, setTicketToDelete] = useState<string | null>(null);
  const [isIntervalDrawerOpen, setIsIntervalDrawerOpen] = useState(false);
  // Initialize currentUser directly from props if available to prevent any flashing
  const [currentUser, setCurrentUser] = useState<any>(user || null);

  // Initialize state with pre-fetched data
  const [channels] = useState<IChannel[]>(initialChannels);
  const [companies] = useState<ICompany[]>(initialCompanies);
  const [categories] = useState<ITicketCategory[]>(initialCategories);
  const [statusOptions] = useState<SelectOption[]>(initialStatuses);
  const [priorityOptions] = useState<SelectOption[]>(initialPriorities);
  
  const [filteredTickets, setFilteredTickets] = useState<ITicketListItem[]>(initialTickets);
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [companyFilterState, setCompanyFilterState] = useState<'active' | 'inactive' | 'all'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('open');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [excludedCategories, setExcludedCategories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [channelFilterState, setChannelFilterState] = useState<'active' | 'inactive' | 'all'>('active');
  const [isLoading, setIsLoading] = useState(false);

  const handleDeleteTicket = (ticketId: string) => {
    setTicketToDelete(ticketId);
  };
  
  // Initialize currentUser state from props if available
  useEffect(() => {
    if (user) {
      setCurrentUser(user);
    } else {
      // Fallback to fetching user if not provided in props
      const fetchUser = async () => {
        try {
          const fetchedUser = await getCurrentUser();
          setCurrentUser(fetchedUser);
        } catch (error) {
          console.error('Error fetching current user:', error);
        }
      };
      
      fetchUser();
    }
  }, [user]);
  
  // Use interval tracking hook to get interval count
  const { intervalCount, isLoading: isLoadingIntervals } = useIntervalTracking(currentUser?.id);

  const confirmDeleteTicket = async () => {
    if (!ticketToDelete) return;

    try {
      // Use the current user from state instead of fetching it again
      if (!currentUser) {
        throw new Error('User not found');
      }

      await deleteTicket(ticketToDelete, currentUser);
      // We would normally call fetchTickets here, but we're now using props
      // Instead, we'll just remove the deleted ticket from the state
      setTickets(prev => prev.filter(t => t.ticket_id !== ticketToDelete));
      setFilteredTickets(prev => prev.filter(t => t.ticket_id !== ticketToDelete));
    } catch (error) {
      console.error('Failed to delete ticket:', error);
    } finally {
      setTicketToDelete(null);
    }
  };

  const createTicketColumns = useCallback((categories: ITicketCategory[]): ColumnDefinition<ITicketListItem>[] => [
    {
      title: 'Ticket Number',
      dataIndex: 'ticket_number',
      render: (value: string, record: ITicketListItem) => (
        <Link
          href={`/msp/tickets/${record.ticket_id}`}
          className="text-blue-500 hover:underline"
        >
          {value}
        </Link>
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
      render: (value: string, record: ITicketListItem) => (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              id="ticket-actions-button"
              variant="ghost"
              className="h-8 w-8 p-0"
            >
              <span className="sr-only">Open menu</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Content
            className="w-48 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-50"
          >
            <DropdownMenu.Item
              className="px-4 py-2 text-sm text-red-600 hover:bg-gray-100 cursor-pointer outline-none"
              onSelect={() => handleDeleteTicket(record.ticket_id as string)}
            >
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      ),
    }
  ], []);

  // Create columns with categories data
  const columns = useMemo(() => createTicketColumns(categories), [categories, createTicketColumns]);

  // Handle saving time entries created from intervals
  const handleCreateTimeEntry = async (timeEntry: any): Promise<void> => {
    try {
      await saveTimeEntry(timeEntry);
      toast.success('Time entry saved successfully');
    } catch (error) {
      console.error('Error saving time entry:', error);
      toast.error('Failed to save time entry');
    }
  };

  // Add id to each ticket for DataTable keys
  const ticketsWithIds = useMemo(() =>
    filteredTickets.map((ticket): any => ({
      ...ticket,
      id: ticket.ticket_id
    }))
    , [filteredTickets]);

  // Filter tickets based on selected and excluded categories
  useEffect(() => {
    let filtered = [...tickets];

    if (selectedCategories.length > 0) {
      filtered = filtered.filter(ticket => {
        // Handle "No Category" selection
        if (selectedCategories.includes('no-category')) {
          return !ticket.category_id && !ticket.subcategory_id;
        }

        for (const selectedCategoryId of selectedCategories) {
          const selectedCategory = categories.find(c => c.category_id === selectedCategoryId);
          if (!selectedCategory) continue;

          if (selectedCategory.parent_category) {
            // If selected category is a subcategory, match only that specific subcategory
            return ticket.subcategory_id === selectedCategoryId;
          } else {
            // If selected category is a parent, match either:
            // 1. The parent category_id directly
            // 2. Any subcategory that belongs to this parent
            if (ticket.category_id === selectedCategoryId) return true;
            if (ticket.subcategory_id) {
              const ticketSubcategory = categories.find(c => c.category_id === ticket.subcategory_id);
              return ticketSubcategory?.parent_category === selectedCategoryId;
            }
          }
        }
        return false;
      });
    }

    if (excludedCategories.length > 0) {
      filtered = filtered.filter(ticket => {
        // Handle "No Category" exclusion
        if (!ticket.category_id && !ticket.subcategory_id) {
          return !excludedCategories.includes('no-category');
        }

        // Check if any excluded category matches this ticket
        for (const excludedId of excludedCategories) {
          const excludedCategory = categories.find(c => c.category_id === excludedId);
          if (!excludedCategory) continue;

          // If excluding a subcategory, only exclude tickets with that exact subcategory_id
          if (excludedCategory.parent_category) {
            if (ticket.subcategory_id === excludedId) {
              return false;
            }
          } else {
            // If excluding a parent category, exclude tickets with:
            // 1. The parent category_id directly
            // 2. Any subcategory belonging to this parent
            if (ticket.category_id === excludedId) {
              return false;
            }
            if (ticket.subcategory_id) {
              const ticketSubcategory = categories.find(c => c.category_id === ticket.subcategory_id);
              if (ticketSubcategory?.parent_category === excludedId) {
                return false;
              }
            }
          }
        }
        return true;
      });
    }

    setFilteredTickets(filtered);
  }, [tickets, selectedCategories, excludedCategories, categories]);

  const handleTicketAdded = useCallback((_ticket: ITicket) => {
    // We would normally call fetchTickets here, but we're now using props
    // Instead, we'll just close the quick add dialog
    setIsQuickAddOpen(false);
  }, []);

  const handleChannelSelect = useCallback((channelId: string) => {
    setSelectedChannel(channelId);
    setChannelFilterState('all');
  }, []);

  const handleCategorySelect = useCallback((categoryIds: string[], excludedIds: string[]) => {
    setSelectedCategories(categoryIds);
    setExcludedCategories(excludedIds);
  }, []);

  const handleCompanySelect = useCallback((companyId: string | null) => {
    setSelectedCompany(companyId || '');
  }, []);

  const handleCompanyFilterStateChange = useCallback((state: 'active' | 'inactive' | 'all') => {
    setCompanyFilterState(state);
  }, []);

  const handleClientTypeFilterChange = useCallback((type: 'all' | 'company' | 'individual') => {
    setClientTypeFilter(type);
  }, []);

  const handleResetFilters = useCallback(() => {
    setSelectedChannel('');
    setSelectedCompany(null);
    setSelectedStatus('open');
    setSelectedPriority('all');
    setSelectedCategories([]);
    setExcludedCategories([]);
    setSearchQuery('');
    setChannelFilterState('active');
    setCompanyFilterState('active');
    setClientTypeFilter('all');
  }, []);

  return (
    <ReflectionContainer id={id} label="Ticketing Dashboard">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Ticketing Dashboard</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setIsIntervalDrawerOpen(true)}
            className="flex items-center gap-2"
            id="view-intervals-button"
          >
            <Clock className="h-4 w-4" />
            View Intervals
            {intervalCount > 0 && (
              <span className="bg-blue-500 text-white rounded-full px-2 py-0.5 text-xs">
                {intervalCount}
              </span>
            )}
          </Button>
          <Button id="add-ticket-button" onClick={() => setIsQuickAddOpen(true)}>Add Ticket</Button>
        </div>
      </div>
      <div className="bg-white shadow rounded-lg p-4">
        <ReflectionContainer id={`${id}-filters`} label="Ticket DashboardFilters">
          <div className="flex items-center gap-3 flex-nowrap">
            <ChannelPicker
              id={`${id}-channel-picker`}
              channels={channels}
              onSelect={handleChannelSelect}
              selectedChannelId={selectedChannel}
              filterState={channelFilterState}
              onFilterStateChange={setChannelFilterState}
            />
            <CompanyPicker
              id='company-picker'
              data-automation-id={`${id}-company-picker`}
              companies={companies}
              onSelect={handleCompanySelect}
              selectedCompanyId={selectedCompany}
              filterState={companyFilterState}
              onFilterStateChange={handleCompanyFilterStateChange}
              clientTypeFilter={clientTypeFilter}
              onClientTypeFilterChange={handleClientTypeFilterChange}
              fitContent={true}
            />
            <CustomSelect
              data-automation-id={`${id}-status-select`}
              options={statusOptions}
              value={selectedStatus}
              onValueChange={(value) => setSelectedStatus(value)}
              placeholder="Select Status"
            />
            <CustomSelect
              data-automation-id={`${id}-priority-select`}
              options={priorityOptions}
              value={selectedPriority}
              onValueChange={(value) => setSelectedPriority(value)}
              placeholder="All Priorities"
            />
            <CategoryPicker
              id={`${id}-category-picker`}
              categories={categories}
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
            <input
              type="text"
              placeholder="Search tickets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-[38px] border rounded px-3 py-2 text-sm min-w-[200px]"
            />
            <Button
              variant="outline"
              onClick={handleResetFilters}
              className="whitespace-nowrap flex items-center gap-2 ml-auto"
              id='reset-filters'
            >
              <XCircle className="h-4 w-4" />
              Reset Filters
            </Button>
          </div>
        </ReflectionContainer>
        <h2 className="text-xl font-semibold mt-6 mb-2">
          Tickets
        </h2>
        {isLoading ? (
          <div className="flex justify-center items-center h-32">
            <span>Loading...</span>
          </div>
        ) : (
          <>
            <DataTable
              {...withDataAutomationId({ id: `${id}-tickets-table` })}
              data={ticketsWithIds}
              columns={columns}
            />
            
            {/* Load More Button */}
            {nextCursor && (
              <div className="flex justify-center mt-4">
                <Button
                  id="load-more-button"
                  onClick={() => onLoadMore(nextCursor)}
                  disabled={isLoadingMore}
                  variant="outline"
                >
                  {isLoadingMore ? 'Loading...' : 'Load More Tickets'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <QuickAddTicket
        id={`${id}-quick-add`}
        open={isQuickAddOpen}
        onOpenChange={setIsQuickAddOpen}
        onTicketAdded={handleTicketAdded}
      />
      <ConfirmationDialog
        id={`${id}-delete-dialog`}
        isOpen={!!ticketToDelete}
        onClose={() => setTicketToDelete(null)}
        onConfirm={confirmDeleteTicket}
        title="Delete Ticket"
        message="Are you sure you want to delete this ticket? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
      
      {/* Interval Management Drawer */}
      {currentUser && (
        <IntervalManagementDrawer
          isOpen={isIntervalDrawerOpen}
          onClose={() => setIsIntervalDrawerOpen(false)}
          userId={currentUser.user_id}
          onCreateTimeEntry={handleCreateTimeEntry}
        />
      )}
    </ReflectionContainer>
  );
};

export default TicketingDashboard;
