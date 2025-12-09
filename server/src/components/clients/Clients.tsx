'use client';
import React, { useState, useEffect, useCallback, memo } from 'react';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import GenericDialog from '../ui/GenericDialog';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import QuickAddClient from './QuickAddClient';
import {
  createClient,
  getAllClients,
  getAllClientsPaginated,
  deleteClient,
  archiveClient,
  updateClient,
  importClientsFromCSV,
  exportClientsToCSV,
  getAllClientIds,
  type PaginatedClientsResponse
} from 'server/src/lib/actions/client-actions/clientActions';
import { findTagsByEntityIds, findAllTagsByType } from 'server/src/lib/actions/tagActions';
import { TagFilter } from 'server/src/components/tags';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import ClientsGrid from './ClientsGrid';
import ClientsList from './ClientsList';
import ViewSwitcher, { ViewSwitcherOption } from '../ui/ViewSwitcher';
import { TrashIcon, MoreVertical, CloudDownload, Upload, LayoutGrid, List, Search, XCircle } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { useUserPreference } from 'server/src/hooks/useUserPreference';
import ClientsImportDialog from './ClientsImportDialog';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Input } from 'server/src/components/ui/Input';
import Drawer from 'server/src/components/ui/Drawer';
import ClientDetails from './ClientDetails';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import toast from 'react-hot-toast';
import { useTagPermissions } from 'server/src/hooks/useTagPermissions';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';

const COMPANY_VIEW_MODE_SETTING = 'client_list_view_mode';
const CLIENTS_GRID_PAGE_SIZE_SETTING = 'clients_grid_page_size';
const CLIENTS_LIST_PAGE_SIZE_SETTING = 'clients_list_page_size';

// Memoized search input component to prevent re-renders
const SearchInput = memo(({ value, onChange }: { value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) => {
  return (
    <div className="relative">
      <Input
        id="search-clients"
        data-automation-id="search-clients"
        type="text"
        placeholder="Search clients"
        className="border-2 border-gray-200 focus:border-purple-500 rounded-md pl-10 pr-4 py-2 w-64 outline-none bg-white"
        value={value}
        onChange={onChange}
        preserveCursor={true}
      />
      <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
    </div>
  );
});

SearchInput.displayName = 'SearchInput';

// Client results component that handles its own loading state
interface ClientResultsProps {
  searchTerm: string;
  filterStatus: 'all' | 'active' | 'inactive';
  clientTypeFilter: 'all' | 'company' | 'individual';
  selectedTags: string[];
  viewMode: 'grid' | 'list';
  selectedClients: string[];
  onCheckboxChange: (clientId: string) => void;
  onEditClient: (clientId: string) => void;
  onDeleteClient: (client: IClient) => void;
  onQuickView?: (client: IClient) => void;
  onTagsChange: (clientId: string, tags: ITag[]) => void;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onClientTagsLoaded?: (clientTags: Record<string, ITag[]>, allUniqueTags: ITag[]) => void;
  // Add props to receive parent's tag state
  clientTags?: Record<string, ITag[]>;
  allUniqueTagsFromParent?: ITag[];
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  onSortChange?: (sortBy: string, sortDirection: 'asc' | 'desc') => void;
}

const ClientResults = memo(({
  searchTerm,
  filterStatus,
  clientTypeFilter,
  selectedTags,
  viewMode,
  selectedClients,
  onCheckboxChange,
  onEditClient,
  onDeleteClient,
  onQuickView,
  onTagsChange,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onClientTagsLoaded,
  clientTags: parentClientTags,
  allUniqueTagsFromParent,
  sortBy,
  sortDirection,
  onSortChange
}: ClientResultsProps) => {
  const [clients, setClients] = useState<IClient[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [localClientTags, setLocalClientTags] = useState<Record<string, ITag[]>>({});
  const [allUniqueTags, setAllUniqueTags] = useState<ITag[]>([]);
  
  // Use parent's tag state if available, otherwise use local state
  const effectiveClientTags = parentClientTags || localClientTags;
  const effectiveAllUniqueTags = allUniqueTagsFromParent || allUniqueTags;

  // Load clients when filters change
  useEffect(() => {
    const loadClients = async () => {
      try {
        // Only show loading for the first load and page changes, not for sorting
        const isInitialLoad = clients.length === 0;
        const isPageChange = currentPage !== 1 && clients.length > 0;

        if (isInitialLoad || isPageChange) {
          setIsLoading(true);
        }

        const response = await getAllClientsPaginated({
          page: currentPage,
          pageSize,
          statusFilter: filterStatus,
          searchTerm: searchTerm || undefined,
          clientTypeFilter,
          selectedTags,
          loadLogos: true,
          sortBy,
          sortDirection
        });

        setClients(response.clients);
        setTotalCount(response.totalCount);
        setIsLoading(false);
      } catch (error) {
        console.error('Error loading clients:', error);
        setIsLoading(false);
      }
    };

    loadClients();
  }, [currentPage, pageSize, filterStatus, searchTerm, clientTypeFilter, selectedTags, sortBy, sortDirection]);

  // Fetch tags when clients change
  useEffect(() => {
    const fetchTags = async () => {
      if (clients.length === 0) return;
      
      try {
        // Fetch both client-specific tags and all unique tags
        const [clientTags, allTags] = await Promise.all([
          findTagsByEntityIds(
            clients.map((client: IClient): string => client.client_id),
            'client'
          ),
          findAllTagsByType('client')
        ]);

        const newClientTags: Record<string, ITag[]> = {};
        clientTags.forEach(tag => {
          if (!newClientTags[tag.tagged_id]) {
            newClientTags[tag.tagged_id] = [];
          }
          newClientTags[tag.tagged_id].push(tag);
        });

        setLocalClientTags(newClientTags);
        setAllUniqueTags(allTags);
        
        // Notify parent component about loaded tags
        if (onClientTagsLoaded) {
          onClientTagsLoaded(newClientTags, allTags);
        }
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };
    fetchTags();
  }, [clients]);

  // No need for client-side filtering anymore since it's done server-side
  const filteredClients = clients;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[400px]">
        <LoadingIndicator
          text="Loading clients..."
          spinnerProps={{ size: 'lg' }}
          layout="stacked"
        />
      </div>
    );
  }

  return (
    <div className="flex-1">
      {viewMode === 'grid' ? (
        <ClientsGrid
          filteredClients={filteredClients}
          selectedClients={selectedClients}
          handleCheckboxChange={onCheckboxChange}
          handleEditClient={onEditClient}
          handleDeleteClient={onDeleteClient}
          onQuickView={onQuickView}
          currentPage={currentPage}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          clientTags={effectiveClientTags}
          allUniqueTags={effectiveAllUniqueTags}
          onTagsChange={onTagsChange}
        />
      ) : (
        <ClientsList
          selectedClients={selectedClients}
          filteredClients={filteredClients}
          setSelectedClients={() => {}} // This prop seems unused in the component
          handleCheckboxChange={onCheckboxChange}
          handleEditClient={onEditClient}
          handleDeleteClient={onDeleteClient}
          onQuickView={onQuickView}
          currentPage={currentPage}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          clientTags={effectiveClientTags}
          allUniqueTags={effectiveAllUniqueTags}
          onTagsChange={onTagsChange}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSortChange={onSortChange}
        />
      )}
    </div>
  );
});

ClientResults.displayName = 'ClientResults';

const Clients: React.FC = () => {
  useTagPermissions(['client']);
  

   const { automationIdProps: containerProps, updateMetadata } = useAutomationIdAndRegister({
     id: 'clients-page',
     type: 'container',
     label: 'Clients Page',
     helperText: "Main clients management page with search, filters, and client grid/list view"
   });

   const { automationIdProps: createButtonProps } = useAutomationIdAndRegister({
     id: 'create-client-btn',
     type: 'button',
     label: 'Create Client',
     helperText: "Opens dialog to create a new client/client"
   });

   const { automationIdProps: actionsMenuProps } = useAutomationIdAndRegister({
     id: 'actions-menu-btn',
     type: 'button',
     label: 'Actions Menu',
     helperText: "Menu for importing/exporting clients"
   });

   const { automationIdProps: deleteSelectedProps } = useAutomationIdAndRegister({
     id: 'delete-selected-btn',
     type: 'button',
     label: 'Delete Selected',
     helperText: "Delete multiple selected clients"
   });

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (searchParams) {
      const create = searchParams.get('create');
      if (create === 'true') {
        setIsDialogOpen(true);
      }
    }
  }, [searchParams]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState<IClient | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState(''); // Local state for input field
  
  // Use the custom hook for view mode preference
  type ClientViewMode = 'grid' | 'list';
  const {
    value: viewMode,
    setValue: setViewModePreference,
    isLoading: isViewModeLoading
  } = useUserPreference<ClientViewMode>(
    COMPANY_VIEW_MODE_SETTING,
    {
      defaultValue: 'grid',
      localStorageKey: COMPANY_VIEW_MODE_SETTING,
      debounceMs: 300
    }
  );

  // Use user preferences for page sizes (separate for grid and list views)
  const {
    value: gridPageSize,
    setValue: setGridPageSize
  } = useUserPreference<number>(
    CLIENTS_GRID_PAGE_SIZE_SETTING,
    {
      defaultValue: 9,
      localStorageKey: CLIENTS_GRID_PAGE_SIZE_SETTING,
      debounceMs: 300
    }
  );

  const {
    value: listPageSize,
    setValue: setListPageSize
  } = useUserPreference<number>(
    CLIENTS_LIST_PAGE_SIZE_SETTING,
    {
      defaultValue: 10,
      localStorageKey: CLIENTS_LIST_PAGE_SIZE_SETTING,
      debounceMs: 300
    }
  );

  // Current page size based on view mode
  const pageSize = viewMode === 'grid' ? gridPageSize : listPageSize;

  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [isSelectAllMode, setIsSelectAllMode] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [isMultiDeleteDialogOpen, setIsMultiDeleteDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showArchiveOption, setShowArchiveOption] = useState(false);
  const [multiDeleteError, setMultiDeleteError] = useState<string | null>(null);

  // Quick View state
  const [quickViewClient, setQuickViewClient] = useState<IClient | null>(null);
  const [isQuickViewOpen, setIsQuickViewOpen] = useState(false);

  // Edit state - removed since edit now navigates directly

  // Tag-related state
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [allUniqueTags, setAllUniqueTags] = useState<ITag[]>([]);
  const [clientTags, setClientTags] = useState<Record<string, ITag[]>>({});

  // Track if filters are applied
  const [isFiltered, setIsFiltered] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // Sorting state
  const [sortBy, setSortBy] = useState<string>('client_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  
  // For multi-delete functionality, we need to track clients
  const [clientsForDelete, setClientsForDelete] = useState<IClient[]>([]);
  

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput);
      setCurrentPage(1); // Reset to first page when searching
    }, 300); // 300ms delay

    return () => clearTimeout(timer);
  }, [searchInput]);

  // Update isFiltered when any filter changes
  useEffect(() => {
    const hasFilters = 
      searchTerm !== '' || 
      filterStatus !== 'active' || 
      clientTypeFilter !== 'all' || 
      selectedTags.length > 0;
    setIsFiltered(hasFilters);
  }, [searchTerm, filterStatus, clientTypeFilter, selectedTags]);

  // Tags will be loaded by ClientResults component

  // Reset to first page when view mode changes
  useEffect(() => {
    if (!isViewModeLoading) {
      setCurrentPage(1);
    }
  }, [viewMode, isViewModeLoading]);

  const viewOptions: ViewSwitcherOption<ClientViewMode>[] = [
    { value: 'grid', label: 'Cards', icon: LayoutGrid },
    { value: 'list', label: 'Table', icon: List },
  ];

  const handleViewModeChange = (newMode: ClientViewMode) => {
    setViewModePreference(newMode);
    setCurrentPage(1); // Reset to first page when changing view
  };


  const handleClientAdded = (newClient: IClient) => {
    // Refresh the list after a client is added
    setRefreshKey(prev => prev + 1);
    toast.success(`${newClient.client_name} has been created successfully.`);
  };

  const handleCheckboxChange = (clientId: string) => {
    setSelectedClients((prevSelected) => {
      if (prevSelected.includes(clientId)) {
        return prevSelected.filter((id) => id !== clientId);
      } else {
        return [...prevSelected, clientId];
      }
    });
    // If user manually selects/deselects, exit select all mode
    setIsSelectAllMode(false);
  };

  const handleSelectAll = async () => {
    if (selectedClients.length > 0 || isSelectAllMode) {
      // Clear all selections
      setSelectedClients([]);
      setIsSelectAllMode(false);
    } else {
      // Select all clients with current filters
      try {
        const allIds = await getAllClientIds({
          statusFilter: filterStatus,
          searchTerm: searchTerm || undefined,
          clientTypeFilter,
          selectedTags
        });
        setSelectedClients(allIds);
        setIsSelectAllMode(true);
      } catch (error) {
        console.error('Error selecting all clients:', error);
        toast.error("Failed to select all clients");
      }
    }
  };

  const handleTagsChange = useCallback((clientId: string, tags: ITag[]) => {
    // Update local tag state for optimistic UI updates
    setClientTags(current => ({
      ...current,
      [clientId]: tags
    }));
    
    // Update unique tags list if needed
    setAllUniqueTags(current => {
      const currentTagTexts = new Set(current.map(t => t.tag_text));
      const newTags = tags.filter(tag => !currentTagTexts.has(tag.tag_text));
      return [...current, ...newTags];
    });
  }, []);
  
  const handleClientTagsLoaded = useCallback((loadedClientTags: Record<string, ITag[]>, uniqueTags: ITag[]) => {
    // Update the main component's tag state when ClientResults loads tags
    setClientTags(loadedClientTags);
    setAllUniqueTags(uniqueTags);
  }, []);
  

  const handleEditClient = async (clientId: string) => {
    // Navigate directly to the client page for editing
    router.push(`/msp/clients/${clientId}`);
  };

  const handleQuickView = (client: IClient) => {
    setQuickViewClient(client);
    setIsQuickViewOpen(true);
  };



  const handleDeleteClient = async (client: IClient) => {
    setClientToDelete(client);
    setDeleteError(null);
    setShowArchiveOption(false);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!clientToDelete) return;

    try {
      const result = await deleteClient(clientToDelete.client_id);

      if (!result.success) {
        if ('code' in result && result.code === 'COMPANY_HAS_DEPENDENCIES') {
          handleDependencyError(result, setDeleteError);
          return;
        }
        throw new Error(result.message || 'Failed to delete client');
      }

      // Show success toast
      toast.success(`${clientToDelete.client_name} has been deleted successfully.`);

      setRefreshKey(prev => prev + 1);
      resetDeleteState();
    } catch (error) {
      console.error('Error deleting client:', error);
      setDeleteError('An error occurred while deleting the client. Please try again.');
    }
  };

  const handleMarkClientInactive = async () => {
    if (!clientToDelete) return;
    
    try {
      await updateClient(clientToDelete.client_id, { is_inactive: true });
      await refreshClients();
      resetDeleteState();
      toast.success(`${clientToDelete.client_name} has been marked as inactive successfully.`);
    } catch (error) {
      console.error('Error marking client as inactive:', error);
      setDeleteError('An error occurred while marking the client as inactive. Please try again.');
    }
  };

  const handleMultiDelete = () => {
    setMultiDeleteError(null);
    setIsMultiDeleteDialogOpen(true);
  };

  const refreshClients = async () => {
    // Force refresh by changing a key to trigger ClientResults re-render
    setRefreshKey(prev => prev + 1);
  };

  // Memoized search input change handler to prevent re-creation on every render
  const handleSearchInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value);
  }, []);

  // Handle reset filters
  const handleResetFilters = useCallback(() => {
    setSearchInput('');
    setSearchTerm('');
    setFilterStatus('active');
    setClientTypeFilter('all');
    setSelectedTags([]);
    setCurrentPage(1);
    setIsFiltered(false);
  }, []);
  
  // Handle sort change
  const handleSortChange = useCallback((newSortBy: string, newSortDirection: 'asc' | 'desc') => {
    setSortBy(newSortBy);
    setSortDirection(newSortDirection);
    setCurrentPage(1); // Reset to first page when sorting changes
  }, []);
  
  const confirmMultiDelete = async () => {
    try {
      const deleteResults = await Promise.all(
        selectedClients.map(async (clientId: string): Promise<{ clientId: string; result: any }> => {
          const result = await deleteClient(clientId);
          return { clientId, result };
        })
      );
  
      const errors: string[] = [];
      const successfulDeletes: string[] = [];
  
      deleteResults.forEach(({ clientId, result }) => {
        if (!result.success) {
          if ('code' in result && result.code === 'COMPANY_HAS_DEPENDENCIES') {
            const client = clientsForDelete.find(c => c.client_id === clientId);
            const clientName = client ? client.client_name : clientId;
            const dependencyText = formatDependencyText(result);
            errors.push(`${clientName}: ${dependencyText}`);
          }
        } else {
          successfulDeletes.push(clientId);
        }
      });
  
      // Update selected clients to remove successfully deleted ones
      setSelectedClients(prev => prev.filter(id => !successfulDeletes.includes(id)));

      if (errors.length > 0) {
        setMultiDeleteError(
          `Some clients could not be deleted:\n${errors.join('\n')}\n\n` +
          `${successfulDeletes.length} clients were successfully deleted.`
        );
      }

      // If any clients were successfully deleted, refresh the list
      if (successfulDeletes.length > 0) {
        await refreshClients();
      }

      // If all selected clients were successfully deleted, close the dialog
      if (errors.length === 0) {
        setIsMultiDeleteDialogOpen(false);
        setMultiDeleteError(null);
        toast.success(`${successfulDeletes.length} clients have been deleted successfully.`);
      } else if (successfulDeletes.length > 0) {
        // Show partial success toast
        toast.success(`${successfulDeletes.length} clients deleted. ${errors.length} could not be deleted.`);
      }
      
    } catch (error) {
      console.error('Error in multi-delete:', error);
      setMultiDeleteError('An error occurred while deleting clients. Please try again.');
    }
  };

  interface DependencyResult {
    dependencies?: string[];
    counts?: Record<string, number>; // Changed from string to number to match backend
    code?: string;
    message?: string;
  }

  const formatDependencyText = (result: DependencyResult): string => {
    const dependencies = result.dependencies || [];
    const counts = result.counts || {};
    
    // Map the base keys to their full dependency names
    const keyMap: Record<string, string> = {
      'contact': 'contacts',
      'ticket': 'active tickets',
      'project': 'active projects',
      'document': 'documents',
      'invoice': 'invoices',
      'interaction': 'interactions',
      'location': 'locations',
      'service_usage': 'service usage records',
      'bucket_usage': 'bucket usage records',
      'contract_line': 'contract lines',
      'tax_rate': 'tax rates',
      'tax_setting': 'tax settings'
    };

    // Create a reverse mapping from full names to base keys
    const reverseKeyMap: Record<string, string> = {};
    Object.entries(keyMap).forEach(([key, value]) => {
      reverseKeyMap[value] = key;
    });

    return dependencies
    .map((dep: string): string => {
      // Get the base key for this dependency
      const baseKey = reverseKeyMap[dep];
      const count = baseKey ? counts[baseKey] || 0 : 0;
      return `${count} ${dep}`;
    })
    .join(', ');
  };

  const handleDependencyError = (
    result: DependencyResult,
    setError: (error: string) => void
  ) => {
    const dependencyText = formatDependencyText(result);

    setError(
      `Unable to delete this client.\n\n` +
      `This client has the following associated records:\n• ${dependencyText.split(', ').join('\n• ')}\n\n` +
      `Please remove or reassign these items before deleting the client.`
    );

    setShowArchiveOption(true);
  };


  const resetDeleteState = () => {
    setIsDeleteDialogOpen(false);
    setClientToDelete(null);
    setDeleteError(null);
    setShowArchiveOption(false);
  };

  const handleExportToCSV = async () => {
    try {
      let clientsToExport: IClient[];
      
      // If clients are selected, export only those
      if (selectedClients.length > 0) {
        const allClients = await getAllClients(true);
        clientsToExport = allClients.filter(client => 
          selectedClients.includes(client.client_id)
        );
      } else {
        // Otherwise export all clients with current filters
        clientsToExport = await getAllClients(true);
      }
      
      const csvData = await exportClientsToCSV(clientsToExport);
      
      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
      
      const link = document.createElement('a');
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'clients.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      
      toast.success(`Exported ${clientsToExport.length} ${clientsToExport.length === 1 ? 'client' : 'clients'} to CSV`);
    } catch (error) {
      console.error('Error exporting clients to CSV:', error);
      toast.error('Failed to export clients to CSV');
    }
  };

  const handleImportComplete = async (clients: IClient[], updateExisting: boolean) => {
    try {
      await importClientsFromCSV(clients, updateExisting);
      setIsImportDialogOpen(false);
      router.refresh();
    } catch (error) {
      console.error('Error importing clients:', error);
    }
  };

  if (viewMode === null) {
    return (
      <div className="w-full">
        <div className="flex justify-end mb-4 flex-wrap gap-6">
          {/* Show loading skeleton for controls */}
          <div className="w-64 h-10 bg-gray-200 rounded animate-pulse" />
          <div className="w-64 h-10 bg-gray-200 rounded animate-pulse" />
          <div className="w-32 h-10 bg-gray-200 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
        {/* Quick Add Client Dialog */}
        <QuickAddClient
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          onClientAdded={handleClientAdded}
        />

        <div className="flex justify-between items-start mb-4 flex-wrap gap-4">
          {/* Left side - Search and Filters */}
          <div className="flex items-center gap-4 flex-wrap">
            {/* Search */}
            <SearchInput value={searchInput} onChange={handleSearchInputChange} />

            {/* Status Filter */}
            <div className="w-48">
              <CustomSelect
                id="status-filter"
                value={filterStatus}
                onValueChange={(value) => {
                  setFilterStatus(value as 'all' | 'active' | 'inactive');
                  setCurrentPage(1); // Reset to first page when changing filter
                }}
                options={[
                  { value: 'active', label: 'Active Clients' },
                  { value: 'inactive', label: 'Inactive Clients' },
                  { value: 'all', label: 'All Clients' }
                ]}
                placeholder="Filter by status"
                label="Status Filter"
              />
            </div>

            {/* Client Type Filter */}
            <div className="w-48">
              <CustomSelect
                id="client-type-filter"
                value={clientTypeFilter}
                onValueChange={(value) => {
                  setClientTypeFilter(value as 'all' | 'company' | 'individual');
                  setCurrentPage(1); // Reset to first page when changing filter
                }}
                options={[
                  { value: 'all', label: 'All Types' },
                  { value: 'company', label: 'Companies' },
                  { value: 'individual', label: 'Individuals' }
                ]}
                placeholder="Filter by type"
                label="Client Type Filter"
              />
            </div>

            {/* Tag Filter */}
            <TagFilter
              allTags={allUniqueTags}
              selectedTags={selectedTags}
              onTagSelect={(tag) => {
                setSelectedTags(prev => 
                  prev.includes(tag) 
                    ? prev.filter(t => t !== tag)
                    : [...prev, tag]
                );
                setCurrentPage(1); // Reset to first page when changing filter
              }}
            />

            {/* Reset Filters Button */}
            {isFiltered && (
              <Button
                id="reset-filters-button"
                variant="outline"
                size="sm"
                className="whitespace-nowrap flex items-center gap-2"
                onClick={handleResetFilters}
              >
                <XCircle className="h-4 w-4" />
                Reset Filters
              </Button>
            )}
          </div>

          {/* Right side - Actions and View Switcher */}
          <div className="flex items-center gap-4">
            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => setIsDialogOpen(true)}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded"
              >
                + Create Client
              </button>

              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button className="border border-gray-300 rounded-md p-2 flex items-center gap-2">
                    <MoreVertical size={16} />
                    Actions
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content className="bg-white rounded-md shadow-lg p-1">
                  <DropdownMenu.Item 
                    className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center"
                    onSelect={() => setIsImportDialogOpen(true)}
                  >
                    <Upload size={14} className="mr-2" />
                    Upload CSV
                  </DropdownMenu.Item>
                  <DropdownMenu.Item 
                    className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center"
                    onSelect={() => void handleExportToCSV()}
                  >
                    <CloudDownload size={14} className="mr-2" />
                    Download CSV
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </div>

            {/* View Switcher */}
            {!isViewModeLoading && viewMode && (
              <ViewSwitcher
                currentView={viewMode}
                onChange={(mode) => void handleViewModeChange(mode)}
                options={viewOptions}
              />
            )}
          </div>
        </div>

      {/* Delete */}
      <div className="flex items-center gap-8 mb-6 ms-4">
        <div className="[&>div]:mb-0 [&>div]:flex [&>div]:items-center">
          <Checkbox
            id="select-all-clients"
            checked={selectedClients.length > 0}
            onChange={() => void handleSelectAll()}
          />
        </div>
        {selectedClients.length > 0 &&
          <span className="text-sm font-medium text-gray-500">
            {isSelectAllMode ? `All ${selectedClients.length} clients selected` : `${selectedClients.length} Selected`}
          </span>}

        <button
          className="flex gap-1 text-sm font-medium text-gray-500"
          disabled={selectedClients.length === 0}
          onClick={handleMultiDelete}
        >
          Delete
          <TrashIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Clients */}
      <ClientResults
        key={refreshKey}
        searchTerm={searchTerm}
        filterStatus={filterStatus}
        clientTypeFilter={clientTypeFilter}
        selectedTags={selectedTags}
        viewMode={viewMode!}
        selectedClients={selectedClients}
        onCheckboxChange={handleCheckboxChange}
        onEditClient={handleEditClient}
        onDeleteClient={handleDeleteClient}
        onQuickView={handleQuickView}
        onTagsChange={handleTagsChange}
        currentPage={currentPage}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={(size) => {
          // Save to the appropriate preference based on current view mode
          if (viewMode === 'grid') {
            setGridPageSize(size);
          } else {
            setListPageSize(size);
          }
          setCurrentPage(1); // Reset to first page when changing page size
        }}
        onClientTagsLoaded={handleClientTagsLoaded}
        clientTags={clientTags}
        allUniqueTagsFromParent={allUniqueTags}
        sortBy={sortBy}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
      />

      {/* Multi-delete confirmation dialog */}
      <ConfirmationDialog
        id="multi-delete-confirmation-dialog"
        isOpen={isMultiDeleteDialogOpen}
        onClose={() => setIsMultiDeleteDialogOpen(false)}
        onConfirm={() => void confirmMultiDelete()}
        title="Delete Selected Clients"
        message={
          multiDeleteError
            ? multiDeleteError
            : `Are you sure you want to delete ${selectedClients.length} selected clients? This action cannot be undone.`
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      {/* Single client delete confirmation dialog */}
      <Dialog
        isOpen={isDeleteDialogOpen}
        onClose={resetDeleteState}
        id="single-delete-confirmation-dialog"
        title="Delete Client"
      >
        <DialogContent>
          <div className="space-y-4">
            {deleteError ? (
              <div className="text-gray-600 whitespace-pre-line">
                {deleteError}
              </div>
            ) : (
              <p className="text-gray-600">
                Are you sure you want to delete {clientToDelete?.client_name}? This action cannot be undone.
              </p>
            )}

            {showArchiveOption && deleteError && (
              <Alert variant="info">
                <AlertDescription>
                  <strong>Alternative Option:</strong> You can mark this client as inactive instead.
                  Inactive clients are hidden from most views but retain all their data and can be marked as active later.
                </AlertDescription>
              </Alert>
            )}
          </div>
          
          <DialogFooter>
            <div className="mt-4 flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={resetDeleteState}
                id="single-delete-cancel"
              >
                Cancel
              </Button>
              
              {deleteError && showArchiveOption ? (
                <Button
                  onClick={() => void handleMarkClientInactive()}
                  id="mark-inactive-button"
                  variant="ghost"
                >
                  Mark as Inactive
                </Button>
              ) : (
                !deleteError && (
                  <Button
                    onClick={() => void confirmDelete()}
                    id="single-delete-confirm"
                    variant="destructive"
                  >
                    Delete
                  </Button>
                )
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* CSV Import Dialog */}
      <ClientsImportDialog
        isOpen={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
        onImportComplete={(clients, updateExisting) => void handleImportComplete(clients, updateExisting)}
      />
      
      {/* Quick View Drawer */}
      <Drawer
        id="client-quick-view-drawer"
        isOpen={isQuickViewOpen}
        onClose={() => {
          setIsQuickViewOpen(false);
          setQuickViewClient(null);
          // Refresh clients to show any updates
          refreshClients();
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


    </div>
  );
};

export default Clients;
