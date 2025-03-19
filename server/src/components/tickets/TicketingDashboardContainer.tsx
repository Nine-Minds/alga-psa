'use client';

import React, { useState } from 'react';
import TicketingDashboard from './TicketingDashboard';
import { loadMoreTickets } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { toast } from 'react-hot-toast';
import { ITicketListItem, ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import { SelectOption } from 'server/src/components/ui/CustomSelect';
import { IChannel } from 'server/src/interfaces';

interface TicketingDashboardContainerProps {
  consolidatedData: {
    options: {
      statusOptions: SelectOption[];
      priorityOptions: SelectOption[];
      channelOptions: SelectOption[];
      agentOptions: SelectOption[];
      categories: ITicketCategory[];
      companies: ICompany[];
      users: IUser[];
    };
    tickets: ITicketListItem[];
    nextCursor: string | null;
  };
  currentUser: IUser;
}

export default function TicketingDashboardContainer({ 
  consolidatedData,
  currentUser
}: TicketingDashboardContainerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [tickets, setTickets] = useState<ITicketListItem[]>(consolidatedData.tickets);
  const [nextCursor, setNextCursor] = useState<string | null>(consolidatedData.nextCursor);

  // Handle loading more tickets with cursor-based pagination
  const handleLoadMore = async (cursor: string, filters: any = {}) => {
    if (!currentUser) {
      toast.error('You must be logged in to load more tickets');
      return;
    }

    try {
      setIsLoading(true);
      // Use the filters passed from the dashboard component
      const result = await loadMoreTickets(
        currentUser,
        {
          channelId: filters.channelId || null,
          statusId: filters.statusId || 'all',
          priorityId: filters.priorityId || 'all',
          categoryId: filters.categoryId || null,
          companyId: filters.companyId || null,
          searchQuery: filters.searchQuery || '',
          channelFilterState: filters.channelFilterState || 'active',
          showOpenOnly: filters.statusId === 'open'
        },
        cursor
      );
      
      setTickets(prev => [...prev, ...result.tickets]);
      setNextCursor(result.nextCursor);
    } catch (error) {
      console.error('Error loading more tickets:', error);
      toast.error('Failed to load more tickets');
    } finally {
      setIsLoading(false);
    }
  };

  // Convert channel options to the format expected by ChannelPicker
  const channels = consolidatedData.options.channelOptions.map(option => ({
    channel_id: option.value,
    channel_name: option.label as string,
    tenant: '',
    is_inactive: false
  }));

  return (
    <TicketingDashboard
      id="ticketing-dashboard"
      initialTickets={tickets}
      // Pass pre-fetched options as props
      initialChannels={channels}
      initialStatuses={consolidatedData.options.statusOptions}
      initialPriorities={consolidatedData.options.priorityOptions}
      initialCategories={consolidatedData.options.categories}
      initialCompanies={consolidatedData.options.companies}
      nextCursor={nextCursor}
      onLoadMore={handleLoadMore}
      isLoadingMore={isLoading}
      user={currentUser}
    />
  );
}