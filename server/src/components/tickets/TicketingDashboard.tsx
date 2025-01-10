'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import Link from 'next/link';
import { ITicket, ITicketListItem, ITicketCategory } from '../../interfaces/ticket.interfaces';
import { QuickAddTicket } from './QuickAddTicket';
import { CategoryPicker } from './CategoryPicker';
import CustomSelect, { SelectOption } from '../ui/CustomSelect';
import { Button } from '../ui/Button';
import { getAllChannels } from '../../lib/actions/channel-actions/channelActions';
import { getTicketStatuses } from '../../lib/actions/status-actions/statusActions';
import { getAllPriorities } from '../../lib/actions/priorityActions';
import { getAllUsers, getCurrentUser } from '../../lib/actions/user-actions/userActions';
import { getTicketCategories } from '../../lib/actions/ticketCategoryActions';
import { getAllCompanies } from '../../lib/actions/companyActions';
import { ChannelPicker } from '../settings/general/ChannelPicker';
import { CompanyPicker } from '../companies/CompanyPicker';
import { IChannel, ICompany } from '../../interfaces';
import { DataTable } from '../ui/DataTable';
import { ColumnDefinition } from '../../interfaces/dataTable.interfaces';
import { getTicketsForList, deleteTicket } from '../../lib/actions/ticket-actions/ticketActions';
import { MoreHorizontal } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { withDataAutomationId } from '@/types/ui-reflection/withDataAutomationId';

interface TicketingDashboardProps {
  id?: string;
  initialTickets: ITicketListItem[];
}

const TicketingDashboard: React.FC<TicketingDashboardProps> = ({
  id = 'ticketing-dashboard',
  initialTickets
}) => {
  const [tickets, setTickets] = useState<ITicketListItem[]>(initialTickets);
  const [ticketToDelete, setTicketToDelete] = useState<string | null>(null);

  const handleDeleteTicket = (ticketId: string) => {
    setTicketToDelete(ticketId);
  };

  const confirmDeleteTicket = async () => {
    if (!ticketToDelete) return;

    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error('User not found');
      }

      await deleteTicket(ticketToDelete, user);
      fetchTickets(true);
    } catch (error) {
      console.error('Failed to delete ticket:', error);
    } finally {
      setTicketToDelete(null);
    }
  };

  const [categories, setCategories] = useState<ITicketCategory[]>([]);

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
  ], [categories]);

  const [filteredTickets, setFilteredTickets] = useState<ITicketListItem[]>(initialTickets);
  const [channels, setChannels] = useState<IChannel[]>([]);
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [statusOptions, setStatusOptions] = useState<SelectOption[]>([]);
  const [priorityOptions, setPriorityOptions] = useState<SelectOption[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [companyFilterState, setCompanyFilterState] = useState<'active' | 'inactive' | 'all'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [excludedCategories, setExcludedCategories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [channelFilterState, setChannelFilterState] = useState<'active' | 'inactive' | 'all'>('active');
  const [isLoading, setIsLoading] = useState(false);

  // Create columns with categories data
  const columns = useMemo(() => createTicketColumns(categories), [categories, createTicketColumns]);

  const fetchOptions = useCallback(async () => {
    return Promise.all([
      getAllChannels(),
      getTicketStatuses(),
      getAllPriorities(),
      getAllUsers(),
      getTicketCategories(),
      getAllCompanies()
    ]);
  }, []);

  // Update the fetchTickets function to include category filtering
  const fetchTickets = useCallback(async (isSubscribed: boolean) => {
    setIsLoading(true);
    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error('User not found');
      }

      const tickets = await getTicketsForList(user, {
        channelId: selectedChannel || undefined,
        statusId: selectedStatus !== 'all' ? selectedStatus : undefined,
        priorityId: selectedPriority !== 'all' ? selectedPriority : undefined,
        companyId: selectedCompany || undefined,
        searchQuery,
        channelFilterState
      });

      if (isSubscribed) {
        setTickets(tickets);
        setIsLoading(false);
      }
    } catch (error) {
      if (isSubscribed) {
        console.error('Failed to fetch tickets:', error);
        setIsLoading(false);
      }
    }
  }, [selectedChannel, selectedStatus, selectedPriority, selectedCompany, searchQuery, channelFilterState]);

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
  }, [tickets, selectedCategories, excludedCategories]);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const [fetchedChannels, statuses, priorities, _, fetchedCategories, fetchedCompanies] = await fetchOptions();

        if (!isMounted) return;

        setChannels(fetchedChannels);
        setCategories(fetchedCategories);
        setCompanies(fetchedCompanies);

        setStatusOptions([
          { value: 'all', label: 'All Statuses' },
          ...statuses.map((status: { status_id: string; name: string | null }): SelectOption => ({
            value: status.status_id!,
            label: status.name ?? ""
          }))
        ]);

        setPriorityOptions([
          { value: 'all', label: 'All Priorities' },
          ...priorities.map((priority: { priority_id: string; priority_name: string }): SelectOption => ({
            value: priority.priority_id,
            label: priority.priority_name
          }))
        ]);

      } catch (error) {
        if (!isMounted) return;
        console.error('Failed to fetch options:', error);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [fetchOptions]);

  // Fetch tickets when filters change
  useEffect(() => {
    let isSubscribed = true;
    fetchTickets(isSubscribed);
    return () => {
      isSubscribed = false;
    };
  }, [fetchTickets]);

  const handleTicketAdded = useCallback((_ticket: ITicket) => {
    let isSubscribed = true;
    fetchTickets(isSubscribed);
    setIsQuickAddOpen(false);
    return () => {
      isSubscribed = false;
    };
  }, [fetchTickets]);

  const handleChannelSelect = useCallback((channelId: string) => {
    setSelectedChannel(channelId);
    setChannelFilterState('all');
  }, []);

  const handleCategorySelect = useCallback((categoryIds: string[], excludedIds: string[]) => {
    setSelectedCategories(categoryIds);
    setExcludedCategories(excludedIds);
  }, []);

  const handleCompanySelect = useCallback((companyId: string) => {
    setSelectedCompany(companyId);
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
    setSelectedStatus('all');
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
        <Button id="add-ticket-button" onClick={() => setIsQuickAddOpen(true)}>Add Ticket</Button>
      </div>
      <div className="bg-white shadow rounded-lg p-4">
        <div className="flex items-center justify-between gap-3">
          <ReflectionContainer id={`${id}-filters`} label="Ticket DashboardFilters">
            <div className="flex items-center gap-3">
              <div className="w-fit">
                <ChannelPicker
                  id='channel-picker'
                  data-automation-id={`${id}-channel-picker`}
                  channels={channels}
                  onSelect={handleChannelSelect}
                  selectedChannelId={selectedChannel}
                  filterState={channelFilterState}
                  onFilterStateChange={setChannelFilterState}
                />
              </div>
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
                placeholder="All Statuses"
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
            </div>
          </ReflectionContainer>
        </div>
        <h2 className="text-xl font-semibold mt-6 mb-2">
          Tickets
        </h2>
        {isLoading ? (
          <div className="flex justify-center items-center h-32">
            <span>Loading...</span>
          </div>
        ) : (
          <DataTable
            {...withDataAutomationId({ id: `${id}-tickets-table` })}
            data={ticketsWithIds}
            columns={columns}
          />
        )}
      </div>
      {/* </ReflectionContainer> */}

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
    </ReflectionContainer>
  );

};

export default TicketingDashboard;
