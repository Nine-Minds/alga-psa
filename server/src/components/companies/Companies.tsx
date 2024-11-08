'use client'
import React, { useState, useEffect } from 'react';
import { ICompany } from '@/interfaces/company.interfaces';
import GenericDialog from '../ui/GenericDialog';
import { Button } from '../ui/Button';
import CompanyForm from './CompanyForm';
import { createCompany, getAllCompanies, deleteCompany, importCompaniesFromCSV, exportCompaniesToCSV } from '@/lib/actions/companyActions';
import { useRouter } from 'next/navigation';
import CompaniesGrid from './CompaniesGrid';
import CompaniesList from './CompaniesList';
import { TrashIcon, MoreVertical, CloudDownload, Upload, LayoutGrid, LayoutList } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { CompanyPicker } from '../companies/CompanyPicker';
import { getCurrentUser, getUserPreference, setUserPreference } from '@/lib/actions/user-actions/userActions';
import CompaniesImportDialog from './CompaniesImportDialog';

const COMPANY_VIEW_MODE_SETTING = 'company_list_view_mode';

const Companies: React.FC = () => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [companyToDelete, setCompanyToDelete] = useState<ICompany | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list' | null>(null);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [isMultiDeleteDialogOpen, setIsMultiDeleteDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [multiDeleteError, setMultiDeleteError] = useState<string | null>(null);

  const router = useRouter();
  
  useEffect(() => {
    const initializeComponent = async () => {
      try {
        // Load both companies and user preferences
        const [allCompanies, currentUser] = await Promise.all([
          getAllCompanies(true),
          getCurrentUser()
        ]);

        setCompanies(allCompanies);

        if (currentUser) {
          const savedViewMode = await getUserPreference(currentUser.user_id, COMPANY_VIEW_MODE_SETTING);
          setViewMode(savedViewMode === 'grid' || savedViewMode === 'list' ? savedViewMode : 'grid');
        } else {
          setViewMode('grid'); // Default if no user or preference
        }
      } catch (error) {
        console.error('Error initializing component:', error);
        setViewMode('grid'); // Default on error
      } finally {
        setIsLoading(false);
      }
    };

    initializeComponent();
  }, []);

  const handleViewModeChange = async (newMode: 'grid' | 'list') => {
    setViewMode(newMode);
    try {
      const currentUser = await getCurrentUser();
      if (currentUser) {
        await setUserPreference(currentUser.user_id, COMPANY_VIEW_MODE_SETTING, newMode);
      }
    } catch (error) {
      console.error('Error saving view mode preference:', error);
    }
  };

  const handleAddCompany = async (data: Omit<ICompany, "company_id" | "created_at" | "updated_at">) => {
    try {
      const newCompanyData: Omit<ICompany, "company_id" | "created_at" | "updated_at"> = {
        ...data,
        company_name: data.company_name!,
        phone_no: data.phone_no || '',
        url: data.url || '',
        address: data.address || '',
        is_inactive: data.is_inactive || false,
        is_tax_exempt: data.is_tax_exempt || false,
        notes: data.notes,
        client_type: data.client_type || 'company',
        tenant: data.tenant!
      };      
      await createCompany(newCompanyData);
      setIsDialogOpen(false);

      const updatedCompanies = await getAllCompanies(true);
      setCompanies(updatedCompanies);

      router.refresh();
    } catch (error) {
      console.error('Error creating company:', error);
    }
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
  
  const statusFilteredCompanies = companies.filter(company =>
    company.company_name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    (filterStatus === 'all' || 
     (filterStatus === 'active' && !company.is_inactive) ||
     (filterStatus === 'inactive' && company.is_inactive)) &&
    (clientTypeFilter === 'all' ||
     (clientTypeFilter === 'company' && company.client_type === 'company') ||
     (clientTypeFilter === 'individual' && company.client_type === 'individual'))
  );
  
  const filteredCompanies = selectedCompanyId
    ? statusFilteredCompanies.filter(company => company.company_id === selectedCompanyId)
    : statusFilteredCompanies;

  const handleEditCompany = (companyId: string) => {
    router.push(`/msp/companies/${companyId}`);
  };

  const handleDeleteCompany = async (company: ICompany) => {
    setCompanyToDelete(company);
    setDeleteError(null);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!companyToDelete) return;
    
    try {
      const result = await deleteCompany(companyToDelete.company_id);
      
      if (!result.success) {
        if ('code' in result && result.code === 'COMPANY_HAS_DEPENDENCIES') {
          handleDependencyError(result, setDeleteError);
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

  const handleMultiDelete = () => {
    setMultiDeleteError(null);
    setIsMultiDeleteDialogOpen(true);
  };

  const refreshCompanies = async () => {
    try {
      const updatedCompanies = await getAllCompanies(true);
      setCompanies(updatedCompanies);
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
      'schedule': 'schedules',
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
      `Unable to delete this company\n\n` +
      `This company has the following associated records:\n${dependencyText}\n\n` +
      `Please remove or reassign these items before deleting the company.`
    );
  };


  const resetDeleteState = () => {
    setIsDeleteDialogOpen(false);
    setCompanyToDelete(null);
    setDeleteError(null);
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
    <div className="w-full">
      <div className="flex justify-end mb-4 flex-wrap gap-6">
        {/* Search */}
        <input
          type="text"
          placeholder="Search"
          className="border border-gray-400 rounded-md p-2 w-64"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        {/* Company Picker */}
        <div className="w-64">
          <CompanyPicker
            onSelect={(companyId) => setSelectedCompanyId(companyId)}
            selectedCompanyId={selectedCompanyId}
            companies={statusFilteredCompanies}
            filterState={filterStatus}
            onFilterStateChange={(state) => setFilterStatus(state)}
            clientTypeFilter={clientTypeFilter}
            onClientTypeFilterChange={(type) => setClientTypeFilter(type)}
          />
        </div>

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
                onSelect={handleExportToCSV}
              >
                <CloudDownload size={14} className="mr-2" />
                Download CSV
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>

        <div className="flex items-center gap-2 ms-4">
          {/* Grid button */}
          <button
            onClick={() => handleViewModeChange('grid')}
            className={`p-1 rounded hover:bg-gray-100 ${
              viewMode === 'grid' 
                ? 'bg-gray-200 text-gray-700' 
                : 'text-gray-500'
            }`}
          >
            <LayoutGrid size={20} />
          </button>

          {/* List button */}
          <button
            onClick={() => handleViewModeChange('list')}
            className={`p-1 rounded hover:bg-gray-100 ${
              viewMode === 'list' 
                ? 'bg-gray-200 text-gray-700' 
                : 'text-gray-500'
            }`}
          >
            <LayoutList size={20} />
          </button>
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
          className="flex gap-1 text-sm font-medium text-gray-500"
          disabled={selectedCompanies.length === 0}
          onClick={handleMultiDelete}
        >
          Delete
          <TrashIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Companies */}
      <div className="w-full">
        {viewMode === 'grid' ? (
          <CompaniesGrid
            filteredCompanies={filteredCompanies}
            selectedCompanies={selectedCompanies}
            handleCheckboxChange={handleCheckboxChange}
            handleEditCompany={handleEditCompany}
            handleDeleteCompany={handleDeleteCompany}
          />
        ) : (
          <CompaniesList
            selectedCompanies={selectedCompanies}
            filteredCompanies={filteredCompanies}
            setSelectedCompanies={setSelectedCompanies}
            handleCheckboxChange={handleCheckboxChange}
            handleEditCompany={handleEditCompany}
            handleDeleteCompany={handleDeleteCompany}
          />
        )}
      </div>

      {/* Dialogs */}
      <GenericDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        title="Add New Client"
      >
        <CompanyForm onSubmit={handleAddCompany} />
      </GenericDialog>

      {/* Single Delete Confirmation Dialog */}
      <GenericDialog
        isOpen={isDeleteDialogOpen}
        onClose={resetDeleteState}
        title="Delete Company"
      >
        <div className="p-6">
          {deleteError ? (
            <>
              <p className="mb-6 text-red-600 whitespace-pre-line text-sm leading-relaxed">
                {deleteError}
              </p>
              <div className="flex justify-end">
                <Button
                  onClick={resetDeleteState}
                  className="px-6 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded shadow-sm transition-colors"
                >
                  Close
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-4">Are you sure you want to delete this company? This action cannot be undone.</p>
              <div className="flex justify-end gap-4">
                <Button
                  onClick={resetDeleteState}
                  className="px-6 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmDelete}
                  className="px-6 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded shadow-sm transition-colors"
                >
                  Delete
                </Button>
              </div>
            </>
          )}
        </div>
      </GenericDialog>

      {/* Multi-Delete Confirmation Dialog */}
      <GenericDialog
        isOpen={isMultiDeleteDialogOpen}
        onClose={() => {
          setIsMultiDeleteDialogOpen(false);
          setMultiDeleteError(null);
        }}
        title="Delete Selected Companies"
      >
        <div className="p-6">
          {multiDeleteError ? (
            <>
              <p className="mb-4 text-red-600 whitespace-pre-line">{multiDeleteError}</p>
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    setIsMultiDeleteDialogOpen(false);
                    setMultiDeleteError(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded shadow-sm transition-colors"
                >
                  Close
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-4">
                Are you sure you want to delete {selectedCompanies.length} selected companies? This action cannot be undone.
              </p>
              <div className="flex justify-end gap-4">
                <Button
                  onClick={() => setIsMultiDeleteDialogOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmMultiDelete}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded shadow-sm transition-colors"
                >
                  Delete Selected
                </Button>
              </div>
            </>
          )}
        </div>
      </GenericDialog>

      {/* Import Dialog */}
      <CompaniesImportDialog
        isOpen={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
        onImportComplete={handleImportComplete}
      />
    </div>
  );
};

export default Companies;
