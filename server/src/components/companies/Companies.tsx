'use client';
import React, { useState, useEffect, useCallback, memo } from 'react';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import GenericDialog from '../ui/GenericDialog';
import { Button } from '../ui/Button';
import QuickAddCompany from './QuickAddCompany';
import { 
  createCompany, 
  getAllCompanies, 
  getAllCompaniesPaginated,
  deleteCompany,
  updateCompany, 
  importCompaniesFromCSV, 
  exportCompaniesToCSV,
  getAllCompanyIds,
  type PaginatedCompaniesResponse 
} from 'server/src/lib/actions/company-actions/companyActions';
import { findTagsByEntityIds, findAllTagsByType } from 'server/src/lib/actions/tagActions';
import { TagFilter } from 'server/src/components/tags';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import CompaniesGrid from './CompaniesGrid';
import CompaniesList from './CompaniesList';
import ViewSwitcher, { ViewSwitcherOption } from '../ui/ViewSwitcher';
import { TrashIcon, MoreVertical, CloudDownload, Upload, LayoutGrid, List, Search, XCircle } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import CustomSelect from '../ui/CustomSelect';
import { useUserPreference } from 'server/src/hooks/useUserPreference';
import CompaniesImportDialog from './CompaniesImportDialog';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import { Dialog, DialogContent, DialogFooter } from '../ui/Dialog';
import { Input } from 'server/src/components/ui/Input';
import Drawer from 'server/src/components/ui/Drawer';
import CompanyDetails from './CompanyDetails';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { toast } from 'react-hot-toast';
import { useTagPermissions } from 'server/src/hooks/useTagPermissions';
import LoadingIndicator from '../ui/LoadingIndicator';

const COMPANY_VIEW_MODE_SETTING = 'company_list_view_mode';

// Memoized search input component to prevent re-renders
const SearchInput = memo(({ value, onChange }: { value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) => {
  return (
    <div className="relative">
      <Input
        id="search-companies"
        data-automation-id="search-companies"
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

// Company results component that handles its own loading state
interface CompanyResultsProps {
  searchTerm: string;
  filterStatus: 'all' | 'active' | 'inactive';
  clientTypeFilter: 'all' | 'company' | 'individual';
  selectedTags: string[];
  viewMode: 'grid' | 'list';
  selectedCompanies: string[];
  onCheckboxChange: (companyId: string) => void;
  onEditCompany: (companyId: string) => void;
  onDeleteCompany: (company: ICompany) => void;
  onQuickView?: (company: ICompany) => void;
  onTagsChange: (companyId: string, tags: ITag[]) => void;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onCompanyTagsLoaded?: (companyTags: Record<string, ITag[]>, allUniqueTags: ITag[]) => void;
  // Add props to receive parent's tag state
  companyTags?: Record<string, ITag[]>;
  allUniqueTagsFromParent?: ITag[];
  editingId?: string | null;
}

const CompanyResults = memo(({
  searchTerm,
  filterStatus,
  clientTypeFilter,
  selectedTags,
  viewMode,
  selectedCompanies,
  onCheckboxChange,
  onEditCompany,
  onDeleteCompany,
  onQuickView,
  onTagsChange,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onCompanyTagsLoaded,
  companyTags: parentCompanyTags,
  allUniqueTagsFromParent,
  editingId
}: CompanyResultsProps) => {
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [localCompanyTags, setLocalCompanyTags] = useState<Record<string, ITag[]>>({});
  const [allUniqueTags, setAllUniqueTags] = useState<ITag[]>([]);
  
  // Use parent's tag state if available, otherwise use local state
  const effectiveCompanyTags = parentCompanyTags || localCompanyTags;
  const effectiveAllUniqueTags = allUniqueTagsFromParent || allUniqueTags;

  // Load companies when filters change
  useEffect(() => {
    const loadCompanies = async () => {
      try {
        setIsLoading(true);
        const response = await getAllCompaniesPaginated({
          page: currentPage,
          pageSize,
          statusFilter: filterStatus,
          searchTerm: searchTerm || undefined,
          clientTypeFilter,
          selectedTags,
          loadLogos: true
        });

        setCompanies(response.companies);
        setTotalCount(response.totalCount);
        setIsLoading(false);
      } catch (error) {
        console.error('Error loading companies:', error);
        setIsLoading(false);
      }
    };

    loadCompanies();
  }, [currentPage, pageSize, filterStatus, searchTerm, clientTypeFilter, selectedTags]);

  // Fetch tags when companies change
  useEffect(() => {
    const fetchTags = async () => {
      if (companies.length === 0) return;
      
      try {
        // Fetch both company-specific tags and all unique tags
        const [companyTags, allTags] = await Promise.all([
          findTagsByEntityIds(
            companies.map((company: ICompany): string => company.company_id),
            'company'
          ),
          findAllTagsByType('company')
        ]);

        const newCompanyTags: Record<string, ITag[]> = {};
        companyTags.forEach(tag => {
          if (!newCompanyTags[tag.tagged_id]) {
            newCompanyTags[tag.tagged_id] = [];
          }
          newCompanyTags[tag.tagged_id].push(tag);
        });

        setLocalCompanyTags(newCompanyTags);
        setAllUniqueTags(allTags);
        
        // Notify parent component about loaded tags
        if (onCompanyTagsLoaded) {
          onCompanyTagsLoaded(newCompanyTags, allTags);
        }
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };
    fetchTags();
  }, [companies]);

  // No need for client-side filtering anymore since it's done server-side
  const filteredCompanies = companies;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[400px]">
        <LoadingIndicator 
          text="Loading companies..." 
          spinnerProps={{ size: 'lg' }}
          layout="stacked"
        />
      </div>
    );
  }

  return (
    <div className="flex-1">
      {viewMode === 'grid' ? (
        <CompaniesGrid
          filteredCompanies={filteredCompanies}
          selectedCompanies={selectedCompanies}
          handleCheckboxChange={onCheckboxChange}
          handleEditCompany={onEditCompany}
          handleDeleteCompany={onDeleteCompany}
          onQuickView={onQuickView}
          currentPage={currentPage}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          companyTags={effectiveCompanyTags}
          allUniqueTags={effectiveAllUniqueTags}
          onTagsChange={onTagsChange}
          editingId={editingId}
        />
      ) : (
        <CompaniesList
          selectedCompanies={selectedCompanies}
          filteredCompanies={filteredCompanies}
          setSelectedCompanies={() => {}} // This prop seems unused in the component
          handleCheckboxChange={onCheckboxChange}
          handleEditCompany={onEditCompany}
          handleDeleteCompany={onDeleteCompany}
          onQuickView={onQuickView}
          currentPage={currentPage}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={onPageChange}
          companyTags={effectiveCompanyTags}
          allUniqueTags={effectiveAllUniqueTags}
          onTagsChange={onTagsChange}
          editingId={editingId}
        />
      )}
    </div>
  );
});

CompanyResults.displayName = 'CompanyResults';

const Companies: React.FC = () => {
  useTagPermissions(['company']);
  

   const { automationIdProps: containerProps, updateMetadata } = useAutomationIdAndRegister({
     id: 'companies-page',
     type: 'container',
     label: 'Companies Page',
     helperText: "Main companies management page with search, filters, and company grid/list view"
   });

   const { automationIdProps: createButtonProps } = useAutomationIdAndRegister({
     id: 'create-client-btn',
     type: 'button',
     label: 'Create Client',
     helperText: "Opens dialog to create a new client/company"
   });

   const { automationIdProps: actionsMenuProps } = useAutomationIdAndRegister({
     id: 'actions-menu-btn',
     type: 'button',
     label: 'Actions Menu',
     helperText: "Menu for importing/exporting companies"
   });

   const { automationIdProps: deleteSelectedProps } = useAutomationIdAndRegister({
     id: 'delete-selected-btn',
     type: 'button',
     label: 'Delete Selected',
     helperText: "Delete multiple selected companies"
   });

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams) {
      const create = searchParams.get('create');
      if (create === 'true') {
        setIsDialogOpen(true);
      }
    }
  }, [searchParams]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [companyToDelete, setCompanyToDelete] = useState<ICompany | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState(''); // Local state for input field
  
  // Use the custom hook for view mode preference
  type CompanyViewMode = 'grid' | 'list';
  const { 
    value: viewMode, 
    setValue: setViewModePreference,
    isLoading: isViewModeLoading 
  } = useUserPreference<CompanyViewMode>(
    COMPANY_VIEW_MODE_SETTING,
    {
      defaultValue: 'grid',
      localStorageKey: COMPANY_VIEW_MODE_SETTING,
      debounceMs: 300
    }
  );
  
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [isSelectAllMode, setIsSelectAllMode] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [isMultiDeleteDialogOpen, setIsMultiDeleteDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [multiDeleteError, setMultiDeleteError] = useState<string | null>(null);
  const [showDeactivateOption, setShowDeactivateOption] = useState(false);
  
  // Quick View state
  const [quickViewCompany, setQuickViewCompany] = useState<ICompany | null>(null);
  const [isQuickViewOpen, setIsQuickViewOpen] = useState(false);
  
  // Edit state
  const [editingCompany, setEditingCompany] = useState<ICompany | null>(null);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Tag-related state
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [allUniqueTags, setAllUniqueTags] = useState<ITag[]>([]);
  const [companyTags, setCompanyTags] = useState<Record<string, ITag[]>>({});
  
  // Track if filters are applied
  const [isFiltered, setIsFiltered] = useState(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(viewMode === 'grid' ? 9 : 10);
  
  // For multi-delete functionality, we need to track companies
  const [companiesForDelete, setCompaniesForDelete] = useState<ICompany[]>([]);
  

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

  // Tags will be loaded by CompanyResults component

  // Update page size when view mode changes
  useEffect(() => {
    if (!isViewModeLoading) {
      setPageSize(viewMode === 'grid' ? 9 : 10);
    }
  }, [viewMode, isViewModeLoading]);

  const viewOptions: ViewSwitcherOption<CompanyViewMode>[] = [
    { value: 'grid', label: 'Cards', icon: LayoutGrid },
    { value: 'list', label: 'Table', icon: List },
  ];

  const handleViewModeChange = (newMode: CompanyViewMode) => {
    setViewModePreference(newMode);
    setCurrentPage(1); // Reset to first page when changing view
  };


  const handleCompanyAdded = (newCompany: ICompany) => {
    // Refresh the list after a company is added
    refreshCompanies();
  };

  const handleCheckboxChange = (companyId: string) => {
    setSelectedCompanies((prevSelected) => {
      if (prevSelected.includes(companyId)) {
        return prevSelected.filter((id) => id !== companyId);
      } else {
        return [...prevSelected, companyId];
      }
    });
    // If user manually selects/deselects, exit select all mode
    setIsSelectAllMode(false);
  };

  const handleSelectAll = async () => {
    if (selectedCompanies.length > 0 || isSelectAllMode) {
      // Clear all selections
      setSelectedCompanies([]);
      setIsSelectAllMode(false);
    } else {
      // Select all companies with current filters
      try {
        const allIds = await getAllCompanyIds({
          statusFilter: filterStatus,
          searchTerm: searchTerm || undefined,
          clientTypeFilter,
          selectedTags
        });
        setSelectedCompanies(allIds);
        setIsSelectAllMode(true);
      } catch (error) {
        console.error('Error selecting all companies:', error);
        toast.error("Failed to select all companies");
      }
    }
  };

  const handleTagsChange = useCallback((companyId: string, tags: ITag[]) => {
    // Update local tag state for optimistic UI updates
    setCompanyTags(current => ({
      ...current,
      [companyId]: tags
    }));
    
    // Update unique tags list if needed
    setAllUniqueTags(current => {
      const currentTagTexts = new Set(current.map(t => t.tag_text));
      const newTags = tags.filter(tag => !currentTagTexts.has(tag.tag_text));
      return [...current, ...newTags];
    });
  }, []);
  
  const handleCompanyTagsLoaded = useCallback((loadedCompanyTags: Record<string, ITag[]>, uniqueTags: ITag[]) => {
    // Update the main component's tag state when CompanyResults loads tags
    setCompanyTags(loadedCompanyTags);
    setAllUniqueTags(uniqueTags);
  }, []);
  

  const handleEditCompany = async (companyId: string) => {
    try {
      // First, fetch the company data
      const companies = await getAllCompanies(true);
      const company = companies.find(c => c.company_id === companyId);
      
      if (company) {
        setEditingCompany(company);
        setEditingId(companyId);
        setIsEditDrawerOpen(true);
      }
    } catch (error) {
      console.error('Error fetching company for edit:', error);
      toast.error("Failed to load company details");
    }
  };

  const handleQuickView = (company: ICompany) => {
    setQuickViewCompany(company);
    setIsQuickViewOpen(true);
  };

  const handleEditDrawerClose = () => {
    setIsEditDrawerOpen(false);
    setEditingCompany(null);
    setEditingId(null);
    // Refresh companies to show any updates
    refreshCompanies();
  };

  const handleDeleteCompany = async (company: ICompany) => {
    setCompanyToDelete(company);
    setDeleteError(null);
    setShowDeactivateOption(false);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!companyToDelete) return;
    
    try {
      const result = await deleteCompany(companyToDelete.company_id);
      
      if (!result.success) {
        if ('code' in result && result.code === 'COMPANY_HAS_DEPENDENCIES') {
          handleDependencyError(result, setDeleteError);
          setShowDeactivateOption(true);
          return;
        }
        throw new Error(result.message || 'Failed to delete company');
      }

      await refreshCompanies();
      resetDeleteState();
    } catch (error) {
      console.error('Error deleting company:', error);
      setDeleteError('An error occurred while deleting the company. Please try again.');
    }
  };

  const handleMarkCompanyInactive = async () => {
    if (!companyToDelete) return;
    
    try {
      await updateCompany(companyToDelete.company_id, { is_inactive: true });
      await refreshCompanies();
      resetDeleteState();
      toast.success(`${companyToDelete.company_name} has been marked as inactive successfully.`);
    } catch (error) {
      console.error('Error marking company as inactive:', error);
      setDeleteError('An error occurred while marking the company as inactive. Please try again.');
    }
  };

  const handleMultiDelete = () => {
    setMultiDeleteError(null);
    setIsMultiDeleteDialogOpen(true);
  };

  const refreshCompanies = async () => {
    // Force refresh by changing a key to trigger CompanyResults re-render
    router.refresh();
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
  
  const confirmMultiDelete = async () => {
    try {
      const deleteResults = await Promise.all(
        selectedCompanies.map(async (companyId: string): Promise<{ companyId: string; result: any }> => {
          const result = await deleteCompany(companyId);
          return { companyId, result };
        })
      );
  
      const errors: string[] = [];
      const successfulDeletes: string[] = [];
  
      deleteResults.forEach(({ companyId, result }) => {
        if (!result.success) {
          if ('code' in result && result.code === 'COMPANY_HAS_DEPENDENCIES') {
            const company = companiesForDelete.find(c => c.company_id === companyId);
            const companyName = company ? company.company_name : companyId;
            const dependencyText = formatDependencyText(result);
            errors.push(`${companyName}: ${dependencyText}`);
          }
        } else {
          successfulDeletes.push(companyId);
        }
      });
  
      // Update selected companies to remove successfully deleted ones
      setSelectedCompanies(prev => prev.filter(id => !successfulDeletes.includes(id)));

      if (errors.length > 0) {
        setMultiDeleteError(
          `Some companies could not be deleted:\n${errors.join('\n')}\n\n` +
          `${successfulDeletes.length} companies were successfully deleted.`
        );
      }

      // If any companies were successfully deleted, refresh the list
      if (successfulDeletes.length > 0) {
        await refreshCompanies();
      }

      // If all selected companies were successfully deleted, close the dialog
      if (errors.length === 0) {
        setIsMultiDeleteDialogOpen(false);
        setMultiDeleteError(null);
      }
      
    } catch (error) {
      console.error('Error in multi-delete:', error);
      setMultiDeleteError('An error occurred while deleting companies. Please try again.');
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
      'billing_plan': 'billing plans',
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
      `Unable to delete this company.\n\n` +
      `This company has the following associated records:\n• ${dependencyText.split(', ').join('\n• ')}\n\n` +
      `Please remove or reassign these items before deleting the company.`
    );
  };


  const resetDeleteState = () => {
    setIsDeleteDialogOpen(false);
    setCompanyToDelete(null);
    setDeleteError(null);
    setShowDeactivateOption(false);
  };

  const handleExportToCSV = async () => {
    try {
      let companiesToExport: ICompany[];
      
      // If companies are selected, export only those
      if (selectedCompanies.length > 0) {
        const allCompanies = await getAllCompanies(true);
        companiesToExport = allCompanies.filter(company => 
          selectedCompanies.includes(company.company_id)
        );
      } else {
        // Otherwise export all companies with current filters
        companiesToExport = await getAllCompanies(true);
      }
      
      const csvData = await exportCompaniesToCSV(companiesToExport);
      
      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
      
      const link = document.createElement('a');
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'companies.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      
      toast.success(`Exported ${companiesToExport.length} ${companiesToExport.length === 1 ? 'company' : 'companies'} to CSV`);
    } catch (error) {
      console.error('Error exporting companies to CSV:', error);
      toast.error('Failed to export companies to CSV');
    }
  };

  const handleImportComplete = async (companies: ICompany[], updateExisting: boolean) => {
    try {
      await importCompaniesFromCSV(companies, updateExisting);
      setIsImportDialogOpen(false);
      router.refresh();
    } catch (error) {
      console.error('Error importing companies:', error);
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
        {/* Quick Add Company Dialog */}
        <QuickAddCompany
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          onCompanyAdded={handleCompanyAdded}
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
            <ViewSwitcher
              currentView={viewMode}
              onChange={(mode) => void handleViewModeChange(mode)}
              options={viewOptions}
            />
          </div>
        </div>

      {/* Delete */}
      <div className="flex items-center gap-8 mb-6 ms-4">
        <input
          type="checkbox"
          className="form-checkbox h-4 w-4 rounded"
          checked={selectedCompanies.length > 0}
          onChange={() => void handleSelectAll()}
        />
        {selectedCompanies.length > 0 &&
          <span className="text-sm font-medium text-gray-500">
            {isSelectAllMode ? `All ${selectedCompanies.length} companies selected` : `${selectedCompanies.length} Selected`}
          </span>}

        <button
          className="flex gap-1 text-sm font-medium text-gray-500"
          disabled={selectedCompanies.length === 0}
          onClick={handleMultiDelete}
        >
          Delete
          <TrashIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Companies */}
      <CompanyResults
        searchTerm={searchTerm}
        filterStatus={filterStatus}
        clientTypeFilter={clientTypeFilter}
        selectedTags={selectedTags}
        viewMode={viewMode!}
        selectedCompanies={selectedCompanies}
        onCheckboxChange={handleCheckboxChange}
        onEditCompany={handleEditCompany}
        onDeleteCompany={handleDeleteCompany}
        onQuickView={handleQuickView}
        onTagsChange={handleTagsChange}
        currentPage={currentPage}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setCurrentPage(1); // Reset to first page when changing page size
        }}
        onCompanyTagsLoaded={handleCompanyTagsLoaded}
        companyTags={companyTags}
        allUniqueTagsFromParent={allUniqueTags}
        editingId={editingId}
      />

      {/* Multi-delete confirmation dialog */}
      <ConfirmationDialog
        id="multi-delete-confirmation-dialog"
        isOpen={isMultiDeleteDialogOpen}
        onClose={() => setIsMultiDeleteDialogOpen(false)}
        onConfirm={() => void confirmMultiDelete()}
        title="Delete Selected Companies"
        message={
          multiDeleteError 
            ? multiDeleteError 
            : `Are you sure you want to delete ${selectedCompanies.length} selected companies? This action cannot be undone.`
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      {/* Single company delete confirmation dialog */}
      <Dialog 
        isOpen={isDeleteDialogOpen} 
        onClose={resetDeleteState}
        id="single-delete-confirmation-dialog"
        title="Delete Company"
      >
        <DialogContent>
          <div className="space-y-4">
            {deleteError ? (
              <div className="text-gray-600 whitespace-pre-line">
                {deleteError}
              </div>
            ) : (
              <p className="text-gray-600">
                Are you sure you want to delete {companyToDelete?.company_name}? This action cannot be undone.
              </p>
            )}
            
            {showDeactivateOption && deleteError && (
              <div className="bg-blue-50 p-4 rounded-md border border-blue-200">
                <p className="text-sm text-blue-800">
                  <strong>Alternative Option:</strong> You can mark this company as inactive instead. 
                  Inactive companies are hidden from most views but retain all their data and can be marked as active later.
                </p>
              </div>
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
              
              {showDeactivateOption && (
                <Button
                  variant="ghost"
                  onClick={() => void handleMarkCompanyInactive()}
                  id="single-delete-mark-inactive"
                >
                  Mark as Inactive
                </Button>
              )}
              
              {!deleteError && (
                <Button
                  onClick={() => void confirmDelete()}
                  id="single-delete-confirm"
                  variant="destructive"
                >
                  Delete
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* CSV Import Dialog */}
      <CompaniesImportDialog
        isOpen={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
        onImportComplete={(companies, updateExisting) => void handleImportComplete(companies, updateExisting)}
      />
      
      {/* Quick View Drawer */}
      <Drawer
        id="company-quick-view-drawer"
        isOpen={isQuickViewOpen}
        onClose={() => {
          setIsQuickViewOpen(false);
          setQuickViewCompany(null);
          // Refresh companies to show any updates
          refreshCompanies();
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

      {/* Edit Drawer */}
      <Drawer
        id="company-edit-drawer"
        isOpen={isEditDrawerOpen}
        onClose={handleEditDrawerClose}
      >
        {editingCompany && (
          <CompanyDetails
            company={editingCompany}
            isInDrawer={true}
            quickView={false}
          />
        )}
      </Drawer>
    </div>
  );
};

export default Companies;
