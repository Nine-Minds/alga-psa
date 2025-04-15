'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { UnitOfMeasureInput } from './UnitOfMeasureInput';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/Dialog';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
// Import new action and types
import { getServices, updateService, deleteService, getServiceTypesForSelection, PaginatedServicesResponse } from 'server/src/lib/actions/serviceActions';
import { getServiceCategories } from 'server/src/lib/actions/serviceCategoryActions';
// Import action to get tax rates
import { getTaxRates } from 'server/src/lib/actions/taxSettingsActions';
import { IService, IServiceCategory, IServiceType } from 'server/src/interfaces/billing.interfaces'; // Added IServiceType
// Import ITaxRate interface
import { ITaxRate } from 'server/src/interfaces/tax.interfaces'; // Corrected import path if needed
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Switch } from '../ui/Switch';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { QuickAddService } from './QuickAddService';
import { MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';

// Removed old SERVICE_TYPE_OPTIONS

// Define billing method options (as per plan)
const BILLING_METHOD_OPTIONS = [
  { value: 'fixed', label: 'Fixed Price' },
  { value: 'per_unit', label: 'Per Unit' }
];

// Define service category options (as per plan)
const SERVICE_CATEGORY_OPTIONS = [
  { value: 'Labor - Support', label: 'Labor - Support' },
  { value: 'Labor - Project', label: 'Labor - Project' },
  { value: 'Managed Service - Server', label: 'Managed Service - Server' },
  { value: 'Managed Service - Workstation', label: 'Managed Service - Workstation' },
  { value: 'Software License', label: 'Software License' },
  { value: 'Hardware', label: 'Hardware' },
  { value: 'Hosting', label: 'Hosting' },
  { value: 'Consulting', label: 'Consulting' },
  // Add others if needed, ensure these match backend expectations
];

const LICENSE_TERM_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
  { value: 'perpetual', label: 'Perpetual' }
];

const ServiceCatalogManager: React.FC = () => {
  const [services, setServices] = useState<IService[]>([]);
  const [categories, setCategories] = useState<IServiceCategory[]>([]);
  // Update state type to match what getServiceTypesForSelection returns
  const [allServiceTypes, setAllServiceTypes] = useState<{ id: string; name: string; billing_method: 'fixed' | 'per_unit'; is_standard: boolean }[]>([]);
  // Use IService directly, extended with optional UI fields
  const [editingService, setEditingService] = useState<(IService & {
    sku?: string; // These might need to be added to IService if they are persisted
    inventory_count?: number;
    seat_limit?: number;
    license_term?: string;
  }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedBillingMethod, setSelectedBillingMethod] = useState<string>('all');
  // State for tax rates - Use full ITaxRate
  const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
  const [isLoadingTaxRates, setIsLoadingTaxRates] = useState(true);
  const [errorTaxRates, setErrorTaxRates] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10); // Default page size
  const [totalCount, setTotalCount] = useState(0);
  const filteredServices = services.filter(service => {
    // Get the effective service type ID (either standard or custom)
    const effectiveServiceTypeId = service.standard_service_type_id || service.custom_service_type_id;
    
    // Match based on the effective service type ID
    const categoryMatch = selectedCategory === 'all' || effectiveServiceTypeId === selectedCategory;
    const billingMethodMatch = selectedBillingMethod === 'all' || service.billing_method === selectedBillingMethod;
    return categoryMatch && billingMethodMatch;
  });

  // Track when page changes are from user interaction vs. programmatic updates
  const [userChangedPage, setUserChangedPage] = useState(false);
  
  // Add effect to refetch data when page changes from user interaction
  useEffect(() => {
    if (userChangedPage) {
      console.log(`Current page changed to: ${currentPage}, fetching data...`);
      fetchServices(true);
      setUserChangedPage(false);
    }
  }, [currentPage, userChangedPage]);

  // Add effect to refetch when filters change
  useEffect(() => {
    // Only run this effect after initial load
    if (services.length > 0) {
      console.log("Filters changed, resetting to page 1 and fetching data");
      setCurrentPage(1); // Reset to page 1 when filters change
      fetchServices(false);
    }
  }, [selectedCategory, selectedBillingMethod]);

  useEffect(() => {
    fetchServices(false); // Initial fetch starts at page 1
    fetchCategories();
    fetchAllServiceTypes(); // Fetch service types
    fetchTaxRates(); // Fetch tax rates instead of regions
  }, []);

  // Function to fetch all service types
  const fetchAllServiceTypes = async () => {
    try {
      const types = await getServiceTypesForSelection();
      setAllServiceTypes(types);
    } catch (fetchError) {
      console.error('Error fetching service types:', fetchError);
      if (fetchError instanceof Error) {
        setError(fetchError.message);
      } else {
        setError('An unknown error occurred while fetching service types');
      }
    }
  };

  // Fetch tax rates instead of regions
  const fetchTaxRates = async () => {
   try {
       setIsLoadingTaxRates(true);
       // Use getTaxRates which returns ITaxRate[]
       const rates = await getTaxRates(); // Fetches active rates by default
       setTaxRates(rates);
       setErrorTaxRates(null);
   } catch (error) {
       console.error('Error loading tax rates:', error);
       setErrorTaxRates('Failed to load tax rates.');
       setTaxRates([]); // Clear rates on error
   } finally {
       setIsLoadingTaxRates(false);
   }
  };

  // Keep track of whether we're in the middle of an update operation
  const [isUpdatingService, setIsUpdatingService] = useState(false);
  
  const fetchServices = async (preservePage = false) => {
    try {
      const pageToFetch = preservePage ? currentPage : 1;
      console.log(`Fetching services for page: ${pageToFetch}, preserve page: ${preservePage}, filters: category=${selectedCategory}, billingMethod=${selectedBillingMethod}`);
      
      // If we're filtering, we need to fetch all services and filter client-side
      // Otherwise, we can use server-side pagination
      let response;
      
      if (selectedCategory !== 'all' || selectedBillingMethod !== 'all') {
        // When filtering, fetch all services (with a large page size)
        console.log("Using client-side filtering - fetching all services");
        response = await getServices(1, 1000);
        
        // Update total count based on filtered results
        const filteredCount = response.services.filter(service => {
          const effectiveServiceTypeId = service.standard_service_type_id || service.custom_service_type_id;
          const categoryMatch = selectedCategory === 'all' || effectiveServiceTypeId === selectedCategory;
          const billingMethodMatch = selectedBillingMethod === 'all' || service.billing_method === selectedBillingMethod;
          return categoryMatch && billingMethodMatch;
        }).length;
        
        setTotalCount(filteredCount);
      } else {
        // No filtering, use server-side pagination
        console.log("Using server-side pagination");
        response = await getServices(pageToFetch, pageSize);
        setTotalCount(response.totalCount);
      }
      
      // Update state with the paginated response
      setServices(response.services);
      
      // If we're preserving the page and response came back with a different page
      // (which could happen if the current page no longer exists after an update)
      if (preservePage && response.page !== currentPage) {
        setCurrentPage(response.page);
      }
      
      setError(null);
    } catch (error) {
      console.error('Error fetching services:', error);
      setError('Failed to fetch services');
    }
  };

  const fetchCategories = async () => {
    try {
      const fetchedCategories = await getServiceCategories();
      setCategories(fetchedCategories);
      setError(null);
    } catch (error) {
      console.error('Error fetching categories:', error);
      setError('Failed to fetch categories');
    }
  };

  // Add effect to monitor services changes and maintain pagination
  useEffect(() => {
    if (isUpdatingService) {
      console.log(`Service update detected, preserving page at: ${currentPage}`);
      // Wait for next render cycle to ensure page is preserved
      const timer = setTimeout(() => {
        setIsUpdatingService(false);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [services, isUpdatingService, currentPage]);

  const handleUpdateService = async () => {
    if (!editingService) return;
    // Check for either standard_service_type_id or custom_service_type_id
    if (!editingService.standard_service_type_id && !editingService.custom_service_type_id) {
      setError('Service Type is required');
      return;
    }
    
    // Store the current page before updating service and fetching new data
    const pageBeforeUpdate = currentPage;
    console.log(`Saving service changes from page: ${pageBeforeUpdate}`);
    
    try {
      // Ensure editingService is not null and has an ID
      if (!editingService?.service_id) {
        setError('Cannot update service without an ID.');
        return;
      }
      
      // First close the dialog to avoid UI jumps
      setIsEditDialogOpen(false);
      setEditingService(null);
      
      // Then update the service
      await updateService(editingService.service_id, editingService);
      
      // Fetch updated services with flag to preserve page
      await fetchServices(true);
      
      // Force the page to stay at the previous value
      console.log(`Forcing page back to: ${pageBeforeUpdate}`);
      setTimeout(() => {
        setCurrentPage(pageBeforeUpdate);
      }, 50);
      
      setError(null);
    } catch (error) {
      console.error('Error updating service:', error);
      setError('Failed to update service');
    }
  };

  const handleDeleteService = async (serviceId: string) => {
    // Store the current page before opening the dialog
    const currentPageBeforeDialog = currentPage;
    
    setServiceToDelete(serviceId);
    setIsDeleteDialogOpen(true);
    
    // Ensure the current page is preserved
    setCurrentPage(currentPageBeforeDialog);
  };

  const confirmDeleteService = async () => {
    if (!serviceToDelete) return;
    
    // Store current page
    const pageBeforeDelete = currentPage;
    console.log(`Deleting service from page: ${pageBeforeDelete}`);

    try {
      // First close the dialog to avoid UI jumps
      setIsDeleteDialogOpen(false);
      setServiceToDelete(null);
      
      // Then delete the service
      await deleteService(serviceToDelete);
      
      // Fetch services with page preservation
      await fetchServices(true);
      
      // Force the page to stay at the previous value
      console.log(`Forcing page back to: ${pageBeforeDelete}`);
      setTimeout(() => {
        setCurrentPage(pageBeforeDelete);
      }, 50);
      
      setError(null);
    } catch (error) {
      console.error('Error deleting service:', error);
      setError('Failed to delete service');
      setIsDeleteDialogOpen(false);
      setServiceToDelete(null);
    }
  };
 
  // Handler for DataTable page changes
  // The useCallback ensures stable reference but we need to prevent circular updates
  const handlePageChange = useCallback((newPage: number) => {
    console.log(`Page changed to: ${newPage}`);
    
    // Only update if the page is actually changing to prevent circular updates
    if (newPage !== currentPage) {
      // Mark that this page change was from user interaction
      setUserChangedPage(true);
      setCurrentPage(newPage);
    }
  }, [currentPage]); // Include currentPage in dependencies

  const getColumns = (): ColumnDefinition<IService>[] => {
    const baseColumns: ColumnDefinition<IService>[] = [
      {
        title: 'Service Name',
        dataIndex: 'service_name',
      },
      {
        title: 'Service Type',
        dataIndex: 'service_type_name', // Use the service_type_name field that comes from the join
        render: (value, record) => {
          // Get the effective service type ID (either standard or custom)
          const effectiveServiceTypeId = record.standard_service_type_id || record.custom_service_type_id;
          const type = allServiceTypes.find(t => t.id === effectiveServiceTypeId);
          return type?.name || value || 'N/A';
        },
      },
      {
        title: 'Billing Method',
        dataIndex: 'billing_method',
        render: (value) => BILLING_METHOD_OPTIONS.find(opt => opt.value === value)?.label || value,
      },
      {
        title: 'Default Rate',
        dataIndex: 'default_rate',
        render: (value) => `$${(value / 100).toFixed(2)}`,
      },
      {
        title: 'Category',
        dataIndex: 'category_id',
        render: (value, record) => categories.find(cat => cat.category_id === value)?.category_name || 'N/A',
      },
      {
        title: 'Unit', // Shortened title
        dataIndex: 'unit_of_measure',
        render: (value, record) => record.billing_method === 'per_unit' ? value || 'N/A' : 'N/A',
      },
      // Updated Tax Column
      {
        title: 'Tax Rate',
        dataIndex: 'tax_rate_id', // Use the new field from the DB
        render: (tax_rate_id) => {
          if (!tax_rate_id) return 'Non-Taxable';
          const rate = taxRates.find(r => r.tax_rate_id === tax_rate_id);
          // Construct label using description/region_code from ITaxRate
          const descriptionPart = rate?.description || rate?.region_code || 'N/A';
          const percentageValue = typeof rate?.tax_percentage === 'string'
              ? parseFloat(rate.tax_percentage)
              : Number(rate?.tax_percentage);
          const percentagePart = !isNaN(percentageValue) ? percentageValue.toFixed(2) : '0.00';
          return rate ? `${descriptionPart} - ${percentagePart}%` : tax_rate_id; // Fallback to ID
        },
      },
    ];

    // Removed conditional columns based on old service_type
    // TODO: Re-add conditional columns based on new category/billing method if needed
    baseColumns.push(
      {
        title: 'SKU',
        dataIndex: 'sku',
        render: (value, record) => {
          // Get the effective service type ID (either standard or custom)
          const effectiveServiceTypeId = record.standard_service_type_id || record.custom_service_type_id;
          const type = allServiceTypes.find(t => t.id === effectiveServiceTypeId);
          return type?.name === 'Hardware' ? value || 'N/A' : 'N/A';
        },
      },
      {
        title: 'Inventory',
        dataIndex: 'inventory_count',
        render: (value, record) => {
          // Get the effective service type ID (either standard or custom)
          const effectiveServiceTypeId = record.standard_service_type_id || record.custom_service_type_id;
          const type = allServiceTypes.find(t => t.id === effectiveServiceTypeId);
          return type?.name === 'Hardware' ? (value ?? 'N/A') : 'N/A'; // Use ?? for 0
        },
      },
      {
        title: 'Seat Limit',
        dataIndex: 'seat_limit',
        render: (value, record) => {
          // Get the effective service type ID (either standard or custom)
          const effectiveServiceTypeId = record.standard_service_type_id || record.custom_service_type_id;
          const type = allServiceTypes.find(t => t.id === effectiveServiceTypeId);
          return type?.name === 'Software License' ? (value ?? 'N/A') : 'N/A'; // Use ?? for 0
        },
      },
      {
        title: 'License Term',
        dataIndex: 'license_term',
        render: (value, record) => {
          // Get the effective service type ID (either standard or custom)
          const effectiveServiceTypeId = record.standard_service_type_id || record.custom_service_type_id;
          const type = allServiceTypes.find(t => t.id === effectiveServiceTypeId);
          return type?.name === 'Software License' ? (value ?? 'N/A') : 'N/A'; // Use ?? for 0
        }
      }
    );

    // Always add actions column at the end
    baseColumns.push({
      title: 'Actions',
      dataIndex: 'service_id',
      width: '5%',
      render: (_, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              id={`service-actions-menu-${record.service_id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`edit-service-${record.service_id}`}
              onClick={() => {
                setEditingService(record);
                setIsEditDialogOpen(true);
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`delete-service-${record.service_id}`}
              className="text-red-600 focus:text-red-600"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteService(record.service_id!);
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    });

    return baseColumns;
  };

  const columns = getColumns();

  return (
    <>
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Service Catalog Management</h3>
        </CardHeader>
        <CardContent>
          {error && <div className="text-red-500 mb-4">{error}</div>}
          {errorTaxRates && <div className="text-red-500 mb-4">{errorTaxRates}</div>} {/* Show tax rate error */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex space-x-2">
                <CustomSelect
                  options={[{ value: 'all', label: 'All Categories' }, ...SERVICE_CATEGORY_OPTIONS]}
                  value={selectedCategory}
                  onValueChange={setSelectedCategory}
                  placeholder="Filter by category..."
                  className="w-[200px]"
                />
                <CustomSelect
                  options={[{ value: 'all', label: 'All Billing Methods' }, ...BILLING_METHOD_OPTIONS]}
                  value={selectedBillingMethod}
                  onValueChange={setSelectedBillingMethod}
                  placeholder="Filter by billing method..."
                  className="w-[200px]"
                />
              </div>
              <QuickAddService onServiceAdded={fetchServices} allServiceTypes={allServiceTypes} /> {/* Pass prop */}
            </div>
            <DataTable
              // Memoize filteredServices to prevent unnecessary rerenders
              data={useMemo(() => filteredServices, [JSON.stringify(filteredServices)])}
              columns={columns}
              pagination={true} // Keep this to enable pagination UI
              currentPage={currentPage}
              pageSize={pageSize}
              totalItems={totalCount} // Pass total count for server-side pagination
              onPageChange={handlePageChange}
              onRowClick={(record: IService) => { // Use updated IService
                // Store the current page before opening the dialog
                const currentPageBeforeDialog = currentPage;
                
                // Add optional UI fields if needed when setting state
                setEditingService({
                  ...record,
                  // sku: record.sku || '', // Example if sku was fetched
                });
                setIsEditDialogOpen(true);
                
                // Ensure the current page is preserved
                setCurrentPage(currentPageBeforeDialog);
              }}
              key={`service-catalog-table-${currentPage}`} // Include currentPage in the key to force proper re-rendering
            />
          </div>
        </CardContent>
      </Card>
      <Dialog isOpen={isEditDialogOpen} onClose={() => setIsEditDialogOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Service</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Service Name"
              value={editingService?.service_name || ''}
              onChange={(e) => setEditingService({ ...editingService!, service_name: e.target.value })}
            />
            {/* Updated CustomSelect to use standard_service_type_id or custom_service_type_id */}
            <CustomSelect
              options={allServiceTypes.map(type => ({ value: type.id, label: type.name }))} // Use fetched types
              // Use the effective service type ID for the value
              value={(editingService?.standard_service_type_id || editingService?.custom_service_type_id) || ''}
              onValueChange={(value) => {
                // Find if the selected type is standard or custom
                const selectedType = allServiceTypes.find(t => t.id === value);
                if (!selectedType) return;
                
                // Update the appropriate field based on whether it's a standard or custom type
                if (selectedType.is_standard) {
                  setEditingService({
                    ...editingService!,
                    standard_service_type_id: value,
                    custom_service_type_id: undefined
                  });
                } else {
                  setEditingService({
                    ...editingService!,
                    standard_service_type_id: undefined,
                    custom_service_type_id: value
                  });
                }
              }}
              placeholder="Select service type..."
            />
            {/* Added Billing Method dropdown */}
            <CustomSelect
              options={BILLING_METHOD_OPTIONS}
              value={editingService?.billing_method || 'fixed'}
              onValueChange={(value) => setEditingService({ ...editingService!, billing_method: value as 'fixed' | 'per_unit' })}
              placeholder="Select billing method..."
            />
            
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description</label>
              <Input
                placeholder="Description"
                value={editingService?.description || ''}
                onChange={(e) => setEditingService({ ...editingService!, description: e.target.value })}
              />
            </div>
            <Input
              type="number"
              placeholder="Default Rate"
              // Display dollars, allow user to type decimals freely.
              // The browser's number input might still show trailing zeros based on step, but typing isn't blocked.
              value={(editingService?.default_rate ?? 0) / 100}
              step="0.01" // Hint to the browser about expected precision
              onChange={(e) => {
                const rawValue = e.target.value;
                // Allow empty string -> 0 cents
                if (rawValue === '') {
                  // Ensure editingService is not null before updating
                  if (editingService) {
                    setEditingService({ ...editingService, default_rate: 0 });
                  }
                  return;
                }
                // Try parsing, update cents only if valid number
                const dollarValue = parseFloat(rawValue);
                if (!isNaN(dollarValue) && editingService) {
                  const centsValue = Math.round(dollarValue * 100);
                  setEditingService({ ...editingService, default_rate: centsValue });
                }
                // If input is invalid (e.g., "abc", "1..2"), do nothing to the cents state.
                // The input field itself might show the invalid input temporarily depending on browser behavior.
              }}
            />
            <CustomSelect
              options={categories.map((cat): { value: string; label: string } => ({
                value: cat.category_id || 'None',
                label: cat.category_name
              }))}
              onValueChange={(value) => setEditingService({ ...editingService!, category_id: value })}
              value={editingService?.category_id || 'unassigned'}
              placeholder="Select category..."
            />
            {/* Conditional Unit of Measure */}
            {editingService?.billing_method === 'per_unit' && (
              <UnitOfMeasureInput
                value={editingService?.unit_of_measure || ''}
                onChange={(value) => setEditingService({ ...editingService!, unit_of_measure: value })}
                placeholder="Unit of Measure"
                className="w-full"
              />
            )}
            {/* Replaced Tax Region/Is Taxable with Tax Rate Selector */}
            <CustomSelect
                id="edit-service-tax-rate-select"
                label="Tax Rate (Optional)"
                value={editingService?.tax_rate_id || ''} // Bind to tax_rate_id from IService
                placeholder={isLoadingTaxRates ? "Loading rates..." : "Select Tax Rate (or leave blank for Non-Taxable)"}
                onValueChange={(value) => {
                  if (editingService) { // Ensure editingService is not null
                    setEditingService({ ...editingService, tax_rate_id: value || null }); // Set null if cleared
                  }
                }}
                // Populate with fetched tax rates, construct label using available fields
                options={taxRates.map(r => { // r is ITaxRate
                   const descriptionPart = r.description || r.region_code || 'N/A';
                   const percentageValue = typeof r.tax_percentage === 'string' ? parseFloat(r.tax_percentage) : Number(r.tax_percentage);
                   const percentagePart = !isNaN(percentageValue) ? percentageValue.toFixed(2) : '0.00';
                   return {
                     value: r.tax_rate_id,
                     label: `${descriptionPart} - ${percentagePart}%`
                   };
                })}
                disabled={isLoadingTaxRates}
                allowClear={true} // Allow clearing the selection
            />

            {/* Removed conditional rendering based on old service_type */}
            {/* Conditional Fields based on Service Type Name */}
            {/* Get the effective service type ID for conditional rendering */}
            {allServiceTypes.find(t => t.id === (editingService?.standard_service_type_id || editingService?.custom_service_type_id))?.name === 'Hardware' && (
              <>
                <Input
                  placeholder="SKU"
                  value={editingService?.sku || ''}
                  onChange={(e) => {
                    if (editingService) {
                      setEditingService({
                        ...editingService,
                        sku: e.target.value
                      });
                    }
                  }}
                />
                <Input
                  type="number"
                  placeholder="Inventory Count"
                  value={editingService?.inventory_count ?? ''} // Use ?? for 0
                  onChange={(e) => {
                    if (editingService) {
                      setEditingService({
                        ...editingService,
                        inventory_count: parseInt(e.target.value) || 0
                      });
                    }
                  }}
                />
              </>
            )}
            {/* Get the effective service type ID for conditional rendering */}
            {allServiceTypes.find(t => t.id === (editingService?.standard_service_type_id || editingService?.custom_service_type_id))?.name === 'Software License' && (
              <>
                <Input
                  type="number"
                  placeholder="Seat Limit"
                  value={editingService?.seat_limit ?? ''} // Use ?? for 0
                  onChange={(e) => {
                    if (editingService) {
                      setEditingService({
                        ...editingService,
                        seat_limit: parseInt(e.target.value) || 0
                      });
                    }
                  }}
                />
                <CustomSelect
                  options={LICENSE_TERM_OPTIONS}
                  value={editingService?.license_term || 'monthly'}
                  onValueChange={(value) => {
                    if (editingService) {
                      setEditingService({
                        ...editingService,
                        license_term: value
                      });
                    }
                  }}
                  placeholder="Select license term..."
                />
              </>
            )}
          </div>
          <DialogFooter>
            <Button id='cancel-button' variant="outline" onClick={() => {
              setIsEditDialogOpen(false);
              setEditingService(null);
            }}>Cancel</Button>
            <Button id='save-button' onClick={() => {
              // Just call handleUpdateService - it will close the dialog
              handleUpdateService();
              // Don't call setIsEditDialogOpen(false) here as it's already done in handleUpdateService
              // and might cause race conditions with the pagination state
            }}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={confirmDeleteService}
        title="Delete Service"
        message="Are you sure you want to delete this service? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </>
  );
};

export default ServiceCatalogManager;
