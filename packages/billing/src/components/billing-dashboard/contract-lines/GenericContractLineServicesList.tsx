// server/src/components/billing-dashboard/GenericPlanServicesList.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react'; // Added useCallback
import { Card, Box } from '@radix-ui/themes';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Plus, MoreVertical, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
// Removed CustomSelect import as it wasn't used
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import { IContractLine, IContractLineService, IService, IServiceCategory } from '@alga-psa/types';
import { getContractLineServicesWithConfigurations, addServiceToContractLine, removeServiceFromContractLine } from '@alga-psa/billing/actions/contractLineServiceActions';
import { getServices } from '@alga-psa/billing/actions';
import { getContractLineById } from '@alga-psa/billing/actions/contractLineAction'; // Import action to get plan details
import { getContractById } from '@alga-psa/billing/actions/contractActions';
import { getCurrencySymbol } from '@alga-psa/core'; // Import currency helper
import { getServiceCategories } from '@alga-psa/billing/actions'; // Added import
// Removed useTenant import as it wasn't used
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';
import ContractLineServiceForm from './ContractLineServiceForm'; // Adjusted path
import { Badge } from '@alga-psa/ui/components/Badge';
import { IContractLineServiceConfiguration } from '@alga-psa/types';

// Define billing method options
const BILLING_METHOD_OPTIONS: Array<{ value: 'fixed' | 'hourly' | 'usage'; label: string }> = [
  { value: 'fixed', label: 'Fixed Price' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'usage', label: 'Usage Based' }
];

interface GenericPlanServicesListProps {
  contractLineId: string;
  onServicesChanged?: () => void; // Optional callback when services are added/removed
  disableEditing?: boolean; // New prop to disable edit actions
}


interface EnhancedPlanService extends IContractLineService {
  configuration?: IContractLineServiceConfiguration;
  configurationType?: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket';
  typeConfig?: any; // Type-specific configuration (Fixed, Hourly, Usage, or Bucket)
  // Added fields for display consistency
  service_name?: string;
  service_type_name?: string; // Changed from service_category
  billing_method?: 'fixed' | 'hourly' | 'usage' | 'per_unit' | null; // Allow null and per_unit to match IService
  unit_of_measure?: string;
  default_rate?: number;
}

const GenericPlanServicesList: React.FC<GenericPlanServicesListProps> = ({ contractLineId, onServicesChanged, disableEditing = false }) => {
  const [planServices, setPlanServices] = useState<EnhancedPlanService[]>([]);
  const [availableServices, setAvailableServices] = useState<IService[]>([]);
  // Removed serviceCategories state
  const [selectedServicesToAdd, setSelectedServicesToAdd] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingService, setEditingService] = useState<EnhancedPlanService | null>(null);
  const [planType, setPlanType] = useState<IContractLine['contract_line_type'] | null>(null); // State for plan type
  const [contractLineBillingFrequency, setContractLineBillingFrequency] = useState<string | null>(null);
  const [contractCurrency, setContractCurrency] = useState<string>('USD'); // Contract currency code
  const [customRates, setCustomRates] = useState<Record<string, string>>({}); // Custom rates for services without matching currency
  // Removed tenant state

  // Helper function to get service price in contract currency
  const getServicePriceInCurrency = (service: IService, currencyCode: string): number | null => {
    // First check if service has prices array with the matching currency
    if (service.prices && service.prices.length > 0) {
      const matchingPrice = service.prices.find(p => p.currency_code === currencyCode);
      if (matchingPrice) {
        return matchingPrice.rate;
      }
    }
    // If no matching currency price, return null (requires custom rate)
    return null;
  };

  // Check if a service has a price in the contract currency
  const hasMatchingCurrencyPrice = (service: IService): boolean => {
    return getServicePriceInCurrency(service, contractCurrency) !== null;
  };

  const fetchData = useCallback(async () => { // Added useCallback
    if (!contractLineId) return;

    setIsLoading(true);
    setError(null);

    try {
      // Fetch plan details, services, and configurations
      const [planDetails, servicesResponse, servicesWithConfigurations] = await Promise.all([
        getContractLineById(contractLineId), // Fetch the plan details
        getServices(1, 999, { item_kind: 'any' }),
        getContractLineServicesWithConfigurations(contractLineId),
      ]);
      
      // Extract the services array from the paginated response
      const allAvailableServices = Array.isArray(servicesResponse)
        ? servicesResponse
        : (servicesResponse.services || []);

      if (!planDetails) {
        throw new Error(`Contract line with ID ${contractLineId} not found.`);
      }
      setPlanType(planDetails.contract_line_type); // Store the plan type
      setContractLineBillingFrequency(planDetails.billing_frequency); // Store the billing frequency

      // Fetch contract to get currency
      if (planDetails.contract_id) {
        const contract = await getContractById(planDetails.contract_id);
        if (contract?.currency_code) {
          setContractCurrency(contract.currency_code);
        }
      }

      // Enhance services with details and configuration
      const enhancedServices: EnhancedPlanService[] = servicesWithConfigurations.map(configInfo => {
        // Find the corresponding full service details from the getServices() call
        // Note: configInfo.service already contains service_type_name from the updated action
        const fullServiceDetails = allAvailableServices.find(s => s.service_id === configInfo.configuration.service_id);

        return {
          contract_line_id: contractLineId,
          service_id: configInfo.configuration.service_id,
          quantity: configInfo.configuration.quantity,
          custom_rate: configInfo.configuration.custom_rate,
          tenant: configInfo.configuration.tenant,
          created_at: configInfo.configuration.created_at,
          updated_at: configInfo.configuration.updated_at,
          configuration: configInfo.configuration,
          configurationType: configInfo.configuration.configuration_type,
          typeConfig: configInfo.typeConfig, // Include type-specific config
          service_name: configInfo.service.service_name || 'Unknown Service',
          service_type_name: configInfo.service.service_type_name || 'N/A', // Use directly from joined data
          billing_method: configInfo.service.billing_method,
          unit_of_measure: configInfo.service.unit_of_measure || 'N/A',
          default_rate: configInfo.service.default_rate
        };
      });

      setPlanServices(enhancedServices);
      setAvailableServices(allAvailableServices); // Keep this to know which services *can* be added
    } catch (error) {
      console.error('Error fetching data:', error);
      setError('Failed to load services data');
    } finally {
      setIsLoading(false);
    }
  }, [contractLineId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]); // Use fetchData in dependency array


  const handleAddService = async () => {
    if (!contractLineId || selectedServicesToAdd.length === 0) return;

    // Validate that all services without matching currency have custom rates
    for (const serviceId of selectedServicesToAdd) {
      const service = availableServices.find(s => s.service_id === serviceId);
      if (service && !hasMatchingCurrencyPrice(service)) {
        const customRate = customRates[serviceId];
        if (!customRate || parseFloat(customRate) <= 0) {
          setError(`Please enter a rate for "${service.service_name}" (no ${contractCurrency} price configured)`);
          return;
        }
      }
    }

    try {
      for (const serviceId of selectedServicesToAdd) {
        const serviceToAdd = availableServices.find(s => s.service_id === serviceId);
        if (serviceToAdd) {
          // Get rate: prefer contract currency price, fall back to custom rate
          let rate: number;
          const currencyPrice = getServicePriceInCurrency(serviceToAdd, contractCurrency);
          if (currencyPrice !== null) {
            rate = currencyPrice;
          } else {
            // Use custom rate (already validated above)
            rate = Math.round(parseFloat(customRates[serviceId]) * 100); // Convert to cents
          }

          await addServiceToContractLine(
            contractLineId,
            serviceId,
            1, // Default quantity
            rate
          );
        }
      }
      await fetchData(); // Ensure data is fetched before calling callback
      setSelectedServicesToAdd([]);
      setCustomRates({}); // Clear custom rates
      onServicesChanged?.(); // Call the callback if provided
    } catch (error) {
      console.error('Error adding services:', error);
      setError('Failed to add services');
    }
  };

  const handleRemoveService = async (serviceId: string) => {
    if (!contractLineId) return;

    try {
      await removeServiceFromContractLine(contractLineId, serviceId);
      await fetchData(); // Ensure data is fetched before calling callback
      onServicesChanged?.(); // Call the callback if provided
    } catch (error) {
      console.error('Error removing service:', error);
      setError('Failed to remove service');
    }
  };

  const handleEditService = (service: EnhancedPlanService) => {
    setEditingService(service);
  };

  const handleServiceUpdated = () => {
    setEditingService(null);
    fetchData();
  };

  const getConfigTypeColor = (type?: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket') => {
    switch (type) {
      case 'Fixed': return 'bg-green-100 text-green-800 border-green-200';
      case 'Hourly': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'Usage': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'Bucket': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const planServiceColumns: ColumnDefinition<EnhancedPlanService>[] = [
    {
      title: 'Service Name',
      dataIndex: 'service_name',
      render: (value, record) => {
        // Check for bucket billing period mismatch
        const isBucket = record.configurationType === 'Bucket';
        const bucketConfig = isBucket ? record.typeConfig : null;
        const hasMismatch = isBucket &&
          bucketConfig &&
          contractLineBillingFrequency &&
          bucketConfig.billing_period !== contractLineBillingFrequency;

        return (
          <div className="flex items-center gap-2">
            <span>{value}</span>
            {hasMismatch && (
              <Badge variant="warning" className="text-xs">
                ⚠️ Billing mismatch
              </Badge>
            )}
          </div>
        );
      }
    },
    { title: 'Service Type', dataIndex: 'service_type_name' }, // Changed title and dataIndex
    {
      title: 'Billing Method',
      dataIndex: 'billing_method',
      render: (value) => BILLING_METHOD_OPTIONS.find(opt => opt.value === value)?.label || value || 'N/A',
    },
    {
      title: 'Derived Config Type', // Changed title slightly for clarity
      dataIndex: 'billing_method', // Use billing_method and unit_of_measure from record
      render: (_, record) => { // Use record instead of value
        let derivedType: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket' | undefined; // Allow undefined

        if (record.billing_method === 'fixed') {
          derivedType = 'Fixed';
        } else if (record.billing_method === 'hourly') {
          derivedType = 'Hourly';
        } else if (record.billing_method === 'usage') {
          derivedType = 'Usage';
        }
        // Determine display text, defaulting to 'Default' if derivedType is undefined
        const displayText = derivedType || 'Default';

        return (
          // Pass potentially undefined derivedType to getConfigTypeColor
          <Badge className={`${getConfigTypeColor(derivedType)}`}>
            {displayText}
          </Badge>
        );
      },
    },
    { title: 'Quantity', dataIndex: 'quantity', render: (value) => value ?? 1 }, // Default to 1 if null/undefined
    { title: 'Unit of Measure', dataIndex: 'unit_of_measure' },
    {
      title: 'Custom Rate',
      dataIndex: 'custom_rate',
      render: (value, record) => {
        const rate = value !== undefined ? value : record.default_rate;
        // Display rate directly as decimal
        return rate !== undefined ? `$${parseFloat(rate).toFixed(2)}` : 'N/A';
      },
    },
    {
      title: 'Actions',
      dataIndex: 'service_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`generic-plan-service-actions-${value}`}
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!disableEditing && ( // Conditionally render Configure item
              <DropdownMenuItem
                id={`edit-generic-plan-service-${value}`}
                onClick={() => handleEditService(record)}
              >
                <Settings className="h-4 w-4 mr-2" />
                Configure
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              id={`remove-generic-plan-service-${value}`}
              className="text-red-600 focus:text-red-600"
              onClick={() => handleRemoveService(value)}
            >
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  // Filter available services based on plan type and already added services
  const servicesAvailableToAdd = availableServices.filter(availService => {
    if (availService.is_active === false) {
      return false;
    }

    // Check if service is already added
    const isAlreadyAdded = planServices.some(ps => ps.service_id === availService.service_id);
    if (isAlreadyAdded) {
      return false;
    }

    // Products are only supported on Fixed contract lines in V1.
    if (availService.item_kind === 'product') {
      return planType === 'Fixed';
    }

    // Apply filtering logic based on plan type and the service's own billing_method
    if (planType === 'Hourly') {
      // For Hourly plans, exclude services with 'fixed' billing method directly from the service record
      return availService.billing_method !== 'fixed';
    }
    else if (planType === 'Usage') {
      // For Usage plans, exclude services with 'fixed' billing method
      return availService.billing_method !== 'fixed';
    }
    else if (planType === 'Fixed') {
      // For Fixed plans, only allow services with 'fixed' billing method
      return availService.billing_method === 'fixed';
    }

    // Default: allow service if not already added and no specific filter applies
    return true;
  });

  // Removed category map for rendering add list

  return (
    // Using div instead of Card
    <div>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="text-center py-4">Loading services...</div>
      ) : (
        <>
          <div className="mb-4">
            <DataTable
              id="generic-contract-line-services-table"
              data={planServices}
              columns={planServiceColumns}
              pagination={false}
              // Conditionally disable row click
              onRowClick={!disableEditing ? (row) => handleEditService(row) : undefined}
            />
            {planServices.length === 0 && <p className="text-sm text-muted-foreground mt-2">No services currently associated with this contract line.</p>}
          </div>

          <div className="mt-6 border-t pt-4">
            <h4 className="text-md font-medium mb-2">Add Services to Contract Line</h4>
            {servicesAvailableToAdd.length === 0 ? (
              <p className="text-sm text-muted-foreground">All available services are already associated with this contract line.</p>
            ) : (
              <>
                <div className="mb-3">
                  <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto border rounded p-2">
                    {servicesAvailableToAdd.map(service => {
                      // Use service_type_name directly from the service object (fetched via updated getServices)
                      const serviceTypeName = service.service_type_name || 'N/A'; // No cast needed now that IService includes service_type_name
                      const currencyPrice = getServicePriceInCurrency(service, contractCurrency);
                      const hasCurrencyPrice = currencyPrice !== null;
                      const isSelected = selectedServicesToAdd.includes(service.service_id!);
                      const currencySymbol = getCurrencySymbol(contractCurrency);

                      return (
                        <div
                          key={service.service_id}
                          className={`flex items-center space-x-2 p-2 hover:bg-muted/50 rounded ${!hasCurrencyPrice ? 'bg-amber-50' : ''}`}
                        >
                          <div className="[&>div]:mb-0">
                            <Checkbox
                              id={`add-generic-service-${service.service_id}`}
                              checked={isSelected}
                              onChange={(e) => {
                                if ((e.target as HTMLInputElement).checked) {
                                  setSelectedServicesToAdd([...selectedServicesToAdd, service.service_id!]);
                                } else {
                                  setSelectedServicesToAdd(selectedServicesToAdd.filter(id => id !== service.service_id));
                                  // Clear custom rate when deselecting
                                  if (customRates[service.service_id!]) {
                                    const newRates = { ...customRates };
                                    delete newRates[service.service_id!];
                                    setCustomRates(newRates);
                                  }
                                }
                              }}
                              className="cursor-pointer"
                            />
                          </div>
                          <div className="flex-grow flex flex-col text-sm">
                            <span>{service.service_name}</span>
                            <span className="text-xs text-muted-foreground">
                              Service Type: {serviceTypeName} | Method: {BILLING_METHOD_OPTIONS.find(opt => opt.value === service.billing_method)?.label || service.billing_method}
                              {hasCurrencyPrice ? (
                                <> | Rate: {currencySymbol}{(currencyPrice / 100).toFixed(2)}</>
                              ) : (
                                <> | <span className="text-amber-600">No {contractCurrency} price</span></>
                              )}
                            </span>
                          </div>
                          {/* Show rate input for services without matching currency when selected */}
                          {!hasCurrencyPrice && isSelected && (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">{currencySymbol}</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="Enter rate"
                                value={customRates[service.service_id!] || ''}
                                onChange={(e) => {
                                  const value = e.target.value.replace(/[^0-9.]/g, '');
                                  setCustomRates({ ...customRates, [service.service_id!]: value });
                                }}
                                className="w-20 px-2 py-1 text-xs border rounded"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <Button
                  id="add-generic-plan-services-button"
                  onClick={handleAddService}
                  disabled={selectedServicesToAdd.length === 0}
                  className="w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Selected {selectedServicesToAdd.length > 0 ? `(${selectedServicesToAdd.length})` : ''} Services
                </Button>
              </>
            )}
          </div>
        </>
      )}

      {editingService && (
        <ContractLineServiceForm
          planService={editingService}
          services={availableServices} // Pass all available services for context if needed by form
          // Removed serviceCategories prop
          onClose={() => setEditingService(null)}
          onServiceUpdated={handleServiceUpdated}
        />
      )}
    </div>
  );
};

export default GenericPlanServicesList; // Use default export
