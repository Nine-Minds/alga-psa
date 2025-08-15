'use client';

import React, { useState, useCallback } from 'react';
import TicketingDashboard from './TicketingDashboard';
import { getTicketsPage } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { toast } from 'react-hot-toast';
import { ITicketListItem, ITicketCategory, ITicketListFilters } from 'server/src/interfaces/ticket.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import { SelectOption } from 'server/src/components/ui/CustomSelect';
import { IChannel } from 'server/src/interfaces';

interface TicketingDashboardContainerProps {
  consolidatedData: {
    options: {
      statusOptions: SelectOption[];
      priorityOptions: SelectOption[];
      channelOptions: IChannel[];
      agentOptions: SelectOption[];
      categories: ITicketCategory[];
      companies: ICompany[];
      users: IUser[];
    };
    tickets: ITicketListItem[];
    totalCount: number;
    page: number;
    pageSize: number;
  };
  currentUser: IUser;
}

export default function TicketingDashboardContainer({ 
  consolidatedData,
  currentUser
}: TicketingDashboardContainerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [tickets, setTickets] = useState<ITicketListItem[]>(consolidatedData.tickets);
  const [totalCount, setTotalCount] = useState<number>(consolidatedData.totalCount);
  const [currentPage, setCurrentPage] = useState<number>(consolidatedData.page || 1);
  const [pageSize] = useState<number>(consolidatedData.pageSize || 10);
  const [activeFilters, setActiveFilters] = useState<Partial<ITicketListFilters>>(() => {
    return {
      statusId: 'open',
      priorityId: 'all',
      searchQuery: '',
      channelFilterState: 'active',
      showOpenOnly: true,
      channelId: undefined,
      categoryId: undefined,
      companyId: undefined,
    };
  });

  const fetchTickets = useCallback(async (filters: Partial<ITicketListFilters>, page?: number) => {
    if (!currentUser) {
      toast.error('You must be logged in to perform this action');
      return;
    }
    setIsLoading(true);
    try {
      const currentFiltersWithDefaults: ITicketListFilters = {
        channelId: filters.channelId || undefined,
        statusId: filters.statusId || 'all',
        priorityId: filters.priorityId || 'all',
        categoryId: filters.categoryId || undefined,
        companyId: filters.companyId || undefined,
        searchQuery: filters.searchQuery || '',
        channelFilterState: filters.channelFilterState || 'active',
        showOpenOnly: (filters.statusId === 'open') || (filters.showOpenOnly === true) 
      };
      const targetPage = page || 1;
      const result = await getTicketsPage(currentUser, currentFiltersWithDefaults, targetPage, pageSize);
      setTickets(result.tickets);
      setTotalCount(result.totalCount);
      setCurrentPage(result.page);
      setActiveFilters(currentFiltersWithDefaults);

    } catch (error) {
      console.error('Error fetching tickets:', error);
      toast.error('Failed to fetch tickets');
      setTickets([]);
      setTotalCount(0);
    } finally {
      setIsLoading(false);
    }
  }, [currentUser, pageSize]);

  // DataTable page change
  const handlePageChange = useCallback(async (newPage: number) => {
    await fetchTickets(activeFilters, newPage);
  }, [fetchTickets, activeFilters]);

  const handleFiltersChanged = useCallback(async (newFilters: Partial<ITicketListFilters>) => {
    await fetchTickets(newFilters, 1); // Fetch page 1
  }, [fetchTickets]);

  const mappedAndFilteredChannels = consolidatedData.options.channelOptions.map(channel => ({
    ...channel,
    channel_id: channel.channel_id || '',
    channel_name: channel.channel_name || 'Unnamed Channel',
    tenant: channel.tenant || currentUser.tenant || '',
    is_inactive: channel.is_inactive || false,
  })).filter(channel => channel.channel_id !== '');

  const initialChannelsForDashboard: Array<IChannel & { channel_id: string; channel_name: string; tenant: string; is_inactive: boolean }> = mappedAndFilteredChannels;
  
  return (
    <TicketingDashboard
      id="ticketing-dashboard"
      initialTickets={tickets} 
      initialChannels={initialChannelsForDashboard}
      initialStatuses={consolidatedData.options.statusOptions}
      initialPriorities={consolidatedData.options.priorityOptions}
      initialCategories={consolidatedData.options.categories}
      initialCompanies={consolidatedData.options.companies}
      nextCursor={null}
      onLoadMore={async () => { /* no-op */ }} 
      onFiltersChanged={handleFiltersChanged}
      initialFilterValues={activeFilters}
      isLoadingMore={isLoading}
      user={currentUser}
      currentPage={currentPage}
      pageSize={pageSize}
      totalItems={totalCount}
      onPageChange={handlePageChange}
    />
  );
}
