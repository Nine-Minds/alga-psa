'use client';
import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import type { DeletionValidationResult, IClient } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { usePrintAction } from '@alga-psa/ui/components/PrintButton';
import {
  PrintOptionsDialog,
  type PrintColumnOption,
  usePrintColumnSelection,
} from '@alga-psa/ui/components/PrintOptionsDialog';
import { PrintableTable } from '@alga-psa/ui/components/PrintableTable';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import {
  DropdownMenuContent as StyledDropdownMenuContent,
  DropdownMenuItem as StyledDropdownMenuItem,
  DropdownMenuSeparator as StyledDropdownMenuSeparator,
} from '@alga-psa/ui/components/DropdownMenu';
import QuickAddClient from './QuickAddClient';
import { getAllClients } from '@alga-psa/clients/actions';
import {
  getAllClientsPaginated,
  deleteClient,
  validateClientDeletion,
  exportClientsToCSV,
  markClientInactiveWithContacts,
  markClientActiveWithContacts,
} from '@alga-psa/clients/actions';
import { findTagsByEntityIds, findAllTagsByType, isTagActionError } from '@alga-psa/tags/actions';
import { TagFilter } from '@alga-psa/ui/components';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import ClientsGrid from './ClientsGrid';
import ClientsList from './ClientsList';
import ViewSwitcher, { ViewSwitcherOption } from '@alga-psa/ui/components/ViewSwitcher';
import { TrashIcon, MoreVertical, CloudDownload, Upload, LayoutGrid, List, Search, XCircle, Power, RotateCcw, Printer, Settings2, Share2 } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useUserPreference } from '@alga-psa/user-composition/hooks';
import ClientsImportDialog from './ClientsImportDialog';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import Drawer from '@alga-psa/ui/components/Drawer';
import ClientQuickView from './ClientQuickView';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import toast from 'react-hot-toast';
import { DeleteEntityDialog, handleError, useClientDrawer } from '@alga-psa/ui';
import { useTagPermissions } from '@alga-psa/tags/hooks';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ShortcutActiveRegion, usePageCreateShortcut } from '@alga-psa/ui/keyboard-shortcuts';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

const COMPANY_VIEW_MODE_SETTING = 'client_list_view_mode';
const CLIENTS_GRID_PAGE_SIZE_SETTING = 'clients_grid_page_size';
const CLIENTS_LIST_PAGE_SIZE_SETTING = 'clients_list_page_size';
const CLIENTS_PRINT_PAGE_SIZE = 5000;

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

const formatClientPrintAddress = (client: IClient): string => {
  return [
    client.address_line1 ?? client.address,
    client.address_line2 ?? client.address_2,
    client.city,
    client.state_province ?? client.state,
    client.postal_code ?? client.zip,
    client.country_name ?? client.country,
  ].filter(Boolean).join(', ');
};

// Memoized search input component to prevent re-renders
const SearchInput = memo(({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
}) => {
  return (
    <div className="relative p-0.5">
      <Input
        id="search-clients"
        data-automation-id="search-clients"
        type="text"
        placeholder={placeholder}
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
  onSelectionChange: (clientIds: string[]) => void;
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
  onClientsLoaded?: (clients: IClient[]) => void;
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
  onSelectionChange,
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
  onClientsLoaded,
  clientTags: parentClientTags,
  allUniqueTagsFromParent,
  sortBy,
  sortDirection,
  onSortChange
}: ClientResultsProps) => {
  const { t } = useTranslation('msp/clients');
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
        // Notify parent component when clients are loaded
        onClientsLoaded?.(response.clients);
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
        if (isTagActionError(clientTags)) {
          console.error('Error fetching client tags:', clientTags);
        } else {
          clientTags.forEach(tag => {
            if (!newClientTags[tag.tagged_id]) {
              newClientTags[tag.tagged_id] = [];
            }
            newClientTags[tag.tagged_id].push(tag);
          });
        }

        setLocalClientTags(newClientTags);
        const safeAllTags = isTagActionError(allTags) ? [] : allTags;
        if (isTagActionError(allTags)) {
          console.error('Error fetching all client tags:', allTags);
        }
        setAllUniqueTags(safeAllTags);
        
        // Notify parent component about loaded tags
        if (onClientTagsLoaded) {
          onClientTagsLoaded(newClientTags, safeAllTags);
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
          text={t('clientsPage.loadingClients', { defaultValue: 'Loading clients...' })}
          spinnerProps={{ size: 'lg' }}
          layout="stacked"
        />
      </div>
    );
  }

  return (
    <ShortcutActiveRegion id="clients-shortcut-region" className="flex-1 outline-none">
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
          setSelectedClients={onSelectionChange}
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
    </ShortcutActiveRegion>
  );
});

ClientResults.displayName = 'ClientResults';

const Clients: React.FC = () => {
  useTagPermissions(['client']);
  const { t } = useTranslation('msp/clients');
  

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
  const openCreateClient = useCallback(() => setIsDialogOpen(true), []);
  usePageCreateShortcut(openCreateClient);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);

  // This list fetches its own data client-side, so router.refresh() (used by the global
  // quick-create) won't reload it. Listen for the quick-create "created" event and re-fetch.
  // Event name is mirrored in QuickCreateDialog.tsx.
  useEffect(() => {
    const onCreated = (event: Event) => {
      const detail = (event as CustomEvent<{ entity?: string }>).detail;
      if (detail?.entity === 'client') {
        setRefreshKey((prev) => prev + 1);
      }
    };
    window.addEventListener('alga:quick-create:created', onCreated);
    return () => window.removeEventListener('alga:quick-create:created', onCreated);
  }, []);

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
    setValue: setGridPageSize,
    isLoading: isGridPageSizeLoading
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
    setValue: setListPageSize,
    isLoading: isListPageSizeLoading
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
  const areClientPreferencesLoading = isViewModeLoading || isGridPageSizeLoading || isListPageSizeLoading;

  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [isSelectAllMode, setIsSelectAllMode] = useState(false);
  const [loadedClients, setLoadedClients] = useState<IClient[]>([]);
  const [printClients, setPrintClients] = useState<IClient[]>([]);
  const [isPrintOptionsOpen, setIsPrintOptionsOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [isMultiDeleteDialogOpen, setIsMultiDeleteDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [multiDeleteError, setMultiDeleteError] = useState<string | null>(null);
  const [multiDeleteResults, setMultiDeleteResults] = useState<{
    successCount: number;
    failedClients: Array<{ clientId: string; clientName: string; reason: string }>;
  } | null>(null);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);


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
  
  const formatClientCountLabel = useCallback((count: number) => {
    return t('clientsPage.entities.client', { count, defaultValue_one: 'client', defaultValue_other: 'clients' });
  }, [t]);

  const formatContactCountLabel = useCallback((count: number) => {
    return t('clientsPage.entities.contact', { count, defaultValue_one: 'contact', defaultValue_other: 'contacts' });
  }, [t]);

  const formatSelectedSummary = useCallback((count: number) => {
    if (count === 1) {
      return t('clientsPage.selectedSingle', {
        defaultValue: '{{count}} Selected',
        count,
      });
    }

    return t('clientsPage.selectedPlural', {
      defaultValue: '{{count}} Selected',
      count,
    });
  }, [t]);

  const localizeClientDeleteValidation = useCallback((result: DeletionValidationResult): DeletionValidationResult => {
    const hasClientOnlyAlternative = result.alternatives.some((alternative) => alternative.action === 'deactivate_client_only');
    const dependencyLabel = (type: string, count: number, fallback: string) => {
      const dependencyKeys: Record<string, [string, string, string, string]> = {
        contact: ['clientsPage.dependency.contact', 'contact', 'clientsPage.dependency.contacts', 'contacts'],
        ticket: ['clientsPage.dependency.ticket', 'ticket', 'clientsPage.dependency.tickets', 'tickets'],
        project: ['clientsPage.dependency.project', 'project', 'clientsPage.dependency.projects', 'projects'],
        invoice: ['clientsPage.dependency.invoice', 'invoice', 'clientsPage.dependency.invoices', 'invoices'],
        document: ['clientsPage.dependency.document', 'document', 'clientsPage.dependency.documents', 'documents'],
        interaction: ['clientsPage.dependency.interaction', 'interaction', 'clientsPage.dependency.interactions', 'interactions'],
        asset: ['clientsPage.dependency.asset', 'asset', 'clientsPage.dependency.assets', 'assets'],
        usage: ['clientsPage.dependency.serviceUsageRecord', 'service usage record', 'clientsPage.dependency.serviceUsageRecords', 'service usage records'],
        bucket_usage: ['clientsPage.dependency.bucketUsageRecord', 'bucket usage record', 'clientsPage.dependency.bucketUsageRecords', 'bucket usage records'],
      };
      const keys = dependencyKeys[type];
      if (!keys) return fallback;
      const [singularKey, singularDefault, pluralKey, pluralDefault] = keys;
      return count === 1
        ? t(singularKey, { defaultValue: singularDefault })
        : t(pluralKey, { defaultValue: pluralDefault });
    };

    const message = (() => {
      if (result.code === 'DEPENDENCIES_EXIST') {
        return t('clientsPage.deleteClientUnable', { defaultValue: 'Unable to delete this client.' });
      }
      if (result.code === 'IS_DEFAULT') {
        return t('clientsPage.defaultClientDeleteError', {
          defaultValue: 'Cannot delete the default client. Please set another client as default in General Settings first.',
        });
      }
      if (result.code === 'NOT_FOUND') {
        return t('clientsPage.clientNotFound', { defaultValue: 'Client not found.' });
      }
      if (result.code === 'PERMISSION_DENIED') {
        return t('clientsPage.deletePermissionDenied', {
          defaultValue: 'Permission denied: Cannot delete clients.',
        });
      }
      return result.message;
    })();

    return {
      ...result,
      message,
      dependencies: result.dependencies.map((dependency) => ({
        ...dependency,
        label: dependencyLabel(dependency.type, dependency.count, dependency.label),
      })),
      alternatives: result.alternatives.map((alternative) => {
        if (alternative.action === 'deactivate_client_only') {
          return {
            ...alternative,
            label: t('clientDetails.clientOnly', { defaultValue: 'Client Only' }),
            description: t('clientDetails.deactivateClientOnlyDescription', {
              defaultValue: 'Deactivate the client but leave its contacts active.',
            }),
          };
        }

        if (alternative.action === 'deactivate') {
          return {
            ...alternative,
            label: hasClientOnlyAlternative
              ? t('clientDetails.clientAndContacts', { defaultValue: 'Client & Contacts' })
              : t('clientsPage.markAsInactive', { defaultValue: 'Mark as Inactive' }),
            description: t('clientDetails.deactivateClientDescription', {
              defaultValue: 'Deactivates the record without deleting its data.',
            }),
          };
        }

        return alternative;
      }),
    };
  }, [t]);


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
    {
      value: 'grid',
      label: t('clientsPage.cardsView', { defaultValue: 'Cards' }),
      icon: LayoutGrid,
    },
    {
      value: 'list',
      label: t('clientsPage.tableView', { defaultValue: 'Table' }),
      icon: List,
    },
  ];

  const handleViewModeChange = (newMode: ClientViewMode) => {
    setViewModePreference(newMode);
    setCurrentPage(1); // Reset to first page when changing view
  };


  const handleClientAdded = (newClient: IClient) => {
    // Store tags for the new client if provided (for immediate display)
    if (newClient.client_id && newClient.tags && newClient.tags.length > 0) {
      setClientTags(current => ({
        ...current,
        [newClient.client_id]: newClient.tags!
      }));

      // Update unique tags list with any new tags
      setAllUniqueTags(prevTags => {
        const currentTagTexts = new Set(prevTags.map(t => t.tag_text));
        const newUniqueTags = newClient.tags!.filter(tag => !currentTagTexts.has(tag.tag_text));
        if (newUniqueTags.length > 0) {
          return [...prevTags, ...newUniqueTags];
        }
        return prevTags;
      });
    }

    // Refresh the list after a client is added
    setRefreshKey(prev => prev + 1);
    toast.success(t('clientsPage.createSuccess', {
      defaultValue: '{{name}} has been created successfully.',
      name: newClient.client_name,
    }));
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

  const handleSelectAll = () => {
    if (selectedClients.length > 0 || isSelectAllMode) {
      // Clear all selections
      setSelectedClients([]);
      setIsSelectAllMode(false);
    } else {
      // Select all clients on the current page (from loaded clients)
      const clientIds = loadedClients.map(c => c.client_id);
      if (clientIds.length > 0) {
        setSelectedClients(clientIds);
        setIsSelectAllMode(true);
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

  const handleClientsLoaded = useCallback((clients: IClient[]) => {
    // Store loaded clients for use in bulk operations (e.g., displaying names in delete results)
    setLoadedClients(clients);
  }, []);
  

  const handleEditClient = async (clientId: string) => {
    // Navigate directly to the client page for editing
    router.push(`/msp/clients/${clientId}`);
  };

  const clientDrawer = useClientDrawer();

  const handleQuickView = (client: IClient) => {
    if (clientDrawer) {
      clientDrawer.openClientDrawer(client.client_id);
      return;
    }
    setQuickViewClient(client);
    setIsQuickViewOpen(true);
  };



  const runDeleteValidation = useCallback(async (clientId: string) => {
    setIsDeleteValidating(true);
    try {
      const result = await validateClientDeletion(clientId);
      setDeleteValidation(localizeClientDeleteValidation(result));
    } catch (error) {
      console.error('Failed to validate client deletion:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: t('clientsPage.singleDeleteError', {
          defaultValue: 'An error occurred while deleting the client. Please try again.',
        }),
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, [localizeClientDeleteValidation, t]);

  const handleDeleteClient = async (client: IClient) => {
    setClientToDelete(client);
    setDeleteValidation(null);
    setIsDeleteDialogOpen(true);
    void runDeleteValidation(client.client_id);
  };

  const confirmDelete = async () => {
    if (!clientToDelete) return;
    setIsDeleteProcessing(true);
    try {
      const result = await deleteClient(clientToDelete.client_id);

      if (!result.success) {
        setDeleteValidation(localizeClientDeleteValidation(result));
        return;
      }

      toast.success(t('clientsPage.deleteSingleSuccess', {
        defaultValue: '{{name}} has been deleted successfully.',
        name: clientToDelete.client_name,
      }));

      setRefreshKey(prev => prev + 1);
      resetDeleteState();
    } catch (error) {
      console.error('Error deleting client:', error);
      toast.error(t('clientsPage.singleDeleteError', {
        defaultValue: 'An error occurred while deleting the client. Please try again.',
      }));
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  const handleDeleteAlternativeAction = async (action: string) => {
    setIsDeleteProcessing(true);
    try {
      if (action === 'deactivate') {
        await handleMarkClientInactiveAll();
      } else if (action === 'deactivate_client_only') {
        await handleMarkClientInactiveOnly();
      }
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  // Handler for deactivating client from delete dialog (deactivates all contacts)
  const handleMarkClientInactiveAll = async () => {
    if (!clientToDelete) return;

    const clientName = clientToDelete.client_name;
    try {
      // Use atomic action to deactivate client AND all contacts
      const result = await markClientInactiveWithContacts(clientToDelete.client_id, true);

      if (!result.success) {
        handleError(new Error(result.message || t('clientsPage.markInactiveFailed', {
          defaultValue: 'Failed to mark client as inactive',
        })));
        resetDeleteState();
        return;
      }

      if (result.contactsDeactivated > 0) {
        toast.success(t('clientsPage.singleInactiveWithContactsSuccess', {
          name: clientName,
          count: result.contactsDeactivated,
        }));
      } else {
        toast.success(t('clientsPage.singleInactiveSuccess', { name: clientName }));
      }

      // Close dialog first, then refresh
      resetDeleteState();
      await refreshClients();
    } catch (error: any) {
      handleError(error, t('clientsPage.singleInactiveError', {
        defaultValue: 'An error occurred while marking the client as inactive. Please try again.',
      }));
      resetDeleteState();
    }
  };

  // Handler for deactivating client from delete dialog (client only)
  const handleMarkClientInactiveOnly = async () => {
    if (!clientToDelete) return;

    const clientName = clientToDelete.client_name;
    try {
      // Use atomic action to deactivate client only
      const result = await markClientInactiveWithContacts(clientToDelete.client_id, false);

      if (!result.success) {
        handleError(new Error(result.message || t('clientsPage.markInactiveFailed', {
          defaultValue: 'Failed to mark client as inactive',
        })));
        resetDeleteState();
        return;
      }

      toast.success(t('clientsPage.singleInactiveSuccess', { name: clientName }));

      // Close dialog first, then refresh
      resetDeleteState();
      await refreshClients();
    } catch (error: any) {
      handleError(error, t('clientsPage.singleInactiveError', {
        defaultValue: 'An error occurred while marking the client as inactive. Please try again.',
      }));
      resetDeleteState();
    }
  };

  // Handler for bulk Mark as Inactive
  const handleBulkMarkInactive = async () => {
    if (selectedClients.length === 0) return;

    try {
      // Process in chunks of 10 to avoid overwhelming the server
      const CHUNK_SIZE = 10;
      const results: { clientId: string; success: boolean; contactsDeactivated: number }[] = [];

      for (let i = 0; i < selectedClients.length; i += CHUNK_SIZE) {
        const chunk = selectedClients.slice(i, i + CHUNK_SIZE);
        const chunkResults = await Promise.all(
          chunk.map(async (clientId: string) => {
            try {
              const result = await markClientInactiveWithContacts(clientId, true);
              return { clientId, success: result.success, contactsDeactivated: result.contactsDeactivated || 0 };
            } catch (error) {
              return { clientId, success: false, contactsDeactivated: 0 };
            }
          })
        );
        results.push(...chunkResults);
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;
      const totalContactsDeactivated = results.reduce((sum, r) => sum + r.contactsDeactivated, 0);

      if (failCount > 0) {
        toast.error(t('clientsPage.bulkInactiveFailed', {
          defaultValue: '{{count}} clients could not be marked as inactive.',
          count: failCount,
        }));
      }
      if (successCount > 0) {
        if (totalContactsDeactivated > 0) {
          toast.success(t('clientsPage.bulkInactiveWithContactsSuccess', {
            defaultValue: '{{clientCount}} {{clientsLabel}} and {{contactCount}} {{contactsLabel}} have been marked as inactive successfully.',
            clientCount: successCount,
            clientsLabel: formatClientCountLabel(successCount),
            contactCount: totalContactsDeactivated,
            contactsLabel: formatContactCountLabel(totalContactsDeactivated),
          }));
        } else {
          toast.success(t('clientsPage.bulkInactiveSuccess', {
            defaultValue: '{{count}} clients have been marked as inactive successfully.',
            count: successCount,
          }));
        }
      }

      setSelectedClients([]);
      setIsSelectAllMode(false);
      await refreshClients();
    } catch (error) {
      handleError(error, t('clientsPage.bulkInactiveError', {
        defaultValue: 'An error occurred while marking clients as inactive. Please try again.',
      }));
    }
  };

  // Handler for bulk Reactivate
  const handleBulkReactivate = async () => {
    if (selectedClients.length === 0) return;

    try {
      // Process in chunks of 10 to avoid overwhelming the server
      const CHUNK_SIZE = 10;
      const results: { clientId: string; success: boolean; contactsReactivated: number }[] = [];

      for (let i = 0; i < selectedClients.length; i += CHUNK_SIZE) {
        const chunk = selectedClients.slice(i, i + CHUNK_SIZE);
        const chunkResults = await Promise.all(
          chunk.map(async (clientId: string) => {
            try {
              const result = await markClientActiveWithContacts(clientId, true);
              return { clientId, success: result.success, contactsReactivated: result.contactsReactivated || 0 };
            } catch (error) {
              return { clientId, success: false, contactsReactivated: 0 };
            }
          })
        );
        results.push(...chunkResults);
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;
      const totalContactsReactivated = results.reduce((sum, r) => sum + r.contactsReactivated, 0);

      if (failCount > 0) {
        toast.error(t('clientsPage.bulkReactivateFailed', {
          defaultValue: '{{count}} clients could not be reactivated.',
          count: failCount,
        }));
      }
      if (successCount > 0) {
        if (totalContactsReactivated > 0) {
          toast.success(t('clientsPage.bulkReactivateWithContactsSuccess', {
            defaultValue: '{{clientCount}} {{clientsLabel}} and {{contactCount}} {{contactsLabel}} have been reactivated successfully.',
            clientCount: successCount,
            clientsLabel: formatClientCountLabel(successCount),
            contactCount: totalContactsReactivated,
            contactsLabel: formatContactCountLabel(totalContactsReactivated),
          }));
        } else {
          toast.success(t('clientsPage.bulkReactivateSuccess', {
            defaultValue: '{{count}} clients have been reactivated successfully.',
            count: successCount,
          }));
        }
      }

      setSelectedClients([]);
      setIsSelectAllMode(false);
      await refreshClients();
    } catch (error) {
      handleError(error, t('clientsPage.bulkReactivateError', {
        defaultValue: 'An error occurred while reactivating clients. Please try again.',
      }));
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

      const failedClients: Array<{ clientId: string; clientName: string; reason: string }> = [];
      const successfulDeletes: string[] = [];

      deleteResults.forEach(({ clientId, result }) => {
        if (!result.success) {
          const client = loadedClients.find(c => c.client_id === clientId);
            const clientName = client
              ? client.client_name
              : t('clientsPage.unknownClient', { defaultValue: 'Unknown Client' });

          if ('code' in result && result.code === 'DEPENDENCIES_EXIST' && result.dependencies?.length > 0) {
            const reason = formatDependencyText(result);
            failedClients.push({ clientId, clientName, reason });
          } else {
            failedClients.push({
              clientId,
              clientName,
              reason: result.message || t('clientsPage.unknownError', { defaultValue: 'Unknown error' }),
            });
          }
        } else {
          successfulDeletes.push(clientId);
        }
      });

      // Update selected clients to remove successfully deleted ones
      setSelectedClients(prev => prev.filter(id => !successfulDeletes.includes(id)));

      // If any clients were successfully deleted, refresh the list
      if (successfulDeletes.length > 0) {
        await refreshClients();
      }

      // If all selected clients were successfully deleted, close the dialog
      if (failedClients.length === 0) {
        setIsMultiDeleteDialogOpen(false);
        setMultiDeleteError(null);
        setMultiDeleteResults(null);
        toast.success(t('clientsPage.bulkDeleteSuccess', {
          defaultValue: '{{count}} clients have been deleted successfully.',
          count: successfulDeletes.length,
        }));
      } else {
        // Store structured results for better UI display
        setMultiDeleteResults({
          successCount: successfulDeletes.length,
          failedClients
        });
      }

    } catch (error) {
      console.error('Error in multi-delete:', error);
      setMultiDeleteError(t('clientsPage.bulkDeleteError', {
        defaultValue: 'An error occurred while deleting clients. Please try again.',
      }));
    }
  };

  // Handler for marking failed bulk-delete clients as inactive
  const handleBulkMarkFailedAsInactive = async () => {
    if (!multiDeleteResults || multiDeleteResults.failedClients.length === 0) return;

    const clientIds = multiDeleteResults.failedClients.map(c => c.clientId);

    try {
      const results = await Promise.all(
        clientIds.map(async (clientId) => {
          try {
            const result = await markClientInactiveWithContacts(clientId, true);
            return { clientId, success: result.success, contactsDeactivated: result.contactsDeactivated || 0 };
          } catch (error) {
            return { clientId, success: false, contactsDeactivated: 0 };
          }
        })
      );

      const successCount = results.filter(r => r.success).length;
      const totalContactsDeactivated = results.reduce((sum, r) => sum + r.contactsDeactivated, 0);

      // Close dialog and reset state
      setIsMultiDeleteDialogOpen(false);
      setMultiDeleteError(null);
      setMultiDeleteResults(null);
      setSelectedClients([]);
      setIsSelectAllMode(false);

      await refreshClients();

      if (successCount > 0) {
        if (totalContactsDeactivated > 0) {
          toast.success(t('clientsPage.bulkInactiveWithContactsShortSuccess', {
            defaultValue: '{{clientCount}} {{clientsLabel}} and {{contactCount}} {{contactsLabel}} have been marked as inactive.',
            clientCount: successCount,
            clientsLabel: formatClientCountLabel(successCount),
            contactCount: totalContactsDeactivated,
            contactsLabel: formatContactCountLabel(totalContactsDeactivated),
          }));
        } else {
          toast.success(t('clientsPage.bulkInactiveShortSuccess', {
            defaultValue: '{{count}} clients have been marked as inactive.',
            count: successCount,
          }));
        }
      }
    } catch (error) {
      handleError(error, t('clientsPage.bulkInactiveShortError', {
        defaultValue: 'An error occurred while marking clients as inactive.',
      }));
    }
  };

  const formatDependencyText = (result: DeletionValidationResult): string => {
    return result.dependencies.map((dep) => `${dep.count} ${dep.label}`).join(', ');
  };

  const resetDeleteState = () => {
    setIsDeleteDialogOpen(false);
    setClientToDelete(null);
    setDeleteValidation(null);
    setIsDeleteValidating(false);
    setIsDeleteProcessing(false);
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
      if (isReturnedActionError(csvData)) {
        toast.error(getErrorMessage(csvData));
        return;
      }
      
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
      
      toast.success(t('clientsPage.exportSuccess', {
        defaultValue: 'Exported {{count}} clients to CSV',
        count: clientsToExport.length,
      }));
    } catch (error) {
      console.error('Error exporting clients to CSV:', error);
      toast.error(t('clientsPage.exportError', { defaultValue: 'Failed to export clients to CSV' }));
    }
  };

  const hydratePrintClientTags = useCallback(async (clientsToPrint: IClient[]) => {
    if (clientsToPrint.length === 0) return;

    try {
      const tags = await findTagsByEntityIds(
        clientsToPrint.map((client) => client.client_id),
        'client'
      );
      if (isTagActionError(tags)) {
        console.error('Error hydrating print client tags:', tags);
        return;
      }
      const nextClientTags: Record<string, ITag[]> = {};
      tags.forEach((tag) => {
        if (!nextClientTags[tag.tagged_id]) {
          nextClientTags[tag.tagged_id] = [];
        }
        nextClientTags[tag.tagged_id].push(tag);
      });
      setClientTags((current) => ({ ...current, ...nextClientTags }));
    } catch (error) {
      console.error('Error fetching print client tags:', error);
    }
  }, []);

  const preparePrintClients = useCallback(async () => {
    if (selectedClients.length > 0) {
      const selectedClientSet = new Set(selectedClients);
      const loadedSelectedClients = loadedClients.filter((client) => selectedClientSet.has(client.client_id));

      if (loadedSelectedClients.length === selectedClients.length) {
        await hydratePrintClientTags(loadedSelectedClients);
        setPrintClients(loadedSelectedClients);
        return;
      }

      const response = await getAllClientsPaginated({
        page: 1,
        pageSize: CLIENTS_PRINT_PAGE_SIZE,
        includeInactive: true,
        loadLogos: false,
        sortBy,
        sortDirection,
      });
      const clientsToPrint = response.clients.filter((client) => selectedClientSet.has(client.client_id));
      await hydratePrintClientTags(clientsToPrint);
      setPrintClients(clientsToPrint);
      return;
    }

    const response = await getAllClientsPaginated({
      page: 1,
      pageSize: CLIENTS_PRINT_PAGE_SIZE,
      includeInactive: filterStatus !== 'active',
      statusFilter: filterStatus,
      searchTerm,
      clientTypeFilter,
      selectedTags,
      loadLogos: false,
      sortBy,
      sortDirection,
    });

    await hydratePrintClientTags(response.clients);
    setPrintClients(response.clients);
  }, [
    clientTypeFilter,
    filterStatus,
    hydratePrintClientTags,
    loadedClients,
    searchTerm,
    selectedClients,
    selectedTags,
    sortBy,
    sortDirection,
  ]);

  const clientPrintColumns = useMemo<PrintColumnOption<IClient>[]>(() => [
    {
      key: 'client_name',
      label: t('clientsList.name', { defaultValue: 'Name' }),
      header: t('clientsList.name', { defaultValue: 'Name' }),
      render: (client) => client.client_name,
    },
    {
      key: 'created_at',
      label: t('clientsList.created', { defaultValue: 'Created' }),
      header: t('clientsList.created', { defaultValue: 'Created' }),
      render: (client) => client.created_at
        ? new Date(client.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : t('common.states.na', { defaultValue: 'N/A' }),
    },
    {
      key: 'client_type',
      label: t('clientsList.type', { defaultValue: 'Type' }),
      header: t('clientsList.type', { defaultValue: 'Type' }),
      render: (client) => client.client_type
        ? t(`clientsPage.clientTypes.${client.client_type}`, { defaultValue: client.client_type })
        : t('clientsPage.print.emptyValue', { defaultValue: '-' }),
    },
    {
      key: 'phone_no',
      label: t('clientsList.phone', { defaultValue: 'Phone' }),
      header: t('clientsList.phone', { defaultValue: 'Phone' }),
      render: (client) => client.location_phone ?? client.phone_no ?? t('clientsPage.print.emptyValue', { defaultValue: '-' }),
    },
    {
      key: 'address',
      label: t('clientsList.address', { defaultValue: 'Address' }),
      header: t('clientsList.address', { defaultValue: 'Address' }),
      render: (client) => formatClientPrintAddress(client) || t('clientsPage.print.emptyValue', { defaultValue: '-' }),
    },
    {
      key: 'account_manager_full_name',
      label: t('clientsList.accountManager', { defaultValue: 'Account Manager' }),
      header: t('clientsList.accountManager', { defaultValue: 'Account Manager' }),
      render: (client) => client.account_manager_full_name || t('common.states.na', { defaultValue: 'N/A' }),
    },
    {
      key: 'url',
      label: t('clientsList.url', { defaultValue: 'URL' }),
      header: t('clientsList.url', { defaultValue: 'URL' }),
      render: (client) => client.url || t('common.states.na', { defaultValue: 'N/A' }),
    },
    {
      key: 'tags',
      label: t('clientsList.tags', { defaultValue: 'Tags' }),
      header: t('clientsList.tags', { defaultValue: 'Tags' }),
      render: (client) => {
        const tags = clientTags[client.client_id] ?? [];
        return tags.length > 0
          ? tags.map((tag) => tag.tag_text).join(', ')
          : t('clientsPage.print.emptyValue', { defaultValue: '-' });
      },
    },
    {
      key: 'status',
      label: t('clientsPage.print.columns.status', { defaultValue: 'Status' }),
      header: t('clientsPage.print.columns.status', { defaultValue: 'Status' }),
      render: (client) => client.is_inactive
        ? t('common.states.inactive', { defaultValue: 'Inactive' })
        : t('common.states.active', { defaultValue: 'Active' }),
    },
  ], [clientTags, t]);
  const {
    selectedColumnKeys: selectedClientPrintColumnKeys,
    selectedColumns: selectedClientPrintColumns,
    setSelectedColumnKeys: setSelectedClientPrintColumnKeys,
    resetSelectedColumnKeys: resetSelectedClientPrintColumnKeys,
  } = usePrintColumnSelection('print-columns:clients-list', clientPrintColumns);

  const { triggerPrint: triggerPrintClients, isPreparing: isPreparingClientPrint } = usePrintAction({
    onBeforePrint: preparePrintClients,
    onAfterPrint: () => setPrintClients([]),
  });

  const handleImportComplete = async () => {
    setIsImportDialogOpen(false);
    await refreshClients();
    router.refresh();
  };

  if (viewMode === null || areClientPreferencesLoading) {
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

        {/* Actions row */}
        <div className="flex justify-end items-center mb-4 gap-4">
          <div className="flex gap-2">
            <Button
              id="create-client-button"
              onClick={openCreateClient}
            >
              {t('clientsPage.createClientShort', { defaultValue: '+ Create Client' })}
            </Button>

            <DropdownMenu.Root>
              <Tooltip content={t('clientsPage.shareTooltip', { defaultValue: 'Print, import and export' })}>
                <DropdownMenu.Trigger asChild>
                  <Button
                    id="clients-actions-button"
                    variant="outline"
                    size="default"
                    className="w-10 px-0"
                    aria-label={t('clientsPage.shareTooltip', { defaultValue: 'Print, import and export' })}
                  >
                    <Share2 className="h-4 w-4" />
                  </Button>
                </DropdownMenu.Trigger>
              </Tooltip>
              <StyledDropdownMenuContent align="end" className="w-56">
                <StyledDropdownMenuItem
                  onSelect={(event) => { event.preventDefault(); void triggerPrintClients(); }}
                  disabled={isPreparingClientPrint}
                  className="gap-2"
                >
                  <Printer className="h-4 w-4 text-[rgb(var(--color-text-500))]" />
                  <span className="flex-1">
                    {selectedClients.length > 0
                      ? t('actions.printSelected', {
                          count: selectedClients.length,
                          defaultValue: 'Print selected ({{count}})',
                        })
                      : t('actions.print', { defaultValue: 'Print' })}
                  </span>
                </StyledDropdownMenuItem>
                <StyledDropdownMenuItem
                  onSelect={(event) => { event.preventDefault(); setIsPrintOptionsOpen(true); }}
                  className="gap-2"
                >
                  <Settings2 className="h-4 w-4 text-[rgb(var(--color-text-500))]" />
                  <span className="flex-1">{t('actions.printOptions', { defaultValue: 'Print options' })}</span>
                </StyledDropdownMenuItem>
                <StyledDropdownMenuSeparator />
                <StyledDropdownMenuItem
                  onSelect={() => setIsImportDialogOpen(true)}
                  className="gap-2"
                >
                  <Upload className="h-4 w-4 text-[rgb(var(--color-text-500))]" />
                  <span className="flex-1">{t('common.actions.uploadCsv', { defaultValue: 'Upload CSV' })}</span>
                </StyledDropdownMenuItem>
                <StyledDropdownMenuItem
                  onSelect={() => void handleExportToCSV()}
                  className="gap-2"
                >
                  <CloudDownload className="h-4 w-4 text-[rgb(var(--color-text-500))]" />
                  <span className="flex-1">{t('common.actions.downloadCsv', { defaultValue: 'Download CSV' })}</span>
                </StyledDropdownMenuItem>
                <StyledDropdownMenuSeparator />
                <StyledDropdownMenuItem
                  onSelect={() => selectedClients.length > 0 && void handleBulkMarkInactive()}
                  disabled={selectedClients.length === 0}
                  className="gap-2"
                >
                  <Power className="h-4 w-4 text-[rgb(var(--color-text-500))]" />
                  <span className="flex-1">{t('clientsPage.markAsInactive', { defaultValue: 'Mark as Inactive' })}</span>
                </StyledDropdownMenuItem>
                <StyledDropdownMenuItem
                  onSelect={() => selectedClients.length > 0 && void handleBulkReactivate()}
                  disabled={selectedClients.length === 0}
                  className="gap-2"
                >
                  <RotateCcw className="h-4 w-4 text-[rgb(var(--color-text-500))]" />
                  <span className="flex-1">{t('common.actions.reactivate', { defaultValue: 'Reactivate' })}</span>
                </StyledDropdownMenuItem>
              </StyledDropdownMenuContent>
            </DropdownMenu.Root>
          </div>

          <ViewSwitcher
            currentView={viewMode}
            onChange={(mode) => void handleViewModeChange(mode)}
            options={viewOptions}
          />
        </div>

        {/* Filter row */}
        <div className="flex items-center mb-4 gap-4">
            <SearchInput
              value={searchInput}
              onChange={handleSearchInputChange}
              placeholder={t('clientsPage.searchPlaceholder', { defaultValue: 'Search clients, notes, documents, and interactions' })}
            />

            <div className="w-48 shrink-0">
              <CustomSelect
                id="status-filter"
                value={filterStatus}
                onValueChange={(value) => {
                  setFilterStatus(value as 'all' | 'active' | 'inactive');
                  setCurrentPage(1);
                }}
                options={[
                  { value: 'active', label: t('clientsPage.activeClients', { defaultValue: 'Active Clients' }) },
                  { value: 'inactive', label: t('clientsPage.inactiveClients', { defaultValue: 'Inactive Clients' }) },
                  { value: 'all', label: t('clientsPage.allClients', { defaultValue: 'All Clients' }) }
                ]}
                placeholder={t('clientsPage.filterByStatus', { defaultValue: 'Filter by status' })}
                label={t('clientsPage.statusFilterLabel', { defaultValue: 'Status Filter' })}
              />
            </div>

            <div className="w-48 shrink-0">
              <CustomSelect
                id="client-type-filter"
                value={clientTypeFilter}
                onValueChange={(value) => {
                  setClientTypeFilter(value as 'all' | 'company' | 'individual');
                  setCurrentPage(1);
                }}
                options={[
                  { value: 'all', label: t('clientsPage.allTypes', { defaultValue: 'All Types' }) },
                  { value: 'company', label: t('clientsPage.companies', { defaultValue: 'Companies' }) },
                  { value: 'individual', label: t('clientsPage.individuals', { defaultValue: 'Individuals' }) }
                ]}
                placeholder={t('clientsPage.filterByType', { defaultValue: 'Filter by type' })}
                label={t('clientsPage.clientTypeFilterLabel', { defaultValue: 'Client Type Filter' })}
              />
            </div>

            <TagFilter
              tags={allUniqueTags}
              selectedTags={selectedTags}
              onToggleTag={(tag: string) => {
                setSelectedTags(prev =>
                  prev.includes(tag)
                    ? prev.filter(t => t !== tag)
                    : [...prev, tag]
                );
                setCurrentPage(1);
              }}
              onClearTags={() => setSelectedTags([])}
            />

            <Button
              id="reset-filters-button"
              variant="ghost"
              size="sm"
              className={`shrink-0 flex items-center gap-1 ${isFiltered ? 'text-gray-500 hover:text-gray-700' : 'invisible'}`}
              onClick={handleResetFilters}
              disabled={!isFiltered}
            >
              <XCircle className="h-4 w-4" />
              {t('clientsPage.reset', { defaultValue: 'Reset' })}
            </Button>
        </div>

      {/* Delete */}
      <div className="flex items-center gap-8 mb-6 ms-4">
        <div className="[&>div]:flex [&>div]:items-center">
          <Checkbox
            id="select-all-clients"
            checked={selectedClients.length > 0}
            onChange={handleSelectAll}
          />
        </div>
        {selectedClients.length > 0 && (
          <span className="text-sm font-medium text-gray-500">
            {isSelectAllMode
              ? t('clientsPage.allSelected', {
                  defaultValue: 'All {{count}} clients selected',
                  count: selectedClients.length,
                })
              : formatSelectedSummary(selectedClients.length)}
          </span>
        )}

        <Button
          id="delete-selected-clients"
          variant="ghost"
          size="sm"
          className="flex gap-1 text-gray-500"
          disabled={selectedClients.length === 0}
          onClick={handleMultiDelete}
        >
          {t('common.actions.delete', { defaultValue: 'Delete' })}
          <TrashIcon className="h-5 w-5" />
        </Button>
      </div>

      <div className="app-print-root app-print-only">
        <PrintableTable
          title={selectedClients.length > 0
            ? t('clientsPage.print.selectedTitle', {
                count: selectedClients.length,
                defaultValue: 'Selected Clients',
              })
            : t('clientsPage.print.title', { defaultValue: 'Clients' })}
          subtitle={t('clientsPage.print.subtitle', {
            count: printClients.length,
            defaultValue: '{{count}} clients',
          })}
          rows={printClients}
          columns={selectedClientPrintColumns}
          getRowKey={(client) => client.client_id}
          emptyMessage={t('clientsPage.print.noClients', { defaultValue: 'No clients to print' })}
        />
      </div>

      <PrintOptionsDialog
        id="clients-print-options-dialog"
        open={isPrintOptionsOpen}
        onOpenChange={setIsPrintOptionsOpen}
        title={t('clientsPage.print.optionsDialog.title', { defaultValue: 'Print options' })}
        description={t('clientsPage.print.optionsDialog.description', {
          defaultValue: 'Choose which columns to include when printing clients.',
        })}
        columns={clientPrintColumns}
        selectedColumnKeys={selectedClientPrintColumnKeys}
        onSelectedColumnKeysChange={setSelectedClientPrintColumnKeys}
        onReset={resetSelectedClientPrintColumnKeys}
        onPrint={() => triggerPrintClients()}
        isPrinting={isPreparingClientPrint}
        printLabel={selectedClients.length > 0
          ? t('actions.printSelected', {
              count: selectedClients.length,
              defaultValue: 'Print selected ({{count}})',
            })
          : t('actions.print', { defaultValue: 'Print' })
        }
      />

      {/* Clients */}
      <ClientResults
        key={refreshKey}
        searchTerm={searchTerm}
        filterStatus={filterStatus}
        clientTypeFilter={clientTypeFilter}
        selectedTags={selectedTags}
        viewMode={viewMode!}
        selectedClients={selectedClients}
        onSelectionChange={(clientIds) => {
          setSelectedClients(clientIds);
          setIsSelectAllMode(false);
        }}
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
        onClientsLoaded={handleClientsLoaded}
        clientTags={clientTags}
        allUniqueTagsFromParent={allUniqueTags}
        sortBy={sortBy}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
      />

      {/* Multi-delete confirmation dialog */}
      <Dialog
        isOpen={isMultiDeleteDialogOpen}
        onClose={() => {
          setIsMultiDeleteDialogOpen(false);
          setMultiDeleteError(null);
          setMultiDeleteResults(null);
        }}
        id="multi-delete-confirmation-dialog"
        title={multiDeleteResults
          ? t('clientsPage.deleteResults', { defaultValue: 'Delete Results' })
          : t('clientsPage.deleteSelectedClients', { defaultValue: 'Delete Selected Clients' })}
      >
        <DialogContent>
          <div className="space-y-4">
            {multiDeleteError ? (
              <div className="text-red-600">{multiDeleteError}</div>
            ) : multiDeleteResults ? (
              <>
                {/* Success message if any were deleted */}
                {multiDeleteResults.successCount > 0 && (
                  <Alert variant="success">
                    <AlertDescription>
                      {t('clientsPage.multiDeleteSuccessSummary', {
                        defaultValue: '{{count}} clients were successfully deleted.',
                        count: multiDeleteResults.successCount,
                      })}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Failed clients section */}
                {multiDeleteResults.failedClients.length > 0 && (
                  <div className="space-y-3">
                    <Alert variant="warning">
                      <AlertDescription>
                        <p className="font-semibold mb-2">
                          {t('clientsPage.multiDeleteFailedSummary', {
                            defaultValue: '{{count}} clients could not be deleted',
                            count: multiDeleteResults.failedClients.length,
                          })}
                        </p>
                        <p className="text-sm">
                          {t('clientsPage.deleteBlockedPlural', {
                            defaultValue: 'These clients have associated records that must be removed first.',
                          })}
                        </p>
                      </AlertDescription>
                    </Alert>

                    <div className="max-h-48 overflow-y-auto border rounded-md">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left p-2 font-medium text-gray-700">
                              {t('clientsPage.table.client', { defaultValue: 'Client' })}
                            </th>
                            <th className="text-left p-2 font-medium text-gray-700">
                              {t('clientsPage.associatedRecords', { defaultValue: 'Associated Records' })}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {multiDeleteResults.failedClients.map((client) => (
                            <tr key={client.clientId} className="hover:bg-gray-50">
                              <td className="p-2 font-medium text-gray-900">{client.clientName}</td>
                              <td className="p-2 text-gray-600">{client.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <Alert variant="info">
                      <AlertDescription>
                        {t('clientsPage.bulkInactivePrompt', {
                          defaultValue: 'Mark these clients as inactive. They will be hidden from most views but retain all their data.',
                        })}
                      </AlertDescription>
                    </Alert>
                  </div>
                )}
              </>
            ) : (
              <p className="text-gray-600">
                {t('clientsPage.deleteSelectedPrompt', {
                  defaultValue: 'Are you sure you want to delete {{count}} selected clients? This action cannot be undone.',
                  count: selectedClients.length,
                })}
              </p>
            )}
          </div>

          <DialogFooter>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsMultiDeleteDialogOpen(false);
                  setMultiDeleteError(null);
                  setMultiDeleteResults(null);
                }}
                id="multi-delete-cancel"
              >
                {multiDeleteResults
                  ? t('common.actions.close', { defaultValue: 'Close' })
                  : t('common.actions.cancel', { defaultValue: 'Cancel' })}
              </Button>

              {multiDeleteResults && multiDeleteResults.failedClients.length > 0 && (
                <Button
                  variant="default"
                  onClick={() => void handleBulkMarkFailedAsInactive()}
                  id="multi-delete-mark-inactive"
                >
                  {t('clientsPage.markFailedAsInactive', {
                    defaultValue: 'Mark {{count}} as Inactive',
                    count: multiDeleteResults.failedClients.length,
                  })}
                </Button>
              )}

              {!multiDeleteResults && !multiDeleteError && (
                <Button
                  variant="destructive"
                  onClick={() => void confirmMultiDelete()}
                  id="multi-delete-confirm"
                >
                  {t('common.actions.delete', { defaultValue: 'Delete' })}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single client delete confirmation dialog */}
      <DeleteEntityDialog
        id="single-delete-confirmation-dialog"
        isOpen={isDeleteDialogOpen}
        onClose={resetDeleteState}
        onConfirmDelete={confirmDelete}
        onAlternativeAction={handleDeleteAlternativeAction}
        entityName={clientToDelete?.client_name ?? ''}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing}
      />

      {/* CSV Import Dialog */}
      <ClientsImportDialog
        isOpen={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
        onImportComplete={() => void handleImportComplete()}
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
          <ClientQuickView
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
