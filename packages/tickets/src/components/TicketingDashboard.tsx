'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { ITicket, ITicketListItem, ITicketCategory, ITicketListFilters, DeletionValidationResult } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import { QuickAddTicket } from './QuickAddTicket';
import { CategoryPicker } from './CategoryPicker';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { PrioritySelect } from '@alga-psa/ui/components';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Input } from '@alga-psa/ui/components/Input';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import { getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import { BoardPicker } from '@alga-psa/ui/components/settings/general/BoardPicker';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { TagFilter } from '@alga-psa/ui/components';
import { useTagPermissions } from '@alga-psa/tags/hooks';
import { IBoard, IClient, IUser, ITeam } from '@alga-psa/types';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { ColumnDefinition } from '@alga-psa/types';
import { deleteTicket, deleteTickets, moveTicketsToBoard } from '../actions/ticketActions';
import { getBoardTicketStatuses } from '../actions/board-actions/boardTicketStatusActions';
import { bundleTicketsAction } from '../actions/ticketBundleActions';
import { fetchBundleChildrenForMaster, getAllMatchingTicketIds } from '../actions/optimizedTicketActions';
import TicketExportDialog from './TicketExportDialog';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { XCircle, Clock, Download, ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@alga-psa/ui/components/DropdownMenu';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { useIntervalTracking } from '@alga-psa/ui/hooks';
import type { TicketingDisplaySettings } from '../actions/ticketDisplaySettings';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { createTicketColumns } from '@alga-psa/tickets/lib';
import { useTicketCrossFeature } from '../context/TicketCrossFeatureContext';
import Spinner from '@alga-psa/ui/components/Spinner';

import QuickAddCategory from './QuickAddCategory';
import MultiUserAndTeamPicker from '@alga-psa/ui/components/MultiUserAndTeamPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';
import ViewDensityControl from '@alga-psa/ui/components/ViewDensityControl';
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
  initialTags?: ITag[];
  initialUsers?: IUser[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onFilterChange: (update: Partial<ITicketListFilters>) => void;
  filterValues: Partial<ITicketListFilters>;
  isLoadingMore: boolean;
  user?: IUser;
  displaySettings?: TicketingDisplaySettings;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  onSortChange: (sortBy: string, sortDirection: 'asc' | 'desc') => void;
  renderClientDetails?: (args: { id: string; client: IClient }) => React.ReactNode;
  initialAgentAvatarUrls?: Record<string, string | null>;
  initialTeamAvatarUrls?: Record<string, string | null>;
  initialTicketTags?: Record<string, ITag[]>;
  initialTeams?: ITeam[];
  canUpdateTickets?: boolean;
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

const TICKET_LIST_DENSITY_STORAGE_KEY = 'ticket_list_density_level';
const EMPTY_STRING_ARRAY: string[] = [];

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
  onFilterChange,
  filterValues,
  isLoadingMore,
  user,
  displaySettings,
  sortBy = 'entered_at',
  sortDirection = 'desc',
  onSortChange,
  renderClientDetails,
  initialAgentAvatarUrls = {},
  initialTeamAvatarUrls = {},
  initialTicketTags = {},
  initialTeams = [],
  canUpdateTickets = true,
}) => {
  const BUNDLE_VIEW_STORAGE_KEY = 'tickets_bundle_view';
  const router = useRouter();
  const { renderSlaIndicator } = useTicketCrossFeature();
  // Pre-fetch tag permissions to prevent individual API calls
  useTagPermissions(['ticket']);

  const [tickets, setTickets] = useState<ITicketListItem[]>(initialTickets);
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(new Set());
  const [allMatchingMode, setAllMatchingMode] = useState(false);
  const [visibleTicketIds, setVisibleTicketIds] = useState<string[]>([]);
  const [ticketToDelete, setTicketToDelete] = useState<string | null>(null);
  const [ticketToDeleteName, setTicketToDeleteName] = useState<string | null>(null);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  const currentUser = user || null;
  const { openDrawer, replaceDrawer } = useDrawer();
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkDeleteErrors, setBulkDeleteErrors] = useState<Array<{ ticketId: string; message: string }>>([]);
  const [isBulkMoveDialogOpen, setIsBulkMoveDialogOpen] = useState(false);
  const [isBulkMoving, setIsBulkMoving] = useState(false);
  const [bulkMoveErrors, setBulkMoveErrors] = useState<Array<{ ticketId: string; message: string }>>([]);
  const [selectedDestinationBoardId, setSelectedDestinationBoardId] = useState<string>('');
  const [destinationBoardStatuses, setDestinationBoardStatuses] = useState<SelectOption[]>([]);
  const [selectedDestinationStatusId, setSelectedDestinationStatusId] = useState<string>('');
  const [isLoadingDestinationStatuses, setIsLoadingDestinationStatuses] = useState(false);
  const [destinationStatusError, setDestinationStatusError] = useState<string>('');
  const [additionalAgentAvatarUrls, setAdditionalAgentAvatarUrls] = useState<Record<string, string | null>>(initialAgentAvatarUrls);
  const [teamAvatarUrls, setTeamAvatarUrls] = useState<Record<string, string | null>>(initialTeamAvatarUrls);
  const [isBundleDialogOpen, setIsBundleDialogOpen] = useState(false);
  const [bundleMasterTicketId, setBundleMasterTicketId] = useState<string | null>(null);
  const [bundleSyncUpdates, setBundleSyncUpdates] = useState(true);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [isMultiClientBundleConfirmOpen, setIsMultiClientBundleConfirmOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);

  const [boards] = useState<IBoard[]>(initialBoards);
  const [clients] = useState<IClient[]>(initialClients);
  const [categories, setCategories] = useState<ITicketCategory[]>(initialCategories);
  const [statusOptions] = useState<SelectOption[]>(initialStatuses);
  const [priorityOptions] = useState<SelectOption[]>(initialPriorities);
  
  // Filter values derived from props (single source of truth is Container's activeFilters)
  const selectedBoard = filterValues.boardId ?? null;
  const selectedClient = filterValues.clientId ?? null;
  const selectedStatus = filterValues.statusId ?? 'open';
  const selectedPriority = filterValues.priorityId ?? 'all';
  const selectedCategories = useMemo(() =>
    filterValues.categoryId ? [filterValues.categoryId] : EMPTY_STRING_ARRAY,
    [filterValues.categoryId]
  );
  const [excludedCategories, setExcludedCategories] = useState<string[]>([]);
  const [isQuickAddCategoryOpen, setIsQuickAddCategoryOpen] = useState(false);
  const boardFilterState = filterValues.boardFilterState ?? 'active';

  // Search query needs local state for responsive typing, debounced before emitting
  const [searchQuery, setSearchQuery] = useState<string>(filterValues.searchQuery ?? '');

  // Assignee filter values from props
  const selectedAssignees = filterValues.assignedToIds ?? EMPTY_STRING_ARRAY;
  const selectedTeams = filterValues.assignedTeamIds ?? EMPTY_STRING_ARRAY;
  const includeUnassigned = filterValues.includeUnassigned ?? false;
  const [teams] = useState<ITeam[]>(initialTeams);

  // Due date filter values from props
  const selectedDueDateFilter = filterValues.dueDateFilter ?? 'all';
  const dueDateFilterValue = useMemo(() => {
    const dateStr = filterValues.dueDateFrom || filterValues.dueDateTo;
    return dateStr ? new Date(dateStr) : undefined;
  }, [filterValues.dueDateFrom, filterValues.dueDateTo]);
  const selectedResponseState = (filterValues.responseState ?? 'all') as 'awaiting_client' | 'awaiting_internal' | 'none' | 'all';
  const selectedSlaStatus = filterValues.slaStatusFilter ?? 'all';
  const bundleView = (filterValues.bundleView ?? 'bundled') as 'bundled' | 'individual';
  const [ticketListDensityLevel, setTicketListDensityLevel] = useState<number>(50);

  const [clientFilterState, setClientFilterState] = useState<'active' | 'inactive' | 'all'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

  // Tag filter values from props
  const selectedTags = filterValues.tags ?? EMPTY_STRING_ARRAY;
  const ticketTagsRef = useRef<Record<string, ITag[]>>(initialTicketTags);
  const [allUniqueTags, setAllUniqueTags] = useState<ITag[]>(initialTags || []);
  const [tagsVersion, setTagsVersion] = useState(0); // Used to force re-render when tags are fetched

  const isFiltered = useMemo(() => {
    return selectedBoard !== null ||
      selectedClient !== null ||
      selectedStatus !== 'open' ||
      selectedPriority !== 'all' ||
      selectedCategories.length > 0 ||
      searchQuery !== '' ||
      selectedTags.length > 0 ||
      selectedAssignees.length > 0 ||
      selectedTeams.length > 0 ||
      includeUnassigned ||
      selectedDueDateFilter !== 'all' ||
      selectedResponseState !== 'all' ||
      selectedSlaStatus !== 'all';
  }, [selectedBoard, selectedClient, selectedStatus, selectedPriority, selectedCategories, searchQuery, selectedTags, selectedAssignees, selectedTeams, includeUnassigned, selectedDueDateFilter, selectedResponseState, selectedSlaStatus]);

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
      // Only return a new array if there are actually new tags to add
      if (newTags.length === 0) {
        return current;
      }
      return [...current, ...newTags];
    });
  };

  useEffect(() => {
    setTickets(initialTickets);
    // New list payload means pagination/filters changed; reset any inline expansion state.
    setExpandedBundleMasters(new Set());
    setLoadedBundleChildrenMasters(new Set());
  }, [initialTickets]);

  // Avatar URLs are now provided via initialAgentAvatarUrls from server-side consolidated fetch
  useEffect(() => {
    setAdditionalAgentAvatarUrls(initialAgentAvatarUrls);
  }, [initialAgentAvatarUrls]);

  // Team avatar URLs are now provided via initialTeamAvatarUrls from server-side consolidated fetch
  useEffect(() => {
    setTeamAvatarUrls(initialTeamAvatarUrls);
  }, [initialTeamAvatarUrls]);

  // Sync search query from external changes (back/forward navigation).
  // Only fires when the container's value differs from what we last emitted.
  const lastEmittedSearchRef = useRef(filterValues.searchQuery ?? '');
  useEffect(() => {
    const incoming = filterValues.searchQuery ?? '';
    if (incoming !== lastEmittedSearchRef.current) {
      lastEmittedSearchRef.current = incoming;
      setSearchQuery(incoming);
    }
  }, [filterValues.searchQuery]);

  // Ticket tags are now provided via initialTicketTags from server-side consolidated fetch
  useEffect(() => {
    ticketTagsRef.current = initialTicketTags;
    setTagsVersion(v => v + 1);
  }, [initialTicketTags]);

  // No longer need client-side tag fetching since we get all tags from server

  const debouncedSearchQuery = useDebounce(searchQuery, 500);

  // Emit debounced search query changes to the container
  const isFirstSearchEmit = useRef(true);
  useEffect(() => {
    if (isFirstSearchEmit.current) {
      isFirstSearchEmit.current = false;
      return;
    }
    lastEmittedSearchRef.current = debouncedSearchQuery;
    onFilterChange({ searchQuery: debouncedSearchQuery });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchQuery]);

  // Persist bundle view preference to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(BUNDLE_VIEW_STORAGE_KEY, bundleView);
  }, [bundleView]);

  // Persist ticket list density preference locally.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = Number(window.localStorage.getItem(TICKET_LIST_DENSITY_STORAGE_KEY));
    if (Number.isFinite(stored) && stored >= 0 && stored <= 100) {
      setTicketListDensityLevel(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TICKET_LIST_DENSITY_STORAGE_KEY, String(ticketListDensityLevel));
  }, [ticketListDensityLevel]);

  const densityClasses = useMemo(() => {
    if (ticketListDensityLevel <= 15) {
      return {
        filterPadding: 'p-4',
        filterGap: 'gap-4',
        bodyPadding: 'p-4',
        tableRowDensity: '[&>td]:!py-1.5 [&>td]:!text-[13px]',
      };
    }

    if (ticketListDensityLevel >= 85) {
      return {
        filterPadding: 'p-6',
        filterGap: 'gap-4',
        bodyPadding: 'p-7',
        tableRowDensity: '[&>td]:!py-4 [&>td]:!text-[15px]',
      };
    }

    return {
      filterPadding: 'p-6',
      filterGap: 'gap-4',
      bodyPadding: 'p-6',
      tableRowDensity: '',
    };
  }, [ticketListDensityLevel]);

  // Helper function to generate URL with current filter state
  const getCurrentFiltersQuery = useCallback(() => {
    const params = new URLSearchParams();
    const f = filterValues;

    // Only add non-default/non-empty values to URL
    if (f.boardId) params.set('boardId', f.boardId);
    if (f.clientId) params.set('clientId', f.clientId);
    if (f.statusId && f.statusId !== 'open') params.set('statusId', f.statusId);
    if (f.priorityId && f.priorityId !== 'all') params.set('priorityId', f.priorityId);
    if (f.categoryId) params.set('categoryId', f.categoryId);
    if (f.searchQuery) params.set('searchQuery', f.searchQuery);
    if (f.boardFilterState && f.boardFilterState !== 'active') {
      params.set('boardFilterState', f.boardFilterState);
    }
    if (f.assignedToIds && f.assignedToIds.length > 0) {
      params.set('assignedToIds', f.assignedToIds.join(','));
    }
    if (f.assignedTeamIds && f.assignedTeamIds.length > 0) {
      params.set('assignedTeamIds', f.assignedTeamIds.join(','));
    }
    if (f.includeUnassigned) {
      params.set('includeUnassigned', 'true');
    }
    if (f.dueDateFilter && f.dueDateFilter !== 'all') {
      params.set('dueDateFilter', f.dueDateFilter);
      if (f.dueDateFrom) params.set('dueDateFrom', f.dueDateFrom);
      if (f.dueDateTo) params.set('dueDateTo', f.dueDateTo);
    }
    if (f.bundleView && f.bundleView !== 'bundled') {
      params.set('bundleView', f.bundleView);
    }
    if (f.responseState && f.responseState !== 'all') {
      params.set('responseState', f.responseState);
    }
    if (f.slaStatusFilter && f.slaStatusFilter !== 'all') {
      params.set('slaStatusFilter', f.slaStatusFilter);
    }
    if (f.tags && f.tags.length > 0) {
      params.set('tags', f.tags.join(','));
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
  }, [filterValues, sortBy, sortDirection, currentPage, pageSize]);

  const resetDeleteState = () => {
    setTicketToDelete(null);
    setTicketToDeleteName(null);
    setDeleteValidation(null);
    setIsDeleteValidating(false);
    setIsDeleteProcessing(false);
  };

  const runDeleteValidation = useCallback(async (ticketId: string) => {
    setIsDeleteValidating(true);
    try {
      const result = await preCheckDeletion('ticket', ticketId);
      setDeleteValidation(result);
    } catch (error) {
      console.error('Failed to validate ticket deletion:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: 'Failed to validate deletion. Please try again.',
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, []);

  const handleDeleteTicket = (ticketId: string, ticketNameOrNumber: string) => {
    setTicketToDelete(ticketId);
    setTicketToDeleteName(ticketNameOrNumber);
    void runDeleteValidation(ticketId);
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
  
  // Use interval tracking hook to get interval count
  const { intervalCount, isLoading: isLoadingIntervals } = useIntervalTracking(currentUser?.user_id);

  const confirmDeleteTicket = async () => {
    if (!ticketToDelete) return;

    try {
      setIsDeleteProcessing(true);
      const result = await deleteTicket(ticketToDelete);

      if (!result.success) {
        setDeleteValidation(result);
        return;
      }

      setTickets(prev => prev.filter(t => t.ticket_id !== ticketToDelete));
      setSelectedTicketIds(prev => {
        if (!ticketToDelete || !prev.has(ticketToDelete)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(ticketToDelete);
        return next;
      });
      resetDeleteState();
    } catch (error: any) {
      console.error('Failed to delete ticket:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: error?.message || 'An unexpected error occurred while deleting the ticket.',
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  // Custom function for clicking on tickets with filter preservation
  const handleTicketClick = useCallback((ticketId: string) => {
    const filterQuery = getCurrentFiltersQuery();
    const href = filterQuery 
      ? `/msp/tickets/${ticketId}?returnFilters=${encodeURIComponent(filterQuery)}`
      : `/msp/tickets/${ticketId}`;
    router.push(href);
  }, [getCurrentFiltersQuery, router]);


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
        handleError(error, 'Failed to load bundled tickets');
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
    if (!isChecked) {
      setAllMatchingMode(false);
    }
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
    if (!shouldSelect) {
      setAllMatchingMode(false);
    }
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

  const handleSelectAllMatchingTickets = useCallback(async () => {
    try {
      const filters: ITicketListFilters = {
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
        assignedTeamIds: selectedTeams.length > 0 ? selectedTeams : undefined,
        includeUnassigned: includeUnassigned || undefined,
        dueDateFilter: selectedDueDateFilter !== 'all' ? selectedDueDateFilter as ITicketListFilters['dueDateFilter'] : undefined,
        responseState: selectedResponseState !== 'all' ? selectedResponseState : undefined,
        slaStatusFilter: selectedSlaStatus !== 'all' ? selectedSlaStatus as ITicketListFilters['slaStatusFilter'] : undefined,
        bundleView,
      };
      const allIds = await getAllMatchingTicketIds(filters);
      setSelectedTicketIds(new Set(allIds));
      setAllMatchingMode(true);
    } catch (error) {
      console.error('Failed to fetch all matching ticket IDs:', error);
      // Fall back to selecting current page only
      setSelectedTicketIds(new Set(selectableTicketIds));
      setAllMatchingMode(true);
    }
  }, [
    selectedBoard, selectedStatus, selectedPriority, selectedCategories,
    selectedClient, debouncedSearchQuery, boardFilterState, selectedTags,
    selectedAssignees, selectedTeams, includeUnassigned, selectedDueDateFilter,
    selectedResponseState, selectedSlaStatus, bundleView, selectableTicketIds,
  ]);

  const handleBulkMoveBoardChange = useCallback(async (boardId: string) => {
    setSelectedDestinationBoardId(boardId);
    setDestinationStatusError('');
    setSelectedDestinationStatusId('');
    setDestinationBoardStatuses([]);

    if (!boardId) {
      return;
    }

    setIsLoadingDestinationStatuses(true);
    try {
      const statuses = await getBoardTicketStatuses(boardId);
      const boardStatusOptions = statuses.map((status) => ({
        value: status.status_id as string,
        label: status.name,
      }));
      const defaultStatus = statuses.find((status) => status.is_default);

      setDestinationBoardStatuses(boardStatusOptions);

      if (defaultStatus) {
        setSelectedDestinationStatusId(defaultStatus.status_id);
      } else {
        setSelectedDestinationStatusId(boardStatusOptions[0]?.value || '');
      }

      if (boardStatusOptions.length === 0) {
        setDestinationStatusError('This board has no ticket statuses configured for selection.');
      }
    } catch (error: unknown) {
      setDestinationStatusError(error instanceof Error ? error.message : 'Failed to load board statuses');
    } finally {
      setIsLoadingDestinationStatuses(false);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedTicketIds(prev => (prev.size === 0 ? prev : new Set<string>()));
    setAllMatchingMode(false);
  }, []);

  const visibleTicketIdSet = useMemo(() => new Set(visibleTicketIds.filter((id): id is string => !!id)), [visibleTicketIds]);
  const allVisibleTicketsSelected = visibleTicketIds.length > 0 && visibleTicketIds.every(id => selectedTicketIds.has(id));
  const selectedTicketIdsArray = useMemo(() => Array.from(selectedTicketIds), [selectedTicketIds]);
  const hasHiddenSelections = useMemo(
    () => selectedTicketIdsArray.some(id => !visibleTicketIdSet.has(id)),
    [selectedTicketIdsArray, visibleTicketIdSet]
  );
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
  const showSelectAllBanner = allVisibleTicketsSelected && !hasHiddenSelections && !allMatchingMode && totalCount > visibleTicketIds.length && visibleTicketIds.length > 0;

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
      teamAvatarUrls,
      isBundleExpanded: bundleView === 'bundled' ? isBundleExpanded : undefined,
      onToggleBundleExpanded: bundleView === 'bundled' ? toggleBundleExpanded : undefined,
      renderSlaIndicator,
    });

    const selectionColumn: ColumnDefinition<ITicketListItem> = {
      title: (
        <div
          className="flex items-center justify-center gap-0"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <Checkbox
            id={`${id}-select-all`}
            checked={allVisibleTicketsSelected}
            indeterminate={isSelectionIndeterminate}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              event.stopPropagation();
              if (!event.target.checked && allMatchingMode) {
                clearSelection();
              } else {
                handleSelectAllVisibleTickets(event.target.checked);
              }
            }}
            containerClassName="mb-0"
            className="m-0"
            skipRegistration
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center p-0 ml-0.5 text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-text-900))] focus:outline-none"
                onClick={(event) => event.stopPropagation()}
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[6rem]">
              <DropdownMenuItem onSelect={() => void handleSelectAllMatchingTickets()}>
                All
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={clearSelection}>
                None
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
    clearSelection,
    handleSelectAllMatchingTickets,
    allMatchingMode,
    additionalAgentAvatarUrls,
    teamAvatarUrls,
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

  const handleBulkMoveClose = useCallback(() => {
    if (isBulkMoving) {
      return;
    }
    setIsBulkMoveDialogOpen(false);
    setBulkMoveErrors([]);
    setSelectedDestinationBoardId('');
    setDestinationBoardStatuses([]);
    setSelectedDestinationStatusId('');
    setDestinationStatusError('');
    setIsLoadingDestinationStatuses(false);
  }, [isBulkMoving]);

  const handleConfirmBulkMove = useCallback(async () => {
    if (selectedTicketIdsArray.length === 0) {
      return;
    }

    if (!currentUser) {
      toast.error('You must be logged in to move tickets');
      return;
    }

    if (!selectedDestinationBoardId || !selectedDestinationStatusId || destinationBoardStatuses.length === 0) {
      return;
    }

    setIsBulkMoving(true);
    setBulkMoveErrors([]);

    try {
      const result = await moveTicketsToBoard(
        selectedTicketIdsArray,
        selectedDestinationBoardId,
        selectedDestinationStatusId
      );

      if (result.movedIds.length > 0) {
        const movedSet = new Set(result.movedIds);
        setTickets(prev => prev.filter(ticket => {
          if (!ticket.ticket_id) {
            return true;
          }
          return !movedSet.has(ticket.ticket_id);
        }));
        onFilterChange({});
      }

      if (result.failed.length > 0) {
        setBulkMoveErrors(result.failed);
        setSelectedTicketIds(() => new Set(result.failed.map(item => item.ticketId)));
        toast.error('Some tickets could not be moved');
        if (result.movedIds.length > 0) {
          toast.success(`${result.movedIds.length} ticket${result.movedIds.length === 1 ? '' : 's'} moved`);
        }
      } else {
        if (result.movedIds.length > 0) {
          toast.success(`${result.movedIds.length} ticket${result.movedIds.length === 1 ? '' : 's'} moved`);
        }
        clearSelection();
        setIsBulkMoveDialogOpen(false);
      }
    } catch (error) {
      handleError(error, 'Failed to move selected tickets');
    } finally {
      setIsBulkMoving(false);
    }
  }, [clearSelection, currentUser, onFilterChange, selectedDestinationBoardId, selectedDestinationStatusId, selectedTicketIdsArray, destinationBoardStatuses.length]);

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
      handleError(error, 'Failed to delete selected tickets');
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

      // Re-fetch with current filters after bundling
      onFilterChange({});
    } catch (error) {
      setBundleError(error instanceof Error ? error.message : 'Failed to bundle tickets');
      handleError(error, 'Failed to bundle tickets');
    }
  }, [
    selectedTicketIdsArray,
    bundleMasterTicketId,
    bundleSyncUpdates,
    currentUser,
    clearSelection,
    onFilterChange,
  ]);

  const handleConfirmBundleTickets = useCallback(() => {
    if (isSelectedBundleMultiClient) {
      setIsMultiClientBundleConfirmOpen(true);
      return;
    }
    void performBundleTickets();
  }, [isSelectedBundleMultiClient, performBundleTickets]);

  const exportFilters = useMemo((): ITicketListFilters => ({
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
    assignedTeamIds: selectedTeams.length > 0 ? selectedTeams : undefined,
    includeUnassigned: includeUnassigned || undefined,
    dueDateFilter: selectedDueDateFilter !== 'all' ? selectedDueDateFilter as ITicketListFilters['dueDateFilter'] : undefined,
    responseState: selectedResponseState !== 'all' ? selectedResponseState : undefined,
    slaStatusFilter: selectedSlaStatus !== 'all' ? selectedSlaStatus as ITicketListFilters['slaStatusFilter'] : undefined,
    sortBy,
    sortDirection,
    bundleView,
  }), [
    selectedBoard, selectedStatus, selectedPriority, selectedCategories,
    selectedClient, debouncedSearchQuery, boardFilterState, selectedTags,
    selectedAssignees, selectedTeams, includeUnassigned, selectedDueDateFilter,
    selectedResponseState, selectedSlaStatus, sortBy, sortDirection, bundleView,
  ]);

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
    onFilterChange({ boardId: boardId || undefined });
  }, [onFilterChange]);

  const handleCategorySelect = useCallback((newSelectedCategories: string[], newExcludedCategories: string[]) => {
    setExcludedCategories(newExcludedCategories);
    onFilterChange({ categoryId: newSelectedCategories.length > 0 ? newSelectedCategories[0] : undefined });
  }, [onFilterChange]);

  const handleClientSelect = useCallback((clientId: string | null) => {
    onFilterChange({ clientId: clientId || undefined });
  }, [onFilterChange]);

  const handleClientFilterStateChange = useCallback((state: 'active' | 'inactive' | 'all') => {
    setClientFilterState(state);
  }, []);

  const handleClientTypeFilterChange = useCallback((type: 'all' | 'company' | 'individual') => {
    setClientTypeFilter(type);
  }, []);

  const handleResetFilters = useCallback(() => {
    setExcludedCategories([]);
    setSearchQuery('');
    lastEmittedSearchRef.current = '';
    setClientFilterState('active');
    setClientTypeFilter('all');
    clearSelection();

    onFilterChange({
      boardId: undefined,
      clientId: undefined,
      statusId: 'open',
      priorityId: 'all',
      categoryId: undefined,
      searchQuery: '',
      boardFilterState: 'active',
      showOpenOnly: true,
      tags: undefined,
      assignedToIds: undefined,
      assignedTeamIds: undefined,
      includeUnassigned: false,
      dueDateFilter: undefined,
      dueDateFrom: undefined,
      dueDateTo: undefined,
      responseState: undefined,
      slaStatusFilter: undefined,
      bundleView: 'bundled',
    });
  }, [onFilterChange, clearSelection]);

  return (
    <ReflectionContainer id={id} label="Ticketing Dashboard">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Ticketing Dashboard</h1>
        <div className="flex items-center gap-3">
          {hasSelection && canUpdateTickets && (
            <Button
              id={`${id}-bulk-move-button`}
              onClick={() => {
                setBulkMoveErrors([]);
                setSelectedDestinationBoardId('');
                setDestinationBoardStatuses([]);
                setSelectedDestinationStatusId('');
                setDestinationStatusError('');
                setIsBulkMoveDialogOpen(true);
              }}
              className="flex items-center gap-2"
            >
              Move to Board
            </Button>
          )}
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
          <Tooltip content={hasSelection
            ? `Export ${selectedTicketIds.size} selected ticket${selectedTicketIds.size === 1 ? '' : 's'} to CSV`
            : 'Select ticket(s) to export'
          }>
            <span>
              <Button
                id={`${id}-export-csv-button`}
                variant="outline"
                onClick={() => setIsExportDialogOpen(true)}
                disabled={!hasSelection}
                className="flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
            </span>
          </Tooltip>
          <Button id="add-ticket-button" onClick={() => setIsQuickAddOpen(true)}>Add Ticket</Button>
        </div>
      </div>
      <div className="bg-white dark:bg-[rgb(var(--color-card))] shadow rounded-lg">
        <div className={`sticky top-0 z-40 bg-white dark:bg-[rgb(var(--color-card))] rounded-t-lg border-b border-gray-100 dark:border-[rgb(var(--color-border-200))] ${densityClasses.filterPadding}`}>
          <ReflectionContainer id={`${id}-filters`} label="Ticket DashboardFilters">
            <div className={`space-y-3`}>
              {/* Row 1: Primary filters */}
              <div className={`flex items-center ${densityClasses.filterGap}`}>
                <BoardPicker
                  id={`${id}-board-picker`}
                  boards={boards}
                  onSelect={handleBoardSelect}
                  selectedBoardId={selectedBoard}
                  filterState={boardFilterState}
                  onFilterStateChange={(state: 'active' | 'inactive' | 'all') => onFilterChange({ boardFilterState: state })}
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
                <MultiUserAndTeamPicker
                    id={`${id}-assignee-filter`}
                    users={initialUsers}
                    values={selectedAssignees}
                    onValuesChange={(values) => onFilterChange({ assignedToIds: values.length > 0 ? values : undefined })}
                    teams={teams}
                    teamValues={selectedTeams}
                    onTeamValuesChange={(values) => onFilterChange({ assignedTeamIds: values.length > 0 ? values : undefined })}
                    getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                    getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
                    filterMode={true}
                    includeUnassigned={includeUnassigned}
                    onUnassignedChange={(value) => onFilterChange({ includeUnassigned: value })}
                    placeholder="All Assignees"
                    showSearch={true}
                    compactDisplay={true}
                  />
                <CustomSelect
                  data-automation-id={`${id}-status-select`}
                  options={statusOptions}
                  value={selectedStatus}
                  onValueChange={(value) => onFilterChange({ statusId: value, showOpenOnly: value === 'open' })}
                  placeholder="Select Status"
                />
                {displaySettings?.responseStateTrackingEnabled !== false && (
                  <CustomSelect
                    data-automation-id={`${id}-response-state-select`}
                    options={[
                      { value: 'all', label: 'All Response States' },
                      { value: 'awaiting_client', label: 'Awaiting Client' },
                      { value: 'awaiting_internal', label: 'Awaiting Internal' },
                      { value: 'none', label: 'No Response State' },
                    ]}
                    value={selectedResponseState}
                    onValueChange={(value) => onFilterChange({ responseState: value !== 'all' ? value as ITicketListFilters['responseState'] : undefined })}
                    placeholder="Response State"
                  />
                )}
                <PrioritySelect
                  id={`${id}-priority-select`}
                  options={priorityOptions}
                  value={selectedPriority}
                  onValueChange={(value) => onFilterChange({ priorityId: value })}
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
                      const update: Partial<ITicketListFilters> = {
                        dueDateFilter: value !== 'all' ? value as ITicketListFilters['dueDateFilter'] : undefined,
                      };
                      if (value !== 'before' && value !== 'after') {
                        update.dueDateFrom = undefined;
                        update.dueDateTo = undefined;
                      }
                      onFilterChange(update);
                    }}
                    placeholder="Due Date"
                    className="w-fit min-w-[140px]"
                  />
                  {(selectedDueDateFilter === 'before' || selectedDueDateFilter === 'after') && (
                    <DatePicker
                      id={`${id}-due-date-filter-value`}
                      value={dueDateFilterValue}
                      onChange={(date) => {
                        onFilterChange({
                          dueDateFrom: selectedDueDateFilter === 'after' && date ? date.toISOString() : undefined,
                          dueDateTo: selectedDueDateFilter === 'before' && date ? date.toISOString() : undefined,
                        });
                      }}
                      placeholder="Pick date"
                    />
                  )}
                </div>
                <CustomSelect
                  data-automation-id={`${id}-sla-status-filter`}
                  options={[
                    { value: 'all', label: 'All SLA Status' },
                    { value: 'has_sla', label: 'Has SLA' },
                    { value: 'no_sla', label: 'No SLA' },
                    { value: 'on_track', label: 'On Track' },
                    { value: 'breached', label: 'Breached' },
                    { value: 'paused', label: 'Paused' },
                  ]}
                  value={selectedSlaStatus}
                  onValueChange={(value) => onFilterChange({ slaStatusFilter: value !== 'all' ? value as ITicketListFilters['slaStatusFilter'] : undefined })}
                  placeholder="SLA Status"
                />
              </div>

              {/* Row 2: Category, search, tags, reset, bundled, density */}
              <div className={`flex items-center ${densityClasses.filterGap}`}>
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
                  onAddNew={() => setIsQuickAddCategoryOpen(true)}
                />
                <QuickAddCategory
                  isOpen={isQuickAddCategoryOpen}
                  onClose={() => setIsQuickAddCategoryOpen(false)}
                  onCategoryCreated={(newCategory) => {
                    setCategories((prevCategories) => {
                      const existingIndex = prevCategories.findIndex((category) => category.category_id === newCategory.category_id);
                      if (existingIndex >= 0) {
                        const nextCategories = [...prevCategories];
                        nextCategories[existingIndex] = newCategory;
                        return nextCategories;
                      }
                      return [...prevCategories, newCategory];
                    });
                    onFilterChange({ categoryId: newCategory.category_id });
                    setExcludedCategories((prevExcluded) => prevExcluded.filter((categoryId) => categoryId !== newCategory.category_id));
                    setIsQuickAddCategoryOpen(false);
                  }}
                  preselectedBoardId={selectedBoard || undefined}
                  categories={categories}
                  boards={boards}
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
                    const newTags = selectedTags.includes(tag)
                      ? selectedTags.filter(t => t !== tag)
                      : [...selectedTags, tag];
                    onFilterChange({ tags: newTags.length > 0 ? newTags : undefined });
                  }}
                  onClearTags={() => onFilterChange({ tags: undefined })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetFilters}
                  className={`shrink-0 flex items-center gap-1 ${isFiltered ? 'text-gray-500 hover:text-gray-700' : 'invisible'}`}
                  id='reset-filters'
                  disabled={!isFiltered}
                >
                  <XCircle className="h-4 w-4" />
                  Reset
                </Button>
                <div className="h-6 w-px bg-gray-200 mx-1 shrink-0" />
                <div className="flex items-center gap-2 shrink-0">
                  <Label htmlFor={`${id}-bundle-view-toggle`} className="text-sm text-gray-600">
                    Bundled
                  </Label>
                  <Switch
                    id={`${id}-bundle-view-toggle`}
                    checked={bundleView === 'bundled'}
                    onCheckedChange={(checked) => onFilterChange({ bundleView: checked ? 'bundled' : 'individual' })}
                  />
                </div>
                <div className="h-6 w-px bg-gray-200 mx-1 shrink-0" />
                <div className="shrink-0">
                  <ViewDensityControl
                    idPrefix={`${id}-list-density`}
                    value={ticketListDensityLevel}
                    onChange={setTicketListDensityLevel}
                    step={50}
                    compactLabel="Compact"
                    spaciousLabel="Spacious"
                    decreaseTitle="Decrease ticket list spacing"
                    increaseTitle="Increase ticket list spacing"
                    resetTitle="Reset ticket list spacing"
                  />
                </div>
              </div>
            </div>
          </ReflectionContainer>
        </div>

        <div className={densityClasses.bodyPadding}>
        {/* isLoadingMore prop now correctly reflects loading state from container for pagination or filter changes */}
        {isLoadingMore ? (
          <Spinner size="md" className="h-32 w-full" />
        ) : (
          <>
            {(showSelectAllBanner || allMatchingMode) && (
              <Alert variant="info" className="mb-3">
                <AlertDescription className="flex items-center w-full">
                  {allMatchingMode ? (
                    <span className="text-sm">
                      All {totalCount} ticket{totalCount === 1 ? '' : 's'} matching your filters are selected.{' '}
                      <button
                        onClick={clearSelection}
                        className="font-semibold text-primary-600 hover:text-primary-700 hover:underline cursor-pointer bg-transparent border-none p-0"
                      >
                        Clear selection
                      </button>
                    </span>
                  ) : (
                    <span className="text-sm">
                      All {visibleTicketIds.length} ticket{visibleTicketIds.length === 1 ? '' : 's'} on this page are selected.{' '}
                      <button
                        onClick={handleSelectAllMatchingTickets}
                        className="font-semibold text-primary-600 hover:text-primary-700 hover:underline cursor-pointer bg-transparent border-none p-0"
                      >
                        Select all {totalCount} ticket{totalCount === 1 ? '' : 's'} matching your filters
                      </button>
                    </span>
                  )}
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
                `${densityClasses.tableRowDensity} cursor-pointer ${record.ticket_id && selectedTicketIds.has(record.ticket_id)
                  ? '!bg-table-selected'
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
      <DeleteEntityDialog
        id={`${id}-delete-ticket-dialog`}
        isOpen={!!ticketToDelete}
        onClose={resetDeleteState}
        onConfirmDelete={confirmDeleteTicket}
        entityName={ticketToDeleteName || ticketToDelete || 'this ticket'}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing}
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
        isOpen={isBulkMoveDialogOpen && hasSelection}
        onClose={handleBulkMoveClose}
        id={`${id}-bulk-move-dialog`}
        title="Move Selected Tickets"
      >
        <DialogContent>
          {bulkMoveErrors.length > 0 && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                <p className="font-medium">The following tickets could not be moved:</p>
                <ul className="mt-2 space-y-1">
                  {bulkMoveErrors.map(error => {
                    const detail = selectedTicketDetails.find(item => item.ticket_id === error.ticketId);
                    const label = detail?.ticket_number || detail?.title || error.ticketId;
                    return (
                      <li key={error.ticketId}>
                        <span className="font-medium">{label}</span>: {error.message}
                      </li>
                    );
                  })}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {destinationStatusError && (
            <Alert variant="warning" className="mb-4">
              <AlertDescription>
                {destinationStatusError}
              </AlertDescription>
            </Alert>
          )}
          <div className="mb-4 space-y-1">
            <p className="text-gray-600">
              Select a destination board and status, then confirm moving the selected tickets.
            </p>
          </div>
          <div className="mb-4 space-y-3">
            <div>
              <div className="text-sm font-medium text-gray-700 mb-1">Destination Board</div>
              <CustomSelect
                id={`${id}-bulk-move-board`}
                value={selectedDestinationBoardId}
                options={boards.map((board) => ({
                  value: board.board_id,
                  label: board.board_name
                }))}
                onValueChange={(value) => void handleBulkMoveBoardChange(value)}
                placeholder="Select destination board..."
              />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-700 mb-1">Destination Status</div>
              <CustomSelect
                id={`${id}-bulk-move-status`}
                value={selectedDestinationStatusId}
                options={destinationBoardStatuses}
                onValueChange={(value) => setSelectedDestinationStatusId(value)}
                disabled={isLoadingDestinationStatuses || destinationBoardStatuses.length === 0}
                placeholder="Select destination status..."
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto rounded-md border border-gray-200">
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
            id={`${id}-bulk-move-cancel`}
            variant="outline"
            onClick={handleBulkMoveClose}
            disabled={isBulkMoving}
          >
            Cancel
          </Button>
          <Button
            id={`${id}-bulk-move-confirm`}
            onClick={handleConfirmBulkMove}
            disabled={isBulkMoving || isLoadingDestinationStatuses || !selectedDestinationBoardId || !selectedDestinationStatusId || destinationBoardStatuses.length === 0 || destinationStatusError.length > 0}
          >
            {isBulkMoving
              ? 'Moving...'
              : `Move ${selectedTicketIdsArray.length} Ticket${selectedTicketIdsArray.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        isOpen={isBulkDeleteDialogOpen && hasSelection}
        onClose={handleBulkDeleteClose}
        id={`${id}-bulk-delete-dialog`}
        title="Delete Selected Tickets"
      >
        <DialogContent>
          {bulkDeleteErrors.length > 0 && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
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
              </AlertDescription>
            </Alert>
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
            <Alert variant="destructive" className="mb-3">
              <AlertDescription>{bundleError}</AlertDescription>
            </Alert>
          )}
          {(() => {
            if (!isSelectedBundleMultiClient) return null;
            return (
              <Alert variant="warning" className="mb-3">
                <AlertDescription>This bundle spans multiple clients. You'll be asked to confirm before bundling.</AlertDescription>
              </Alert>
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
      <TicketExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        filters={exportFilters}
        totalCount={totalCount}
        selectedTicketIds={selectedTicketIdsArray}
      />
    </ReflectionContainer>
  );
};

export default TicketingDashboard;
