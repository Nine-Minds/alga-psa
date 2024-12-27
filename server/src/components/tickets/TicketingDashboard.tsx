// server/src/components/tickets/TicketingDashboard.tsx
'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { ITicket, ITicketListItem, ITicketCategory } from '@/interfaces/ticket.interfaces';
import { IUser } from '@/interfaces/auth.interfaces';
import { QuickAddTicket } from './QuickAddTicket';
import { CategoryPicker } from './CategoryPicker';
import CustomSelect, { SelectOption } from '../ui/CustomSelect';
import { Button } from '../ui/Button';
import { getAllChannels } from '@/lib/actions/channel-actions/channelActions';
import { getTicketStatuses } from '@/lib/actions/status-actions/statusActions';
import { getAllPriorities } from '@/lib/actions/priorityActions';
import { getAllUsers, getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { getTicketCategories } from '@/lib/actions/ticketCategoryActions';
import { ChannelPicker } from '@/components/settings/general/ChannelPicker';
import { IChannel } from '@/interfaces';
import { DataTable } from '@/components/ui/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';
import { getTicketsForList, deleteTicket } from '@/lib/actions/ticket-actions/ticketActions';
import { MoreHorizontal } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

interface TicketingDashboardProps {
  initialTickets: ITicketListItem[];
}

const TicketingDashboard: React.FC<TicketingDashboardProps> = ({ initialTickets }) => {
  const [tickets, setTickets] = useState<ITicketListItem[]>(initialTickets);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  const handleDeleteTicket = async (ticketId: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error('User not found');
      }

      await deleteTicket(ticketId, user);
      let isSubscribed = true;
      fetchTickets(isSubscribed);
      return () => {
        isSubscribed = false;
      };
    } catch (error) {
      console.error('Failed to delete ticket:', error);
    }
  };

const createTicketColumns = (categories: ITicketCategory[]): ColumnDefinition<ITicketListItem>[] => [
  {
    title: 'Ticket Number',
    dataIndex: 'ticket_number',
    render: (value: string, record: ITicketListItem) => (
      <Link href={`/msp/tickets/${record.ticket_id}`} className="text-blue-500 hover:underline">
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
    render: (value: string) => {
      if (!value) return 'No Category';
      const category = categories.find(c => c.category_id === value);
      if (!category) return 'Unknown Category';
      
      if (category.parent_category) {
        const parent = categories.find(c => c.category_id === category.parent_category);
        return parent ? `${parent.category_name} → ${category.category_name}` : category.category_name;
      }
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
];

  const [filteredTickets, setFilteredTickets] = useState<ITicketListItem[]>(initialTickets);
  const [channels, setChannels] = useState<IChannel[]>([]);
  const [categories, setCategories] = useState<ITicketCategory[]>([]);
  const [statusOptions, setStatusOptions] = useState<SelectOption[]>([]);
  const [priorityOptions, setPriorityOptions] = useState<SelectOption[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [channelFilterState, setChannelFilterState] = useState<'active' | 'inactive' | 'all'>('active');
  const [isLoading, setIsLoading] = useState(false);
  
  // Create columns with categories data
  const columns = useMemo(() => createTicketColumns(categories), [categories]);

  const fetchOptions = useCallback(async () => {
    return Promise.all([
      getAllChannels(),
      getTicketStatuses(),
      getAllPriorities(),
      getAllUsers(),
      getTicketCategories()
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
  }, [selectedChannel, selectedStatus, selectedPriority, searchQuery, channelFilterState]);

  // Add id to each ticket for DataTable keys
  const ticketsWithIds = useMemo(() => 
    filteredTickets.map(ticket => ({
      ...ticket,
      id: ticket.ticket_id
    }))
  , [filteredTickets]);

  // Filter tickets based on selected categories
  useEffect(() => {
    let filtered = [...tickets];
    
    if (selectedCategories.length > 0) {
      filtered = filtered.filter(ticket => 
        ticket.category_id && selectedCategories.includes(ticket.category_id)
      );
    }

    setFilteredTickets(filtered);
  }, [tickets, selectedCategories]);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const [fetchedChannels, statuses, priorities, _, fetchedCategories] = await fetchOptions();

        if (!isMounted) return;

        setChannels(fetchedChannels);
        setCategories(fetchedCategories);

        setStatusOptions([
          { value: 'all', label: 'All Statuses' },
          ...statuses.map((status): SelectOption => ({ 
            value: status.status_id!, 
            label: status.name ?? "" 
          }))
        ]);

        setPriorityOptions([
          { value: 'all', label: 'All Priorities' },
          ...priorities.map((priority): SelectOption => ({ 
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

  const handleCategorySelect = (categoryIds: string[]) => {
    setSelectedCategories(categoryIds);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Ticketing Dashboard</h1>
        <Button onClick={() => setIsQuickAddOpen(true)}>Add Ticket</Button>
      </div>
      <div className="bg-white shadow rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="w-fit">
            <ChannelPicker
              channels={channels}
              onSelect={handleChannelSelect}
              selectedChannelId={selectedChannel}
              filterState={channelFilterState}
              onFilterStateChange={setChannelFilterState}
            />
          </div>
          <CustomSelect
            options={statusOptions}
            value={selectedStatus}
            onValueChange={(value) => setSelectedStatus(value)}
            placeholder="All Statuses"
          />
          <CustomSelect
            options={priorityOptions}
            value={selectedPriority}
            onValueChange={(value) => setSelectedPriority(value)}
            placeholder="All Priorities"
          />
          <CategoryPicker
            categories={categories}
            selectedCategories={selectedCategories}
            onSelect={handleCategorySelect}
            placeholder="Filter by category"
            multiSelect={true}
            className="text-sm"
          />
          <input
            type="text"
            placeholder="Search tickets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-[38px] border rounded px-3 py-2 text-sm min-w-[200px]"
          />
        </div>
        <h2 className="text-xl font-semibold mt-6 mb-2">Tickets</h2>
        {isLoading ? (
          <div className="flex justify-center items-center h-32">
            <span>Loading...</span>
          </div>
        ) : (
          <DataTable
            data={ticketsWithIds}
            columns={columns}
          />
        )}
      </div>
      <QuickAddTicket
        open={isQuickAddOpen}
        onOpenChange={setIsQuickAddOpen}
        onTicketAdded={handleTicketAdded}
      />
    </div>
  );
};

export default TicketingDashboard;
