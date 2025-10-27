'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import TicketingDashboard from './TicketingDashboard';
import { loadMoreTickets } from '@product/actions/ticket-actions/optimizedTicketActions';
import { toast } from 'react-hot-toast';
import { ITicketListItem, ITicketCategory, ITicketListFilters } from 'server/src/interfaces/ticket.interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import { SelectOption } from 'server/src/components/ui/CustomSelect';
import { IBoard } from 'server/src/interfaces';
import { TicketingDisplaySettings } from '@product/actions/ticket-actions/ticketDisplaySettings';

interface TicketingDashboardContainerProps {
  consolidatedData: {
    options: {
      statusOptions: SelectOption[];
      priorityOptions: SelectOption[];
      boardOptions: IBoard[];
      agentOptions: SelectOption[];
      categories: ITicketCategory[];
      clients: IClient[];
      users: IUser[];
      tags?: string[];
    };
    tickets: ITicketListItem[];
    nextCursor: string | null;
  };
  currentUser: IUser;
  initialFilters?: Partial<ITicketListFilters>;
  displaySettings?: TicketingDisplaySettings;
}

export default function TicketingDashboardContainer({ 
  consolidatedData,
  currentUser,
  initialFilters,
  displaySettings
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
      boardFilterState: 'active',
      showOpenOnly: true,
      boardId: undefined,
      categoryId: undefined,
      clientId: undefined,
    };
  });

  // Function to sync filter state to URL
  const updateURLWithFilters = useCallback((filters: Partial<ITicketListFilters>) => {
    const params = new URLSearchParams();
    
    // Only add non-default/non-empty values to URL
    if (filters.boardId) params.set('boardId', filters.boardId);
    if (filters.clientId) params.set('clientId', filters.clientId);
    if (filters.statusId && filters.statusId !== 'open') params.set('statusId', filters.statusId);
    if (filters.priorityId && filters.priorityId !== 'all') params.set('priorityId', filters.priorityId);
    if (filters.categoryId) params.set('categoryId', filters.categoryId);
    if (filters.searchQuery) params.set('searchQuery', filters.searchQuery);
    if (filters.boardFilterState && filters.boardFilterState !== 'active') {
      params.set('boardFilterState', filters.boardFilterState);
    }
    if (filters.tags && Array.isArray(filters.tags) && filters.tags.length > 0) {
      // Encode each tag to handle special characters like commas
      const encodedTags = filters.tags.map(tag => encodeURIComponent(String(tag)));
      params.set('tags', encodedTags.join(','));
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
        boardId: filters.boardId || undefined,
        statusId: filters.statusId || 'all',
        priorityId: filters.priorityId || 'all',
        categoryId: filters.categoryId || undefined,
        clientId: filters.clientId || undefined,
        searchQuery: filters.searchQuery || '',
        boardFilterState: filters.boardFilterState || 'active',
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

  const mappedAndFilteredBoards = consolidatedData.options.boardOptions.map(board => ({
    ...board,
    board_id: board.board_id || '',
    board_name: board.board_name || 'Unnamed Board',
    tenant: board.tenant || currentUser.tenant || '',
    is_inactive: board.is_inactive || false,
  })).filter(board => board.board_id !== '');

  const initialBoardsForDashboard: Array<IBoard & { board_id: string; board_name: string; tenant: string; is_inactive: boolean }> = mappedAndFilteredBoards;
  
  return (
    <TicketingDashboard
      id="ticketing-dashboard"
      initialTickets={tickets} 
      initialBoards={initialBoardsForDashboard}
      initialStatuses={consolidatedData.options.statusOptions}
      initialPriorities={consolidatedData.options.priorityOptions}
      initialCategories={consolidatedData.options.categories}
      initialClients={consolidatedData.options.clients}
      initialTags={consolidatedData.options.tags || []}
      nextCursor={nextCursor}
      onLoadMore={handleLoadMore} 
      onFiltersChanged={handleFiltersChanged}
      initialFilterValues={activeFilters}
      isLoadingMore={isLoading}
      user={currentUser}
      displaySettings={displaySettings}
    />
  );
}
