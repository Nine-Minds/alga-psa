'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { ITicket, ITicketListItem, ITicketCategory, ITicketListFilters } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import { QuickAddTicket } from './QuickAddTicket';
import { CategoryPicker } from './CategoryPicker';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { PrioritySelect } from './PrioritySelect';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Input } from '@alga-psa/ui/components/Input';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import { getCurrentUser, getCurrentUserPermissions } from '@alga-psa/users/actions';
import { BoardPicker } from '@alga-psa/ui/components/settings/general/BoardPicker';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { findTagsByEntityIds } from '@alga-psa/tags/actions';
import { TagFilter } from '@alga-psa/ui/components';
import { useTagPermissions } from '@alga-psa/tags/hooks';
import { IBoard, IClient, IUser } from '@alga-psa/types';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { ColumnDefinition } from '@alga-psa/types';
import { deleteTicket, deleteTickets } from '../actions/ticketActions';
import { bundleTicketsAction } from '../actions/ticketBundleActions';
import { fetchBundleChildrenForMaster } from '../actions/optimizedTicketActions';
import { XCircle, Clock } from 'lucide-react';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { useIntervalTracking } from '@alga-psa/ui/hooks';
import type { TicketingDisplaySettings } from '../actions/ticketDisplaySettings';
import { toast } from 'react-hot-toast';
import { createTicketColumns } from '@alga-psa/tickets/lib';
import Spinner from '@alga-psa/ui/components/Spinner';
import MultiUserPicker from '@alga-psa/ui/components/MultiUserPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/users/actions';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { useDrawer } from '@alga-psa/ui';
import { getClientById } from '../actions/clientLookupActions';

interface TicketingDashboardProps {
  id?: string;
  initialTickets: ITicketListItem[];
  initialBoards: IBoard[];
  initialStatuses: SelectOption[];
  initialPriorities: SelectOption[];
  initialCategories: ITicketCategory[];
  initialClients: IClient[];
  initialTags?: string[];
  initialUsers?: IUser[];
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
  renderClientDetails?: (args: { id: string; client: IClient }) => React.ReactNode;
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
  initialUsers = [],
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
  onSortChange,
  renderClientDetails,
}) => {
  const BUNDLE_VIEW_STORAGE_KEY = 'tickets_bundle_view';
  // Pre-fetch tag permissions to prevent individual API calls
  useTagPermissions(['ticket']);
  
  const [tickets, setTickets] = useState<ITicketListItem[]>(initialTickets);
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(new Set());
  const [visibleTicketIds, setVisibleTicketIds] = useState<string[]>([]);
  const [ticketToDelete, setTicketToDelete] = useState<string | null>(null);
  const [ticketToDeleteName, setTicketToDeleteName] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(user || null);
  const { openDrawer, replaceDrawer } = useDrawer();
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkDeleteErrors, setBulkDeleteErrors] = useState<Array<{ ticketId: string; message: string }>>([]);
  const [additionalAgentAvatarUrls, setAdditionalAgentAvatarUrls] = useState<Record<string, string | null>>({});
  const [isBundleDialogOpen, setIsBundleDialogOpen] = useState(false);
  const [bundleMasterTicketId, setBundleMasterTicketId] = useState<string | null>(null);
  const [bundleSyncUpdates, setBundleSyncUpdates] = useState(true);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [isMultiClientBundleConfirmOpen, setIsMultiClientBundleConfirmOpen] = useState(false);
  const [canUpdateTickets, setCanUpdateTickets] = useState(true);

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

  // Assignee filter state
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>(initialFilterValues.assignedToIds ?? []);
  const [includeUnassigned, setIncludeUnassigned] = useState<boolean>(initialFilterValues.includeUnassigned ?? false);

  // Due date filter state
  const [selectedDueDateFilter, setSelectedDueDateFilter] = useState<string>(initialFilterValues.dueDateFilter ?? 'all');
  const [dueDateFilterValue, setDueDateFilterValue] = useState<Date | undefined>(() => {
    // Initialize from dueDateFrom (for 'after') or dueDateTo (for 'before') from URL
    const dateStr = initialFilterValues.dueDateFrom || initialFilterValues.dueDateTo;
    return dateStr ? new Date(dateStr) : undefined;
  });
  const [selectedResponseState, setSelectedResponseState] = useState<'awaiting_client' | 'awaiting_internal' | 'none' | 'all'>(
    initialFilterValues.responseState ?? 'all'
  );
  const [bundleView, setBundleView] = useState<'bundled' | 'individual'>(initialFilterValues.bundleView ?? 'bundled');

  const [clientFilterState, setClientFilterState] = useState<'active' | 'inactive' | 'all'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  const filtersHaveInitialValues = useMemo(() => {
    return Boolean(
      initialFilterValues.boardId ||
      initialFilterValues.clientId ||
      (initialFilterValues.statusId && initialFilterValues.statusId !== 'open') ||
      (initialFilterValues.priorityId && initialFilterValues.priorityId !== 'all') ||
      initialFilterValues.categoryId ||
      (initialFilterValues.tags && initialFilterValues.tags.length > 0) ||
      (initialFilterValues.assignedToIds && initialFilterValues.assignedToIds.length > 0) ||
      initialFilterValues.includeUnassigned ||
      (initialFilterValues.dueDateFilter && initialFilterValues.dueDateFilter !== 'all') ||
      initialFilterValues.dueDateFrom ||
      initialFilterValues.dueDateTo
    );
  }, [initialFilterValues.boardId, initialFilterValues.clientId, initialFilterValues.statusId, initialFilterValues.priorityId, initialFilterValues.categoryId, initialFilterValues.tags, initialFilterValues.assignedToIds, initialFilterValues.includeUnassigned, initialFilterValues.dueDateFilter, initialFilterValues.dueDateFrom, initialFilterValues.dueDateTo]);

  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isLoadingSelf, setIsLoadingSelf] = useState(false);

  // Tag-related state
  const [selectedTags, setSelectedTags] = useState<string[]>(initialFilterValues.tags || []);
  const ticketTagsRef = useRef<Record<string, ITag[]>>({});
  const [allUniqueTags, setAllUniqueTags] = useState<ITag[]>(
    initialTags.map(tagText => ({ tag_text: tagText } as ITag))
  );
  const [tagsVersion, setTagsVersion] = useState(0); // Used to force re-render when tags are fetched

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
    // New list payload means pagination/filters changed; reset any inline expansion state.
    setExpandedBundleMasters(new Set());
    setLoadedBundleChildrenMasters(new Set());
  }, [initialTickets]);

  // Fetch avatar URLs for additional agents when tickets change
  useEffect(() => {
    const fetchAvatarUrls = async () => {
      // Collect all unique user IDs from additional agents
      const userIds = new Set<string>();
      tickets.forEach(ticket => {
        ticket.additional_agents?.forEach(agent => {
          userIds.add(agent.user_id);
        });
      });

      if (userIds.size === 0) return;

      // Get tenant from first ticket
      const tenant = tickets[0]?.tenant;
      if (!tenant) return;

      try {
        const avatarUrlsMap = await getUserAvatarUrlsBatchAction(Array.from(userIds), tenant);
        // Convert Map to Record
        const urlsRecord: Record<string, string | null> = {};
        avatarUrlsMap.forEach((url, id) => {
          urlsRecord[id] = url;
        });
        setAdditionalAgentAvatarUrls(urlsRecord);
      } catch (error) {
        console.error('Failed to fetch avatar URLs:', error);
      }
    };

    fetchAvatarUrls();
  }, [tickets]);

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
        // Force re-render to show fetched tags
        setTagsVersion(v => v + 1);
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };
    fetchTags();
  }, [initialTickets]);

  // No longer need client-side tag fetching since we get all tags from server

  const debouncedSearchQuery = useDebounce(searchQuery, 500);

  // Persist bundle view preference locally (URL params still take precedence when present)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (initialFilterValues.bundleView) return;

    const stored = window.localStorage.getItem(BUNDLE_VIEW_STORAGE_KEY);
    if (stored === 'bundled' || stored === 'individual') {
      setBundleView(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(BUNDLE_VIEW_STORAGE_KEY, bundleView);
  }, [bundleView]);

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
    // Include assignee filters in returnFilters for consistent back-navigation
    if (selectedAssignees.length > 0) {
      params.set('assignedToIds', selectedAssignees.join(','));
    }
    if (includeUnassigned) {
      params.set('includeUnassigned', 'true');
    }
    // Include due date filter in URL params
    if (selectedDueDateFilter && selectedDueDateFilter !== 'all') {
      params.set('dueDateFilter', selectedDueDateFilter);
      // Add the date value for before/after filters
      if (dueDateFilterValue) {
        if (selectedDueDateFilter === 'before') {
          params.set('dueDateTo', dueDateFilterValue.toISOString());
        } else if (selectedDueDateFilter === 'after') {
          params.set('dueDateFrom', dueDateFilterValue.toISOString());
        }
      }
    }
    if (bundleView && bundleView !== 'bundled') {
      params.set('bundleView', bundleView);
    }
    if (selectedResponseState && selectedResponseState !== 'all') {
      params.set('responseState', selectedResponseState);
    }
    if (selectedTags.length > 0) {
      params.set('tags', selectedTags.map(tag => encodeURIComponent(String(tag))).join(','));
    }
    if (sortBy && sortBy !== 'entered_at') {
      params.set('sortBy', sortBy);
    }
    if (sortDirection && sortDirection !== 'desc') {
      params.set('sortDirection', sortDirection);
    }
    if (currentPage > 1) params.set('page', String(currentPage));
    if (pageSize !== 10) params.set('pageSize', String(pageSize));

    return params.toString();
  }, [selectedBoard, selectedClient, selectedStatus, selectedPriority, selectedCategories, debouncedSearchQuery, boardFilterState, selectedAssignees, includeUnassigned, selectedDueDateFilter, dueDateFilterValue, bundleView, selectedResponseState, selectedTags, sortBy, sortDirection, currentPage, pageSize]);

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
      assignedToIds: selectedAssignees.length > 0 ? selectedAssignees : undefined,
      includeUnassigned: includeUnassigned || undefined,
      dueDateFilter: selectedDueDateFilter !== 'all' ? selectedDueDateFilter as ITicketListFilters['dueDateFilter'] : undefined,
      dueDateFrom: selectedDueDateFilter === 'after' && dueDateFilterValue ? dueDateFilterValue.toISOString() : undefined,
      dueDateTo: selectedDueDateFilter === 'before' && dueDateFilterValue ? dueDateFilterValue.toISOString() : undefined,
      responseState: selectedResponseState !== 'all' ? selectedResponseState : undefined,
      bundleView,
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
    bundleView,
    selectedTags,
    selectedAssignees,
    includeUnassigned,
    selectedDueDateFilter,
    dueDateFilterValue,
    selectedResponseState,
    // onFiltersChanged intentionally omitted - we want to trigger only when filter values change, not when the callback changes
    filtersHaveInitialValues
  ]);

  const handleDeleteTicket = (ticketId: string, ticketNameOrNumber: string) => {
    setTicketToDelete(ticketId);
    setTicketToDeleteName(ticketNameOrNumber);
    setDeleteError(null);
  };
  
  const onQuickViewClient = useCallback(async (clientId: string) => {
    if (!clientId) return;

    openDrawer(<div className="p-4 text-sm text-gray-600">Loading…</div>, undefined, undefined, '900px');
    try {
      const client = await getClientById(clientId);
      if (!client) {
        replaceDrawer(<div className="p-4 text-sm text-gray-600">Client not found.</div>);
        return;
      }

      replaceDrawer(
        renderClientDetails
          ? renderClientDetails({ id: `${id}-client-details`, client })
          : <div className="p-4 text-sm text-gray-600">Client details renderer not configured.</div>,
        undefined,
        '900px'
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load client.';
      replaceDrawer(<div className="p-4 text-sm text-red-600">{message}</div>);
    }
  }, [id, openDrawer, replaceDrawer, renderClientDetails]);
  
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

  useEffect(() => {
    const load = async () => {
      if (!currentUser) return;
      try {
        const permissions = await getCurrentUserPermissions();
        setCanUpdateTickets(permissions.includes('ticket:update'));
      } catch {
        setCanUpdateTickets(true);
      }
    };
    load();
  }, [currentUser]);
  
  // Use interval tracking hook to get interval count
  const { intervalCount, isLoading: isLoadingIntervals } = useIntervalTracking(currentUser?.id);

  const confirmDeleteTicket = async () => {
    if (!ticketToDelete) return;

    try {
      await deleteTicket(ticketToDelete);
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

  const [expandedBundleMasters, setExpandedBundleMasters] = useState<Set<string>>(new Set());
  const [loadedBundleChildrenMasters, setLoadedBundleChildrenMasters] = useState<Set<string>>(new Set());

  const isBundleExpanded = useCallback(
    (masterTicketId: string) => expandedBundleMasters.has(masterTicketId),
    [expandedBundleMasters]
  );

  const toggleBundleExpanded = useCallback(async (masterTicketId: string) => {
    const willExpand = !expandedBundleMasters.has(masterTicketId);

    // Toggle immediately for responsive UI.
    setExpandedBundleMasters(prev => {
      const next = new Set(prev);
      if (next.has(masterTicketId)) next.delete(masterTicketId);
      else next.add(masterTicketId);
      return next;
    });

    // In bundled view, the list API intentionally omits children. Load them on first expand.
    if (
      willExpand &&
      bundleView === 'bundled' &&
      !loadedBundleChildrenMasters.has(masterTicketId)
    ) {
      try {
        const children = await fetchBundleChildrenForMaster(masterTicketId);
        if (children.length > 0) {
          setTickets(prev => {
            const existing = new Set(prev.map(t => t.ticket_id).filter((id): id is string => !!id));
            const next = [...prev];
            for (const child of children) {
              if (child.ticket_id && !existing.has(child.ticket_id)) {
                next.push(child);
                existing.add(child.ticket_id);
              }
            }
            return next;
          });
        }
        setLoadedBundleChildrenMasters(prev => {
          const next = new Set(prev);
          next.add(masterTicketId);
          return next;
        });
      } catch (error) {
        console.error('Failed to load bundle children:', error);
        toast.error('Failed to load bundled tickets');
      }
    }
  }, [bundleView, currentUser, expandedBundleMasters, loadedBundleChildrenMasters]);

  const displayedTickets = useMemo(() => {
    // In bundled view we collapse children under masters and allow expanding inline.
    // In individual view we show tickets as returned (flat list).
    if (bundleView === 'individual') {
      return tickets;
    }

    const childrenByMaster = new Map<string, ITicketListItem[]>();
    const mastersOrStandalone: ITicketListItem[] = [];
    const orphans: ITicketListItem[] = [];

    const presentIds = new Set(tickets.map(t => t.ticket_id).filter((id): id is string => !!id));

    for (const t of tickets) {
      if (!t.ticket_id) continue;
      if (t.master_ticket_id) {
        // Child ticket
        if (presentIds.has(t.master_ticket_id)) {
          const list = childrenByMaster.get(t.master_ticket_id) || [];
          list.push(t);
          childrenByMaster.set(t.master_ticket_id, list);
        } else {
          orphans.push(t);
        }
      } else {
        mastersOrStandalone.push(t);
      }
    }

    // Stable ordering of children per master
    for (const [mid, list] of childrenByMaster.entries()) {
      list.sort((a, b) => {
        const au = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bu = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bu - au;
      });
      childrenByMaster.set(mid, list);
    }

    const result: ITicketListItem[] = [];
    for (const t of mastersOrStandalone) {
      result.push(t);
      if ((t.bundle_child_count ?? 0) > 0 && t.ticket_id) {
        if (expandedBundleMasters.has(t.ticket_id)) {
          const kids = childrenByMaster.get(t.ticket_id) || [];
          result.push(...kids);
        }
      }
    }

    // Append children whose masters aren't on this page
    if (orphans.length > 0) {
      orphans.sort((a, b) => {
        const au = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bu = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bu - au;
      });
      result.push(...orphans);
    }

    return result;
  }, [tickets, bundleView, expandedBundleMasters]);

  // Add id to each ticket for DataTable keys (no client-side filtering needed)
  const ticketsWithIds = useMemo(() =>
    displayedTickets.map((ticket): any => ({
      ...ticket,
      id: ticket.ticket_id
    })), [displayedTickets]);

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
      return [] as Array<{ ticket_id: string; ticket_number?: string; title?: string; client_id?: string | null; client_name?: string }>;
    }

    const selectedSet = new Set(selectedTicketIds);

    return tickets
      .filter(ticket => ticket.ticket_id && selectedSet.has(ticket.ticket_id))
      .map(ticket => ({
        ticket_id: ticket.ticket_id as string,
        ticket_number: ticket.ticket_number,
        title: ticket.title,
        client_id: ticket.client_id ?? null,
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

  const isSelectedBundleMultiClient = useMemo(() => {
    const uniqueClientIds = new Set(
      selectedTicketDetails
        .map(detail => detail.client_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    );
    return uniqueClientIds.size > 1;
  }, [selectedTicketDetails]);

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
      additionalAgentAvatarUrls,
      isBundleExpanded: bundleView === 'bundled' ? isBundleExpanded : undefined,
      onToggleBundleExpanded: bundleView === 'bundled' ? toggleBundleExpanded : undefined,
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
    additionalAgentAvatarUrls,
    isBundleExpanded,
    toggleBundleExpanded,
    bundleView,
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
      const result = await deleteTickets(selectedTicketIdsArray);

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
  }, [selectedTicketIdsArray, clearSelection]);

  const performBundleTickets = useCallback(async () => {
    if (selectedTicketIdsArray.length < 2) {
      setBundleError('Select at least two tickets to bundle.');
      return;
    }
    if (!bundleMasterTicketId) {
      setBundleError('Select a master ticket.');
      return;
    }

    setBundleError(null);
    try {
      await bundleTicketsAction({
        masterTicketId: bundleMasterTicketId,
        childTicketIds: selectedTicketIdsArray.filter((id) => id !== bundleMasterTicketId),
        mode: bundleSyncUpdates ? 'sync_updates' : 'link_only',
      });

      toast.success('Tickets bundled');
      setIsBundleDialogOpen(false);
      clearSelection();

      onFiltersChanged({
        boardId: selectedBoard ?? undefined,
        statusId: selectedStatus,
        priorityId: selectedPriority,
        categoryId: selectedCategories.length > 0 ? selectedCategories[0] : undefined,
        clientId: selectedClient ?? undefined,
        searchQuery: debouncedSearchQuery,
        boardFilterState: boardFilterState,
        showOpenOnly: selectedStatus === 'open',
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        bundleView,
      });
    } catch (error) {
      console.error('Failed to bundle tickets:', error);
      setBundleError(error instanceof Error ? error.message : 'Failed to bundle tickets');
      toast.error('Failed to bundle tickets');
    }
  }, [
    selectedTicketIdsArray,
    bundleMasterTicketId,
    bundleSyncUpdates,
    currentUser,
    clearSelection,
    onFiltersChanged,
    selectedBoard,
    selectedStatus,
    selectedPriority,
    selectedCategories,
    selectedClient,
    debouncedSearchQuery,
    boardFilterState,
    selectedTags,
    bundleView,
  ]);

  const handleConfirmBundleTickets = useCallback(() => {
    if (isSelectedBundleMultiClient) {
      setIsMultiClientBundleConfirmOpen(true);
      return;
    }
    void performBundleTickets();
  }, [isSelectedBundleMultiClient, performBundleTickets]);


  const handleTicketAdded = useCallback((newTicket: ITicket) => {
    // Store tags for the new ticket if provided
    if (newTicket.ticket_id && newTicket.tags && newTicket.tags.length > 0) {
      ticketTagsRef.current[newTicket.ticket_id] = newTicket.tags;

      // Update unique tags list with any new tags
      setAllUniqueTags(prevTags => {
        const currentTagTexts = new Set(prevTags.map(t => t.tag_text));
        const newUniqueTags = newTicket.tags!.filter(tag => !currentTagTexts.has(tag.tag_text));
        if (newUniqueTags.length > 0) {
          return [...prevTags, ...newUniqueTags];
        }
        return prevTags;
      });
    }

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
        tenant: newTicket.tenant,
        tags: newTicket.tags
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
    const defaultDueDateFilter: string = 'all';
    const defaultResponseState: 'awaiting_client' | 'awaiting_internal' | 'none' | 'all' = 'all';
    const defaultBundleView: 'bundled' | 'individual' = 'bundled';

    setSelectedBoard(defaultBoard);
    setSelectedClient(defaultClient);
    setSelectedStatus(defaultStatus);
    setSelectedPriority(defaultPriority);
    setSelectedCategories(defaultCategories);
    setExcludedCategories([]);
    setSearchQuery(defaultSearchQuery);
    setBoardFilterState(defaultBoardFilterState);
    setBundleView(defaultBundleView);
    setSelectedTags([]);
    setSelectedAssignees([]);
    setIncludeUnassigned(false);
    setSelectedDueDateFilter(defaultDueDateFilter);
    setDueDateFilterValue(undefined);
    setSelectedResponseState(defaultResponseState);

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
      assignedToIds: undefined,
      includeUnassigned: undefined,
      dueDateFilter: undefined,
      dueDateFrom: undefined,
      dueDateTo: undefined,
      responseState: undefined,
      bundleView: defaultBundleView,
    });
  }, [onFiltersChanged, clearSelection]);

  return (
    <ReflectionContainer id={id} label="Ticketing Dashboard">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Ticketing Dashboard</h1>
        <div className="flex items-center gap-3">
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
          {selectedTicketIds.size >= 2 && (
            <Button
              id={`${id}-bundle-tickets-button`}
              onClick={() => {
                setBundleError(null);
                const first = Array.from(selectedTicketIds)[0] || null;
                setBundleMasterTicketId(first);
                setBundleSyncUpdates(true);
                setIsBundleDialogOpen(true);
              }}
              className="flex items-center gap-2"
              disabled={!canUpdateTickets}
            >
              Bundle Tickets
            </Button>
          )}
          <Button id="add-ticket-button" onClick={() => setIsQuickAddOpen(true)}>Add Ticket</Button>
        </div>
      </div>
      <div className="bg-white shadow rounded-lg">
        <div className="sticky top-0 z-40 bg-white rounded-t-lg p-6 border-b border-gray-100">
          <ReflectionContainer id={`${id}-filters`} label="Ticket DashboardFilters">
            <div className="flex items-center gap-4 flex-wrap">
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
            <MultiUserPicker
              id={`${id}-assignee-filter`}
              users={initialUsers}
              values={selectedAssignees}
              onValuesChange={setSelectedAssignees}
              getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
              filterMode={true}
              includeUnassigned={includeUnassigned}
              onUnassignedChange={setIncludeUnassigned}
              placeholder="All Assignees"
              showSearch={true}
              compactDisplay={true}
            />

            <div className="h-6 w-px bg-gray-200 mx-1 shrink-0" />

            <CustomSelect
              data-automation-id={`${id}-status-select`}
              options={statusOptions}
              value={selectedStatus}
              onValueChange={(value) => setSelectedStatus(value)}
              placeholder="Select Status"
            />
            <CustomSelect
              data-automation-id={`${id}-response-state-select`}
              options={[
                { value: 'all', label: 'All Response States' },
                { value: 'awaiting_client', label: 'Awaiting Client' },
                { value: 'awaiting_internal', label: 'Awaiting Internal' },
                { value: 'none', label: 'No Response State' },
              ]}
              value={selectedResponseState}
              onValueChange={(value) => setSelectedResponseState(value as 'awaiting_client' | 'awaiting_internal' | 'none' | 'all')}
              placeholder="Response State"
            />
            <PrioritySelect
              id={`${id}-priority-select`}
              options={priorityOptions}
              value={selectedPriority}
              onValueChange={(value) => setSelectedPriority(value)}
              placeholder="All Priorities"
            />
            <div className="flex items-center gap-1">
              <CustomSelect
                data-automation-id={`${id}-due-date-filter`}
                options={[
                  { value: 'all', label: 'All Due Dates' },
                  { value: 'overdue', label: 'Overdue' },
                  { value: 'today', label: 'Due Today' },
                  { value: 'upcoming', label: 'Due Next 7 Days' },
                  { value: 'before', label: dueDateFilterValue && selectedDueDateFilter === 'before'
                    ? `Before ${dueDateFilterValue.toLocaleDateString()}`
                    : 'Before Date...' },
                  { value: 'after', label: dueDateFilterValue && selectedDueDateFilter === 'after'
                    ? `After ${dueDateFilterValue.toLocaleDateString()}`
                    : 'After Date...' },
                  { value: 'no_due_date', label: 'No Due Date' },
                ]}
                value={selectedDueDateFilter}
                onValueChange={(value) => {
                  setSelectedDueDateFilter(value);
                  if (value !== 'before' && value !== 'after') {
                    setDueDateFilterValue(undefined);
                  }
                }}
                placeholder="Due Date"
                className="w-fit min-w-[140px]"
              />
              {(selectedDueDateFilter === 'before' || selectedDueDateFilter === 'after') && (
                <DatePicker
                  id={`${id}-due-date-filter-value`}
                  value={dueDateFilterValue}
                  onChange={setDueDateFilterValue}
                  placeholder="Pick date"
                />
              )}
            </div>

            <div className="h-6 w-px bg-gray-200 mx-1 shrink-0" />

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
              className="h-[38px] min-w-[350px] text-sm"
              containerClassName=""
            />
            <TagFilter
              tags={allUniqueTags}
              selectedTags={selectedTags}
              onToggleTag={(tag: string) => {
                setSelectedTags(prev =>
                  prev.includes(tag)
                    ? prev.filter(t => t !== tag)
                    : [...prev, tag]
                );
              }}
              onClearTags={() => setSelectedTags([])}
            />

            <div className="h-6 w-px bg-gray-200 mx-1 shrink-0" />

            <div className="flex items-center gap-2 shrink-0">
              <Label htmlFor={`${id}-bundle-view-toggle`} className="text-sm text-gray-600">
                Bundled
              </Label>
              <Switch
                id={`${id}-bundle-view-toggle`}
                checked={bundleView === 'bundled'}
                onCheckedChange={(checked) => setBundleView(checked ? 'bundled' : 'individual')}
              />
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetFilters}
              className="text-gray-500 hover:text-gray-700 shrink-0"
              id='reset-filters'
            >
              <XCircle className="h-4 w-4 mr-1" />
              Reset
            </Button>
            </div>
          </ReflectionContainer>
        </div>

        <div className="p-6">
        {/* isLoadingMore prop now correctly reflects loading state from container for pagination or filter changes */}
        {isLoadingMore ? (
          <Spinner size="md" className="h-32 w-full" />
        ) : (
          <>
            {showSelectAllBanner && (
              <Alert variant="info" className="mb-3">
                <AlertDescription className="flex items-center justify-between w-full">
                  <span>
                    All {visibleTicketIds.length} ticket{visibleTicketIds.length === 1 ? '' : 's'} on this page are selected.
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">
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
                </AlertDescription>
              </Alert>
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
                `cursor-pointer ${record.ticket_id && selectedTicketIds.has(record.ticket_id)
                  ? '!bg-blue-50'
                  : ''}`
              }
              onRowClick={(record: ITicketListItem) => {
                if (record.ticket_id) {
                  handleTicketClick(record.ticket_id);
                }
              }}
              onVisibleRowsChange={handleVisibleRowsChange}
              manualSorting={true}
              sortBy={sortBy}
              sortDirection={sortDirection}
              onSortChange={handleTableSortChange}
            />
          </>
        )}
        </div>
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
      <ConfirmationDialog
        id={`${id}-bundle-multi-client-confirm`}
        isOpen={isMultiClientBundleConfirmOpen}
        onClose={() => setIsMultiClientBundleConfirmOpen(false)}
        onConfirm={async () => {
          setIsMultiClientBundleConfirmOpen(false);
          await performBundleTickets();
        }}
        title="Bundle spans multiple clients"
        message="This bundle includes tickets from multiple clients. Confirm that you want to proceed."
        confirmLabel="Proceed"
        cancelLabel="Cancel"
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

      <Dialog
        isOpen={isBundleDialogOpen && selectedTicketIds.size >= 2}
        onClose={() => {
          setIsBundleDialogOpen(false);
          setBundleError(null);
        }}
        id={`${id}-bundle-dialog`}
        title="Bundle Tickets"
      >
        <DialogContent>
          {bundleError && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {bundleError}
            </div>
          )}
          {(() => {
            if (!isSelectedBundleMultiClient) return null;
            return (
              <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                This bundle spans multiple clients. You'll be asked to confirm before bundling.
              </div>
            );
          })()}
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium text-gray-700 mb-1">Select Master Ticket</div>
              <CustomSelect
                id={`${id}-bundle-master-select`}
                value={bundleMasterTicketId || ''}
                options={selectedTicketDetails.map(detail => ({
                  value: detail.ticket_id,
                  label: detail.ticket_number || detail.title || detail.ticket_id
                }))}
                onValueChange={(value) => setBundleMasterTicketId(value)}
                placeholder="Select master ticket..."
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-bundle-sync-updates`}
                checked={bundleSyncUpdates}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setBundleSyncUpdates(event.target.checked)}
                containerClassName="mb-0"
                skipRegistration
              />
              <label htmlFor={`${id}-bundle-sync-updates`} className="text-sm text-gray-700">
                Sync updates from master to children (public replies + workflow changes)
              </label>
            </div>

            <div className="text-xs text-gray-500">
              Child tickets keep their current status when bundled. Workflow fields are locked on children by default. Internal notes stay on the master.
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            id={`${id}-bundle-cancel`}
            variant="outline"
            onClick={() => {
              setIsBundleDialogOpen(false);
              setBundleError(null);
            }}
          >
            Cancel
          </Button>
          <Button
            id={`${id}-bundle-confirm`}
            onClick={handleConfirmBundleTickets}
            disabled={selectedTicketIdsArray.length < 2 || !bundleMasterTicketId}
          >
            Bundle Tickets
          </Button>
        </DialogFooter>
      </Dialog>
    </ReflectionContainer>
  );
};

export default TicketingDashboard;
