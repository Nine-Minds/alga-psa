'use client';
import React, { useState, useEffect, useRef } from 'react';
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
  type PaginatedCompaniesResponse 
} from 'server/src/lib/actions/company-actions/companyActions';
import { findTagsByEntityIds, findAllTagsByType } from 'server/src/lib/actions/tagActions';
import { TagFilter } from 'server/src/components/tags';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import CompaniesGrid from './CompaniesGrid';
import CompaniesList from './CompaniesList';
import ViewSwitcher, { ViewSwitcherOption } from '../ui/ViewSwitcher';
import { TrashIcon, MoreVertical, CloudDownload, Upload, LayoutGrid, List, Search } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import CustomSelect from '../ui/CustomSelect';
import { getCurrentUser, getUserPreference, setUserPreference } from 'server/src/lib/actions/user-actions/userActions';
import CompaniesImportDialog from './CompaniesImportDialog';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import { Dialog, DialogContent, DialogFooter } from '../ui/Dialog';
import { Input } from 'server/src/components/ui/Input';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { useToast } from 'server/src/hooks/use-toast';

const COMPANY_VIEW_MODE_SETTING = 'company_list_view_mode';

const Companies: React.FC = () => {
  const { toast } = useToast();
  
  // UI Reflection Integration
  const { automationIdProps: containerProps, updateMetadata } = useAutomationIdAndRegister({
    id: 'companies-page',
    type: 'container',
    label: 'Companies Page',
    helperText: "Main companies management page with search, filters, and company grid/list view"
  });

  const { automationIdProps: searchProps } = useAutomationIdAndRegister({
    id: 'search-companies',
    type: 'input',
    label: 'Search Companies',
    helperText: "Search for companies by name"
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
  const [viewMode, setViewMode] = useState<'grid' | 'list' | null>(null);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [isMultiDeleteDialogOpen, setIsMultiDeleteDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [multiDeleteError, setMultiDeleteError] = useState<string | null>(null);
  const [showDeactivateOption, setShowDeactivateOption] = useState(false);
  
  // Tag-related state
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const companyTagsRef = useRef<Record<string, ITag[]>>({});
  const [allUniqueTags, setAllUniqueTags] = useState<string[]>([]);
  
  const handleTagsChange = (companyId: string, tags: ITag[]) => {
    companyTagsRef.current[companyId] = tags;
    
    // Update unique tags list
    const allTags = new Set<string>();
    Object.values(companyTagsRef.current).forEach(entityTags => {
      entityTags.forEach(tag => allTags.add(tag.tag_text));
    });
    setAllUniqueTags(Array.from(allTags));
  };
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10); // Default to 10 for list view
  const [totalCount, setTotalCount] = useState(0);
  
  // Load companies with pagination
  const loadCompanies = async () => {
    try {
      setIsLoading(true);
      const response = await getAllCompaniesPaginated({
        page: currentPage,
        pageSize,
        statusFilter: filterStatus,
        searchTerm: searchTerm || undefined,
        clientTypeFilter,
        loadLogos: true // Load logos for displayed companies only
      });

      setCompanies(response.companies);
      setTotalCount(response.totalCount);
      setIsLoading(false);
    } catch (error) {
      console.error('Error loading companies:', error);
      setIsLoading(false);
    }
  };

  // Load companies when filters or pagination changes
  useEffect(() => {
    loadCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, filterStatus, searchTerm, clientTypeFilter, selectedTags]);

  // Fetch tags when companies change
  useEffect(() => {
    const fetchTags = async () => {
      if (companies.length === 0) return;
      
      try {
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

        companyTagsRef.current = newCompanyTags;
        setAllUniqueTags(allTags);
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };
    fetchTags();
  }, [companies]);

  useEffect(() => {
    const initializeComponent = async () => {
      try {
        // Load user preferences
        const currentUser = await getCurrentUser();

        if (currentUser) {
          const savedViewMode = await getUserPreference(currentUser.user_id, COMPANY_VIEW_MODE_SETTING);
          const mode = savedViewMode === 'grid' || savedViewMode === 'list' ? savedViewMode : 'grid';
          setViewMode(mode);
          // Set appropriate page size based on view mode
          setPageSize(mode === 'grid' ? 9 : 10);
        } else {
          setViewMode('grid'); // Default if no user or preference
          setPageSize(9); // Default page size for grid view
        }
      } catch (error) {
        console.error('Error initializing component:', error);
        setViewMode('grid'); // Default on error
      }
    };

    initializeComponent();
  }, []);

  // Define view mode type
  type CompanyViewMode = 'grid' | 'list';

  const viewOptions: ViewSwitcherOption<CompanyViewMode>[] = [
    { value: 'grid', label: 'Cards', icon: LayoutGrid },
    { value: 'list', label: 'Table', icon: List },
  ];

  const handleViewModeChange = async (newMode: CompanyViewMode) => {
    setViewMode(newMode);
    
    // Adjust page size based on view mode
    if (newMode === 'grid') {
      setPageSize(9); // Grid view uses 9 cards by default
    } else {
      setPageSize(10); // List view uses 10 rows by default
    }
    setCurrentPage(1); // Reset to first page when changing view
    
    try {
      const currentUser = await getCurrentUser();
      if (currentUser) {
        await setUserPreference(currentUser.user_id, COMPANY_VIEW_MODE_SETTING, newMode);
      }
    } catch (error) {
      console.error('Error saving view mode preference:', error);
    }
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
  };
  
  // Filter companies by selected tags (client-side)
  const filteredCompanies = companies.filter(company => {
    if (selectedTags.length === 0) return true;
    
    const companyTags = companyTagsRef.current[company.company_id] || [];
    const companyTagTexts = companyTags.map(tag => tag.tag_text);
    
    // Check if company has any of the selected tags
    return selectedTags.some(selectedTag => companyTagTexts.includes(selectedTag));
  });

  const handleEditCompany = (companyId: string) => {
    router.push(`/msp/companies/${companyId}`);
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
      toast({
        title: "Company Status Updated",
        description: `${companyToDelete.company_name} has been marked as inactive successfully.`,
        variant: "default"
      });
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
    try {
      await loadCompanies();
      router.refresh();
    } catch (error) {
      console.error('Error refreshing companies:', error);
    }
  };
  
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
            const company = companies.find(c => c.company_id === companyId);
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
      const csvData = await exportCompaniesToCSV(filteredCompanies);
      
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
    } catch (error) {
      console.error('Error exporting companies to CSV:', error);
    }
  };

  const handleImportComplete = async (companies: ICompany[], updateExisting: boolean) => {
    try {
      await importCompaniesFromCSV(companies, updateExisting);
      const updatedCompanies = await getAllCompanies(true);
      setCompanies(updatedCompanies);
      setIsImportDialogOpen(false);
      router.refresh();
    } catch (error) {
      console.error('Error importing companies:', error);
    }
  };

  if (isLoading || viewMode === null) {
    return (
      <div className="w-full">
        <div className="flex justify-end mb-4 flex-wrap gap-6">
          {/* Show loading skeleton for controls */}
          <div className="w-64 h-10 bg-gray-200 rounded animate-pulse" />
          <div className="w-64 h-10 bg-gray-200 rounded animate-pulse" />
          <div className="w-32 h-10 bg-gray-200 rounded animate-pulse" />
        </div>
        {/* Show loading skeleton for content */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((n):JSX.Element => (
            <div key={n} className="h-48 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <ReflectionContainer {...containerProps}>
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
            <div className="relative">
              <Input
                {...searchProps}
                type="text"
                placeholder="Search clients"
                className="border-2 border-gray-200 focus:border-purple-500 rounded-md pl-10 pr-4 py-2 w-64 outline-none bg-white"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1); // Reset to first page when searching
                }}
              />
              <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            </div>

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
          </div>

          {/* Right side - Actions and View Switcher */}
          <div className="flex items-center gap-4">
            {/* Actions */}
            <div className="flex gap-2">
              <button
                {...createButtonProps}
                onClick={() => setIsDialogOpen(true)}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded"
              >
                + Create Client
              </button>

              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button {...actionsMenuProps} className="border border-gray-300 rounded-md p-2 flex items-center gap-2">
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
          onChange={() => setSelectedCompanies(selectedCompanies.length > 0 ? [] : companies.map((c):string => c.company_id))}
        />
        {selectedCompanies.length > 0 &&
          <span className="text-sm font-medium text-gray-500">
            {selectedCompanies.length} Selected
          </span>}

        <button
          {...deleteSelectedProps}
          className="flex gap-1 text-sm font-medium text-gray-500"
          disabled={selectedCompanies.length === 0}
          onClick={handleMultiDelete}
        >
          Delete
          <TrashIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Companies */}
      <div className="flex-1">
        {viewMode === 'grid' ? (
          <CompaniesGrid
            filteredCompanies={filteredCompanies}
            selectedCompanies={selectedCompanies}
            handleCheckboxChange={handleCheckboxChange}
            handleEditCompany={handleEditCompany}
            handleDeleteCompany={handleDeleteCompany}
            currentPage={currentPage}
            pageSize={pageSize}
            totalCount={totalCount}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setCurrentPage(1); // Reset to first page when changing page size
            }}
            companyTags={companyTagsRef.current}
            allUniqueTags={allUniqueTags}
            onTagsChange={handleTagsChange}
          />
        ) : (
          <CompaniesList
            selectedCompanies={selectedCompanies}
            filteredCompanies={filteredCompanies}
            setSelectedCompanies={setSelectedCompanies}
            handleCheckboxChange={handleCheckboxChange}
            handleEditCompany={handleEditCompany}
            handleDeleteCompany={handleDeleteCompany}
            currentPage={currentPage}
            pageSize={pageSize}
            totalCount={totalCount}
            onPageChange={setCurrentPage}
            companyTags={companyTagsRef.current}
            allUniqueTags={allUniqueTags}
            onTagsChange={handleTagsChange}
          />
        )}
      </div>

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
    </div>
    </ReflectionContainer>
  );
};

export default Companies;
