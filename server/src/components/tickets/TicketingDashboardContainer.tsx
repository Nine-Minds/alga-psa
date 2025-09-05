'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import TicketingDashboard from './TicketingDashboard';
import { loadMoreTickets } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
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
    nextCursor: string | null;
  };
  currentUser: IUser;
  initialFilters?: Partial<ITicketListFilters>;
}

export default function TicketingDashboardContainer({ 
  consolidatedData,
  currentUser,
  initialFilters
}: TicketingDashboardContainerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [tickets, setTickets] = useState<ITicketListItem[]>(consolidatedData.tickets);
  const [nextCursor, setNextCursor] = useState<string | null>(consolidatedData.nextCursor);
  const router = useRouter();

  const [activeFilters, setActiveFilters] = useState<Partial<ITicketListFilters>>(() => {
    // Use initialFilters if provided, otherwise use defaults
    return initialFilters || {
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

  // Function to sync filter state to URL
  const updateURLWithFilters = useCallback((filters: Partial<ITicketListFilters>) => {
    const params = new URLSearchParams();
    
    // Only add non-default/non-empty values to URL
    if (filters.channelId) params.set('channelId', filters.channelId);
    if (filters.companyId) params.set('companyId', filters.companyId);
    if (filters.statusId && filters.statusId !== 'open') params.set('statusId', filters.statusId);
    if (filters.priorityId && filters.priorityId !== 'all') params.set('priorityId', filters.priorityId);
    if (filters.categoryId) params.set('categoryId', filters.categoryId);
    if (filters.searchQuery) params.set('searchQuery', filters.searchQuery);
    if (filters.channelFilterState && filters.channelFilterState !== 'active') {
      params.set('channelFilterState', filters.channelFilterState);
    }
    if (filters.tags && filters.tags.length > 0) {
      params.set('tags', filters.tags.join(','));
    }

    // Update URL without causing a page refresh
    const newURL = params.toString() ? `/msp/tickets?${params.toString()}` : '/msp/tickets';
    router.replace(newURL, { scroll: false });
  }, [router]);

  const fetchTickets = useCallback(async (filters: Partial<ITicketListFilters>, cursor?: string | null) => {
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

      const result = await loadMoreTickets(
        currentUser,
        currentFiltersWithDefaults,
        cursor ?? undefined
      );
      
      if (cursor) { 
        setTickets(prev => [...prev, ...result.tickets]);
      } else { 
        setTickets(result.tickets);
      }
      setNextCursor(result.nextCursor);
      setActiveFilters(currentFiltersWithDefaults); 

    } catch (error) {
      console.error('Error fetching tickets:', error);
      toast.error('Failed to fetch tickets');
      if (!cursor) {
        setTickets([]);
        setNextCursor(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentUser]);

  const handleLoadMore = useCallback(async () => {
    if (nextCursor) {
      await fetchTickets(activeFilters, nextCursor);
    }
  }, [fetchTickets, activeFilters, nextCursor]);

  const handleFiltersChanged = useCallback(async (newFilters: Partial<ITicketListFilters>) => {
    // Update URL to persist filter state
    updateURLWithFilters(newFilters);
    // Fetch new tickets with updated filters
    await fetchTickets(newFilters, null); // Fetch page 1
  }, [fetchTickets, updateURLWithFilters]);

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
      initialTags={consolidatedData.options.tags || []}
      nextCursor={nextCursor}
      onLoadMore={handleLoadMore} 
      onFiltersChanged={handleFiltersChanged}
      initialFilterValues={activeFilters}
      isLoadingMore={isLoading}
      user={currentUser}
    />
  );
}
