'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { ITicket, ITicketListItem, ITicketCategory, ITicketListFilters } from 'server/src/interfaces/ticket.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { QuickAddTicket } from './QuickAddTicket';
import { CategoryPicker } from './CategoryPicker';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { PrioritySelect } from './PrioritySelect';
import { Button } from 'server/src/components/ui/Button';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Input } from 'server/src/components/ui/Input';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { BoardPicker } from 'server/src/components/settings/general/BoardPicker';
import { ClientPicker } from 'server/src/components/clients/ClientPicker';
import { findTagsByEntityIds } from 'server/src/lib/actions/tagActions';
import { TagFilter } from 'server/src/components/tags';
import { useTagPermissions } from 'server/src/hooks/useTagPermissions';
import { IBoard, IClient, IUser } from 'server/src/interfaces';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { deleteTicket, deleteTickets } from 'server/src/lib/actions/ticket-actions/ticketActions';
import { XCircle, Clock } from 'lucide-react';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';
import { useIntervalTracking } from 'server/src/hooks/useIntervalTracking';
import { IntervalManagementDrawer } from 'server/src/components/time-management/interval-tracking/IntervalManagementDrawer';
import { TicketingDisplaySettings } from 'server/src/lib/actions/ticket-actions/ticketDisplaySettings';
import { saveTimeEntry } from 'server/src/lib/actions/timeEntryActions';
import { toast } from 'react-hot-toast';
import Drawer from 'server/src/components/ui/Drawer';
import ClientDetails from 'server/src/components/clients/ClientDetails';
import { createTicketColumns } from 'server/src/lib/utils/ticket-columns';
import Spinner from 'server/src/components/ui/Spinner';

interface TicketingDashboardProps {
  id?: string;
  initialTickets: ITicketListItem[];
  initialBoards: IBoard[];
  initialStatuses: SelectOption[];
  initialPriorities: SelectOption[];
  initialCategories: ITicketCategory[];
  initialClients: IClient[];
  initialTags?: string[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onFiltersChanged: (filters: Partial<ITicketListFilters>) => void;
  initialFilterValues: Partial<ITicketListFilters>;
  isLoadingMore: boolean;
  user?: IUser;
  displaySettings?: TicketingDisplaySettings;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  onSortChange: (sortBy: string, sortDirection: 'asc' | 'desc') => void;
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

const TicketingDashboard: React.FC<TicketingDashboardProps> = ({
  id = 'ticketing-dashboard',
  initialTickets,
  initialBoards,
  initialStatuses,
  initialPriorities,
  initialCategories,
  initialClients,
  initialTags = [],
  totalCount,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onFiltersChanged,
  initialFilterValues,
  isLoadingMore,
  user,
  displaySettings,
  sortBy = 'entered_at',
  sortDirection = 'desc',
  onSortChange
}) => {
  // Pre-fetch tag permissions to prevent individual API calls
  useTagPermissions(['ticket']);
  
  const [tickets, setTickets] = useState<ITicketListItem[]>(initialTickets);
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(new Set());
  const [visibleTicketIds, setVisibleTicketIds] = useState<string[]>([]);
  const [ticketToDelete, setTicketToDelete] = useState<string | null>(null);
  const [ticketToDeleteName, setTicketToDeleteName] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isIntervalDrawerOpen, setIsIntervalDrawerOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(user || null);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkDeleteErrors, setBulkDeleteErrors] = useState<Array<{ ticketId: string; message: string }>>([]);

  const [boards] = useState<IBoard[]>(initialBoards);
  const [clients] = useState<IClient[]>(initialClients);
  const [categories] = useState<ITicketCategory[]>(initialCategories);
  const [statusOptions] = useState<SelectOption[]>(initialStatuses);
  const [priorityOptions] = useState<SelectOption[]>(initialPriorities);
  
  const [selectedBoard, setSelectedBoard] = useState<string | null>(initialFilterValues.boardId ?? null);
  const [selectedClient, setSelectedClient] = useState<string | null>(initialFilterValues.clientId ?? null);
  const [selectedStatus, setSelectedStatus] = useState<string>(initialFilterValues.statusId ?? 'open');
  const [selectedPriority, setSelectedPriority] = useState<string>(initialFilterValues.priorityId ?? 'all');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    initialFilterValues.categoryId ? [initialFilterValues.categoryId] : []
  );
  const [excludedCategories, setExcludedCategories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>(initialFilterValues.searchQuery ?? '');
  const [boardFilterState, setBoardFilterState] = useState<'active' | 'inactive' | 'all'>(initialFilterValues.boardFilterState ?? 'active');
  
  const [clientFilterState, setClientFilterState] = useState<'active' | 'inactive' | 'all'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  const filtersHaveInitialValues = useMemo(() => {
    return Boolean(
      initialFilterValues.boardId ||
      initialFilterValues.clientId ||
      (initialFilterValues.statusId && initialFilterValues.statusId !== 'open') ||
      (initialFilterValues.priorityId && initialFilterValues.priorityId !== 'all') ||
      initialFilterValues.categoryId ||
      (initialFilterValues.tags && initialFilterValues.tags.length > 0)
    );
  }, [initialFilterValues.boardId, initialFilterValues.clientId, initialFilterValues.statusId, initialFilterValues.priorityId, initialFilterValues.categoryId, initialFilterValues.tags]);

  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isLoadingSelf, setIsLoadingSelf] = useState(false);

  // Quick View state
  const [quickViewClientId, setQuickViewClientId] = useState<string | null>(null);
  const [isQuickViewOpen, setIsQuickViewOpen] = useState(false);

  // Tag-related state
  const [selectedTags, setSelectedTags] = useState<string[]>(initialFilterValues.tags || []);
  const ticketTagsRef = useRef<Record<string, ITag[]>>({});
  const [allUniqueTags, setAllUniqueTags] = useState<ITag[]>(
    initialTags.map(tagText => ({ tag_text: tagText } as ITag))
  );

  const handleTableSortChange = useCallback((columnId: string, direction: 'asc' | 'desc') => {
    if (columnId === sortBy && direction === sortDirection) {
      return;
    }
    onSortChange(columnId, direction);
  }, [onSortChange, sortBy, sortDirection]);
  
  const handleTagsChange = (ticketId: string, tags: ITag[]) => {
    ticketTagsRef.current[ticketId] = tags;
    
    // Update unique tags list if needed
    setAllUniqueTags(current => {
      const currentTagTexts = new Set(current.map(t => t.tag_text));
      const newTags = tags.filter(tag => !currentTagTexts.has(tag.tag_text));
      return [...current, ...newTags];
    });
  };

  useEffect(() => {
    setTickets(initialTickets);
  }, [initialTickets]);

  useEffect(() => {
    const nextTags = initialFilterValues.tags || [];
    setSelectedTags(prev => {
      if (prev.length === nextTags.length && prev.every((tag, index) => tag === nextTags[index])) {
        return prev;
      }
      return [...nextTags];
    });
  }, [initialFilterValues.tags]);

  // Fetch ticket-specific tags when initial tickets change
  useEffect(() => {
    const fetchTags = async () => {
      if (initialTickets.length === 0) return;
      
      try {
        const ticketIds = initialTickets.map(ticket => ticket.ticket_id).filter((id): id is string => id !== undefined);
        
        // Only fetch ticket-specific tags, not all tags again
        const ticketTags = await findTagsByEntityIds(ticketIds, 'ticket');

        const newTicketTags: Record<string, ITag[]> = {};
        ticketTags.forEach(tag => {
          if (!newTicketTags[tag.tagged_id]) {
            newTicketTags[tag.tagged_id] = [];
          }
          newTicketTags[tag.tagged_id].push(tag);
        });

        ticketTagsRef.current = newTicketTags;
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };
    fetchTags();
  }, [initialTickets]);

  // No longer need client-side tag fetching since we get all tags from server

  const debouncedSearchQuery = useDebounce(searchQuery, 500);

  // Helper function to generate URL with current filter state
  const getCurrentFiltersQuery = useCallback(() => {
    const params = new URLSearchParams();
    
    // Only add non-default/non-empty values to URL
    if (selectedBoard) params.set('boardId', selectedBoard);
    if (selectedClient) params.set('clientId', selectedClient);
    if (selectedStatus && selectedStatus !== 'open') params.set('statusId', selectedStatus);
    if (selectedPriority && selectedPriority !== 'all') params.set('priorityId', selectedPriority);
    if (selectedCategories.length > 0) params.set('categoryId', selectedCategories[0]);
    if (debouncedSearchQuery) params.set('searchQuery', debouncedSearchQuery);
    if (boardFilterState && boardFilterState !== 'active') {
      params.set('boardFilterState', boardFilterState);
    }

    return params.toString();
  }, [selectedBoard, selectedClient, selectedStatus, selectedPriority, selectedCategories, debouncedSearchQuery, boardFilterState]);

  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip the effect on initial render to prevent unnecessary fetch
    if (isFirstRender.current) {
      isFirstRender.current = false;
      if (!filtersHaveInitialValues) {
        return;
      }
    }

    const currentFilters: Partial<ITicketListFilters> = {
      boardId: selectedBoard ?? undefined,
      statusId: selectedStatus,
      priorityId: selectedPriority,
      categoryId: selectedCategories.length > 0 ? selectedCategories[0] : undefined,
      clientId: selectedClient ?? undefined,
      searchQuery: debouncedSearchQuery,
      boardFilterState: boardFilterState,
      showOpenOnly: selectedStatus === 'open',
      tags: selectedTags.length > 0 ? selectedTags : undefined,
    };

    console.log('[Dashboard] Calling onFiltersChanged with:', currentFilters);
    onFiltersChanged(currentFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedBoard,
    selectedStatus,
    selectedPriority,
    selectedCategories,
    selectedClient,
    debouncedSearchQuery,
    boardFilterState,
    selectedTags,
    // onFiltersChanged intentionally omitted - we want to trigger only when filter values change, not when the callback changes
    filtersHaveInitialValues
  ]);

  const handleDeleteTicket = (ticketId: string, ticketNameOrNumber: string) => {
    setTicketToDelete(ticketId);
    setTicketToDeleteName(ticketNameOrNumber);
    setDeleteError(null);
  };
  
  const [quickViewClient, setQuickViewClient] = useState<IClient | null>(null);
  
  const onQuickViewClient = async (clientId: string) => {
    // First try to find the client in our existing data
    const client = initialClients.find(c => c.client_id === clientId);
    if (client) {
      setQuickViewClient(client);
      setQuickViewClientId(clientId);
      setIsQuickViewOpen(true);
    }
  };
  
  // Initialize currentUser state from props if available
  useEffect(() => {
    // Only fetch user if not already provided in props
    if (!user) {
      const fetchUser = async () => {
        try {
          setIsLoadingSelf(true);
          const fetchedUser = await getCurrentUser();
          setCurrentUser(fetchedUser);
        } catch (error) {
          console.error('Error fetching current user:', error);
        } finally {
          setIsLoadingSelf(false);
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
      setTickets(prev => prev.filter(t => t.ticket_id !== ticketToDelete));
      setSelectedTicketIds(prev => {
        if (!ticketToDelete || !prev.has(ticketToDelete)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(ticketToDelete);
        return next;
      });
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

  // Custom function for clicking on tickets with filter preservation
  const handleTicketClick = useCallback((ticketId: string) => {
    const filterQuery = getCurrentFiltersQuery();
    const href = filterQuery 
      ? `/msp/tickets/${ticketId}?returnFilters=${encodeURIComponent(filterQuery)}`
      : `/msp/tickets/${ticketId}`;
    window.location.href = href;
  }, [getCurrentFiltersQuery]);


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

  // Add id to each ticket for DataTable keys (no client-side filtering needed)
  const ticketsWithIds = useMemo(() =>
    tickets.map((ticket): any => ({
      ...ticket,
      id: ticket.ticket_id
    })), [tickets]);

  const selectableTicketIds = useMemo(
    () => {
      const ids = ticketsWithIds
        .map(ticket => ticket.ticket_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      return Array.from(new Set(ids));
    },
    [ticketsWithIds]
  );

  useEffect(() => {
    setSelectedTicketIds(prev => {
      if (prev.size === 0) {
        return prev;
      }

      const validIds = new Set(selectableTicketIds);
      let changed = false;
      const next = new Set<string>();

      prev.forEach(id => {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });

      if (!changed && next.size === prev.size) {
        return prev;
      }

      return next;
    });
  }, [selectableTicketIds]);

  const handleTicketSelectionChange = useCallback((ticketId: string, isChecked: boolean) => {
    setSelectedTicketIds(prev => {
      const alreadySelected = prev.has(ticketId);

      if (isChecked && alreadySelected) {
        return prev;
      }

      if (!isChecked && !alreadySelected) {
        return prev;
      }

      const next = new Set(prev);

      if (isChecked) {
        next.add(ticketId);
      } else {
        next.delete(ticketId);
      }

      return next;
    });
  }, []);

  const handleSelectAllVisibleTickets = useCallback((shouldSelect: boolean) => {
    const visibleIds = visibleTicketIds.filter((id): id is string => !!id);

    setSelectedTicketIds(prev => {
      if (visibleIds.length === 0) {
        return prev;
      }

      const next = new Set(prev);

      if (shouldSelect) {
        let changed = false;
        visibleIds.forEach(id => {
          if (!next.has(id)) {
            next.add(id);
            changed = true;
          }
        });
        return changed ? next : prev;
      }

      let changed = false;
      visibleIds.forEach(id => {
        if (next.delete(id)) {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [visibleTicketIds]);

  const handleSelectAllMatchingTickets = useCallback(() => {
    // For now, only select current page tickets
    // TODO: Implement server-side select all for all matching tickets
    if (selectableTicketIds.length === 0) {
      return;
    }
    setSelectedTicketIds(new Set(selectableTicketIds));
  }, [selectableTicketIds]);

  const clearSelection = useCallback(() => {
    setSelectedTicketIds(prev => (prev.size === 0 ? prev : new Set<string>()));
  }, []);

  const visibleTicketIdSet = useMemo(() => new Set(visibleTicketIds.filter((id): id is string => !!id)), [visibleTicketIds]);
  const allVisibleTicketsSelected = visibleTicketIds.length > 0 && visibleTicketIds.every(id => selectedTicketIds.has(id));
  const selectedTicketIdsArray = useMemo(() => Array.from(selectedTicketIds), [selectedTicketIds]);
  const hasHiddenSelections = useMemo(
    () => selectedTicketIdsArray.some(id => !visibleTicketIdSet.has(id)),
    [selectedTicketIdsArray, visibleTicketIdSet]
  );
  // For server-side pagination, we show "select all on page" vs "select all matching filters"
  const allCurrentPageSelected = selectableTicketIds.length > 0 && selectableTicketIds.every(id => selectedTicketIds.has(id));
  const isSelectionIndeterminate = selectedTicketIds.size > 0 && !allVisibleTicketsSelected;
  const selectedTicketDetails = useMemo(() => {
    if (selectedTicketIds.size === 0) {
      return [] as Array<{ ticket_id: string; ticket_number?: string; title?: string; client_name?: string }>;
    }

    const selectedSet = new Set(selectedTicketIds);

    return tickets
      .filter(ticket => ticket.ticket_id && selectedSet.has(ticket.ticket_id))
      .map(ticket => ({
        ticket_id: ticket.ticket_id as string,
        ticket_number: ticket.ticket_number,
        title: ticket.title,
        client_name: ticket.client_name,
      }))
      .sort((a, b) => {
        if (a.ticket_number && b.ticket_number) {
          return a.ticket_number.localeCompare(b.ticket_number, undefined, { numeric: true, sensitivity: 'base' });
        }
        if (a.title && b.title) {
          return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
        }
        return 0;
      });
  }, [tickets, selectedTicketIds]);

  const hasSelection = selectedTicketIds.size > 0;
  const showSelectAllBanner = allVisibleTicketsSelected && !hasHiddenSelections && totalCount > visibleTicketIds.length && visibleTicketIds.length > 0;
  const showAllSelectedBanner = false; // Disable "all selected" banner for now until we implement server-side select all

  const handleVisibleRowsChange = useCallback((rows: ITicketListItem[]) => {
    const ids = rows
      .map(row => row.ticket_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const uniqueIds = Array.from(new Set(ids));
    setVisibleTicketIds(prev => {
      if (prev.length === uniqueIds.length && prev.every((value, index) => value === uniqueIds[index])) {
        return prev;
      }
      return uniqueIds;
    });
  }, []);

  const columns = useMemo(() => {
    const baseColumns = createTicketColumns({
      categories,
      boards,
      displaySettings: displaySettings || undefined,
      onTicketClick: handleTicketClick,
      onDeleteClick: handleDeleteTicket,
      ticketTagsRef,
      onTagsChange: handleTagsChange,
      showClient: true,
      onClientClick: onQuickViewClient,
    });

    const selectionColumn: ColumnDefinition<ITicketListItem> = {
      title: (
        <div
          className="flex justify-center"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <Checkbox
            id={`${id}-select-all`}
            checked={allVisibleTicketsSelected}
            indeterminate={isSelectionIndeterminate}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              event.stopPropagation();
              handleSelectAllVisibleTickets(event.target.checked);
            }}
            containerClassName="mb-0"
            className="m-0"
            skipRegistration
          />
        </div>
      ),
      dataIndex: 'selection',
      width: '4%',
      headerClassName: 'text-center px-4',
      cellClassName: 'text-center px-4',
      sortable: false,
      render: (_value: string, record: ITicketListItem) => {
        const ticketId = record.ticket_id;
        if (!ticketId) {
          return null;
        }

        const isChecked = selectedTicketIds.has(ticketId);

        return (
          <div
            className="flex justify-center"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Checkbox
              id={`${id}-select-${ticketId}`}
              checked={isChecked}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                event.stopPropagation();
                handleTicketSelectionChange(ticketId, event.target.checked);
              }}
              containerClassName="mb-0"
              className="m-0"
              skipRegistration
            />
          </div>
        );
      },
    };

    return [selectionColumn, ...baseColumns];
  }, [
    categories,
    boards,
    displaySettings,
    handleTicketClick,
    handleDeleteTicket,
    handleTagsChange,
    ticketTagsRef,
    onQuickViewClient,
    id,
    allVisibleTicketsSelected,
    isSelectionIndeterminate,
    handleSelectAllVisibleTickets,
    handleTicketSelectionChange,
    selectedTicketIds,
  ]);

  const handleBulkDeleteClose = useCallback(() => {
    if (isBulkDeleting) {
      return;
    }
    setIsBulkDeleteDialogOpen(false);
    setBulkDeleteErrors([]);
  }, [isBulkDeleting]);

  const handleConfirmBulkDelete = useCallback(async () => {
    if (selectedTicketIdsArray.length === 0) {
      return;
    }

    if (!currentUser) {
      toast.error('You must be logged in to delete tickets');
      return;
    }

    setIsBulkDeleting(true);
    setBulkDeleteErrors([]);

    try {
      const result = await deleteTickets(selectedTicketIdsArray, currentUser);

      if (result.deletedIds.length > 0) {
        const deletedSet = new Set(result.deletedIds);
        setTickets(prev => prev.filter(ticket => {
          if (!ticket.ticket_id) {
            return true;
          }
          return !deletedSet.has(ticket.ticket_id);
        }));
      }

      if (result.failed.length > 0) {
        setBulkDeleteErrors(result.failed);
        setSelectedTicketIds(() => new Set(result.failed.map(item => item.ticketId)));

        if (result.deletedIds.length > 0) {
          toast.success(`${result.deletedIds.length} ticket${result.deletedIds.length === 1 ? '' : 's'} deleted`);
        }
        toast.error('Some tickets could not be deleted');
      } else {
        if (result.deletedIds.length > 0) {
          toast.success(`${result.deletedIds.length} ticket${result.deletedIds.length === 1 ? '' : 's'} deleted`);
        }
        clearSelection();
        setIsBulkDeleteDialogOpen(false);
      }
    } catch (error) {
      console.error('Failed to delete selected tickets:', error);
      toast.error('Failed to delete selected tickets');
    } finally {
      setIsBulkDeleting(false);
    }
  }, [selectedTicketIdsArray, currentUser, clearSelection]);


  const handleTicketAdded = useCallback((newTicket: ITicket) => {
    // Add the new ticket to the local state
    setTickets(prevTickets => {
      const status = statusOptions.find(s => s.value === newTicket.status_id);
      const priority = priorityOptions.find(p => p.value === newTicket.priority_id);
      const board = boards.find(c => c.board_id === newTicket.board_id);
      
      let categoryName = '';
      if (newTicket.category_id) {
        const category = categories.find(c => c.category_id === newTicket.category_id);
        if (category) {
          categoryName = category.category_name;
        }
      }
      
      // Find the client name
      const client = initialClients.find(c => c.client_id === newTicket.client_id);
      const clientName = client ? client.client_name : 'Unknown';
      
      // Convert the new ticket to match the ITicketListItem format
      const newTicketListItem: ITicketListItem = {
        ticket_id: newTicket.ticket_id,
        ticket_number: newTicket.ticket_number,
        title: newTicket.title,
        url: newTicket.url,
        status_id: newTicket.status_id,
        status_name: typeof status?.label === 'string' ? status.label : '',
        priority_id: newTicket.priority_id ?? null,
        priority_name: typeof priority?.label === 'string' ? priority.label : '',
        board_id: newTicket.board_id,
        board_name: board?.board_name || '',
        category_id: newTicket.category_id,
        subcategory_id: newTicket.subcategory_id,
        category_name: categoryName,
        client_id: newTicket.client_id,
        client_name: clientName,
        contact_name_id: newTicket.contact_name_id,
        entered_by: newTicket.entered_by,
        entered_by_name: currentUser ? `${currentUser.first_name} ${currentUser.last_name}` : '',
        updated_by: newTicket.updated_by,
        closed_by: newTicket.closed_by,
        assigned_to: newTicket.assigned_to,
        assigned_to_name: null,
        entered_at: newTicket.entered_at,
        updated_at: newTicket.updated_at,
        closed_at: newTicket.closed_at,
        attributes: newTicket.attributes,
        tenant: newTicket.tenant
      };
      
      return [newTicketListItem, ...prevTickets];
    });
    
    // Close the quick add dialog
    setIsQuickAddOpen(false);
  }, [statusOptions, priorityOptions, boards, categories, currentUser]);

  const handleBoardSelect = useCallback((boardId: string) => {
    setSelectedBoard(boardId);
  }, []);

  const handleCategorySelect = useCallback((newSelectedCategories: string[], newExcludedCategories: string[]) => {
    setSelectedCategories(newSelectedCategories);
    setExcludedCategories(newExcludedCategories);
  }, []);
  
  const handleClientSelect = useCallback((clientId: string | null) => {
    setSelectedClient(clientId);
  }, []);

  const handleClientFilterStateChange = useCallback((state: 'active' | 'inactive' | 'all') => {
    setClientFilterState(state);
  }, []);

  const handleClientTypeFilterChange = useCallback((type: 'all' | 'company' | 'individual') => {
    setClientTypeFilter(type);
  }, []);

  const handleResetFilters = useCallback(() => {
    // Define the true default/reset states
    const defaultBoard: string | null = null;
    const defaultClient: string | null = null;
    const defaultStatus: string = 'open';
    const defaultPriority: string = 'all';
    const defaultCategories: string[] = [];
    const defaultSearchQuery: string = '';
    const defaultBoardFilterState: 'active' | 'inactive' | 'all' = 'active';

    setSelectedBoard(defaultBoard);
    setSelectedClient(defaultClient);
    setSelectedStatus(defaultStatus);
    setSelectedPriority(defaultPriority);
    setSelectedCategories(defaultCategories);
    setExcludedCategories([]);
    setSearchQuery(defaultSearchQuery);
    setBoardFilterState(defaultBoardFilterState);
    setSelectedTags([]);
    
    setClientFilterState('active'); 
    setClientTypeFilter('all');

    clearSelection();

    onFiltersChanged({
      boardId: defaultBoard === null ? undefined : defaultBoard,
      clientId: defaultClient === null ? undefined : defaultClient,
      statusId: defaultStatus,
      priorityId: defaultPriority,
      categoryId: defaultCategories.length > 0 ? defaultCategories[0] : undefined,
      searchQuery: defaultSearchQuery,
      boardFilterState: defaultBoardFilterState,
      showOpenOnly: defaultStatus === 'open',
    });
  }, [onFiltersChanged, clearSelection]);

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
          {hasSelection && (
            <Button
              id={`${id}-bulk-delete-button`}
              variant="destructive"
              onClick={() => {
                setBulkDeleteErrors([]);
                setIsBulkDeleteDialogOpen(true);
              }}
              className="flex items-center gap-2"
            >
              Delete Selected ({selectedTicketIds.size})
            </Button>
          )}
          <Button id="add-ticket-button" onClick={() => setIsQuickAddOpen(true)}>Add Ticket</Button>
        </div>
      </div>
      <div className="bg-white shadow rounded-lg p-4">
        <ReflectionContainer id={`${id}-filters`} label="Ticket DashboardFilters">
          <div className="flex items-center gap-3 flex-nowrap">
            <BoardPicker
              id={`${id}-board-picker`}
              boards={boards}
              onSelect={handleBoardSelect}
              selectedBoardId={selectedBoard}
              filterState={boardFilterState}
              onFilterStateChange={setBoardFilterState}
            />
            <ClientPicker
              id='client-picker'
              data-automation-id={`${id}-client-picker`}
              clients={clients}
              onSelect={handleClientSelect}
              selectedClientId={selectedClient}
              filterState={clientFilterState}
              onFilterStateChange={handleClientFilterStateChange}
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
            <PrioritySelect
              id={`${id}-priority-select`}
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
            <Input
              id={`${id}-search-tickets-input`}
              placeholder="Search tickets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-[38px] min-w-[200px] text-sm" // Applied to the <input> element itself
              containerClassName="" // Applied to the wrapping <div>, removes default mb-4
            />
            <TagFilter
              allTags={allUniqueTags}
              selectedTags={selectedTags}
              onTagSelect={(tag) => {
                setSelectedTags(prev =>
                  prev.includes(tag)
                    ? prev.filter(t => t !== tag)
                    : [...prev, tag]
                );
              }}
              onClear={() => setSelectedTags([])}
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
        {/* isLoadingMore prop now correctly reflects loading state from container for pagination or filter changes */}
        {isLoadingMore ? (
          <Spinner size="md" className="h-32 w-full" />
        ) : (
          <>
            {showSelectAllBanner && (
              <div className="mb-3 flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
                <span>
                  All {visibleTicketIds.length} ticket{visibleTicketIds.length === 1 ? '' : 's'} on this page are selected.
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-blue-600">
                    {totalCount} total ticket{totalCount === 1 ? '' : 's'} match your filters
                  </span>
                  <Button
                    id={`${id}-clear-visible-selection`}
                    variant="link"
                    onClick={clearSelection}
                    className="p-0"
                  >
                    Clear selection
                  </Button>
                </div>
              </div>
            )}
            <DataTable
              key={`${currentPage}-${pageSize}`}
              {...withDataAutomationId({ id: `${id}-tickets-table` })}
              data={ticketsWithIds}
              columns={columns}
              pagination={true}
              currentPage={currentPage}
              onPageChange={onPageChange}
              pageSize={pageSize}
              totalItems={totalCount}
              onItemsPerPageChange={onPageSizeChange}
              rowClassName={(record: ITicketListItem) =>
                record.ticket_id && selectedTicketIds.has(record.ticket_id)
                  ? '!bg-blue-50'
                  : ''
              }
              onVisibleRowsChange={handleVisibleRowsChange}
              manualSorting={true}
              sortBy={sortBy}
              sortDirection={sortDirection}
              onSortChange={handleTableSortChange}
            />
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
        id={`${id}-delete-ticket-dialog`}
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
      <Dialog
        isOpen={isBulkDeleteDialogOpen && hasSelection}
        onClose={handleBulkDeleteClose}
        id={`${id}-bulk-delete-dialog`}
        title="Delete Selected Tickets"
      >
        <DialogContent>
          {bulkDeleteErrors.length > 0 && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <p className="font-medium">The following tickets could not be deleted:</p>
              <ul className="mt-2 space-y-1">
                {bulkDeleteErrors.map(error => {
                  const detail = selectedTicketDetails.find(item => item.ticket_id === error.ticketId);
                  const label = detail?.ticket_number || detail?.title || error.ticketId;
                  return (
                    <li key={error.ticketId}>
                      <span className="font-medium">{label}</span>: {error.message}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <p className="text-gray-600">
            {selectedTicketIdsArray.length === 1
              ? 'Are you sure you want to delete this ticket? This action cannot be undone.'
              : `Are you sure you want to delete these ${selectedTicketIdsArray.length} tickets? This action cannot be undone.`}
          </p>
          <div className="mt-4 max-h-60 overflow-y-auto rounded-md border border-gray-200">
            {selectedTicketDetails.length > 0 ? (
              <ul>
                {selectedTicketDetails.map(detail => (
                  <li key={detail.ticket_id} className="border-b border-gray-200 px-4 py-2 last:border-b-0">
                    <span className="font-medium text-gray-700">
                      {detail.ticket_number || detail.title || detail.ticket_id}
                    </span>
                    {detail.title && detail.ticket_number && (
                      <span className="ml-2 text-sm text-gray-500">{detail.title}</span>
                    )}
                    {detail.client_name && (
                      <span className="ml-2 text-sm text-gray-400">· {detail.client_name}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-3 text-sm text-gray-500">
                No tickets selected.
              </div>
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            id={`${id}-bulk-delete-cancel`}
            variant="outline"
            onClick={handleBulkDeleteClose}
            disabled={isBulkDeleting}
          >
            Cancel
          </Button>
          <Button
            id={`${id}-bulk-delete-confirm`}
            variant="destructive"
            onClick={handleConfirmBulkDelete}
            disabled={isBulkDeleting || selectedTicketIdsArray.length === 0}
          >
            {isBulkDeleting
              ? 'Deleting...'
              : `Delete ${selectedTicketIdsArray.length} Ticket${selectedTicketIdsArray.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </Dialog>
      
      {/* Interval Management Drawer */}
      {currentUser && (
        <IntervalManagementDrawer
          isOpen={isIntervalDrawerOpen}
          onClose={() => setIsIntervalDrawerOpen(false)}
          userId={currentUser.user_id}
          onCreateTimeEntry={handleCreateTimeEntry}
        />
      )}
      
      {/* Client Quick View Drawer */}
      <Drawer
        isOpen={isQuickViewOpen}
        onClose={() => {
          setIsQuickViewOpen(false);
          setQuickViewClientId(null);
          setQuickViewClient(null);
        }}
      >
        {quickViewClient && (
          <ClientDetails
            client={quickViewClient}
            isInDrawer={true}
            quickView={true}
          />
        )}
      </Drawer>
    </ReflectionContainer>
  );
};

export default TicketingDashboard;
