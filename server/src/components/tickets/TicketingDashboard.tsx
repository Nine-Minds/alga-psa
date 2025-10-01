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
import { Input } from 'server/src/components/ui/Input';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { ChannelPicker } from 'server/src/components/settings/general/ChannelPicker';
import { CompanyPicker } from 'server/src/components/companies/CompanyPicker';
import { findTagsByEntityIds } from 'server/src/lib/actions/tagActions';
import { TagFilter, TagManager } from 'server/src/components/tags';
import { useTagPermissions } from 'server/src/hooks/useTagPermissions';
import { IChannel, ICompany, IUser } from 'server/src/interfaces';
import { DataTable } from 'server/src/components/ui/DataTable';
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
import CompanyDetails from 'server/src/components/companies/CompanyDetails';
import { createTicketColumns } from 'server/src/lib/utils/ticket-columns';

interface TicketingDashboardProps {
  id?: string;
  initialTickets: ITicketListItem[];
  initialChannels: IChannel[];
  initialStatuses: SelectOption[];
  initialPriorities: SelectOption[];
  initialCategories: ITicketCategory[];
  initialCompanies: ICompany[];
  initialTags?: string[];
  nextCursor: string | null;
  onLoadMore: () => Promise<void>;
  onFiltersChanged: (filters: Partial<ITicketListFilters>) => void;
  initialFilterValues: Partial<ITicketListFilters>;
  isLoadingMore: boolean;
  user?: IUser;
  displaySettings?: TicketingDisplaySettings;
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

type PendingDeletion =
  | { type: 'single'; ticketId: string; ticketName?: string | null }
  | { type: 'bulk'; ticketIds: string[] };

const TicketingDashboard: React.FC<TicketingDashboardProps> = ({
  id = 'ticketing-dashboard',
  initialTickets,
  initialChannels,
  initialStatuses,
  initialPriorities,
  initialCategories,
  initialCompanies,
  initialTags = [],
  nextCursor,
  onLoadMore,
  onFiltersChanged,
  initialFilterValues,
  isLoadingMore,
  user,
  displaySettings
}) => {
  // Pre-fetch tag permissions to prevent individual API calls
  useTagPermissions(['ticket']);
  
  const [tickets, setTickets] = useState<ITicketListItem[]>(initialTickets);
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isIntervalDrawerOpen, setIsIntervalDrawerOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(user || null);
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(() => new Set());

  const [channels] = useState<IChannel[]>(initialChannels);
  const [companies] = useState<ICompany[]>(initialCompanies);
  const [categories] = useState<ITicketCategory[]>(initialCategories);
  const [statusOptions] = useState<SelectOption[]>(initialStatuses);
  const [priorityOptions] = useState<SelectOption[]>(initialPriorities);
  
  const [selectedChannel, setSelectedChannel] = useState<string | null>(initialFilterValues.channelId || null);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(initialFilterValues.companyId === undefined ? null : initialFilterValues.companyId); // Keep previous fix for company
  const [selectedStatus, setSelectedStatus] = useState<string>(initialFilterValues.statusId || 'open');
  const [selectedPriority, setSelectedPriority] = useState<string>(initialFilterValues.priorityId || 'all');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(initialFilterValues.categoryId ? [initialFilterValues.categoryId] : []);
  const [excludedCategories, setExcludedCategories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>(initialFilterValues.searchQuery || '');
  const [channelFilterState, setChannelFilterState] = useState<'active' | 'inactive' | 'all'>(initialFilterValues.channelFilterState || 'active');
  
  const [companyFilterState, setCompanyFilterState] = useState<'active' | 'inactive' | 'all'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isLoadingSelf, setIsLoadingSelf] = useState(false);
  
  // Quick View state
  const [quickViewCompanyId, setQuickViewCompanyId] = useState<string | null>(null);
  const [isQuickViewOpen, setIsQuickViewOpen] = useState(false);
  
  // Tag-related state
  const [selectedTags, setSelectedTags] = useState<string[]>(initialFilterValues.tags || []);
  const ticketTagsRef = useRef<Record<string, ITag[]>>({});
  const [allUniqueTags, setAllUniqueTags] = useState<ITag[]>(
    initialTags.map(tagText => ({ tag_text: tagText } as ITag))
  );
  
  const handleTagsChange = (ticketId: string, tags: ITag[]) => {
    ticketTagsRef.current[ticketId] = tags;

    // Update unique tags list if needed
    setAllUniqueTags(current => {
      const currentTagTexts = new Set(current.map(t => t.tag_text));
      const newTags = tags.filter(tag => !currentTagTexts.has(tag.tag_text));
      return [...current, ...newTags];
    });
  };

  const handleToggleTicketSelection = useCallback((ticketId: string, isSelected: boolean) => {
    if (!ticketId) return;
    setSelectedTicketIds(prev => {
      const next = new Set(prev);
      if (isSelected) {
        next.add(ticketId);
      } else {
        next.delete(ticketId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setTickets(initialTickets);
    setSelectedTicketIds(new Set());
  }, [initialTickets]);

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
    if (selectedChannel) params.set('channelId', selectedChannel);
    if (selectedCompany) params.set('companyId', selectedCompany);
    if (selectedStatus && selectedStatus !== 'open') params.set('statusId', selectedStatus);
    if (selectedPriority && selectedPriority !== 'all') params.set('priorityId', selectedPriority);
    if (selectedCategories.length > 0) params.set('categoryId', selectedCategories[0]);
    if (debouncedSearchQuery) params.set('searchQuery', debouncedSearchQuery);
    if (channelFilterState && channelFilterState !== 'active') {
      params.set('channelFilterState', channelFilterState);
    }

    return params.toString();
  }, [selectedChannel, selectedCompany, selectedStatus, selectedPriority, selectedCategories, debouncedSearchQuery, channelFilterState]);

  useEffect(() => {
    const currentFilters: Partial<ITicketListFilters> = {
      channelId: selectedChannel === null ? undefined : selectedChannel,
      statusId: selectedStatus,
      priorityId: selectedPriority,
      categoryId: selectedCategories.length > 0 ? selectedCategories[0] : undefined,
      companyId: selectedCompany || undefined,
      searchQuery: debouncedSearchQuery,
      channelFilterState: channelFilterState,
      showOpenOnly: selectedStatus === 'open',
      tags: selectedTags.length > 0 ? selectedTags : undefined,
    };
    onFiltersChanged(currentFilters);
  }, [
    selectedChannel, 
    selectedStatus, 
    selectedPriority, 
    selectedCategories, 
    selectedCompany, 
    debouncedSearchQuery, 
    channelFilterState,
    selectedTags
    // Removed onFiltersChanged from dependencies to prevent infinite loop
  ]);

  const handleDeleteTicket = useCallback((ticketId: string, ticketNameOrNumber: string) => {
    setPendingDeletion({ type: 'single', ticketId, ticketName: ticketNameOrNumber });
    setDeleteError(null);
  }, []);
  
  const [quickViewCompany, setQuickViewCompany] = useState<ICompany | null>(null);
  
  const onQuickViewCompany = async (companyId: string) => {
    // First try to find the company in our existing data
    const company = initialCompanies.find(c => c.company_id === companyId);
    if (company) {
      setQuickViewCompany(company);
      setQuickViewCompanyId(companyId);
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

  const confirmDeleteTicket = useCallback(async () => {
    if (!pendingDeletion) return;

    if (!currentUser) {
      setDeleteError('User not found');
      return;
    }

    try {
      if (pendingDeletion.type === 'single') {
        await deleteTicket(pendingDeletion.ticketId, currentUser);
        setTickets(prev => prev.filter(t => t.ticket_id !== pendingDeletion.ticketId));
        setSelectedTicketIds(prev => {
          const next = new Set(prev);
          next.delete(pendingDeletion.ticketId);
          return next;
        });
        if (pendingDeletion.ticketId) {
          delete ticketTagsRef.current[pendingDeletion.ticketId];
        }
      } else {
        await deleteTickets(pendingDeletion.ticketIds, currentUser);
        setTickets(prev => prev.filter(t => !pendingDeletion.ticketIds.includes(t.ticket_id ?? '')));
        setSelectedTicketIds(prev => {
          const next = new Set(prev);
          pendingDeletion.ticketIds.forEach(id => next.delete(id));
          return next;
        });
        pendingDeletion.ticketIds.forEach(id => {
          delete ticketTagsRef.current[id];
        });
      }

      setPendingDeletion(null);
      setDeleteError(null);
    } catch (error: any) {
      console.error('Failed to delete ticket(s):', error);
      if (error.message && error.message.startsWith('VALIDATION_ERROR:')) {
        setDeleteError(error.message.replace('VALIDATION_ERROR: ', ''));
      } else {
        setDeleteError(
          pendingDeletion.type === 'bulk'
            ? 'An unexpected error occurred while deleting the selected tickets.'
            : 'An unexpected error occurred while deleting the ticket.'
        );
      }
    }
  }, [pendingDeletion, currentUser, deleteTicket, deleteTickets]);

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

  // Filter tickets by selected tags
  const filteredTickets = useMemo(() => {
    if (selectedTags.length === 0) return tickets;
    
    return tickets.filter(ticket => {
      const ticketTags = ticketTagsRef.current[ticket.ticket_id || ''] || [];
      const ticketTagTexts = ticketTags.map(tag => tag.tag_text);
      
      // Check if ticket has any of the selected tags
      return selectedTags.some(selectedTag => ticketTagTexts.includes(selectedTag));
    });
  }, [tickets, selectedTags]);

  // Add id to each ticket for DataTable keys
  const ticketsWithIds = useMemo(() =>
    filteredTickets.map((ticket): any => ({
      ...ticket,
      id: ticket.ticket_id
    })), [filteredTickets]);

  const allTicketIds = useMemo(
    () => ticketsWithIds.map(ticket => ticket.ticket_id).filter((id): id is string => !!id),
    [ticketsWithIds]
  );

  useEffect(() => {
    setSelectedTicketIds(prev => {
      const validIds = new Set(allTicketIds);
      const filtered = Array.from(prev).filter(id => validIds.has(id));
      if (filtered.length === prev.size) {
        return prev;
      }
      return new Set(filtered);
    });
  }, [allTicketIds]);

  const selectionSummary = useMemo(() => {
    const selectedCount = selectedTicketIds.size;
    const allSelected = allTicketIds.length > 0 && allTicketIds.every(id => selectedTicketIds.has(id));
    return {
      selectedCount,
      allSelected,
      indeterminate: selectedCount > 0 && !allSelected,
    };
  }, [allTicketIds, selectedTicketIds]);

  const {
    selectedCount: selectedTicketsCount,
    allSelected: areAllTicketsSelected,
    indeterminate: isSelectAllIndeterminate,
  } = selectionSummary;

  const handleSelectAll = useCallback((isChecked: boolean) => {
    setSelectedTicketIds(prev => {
      const next = new Set(prev);
      if (isChecked) {
        allTicketIds.forEach(id => next.add(id));
      } else {
        allTicketIds.forEach(id => next.delete(id));
      }
      return next;
    });
  }, [allTicketIds]);

  const handleBulkDeleteRequest = useCallback(() => {
    if (selectedTicketIds.size === 0) return;
    setPendingDeletion({ type: 'bulk', ticketIds: Array.from(selectedTicketIds) });
    setDeleteError(null);
  }, [selectedTicketIds]);


  const baseColumns = useMemo(
    () =>
      createTicketColumns({
        categories,
        displaySettings: displaySettings || undefined,
        onTicketClick: handleTicketClick,
        onDeleteClick: handleDeleteTicket,
        ticketTagsRef,
        onTagsChange: handleTagsChange,
        showClient: true,
        onClientClick: onQuickViewCompany,
      }),
    [categories, displaySettings, handleTicketClick, handleDeleteTicket, handleTagsChange, ticketTagsRef, onQuickViewCompany]
  );

  const selectionColumn = useMemo<ColumnDefinition<ITicketListItem>>(
    () => ({
      title: '',
      dataIndex: 'selection',
      width: '4%',
      headerClassName: 'w-12',
      cellClassName: 'w-12',
      render: (_value: string, record: ITicketListItem) => {
        const ticketId = record.ticket_id;
        if (!ticketId) return null;

        const checkboxId = `${id}-select-ticket-${ticketId}`;
        const labelSource = record.ticket_number || record.title || ticketId;
        const stopPropagation = (event: React.SyntheticEvent) => {
          event.stopPropagation();
        };

        return (
          <div
            className="flex justify-center"
            onClick={stopPropagation}
            onMouseDown={stopPropagation}
          >
            <Checkbox
              id={checkboxId}
              checked={selectedTicketIds.has(ticketId)}
              onChange={event => {
                stopPropagation(event);
                handleToggleTicketSelection(ticketId, event.target.checked);
              }}
              onClick={stopPropagation}
              containerClassName="mb-0 justify-center"
              aria-label={`Select ticket ${labelSource}`}
            />
          </div>
        );
      },
    }),
    [id, selectedTicketIds, handleToggleTicketSelection]
  );

  const columns = useMemo(
    () => [selectionColumn, ...baseColumns],
    [selectionColumn, baseColumns]
  );

  const deletionDialogTitle = pendingDeletion?.type === 'bulk' ? 'Delete Tickets' : 'Delete Ticket';

  const deletionDialogMessage = useMemo(() => {
    if (deleteError) {
      return deleteError;
    }
    if (!pendingDeletion) {
      return 'Are you sure you want to delete the selected tickets? This action cannot be undone.';
    }
    if (pendingDeletion.type === 'single') {
      const displayName = pendingDeletion.ticketName || pendingDeletion.ticketId;
      return `Are you sure you want to delete ticket "${displayName}"? This action cannot be undone.`;
    }
    const names = pendingDeletion.ticketIds.map(id => {
      const ticket = tickets.find(t => t.ticket_id === id);
      return ticket?.title || ticket?.ticket_number || id;
    });
    const visibleSummary = names.slice(0, 3).join(', ');
    const remaining = names.length - 3;
    const additionalSummary = remaining > 0 ? `, and ${remaining} more` : '';
    const selectionSummaryText = visibleSummary ? `${visibleSummary}${additionalSummary}` : '';
    const selectionSuffix = selectionSummaryText ? ` Selected: ${selectionSummaryText}.` : '';
    return `Are you sure you want to delete ${pendingDeletion.ticketIds.length} tickets? This action cannot be undone.${selectionSuffix}`;
  }, [deleteError, pendingDeletion, tickets]);

  const confirmationDialogConfirmLabel = deleteError
    ? undefined
    : pendingDeletion?.type === 'bulk'
      ? 'Delete Tickets'
      : 'Delete';

  const confirmationDialogCancelLabel = deleteError ? 'Close' : 'Cancel';


  const handleTicketAdded = useCallback((newTicket: ITicket) => {
    // Add the new ticket to the local state
    setTickets(prevTickets => {
      const status = statusOptions.find(s => s.value === newTicket.status_id);
      const priority = priorityOptions.find(p => p.value === newTicket.priority_id);
      const channel = channels.find(c => c.channel_id === newTicket.channel_id);
      
      let categoryName = '';
      if (newTicket.category_id) {
        const category = categories.find(c => c.category_id === newTicket.category_id);
        if (category) {
          categoryName = category.category_name;
        }
      }
      
      // Find the company name
      const company = initialCompanies.find(c => c.company_id === newTicket.company_id);
      const companyName = company ? company.company_name : 'Unknown';
      
      // Convert the new ticket to match the ITicketListItem format
      const newTicketListItem: ITicketListItem = {
        ticket_id: newTicket.ticket_id,
        ticket_number: newTicket.ticket_number,
        title: newTicket.title,
        url: newTicket.url,
        status_id: newTicket.status_id,
        status_name: typeof status?.label === 'string' ? status.label : '',
        priority_id: newTicket.priority_id,
        priority_name: typeof priority?.label === 'string' ? priority.label : '',
        channel_id: newTicket.channel_id,
        channel_name: channel?.channel_name || '',
        category_id: newTicket.category_id,
        subcategory_id: newTicket.subcategory_id,
        category_name: categoryName,
        company_id: newTicket.company_id,
        company_name: companyName,
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
  }, [statusOptions, priorityOptions, channels, categories, currentUser]);

  const handleChannelSelect = useCallback((channelId: string) => {
    setSelectedChannel(channelId);
  }, []);

  const handleCategorySelect = useCallback((newSelectedCategories: string[], newExcludedCategories: string[]) => {
    setSelectedCategories(newSelectedCategories);
    setExcludedCategories(newExcludedCategories);
  }, []);
  
  const handleCompanySelect = useCallback((companyId: string | null) => {
    setSelectedCompany(companyId);
  }, []);

  const handleCompanyFilterStateChange = useCallback((state: 'active' | 'inactive' | 'all') => {
    setCompanyFilterState(state);
  }, []);

  const handleClientTypeFilterChange = useCallback((type: 'all' | 'company' | 'individual') => {
    setClientTypeFilter(type);
  }, []);

  const handleResetFilters = useCallback(() => {
    // Define the true default/reset states
    const defaultChannel: string | null = null;
    const defaultCompany: string | null = null;
    const defaultStatus: string = 'open';
    const defaultPriority: string = 'all';
    const defaultCategories: string[] = [];
    const defaultSearchQuery: string = '';
    const defaultChannelFilterState: 'active' | 'inactive' | 'all' = 'active';

    setSelectedChannel(defaultChannel);
    setSelectedCompany(defaultCompany);
    setSelectedStatus(defaultStatus);
    setSelectedPriority(defaultPriority);
    setSelectedCategories(defaultCategories);
    setExcludedCategories([]);
    setSearchQuery(defaultSearchQuery);
    setChannelFilterState(defaultChannelFilterState);
    setSelectedTags([]);

    setSelectedTicketIds(new Set());

    setCompanyFilterState('active');
    setClientTypeFilter('all');

    onFiltersChanged({
      channelId: defaultChannel === null ? undefined : defaultChannel,
      companyId: defaultCompany === null ? undefined : defaultCompany,
      statusId: defaultStatus,
      priorityId: defaultPriority,
      categoryId: defaultCategories.length > 0 ? defaultCategories[0] : undefined,
      searchQuery: defaultSearchQuery,
      channelFilterState: defaultChannelFilterState,
      showOpenOnly: defaultStatus === 'open',
    });
  }, [onFiltersChanged]);

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
        <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-select-all-checkbox`}
              label="Select all on page"
              checked={areAllTicketsSelected}
              indeterminate={isSelectAllIndeterminate}
              onChange={event => handleSelectAll(event.target.checked)}
              containerClassName="mb-0"
              disabled={ticketsWithIds.length === 0}
            />
            <span className="text-sm text-gray-600">
              {selectedTicketsCount} selected
            </span>
          </div>
          <Button
            id={`${id}-delete-selected-button`}
            variant="destructive"
            onClick={handleBulkDeleteRequest}
            disabled={selectedTicketsCount === 0}
          >
            Delete Selected
          </Button>
        </div>
        {/* isLoadingMore prop now correctly reflects loading state from container for pagination or filter changes */}
        {isLoadingMore ? (
          <div className="flex justify-center items-center h-32">
            <span>Loading tickets...</span>
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
                  onClick={onLoadMore}
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
        id={`${id}-delete-ticket-dialog`}
        isOpen={!!pendingDeletion}
        onClose={() => {
          setPendingDeletion(null);
          setDeleteError(null);
        }}
        onConfirm={confirmDeleteTicket}
        title={deletionDialogTitle}
        message={deletionDialogMessage}
        confirmLabel={confirmationDialogConfirmLabel}
        cancelLabel={confirmationDialogCancelLabel}
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
      
      {/* Company Quick View Drawer */}
      <Drawer
        isOpen={isQuickViewOpen}
        onClose={() => {
          setIsQuickViewOpen(false);
          setQuickViewCompanyId(null);
          setQuickViewCompany(null);
        }}
      >
        {quickViewCompany && (
          <CompanyDetails
            company={quickViewCompany}
            isInDrawer={true}
            quickView={true}
          />
        )}
      </Drawer>
    </ReflectionContainer>
  );
};

export default TicketingDashboard;
