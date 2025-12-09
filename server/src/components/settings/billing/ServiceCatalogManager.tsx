'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
// Import new action and types
import { getServices, updateService, deleteService, getServiceTypesForSelection, PaginatedServicesResponse, createServiceTypeInline, updateServiceTypeInline, deleteServiceTypeInline, setServicePrices } from 'server/src/lib/actions/serviceActions';
import { CURRENCY_OPTIONS, getCurrencySymbol } from 'server/src/constants/currency';
import { getServiceCategories } from 'server/src/lib/actions/serviceCategoryActions';
// Import action to get tax rates
import { getTaxRates } from 'server/src/lib/actions/taxSettingsActions';
import { IService, IServiceCategory, IServiceType, IServicePrice } from 'server/src/interfaces/billing.interfaces'; // Added IServiceType, IServicePrice
// Import ITaxRate interface
import { ITaxRate } from 'server/src/interfaces/tax.interfaces'; // Corrected import path if needed
import { Card, CardContent, CardHeader } from 'server/src/components/ui/Card';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { QuickAddService } from './QuickAddService';
import { EditableServiceTypeSelect } from 'server/src/components/ui/EditableServiceTypeSelect';
import { MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

// Removed old SERVICE_TYPE_OPTIONS

// Define billing method options (as per contract line)
const BILLING_METHOD_OPTIONS = [
  { value: 'fixed', label: 'Fixed Fee' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'per_unit', label: 'Per Unit' },
  { value: 'usage', label: 'Usage Based' }
];

// Removed hardcoded SERVICE_CATEGORY_OPTIONS - will use fetched categories instead

const LICENSE_TERM_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
  { value: 'perpetual', label: 'Perpetual' }
];

const ServiceCatalogManager: React.FC = () => {
  const [services, setServices] = useState<IService[]>([]);
  // Note: Categories are currently hidden in favor of using Service Types for organization
  const [categories, setCategories] = useState<IServiceCategory[]>([]);
  // Update state type to match what getServiceTypesForSelection returns
  const [allServiceTypes, setAllServiceTypes] = useState<{ id: string; name: string; billing_method: 'fixed' | 'hourly' | 'per_unit' | 'usage'; is_standard: boolean }[]>([]);
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
  // Using Service Type filter instead of categories
  const [selectedServiceType, setSelectedServiceType] = useState<string>('all');
  const [selectedBillingMethod, setSelectedBillingMethod] = useState<string>('all');
  // State for tax rates - Use full ITaxRate
  const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
  const [isLoadingTaxRates, setIsLoadingTaxRates] = useState(true);
  const [errorTaxRates, setErrorTaxRates] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10); // Default page size
  const [totalCount, setTotalCount] = useState(0);
  // State for rate input (display value while typing)
  const [rateInput, setRateInput] = useState<string>('');
  // State for editing prices (multi-currency support)
  const [editingPrices, setEditingPrices] = useState<Array<{ currency_code: string; rate: number }>>([]);
  const filteredServices = services.filter(service => {
    // Filter by Service Type
    const serviceTypeMatch = selectedServiceType === 'all' || service.custom_service_type_id === selectedServiceType;
    const billingMethodMatch = selectedBillingMethod === 'all' || service.billing_method === selectedBillingMethod;
    return serviceTypeMatch && billingMethodMatch;
  });
  const memoizedFilteredServices = useMemo(() => filteredServices, [JSON.stringify(filteredServices)]);

  // Track when page changes are from user interaction vs. programmatic updates
  const [userChangedPage, setUserChangedPage] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
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
  }, [selectedServiceType, selectedBillingMethod]);

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
    setIsLoading(true);
    try {
      const pageToFetch = preservePage ? currentPage : 1;
      console.log(`Fetching services for page: ${pageToFetch}, preserve page: ${preservePage}, filters: serviceType=${selectedServiceType}, billingMethod=${selectedBillingMethod}`);
      
      // If we're filtering, we need to fetch all services and filter client-side
      // Otherwise, we can use server-side pagination
      let response;
      
      if (selectedServiceType !== 'all' || selectedBillingMethod !== 'all') {
        // When filtering, fetch all services (with a large page size)
        console.log("Using client-side filtering - fetching all services");
        response = await getServices(1, 1000);
        
        // Update total count based on filtered results
        const filteredCount = response.services.filter(service => {
          const serviceTypeMatch = selectedServiceType === 'all' || service.custom_service_type_id === selectedServiceType;
          const billingMethodMatch = selectedBillingMethod === 'all' || service.billing_method === selectedBillingMethod;
          return serviceTypeMatch && billingMethodMatch;
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
    } finally {
      setIsLoading(false);
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
    // Check for custom_service_type_id
    if (!editingService.custom_service_type_id) {
      setError('Service Type is required');
      return;
    }

    // Validate at least one price is set
    if (editingPrices.length === 0) {
      setError('At least one price is required');
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
      setEditingPrices([]);

      // Then update the service
      await updateService(editingService.service_id, editingService);

      // Update the service prices
      await setServicePrices(editingService.service_id, editingPrices);

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

  // Handle page size change - reset to page 1
  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  }, []);

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
          const type = allServiceTypes.find(t => t.id === record.custom_service_type_id);
          return type?.name || value || 'N/A';
        },
      },
      {
        title: 'Billing Method',
        dataIndex: 'billing_method',
        render: (value) => BILLING_METHOD_OPTIONS.find(opt => opt.value === value)?.label || value,
      },
      {
        title: 'Pricing',
        dataIndex: 'prices',
        render: (prices: IServicePrice[] | undefined, record) => {
          if (!prices || prices.length === 0) {
            // Fall back to default_rate if no prices exist
            return `$${(record.default_rate / 100).toFixed(2)}`;
          }
          // Show primary price (first one, typically USD)
          const primaryPrice = prices[0];
          const primaryDisplay = `${getCurrencySymbol(primaryPrice.currency_code)}${(primaryPrice.rate / 100).toFixed(2)}`;
          // Show indicator if there are additional currencies
          if (prices.length > 1) {
            return (
              <span title={prices.map(p => `${p.currency_code}: ${getCurrencySymbol(p.currency_code)}${(p.rate / 100).toFixed(2)}`).join('\n')}>
                {primaryDisplay} <span className="text-xs text-gray-500">+{prices.length - 1}</span>
              </span>
            );
          }
          return primaryDisplay;
        },
      },
      // Category column hidden - using Service Types for organization
      // {
      //   title: 'Category',
      //   dataIndex: 'category_id',
      //   render: (value, record) => categories.find(cat => cat.category_id === value)?.category_name || 'N/A',
      // },
      {
        title: 'Unit', // Shortened title
        dataIndex: 'unit_of_measure',
        render: (value, record) => record.billing_method === 'usage' ? value || 'N/A' : 'N/A',
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
    // Hidden columns: SKU, Inventory, Seat Limit, License Term
    // baseColumns.push(
    //   {
    //     title: 'SKU',
    //     dataIndex: 'sku',
    //     render: (value, record) => {
    //       const type = allServiceTypes.find(t => t.id === record.custom_service_type_id);
    //       return type?.name === 'Hardware' ? value || 'N/A' : 'N/A';
    //     },
    //   },
    //   {
    //     title: 'Inventory',
    //     dataIndex: 'inventory_count',
    //     render: (value, record) => {
    //       const type = allServiceTypes.find(t => t.id === record.custom_service_type_id);
    //       return type?.name === 'Hardware' ? (value ?? 'N/A') : 'N/A'; // Use ?? for 0
    //     },
    //   },
    //   {
    //     title: 'Seat Limit',
    //     dataIndex: 'seat_limit',
    //     render: (value, record) => {
    //       const type = allServiceTypes.find(t => t.id === record.custom_service_type_id);
    //       return type?.name === 'Software License' ? (value ?? 'N/A') : 'N/A'; // Use ?? for 0
    //     },
    //   },
    //   {
    //     title: 'License Term',
    //     dataIndex: 'license_term',
    //     render: (value, record) => {
    //       const type = allServiceTypes.find(t => t.id === record.custom_service_type_id);
    //       return type?.name === 'Software License' ? (value ?? 'N/A') : 'N/A'; // Use ?? for 0
    //     }
    //   }
    // );

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
                // Initialize editingPrices from service prices or create default USD entry
                const prices = record.prices && record.prices.length > 0
                  ? record.prices.map(p => ({ currency_code: p.currency_code, rate: p.rate }))
                  : [{ currency_code: 'USD', rate: record.default_rate }];
                setEditingPrices(prices);
                // Set rate input for the first/primary price
                const primaryRate = prices.length > 0 ? prices[0].rate : record.default_rate;
                setRateInput((primaryRate / 100).toFixed(2));
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
                {/* Service Type filter */}
                <CustomSelect
                  options={[
                    { value: 'all', label: 'All Service Types' },
                    ...allServiceTypes.map(type => ({
                      value: type.id,
                      label: type.name
                    }))
                  ]}
                  value={selectedServiceType}
                  onValueChange={setSelectedServiceType}
                  placeholder="Filter by service type..."
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
              <QuickAddService
                onServiceAdded={fetchServices}
                allServiceTypes={allServiceTypes}
                onServiceTypesChange={fetchAllServiceTypes}
              /> {/* Pass prop */}
            </div>
            {isLoading ? (
              <LoadingIndicator
                layout="stacked"
                className="py-10 text-gray-600"
                spinnerProps={{ size: 'md' }}
                text="Loading services"
              />
            ) : (
              <DataTable
                id="service-catalog-manager-table"
                data={memoizedFilteredServices}
                columns={columns}
                pagination={true} // Keep this to enable pagination UI
                currentPage={currentPage}
                pageSize={pageSize}
                totalItems={totalCount} // Pass total count for server-side pagination
                onPageChange={handlePageChange}
                onItemsPerPageChange={handlePageSizeChange}
                onRowClick={(record: IService) => { // Use updated IService
                  // Store the current page before opening the dialog
                  const currentPageBeforeDialog = currentPage;

                  // Add optional UI fields if needed when setting state
                  setEditingService({
                    ...record,
                    // sku: record.sku || '', // Example if sku was fetched
                  });
                  // Initialize editingPrices from service prices or create default USD entry
                  const prices = record.prices && record.prices.length > 0
                    ? record.prices.map(p => ({ currency_code: p.currency_code, rate: p.rate }))
                    : [{ currency_code: 'USD', rate: record.default_rate }];
                  setEditingPrices(prices);
                  // Set rate input for the first/primary price
                  const primaryRate = prices.length > 0 ? prices[0].rate : record.default_rate;
                  setRateInput((primaryRate / 100).toFixed(2));
                  setIsEditDialogOpen(true);

                  // Ensure the current page is preserved
                  setCurrentPage(currentPageBeforeDialog);
                }}
                key={`service-catalog-table-${currentPage}`} // Include currentPage in the key to force proper re-rendering
              />
            )}
          </div>
        </CardContent>
      </Card>
      <Dialog 
        isOpen={isEditDialogOpen} 
        onClose={() => setIsEditDialogOpen(false)} 
        title="Edit Service"
      >
        <DialogContent>
          <div className="space-y-4">
            <div>
              <label htmlFor="service-name" className="block text-sm font-medium text-gray-700 mb-1">Service Name</label>
              <Input
                id="service-name"
                placeholder="Service Name"
                value={editingService?.service_name || ''}
                onChange={(e) => setEditingService({ ...editingService!, service_name: e.target.value })}
              />
            </div>
            {/* Updated to use EditableServiceTypeSelect */}
            <div>
              <EditableServiceTypeSelect
                label="Service Type"
                value={editingService?.custom_service_type_id || ''}
                onChange={(value) => {
                  setEditingService({
                    ...editingService!,
                    custom_service_type_id: value
                  });
                }}
                serviceTypes={allServiceTypes}
                onCreateType={async (name) => {
                  await createServiceTypeInline(name);
                  fetchAllServiceTypes(); // Refresh the service types list
                }}
                onUpdateType={async (id, name) => {
                  await updateServiceTypeInline(id, name);
                  fetchAllServiceTypes(); // Refresh the service types list
                }}
                onDeleteType={async (id) => {
                  await deleteServiceTypeInline(id);
                  fetchAllServiceTypes(); // Refresh the service types list
                }}
                placeholder="Select service type..."
              />
            </div>
            {/* Added Billing Method dropdown */}
            <div>
              <label htmlFor="billing-method" className="block text-sm font-medium text-gray-700 mb-1">Billing Method</label>
              <CustomSelect
                id="billing-method"
                options={BILLING_METHOD_OPTIONS}
                value={editingService?.billing_method || 'fixed'}
                onValueChange={(value) => setEditingService({ ...editingService!, billing_method: value as 'fixed' | 'hourly' | 'per_unit' | 'usage' })}
                placeholder="Select billing method..."
              />
            </div>
            
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <Input
                id="description"
                placeholder="Description"
                value={editingService?.description || ''}
                onChange={(e) => setEditingService({ ...editingService!, description: e.target.value })}
              />
            </div>
            {/* Multi-Currency Pricing Section */}
            <div className="col-span-2 border rounded-lg p-4 bg-gray-50">
              <div className="flex justify-between items-center mb-3">
                <label className="block text-sm font-medium text-gray-700">
                  Pricing *
                  <span className="text-xs font-normal text-gray-500 ml-2">
                    ({editingService?.billing_method === 'fixed' ? 'Monthly' : editingService?.billing_method === 'hourly' ? 'Per Hour' : 'Per Unit'})
                  </span>
                </label>
                <Button
                  id="add-currency-btn"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // Find currencies not yet added
                    const usedCurrencies = editingPrices.map(p => p.currency_code);
                    const availableCurrency = CURRENCY_OPTIONS.find(c => !usedCurrencies.includes(c.value));
                    if (availableCurrency) {
                      setEditingPrices([...editingPrices, { currency_code: availableCurrency.value, rate: 0 }]);
                    }
                  }}
                  disabled={editingPrices.length >= CURRENCY_OPTIONS.length}
                >
                  + Add Currency
                </Button>
              </div>

              <div className="space-y-3">
                {editingPrices.map((price, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <div className="w-32">
                      <CustomSelect
                        id={`edit-price-currency-${index}`}
                        options={CURRENCY_OPTIONS.filter(c =>
                          c.value === price.currency_code ||
                          !editingPrices.some(p => p.currency_code === c.value)
                        ).map(c => ({ value: c.value, label: c.label }))}
                        value={price.currency_code}
                        onValueChange={(value) => {
                          const newPrices = [...editingPrices];
                          newPrices[index] = { ...newPrices[index], currency_code: value };
                          setEditingPrices(newPrices);
                        }}
                        placeholder="Currency"
                      />
                    </div>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                        {getCurrencySymbol(price.currency_code)}
                      </span>
                      <Input
                        id={`edit-price-rate-${index}`}
                        type="text"
                        inputMode="decimal"
                        value={index === 0 ? rateInput : (price.rate / 100).toFixed(2)}
                        onChange={(e) => {
                          const value = e.target.value.replace(/[^0-9.]/g, '');
                          const decimalCount = (value.match(/\./g) || []).length;
                          if (decimalCount <= 1) {
                            if (index === 0) {
                              setRateInput(value);
                            } else {
                              // For non-primary prices, update directly
                              const dollars = parseFloat(value) || 0;
                              const cents = Math.round(dollars * 100);
                              const newPrices = [...editingPrices];
                              newPrices[index] = { ...newPrices[index], rate: cents };
                              setEditingPrices(newPrices);
                            }
                          }
                        }}
                        onBlur={() => {
                          if (index === 0) {
                            // Primary price - update both editingPrices and default_rate
                            const dollars = parseFloat(rateInput) || 0;
                            const cents = Math.round(dollars * 100);
                            const newPrices = [...editingPrices];
                            newPrices[0] = { ...newPrices[0], rate: cents };
                            setEditingPrices(newPrices);
                            if (editingService) {
                              setEditingService({ ...editingService, default_rate: cents });
                            }
                            setRateInput((cents / 100).toFixed(2));
                          }
                        }}
                        placeholder="0.00"
                        className="pl-10"
                      />
                    </div>
                    {editingPrices.length > 1 && (
                      <Button
                        id={`remove-price-${index}`}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 px-2"
                        onClick={() => {
                          const newPrices = editingPrices.filter((_, i) => i !== index);
                          setEditingPrices(newPrices);
                          // If removing the first price, update rateInput
                          if (index === 0 && newPrices.length > 0) {
                            setRateInput((newPrices[0].rate / 100).toFixed(2));
                            if (editingService) {
                              setEditingService({ ...editingService, default_rate: newPrices[0].rate });
                            }
                          }
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Add prices in multiple currencies. The first currency is the primary rate.
              </p>
            </div>

            {/* Unit of Measure for usage-based services */}
            {editingService?.billing_method === 'usage' && (
              <>
                <div>
                  <label htmlFor="unit-of-measure" className="block text-sm font-medium text-gray-700 mb-1">Unit of Measure *</label>
                  <Input
                    id="unit-of-measure"
                    type="text"
                    value={editingService?.unit_of_measure || ''}
                    onChange={(e) => setEditingService({ ...editingService!, unit_of_measure: e.target.value })}
                    placeholder="e.g., GB, API call, user"
                    required
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">The measurable unit for billing (e.g., GB, API call, user)</p>
                </div>
              </>
            )}
            {/* Category dropdown removed - using Service Types for organization */}
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
            {/* Get the service type for conditional rendering */}
            {allServiceTypes.find(t => t.id === editingService?.custom_service_type_id)?.name === 'Hardware' && (
              <>
                <div>
                  <label htmlFor="sku" className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
                  <Input
                    id="sku"
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
                </div>
                <div>
                  <label htmlFor="inventory-count" className="block text-sm font-medium text-gray-700 mb-1">Inventory Count</label>
                  <Input
                    id="inventory-count"
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
                </div>
              </>
            )}
            {/* Get the service type for conditional rendering */}
            {allServiceTypes.find(t => t.id === editingService?.custom_service_type_id)?.name === 'Software License' && (
              <>
                <div>
                  <label htmlFor="seat-limit" className="block text-sm font-medium text-gray-700 mb-1">Seat Limit</label>
                  <Input
                    id="seat-limit"
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
                </div>
                <div>
                  <label htmlFor="license-term" className="block text-sm font-medium text-gray-700 mb-1">License Term</label>
                  <CustomSelect
                    id="license-term"
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
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button id='cancel-button' variant="outline" onClick={() => {
              setIsEditDialogOpen(false);
              setEditingService(null);
              setRateInput('');
              setEditingPrices([]);
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
