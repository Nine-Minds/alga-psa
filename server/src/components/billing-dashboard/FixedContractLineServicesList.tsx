// server/src/components/billing-dashboard/FixedPlanServicesList.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Input } from 'server/src/components/ui/Input';
import { Plus, MoreVertical, HelpCircle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { Tooltip } from 'server/src/components/ui/Tooltip'; // Corrected Tooltip import
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IContractLine, IContractLineService, IService, IServiceCategory } from 'server/src/interfaces/billing.interfaces';
import { IContractLineServiceConfiguration } from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
import {
  getContractLineServices,
  addServiceToContractLine,
  removeServiceFromContractLine,
  updateContractLineService,
  getContractLineServicesWithConfigurations
} from 'server/src/lib/actions/contractLineServiceActions';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { getServiceCategories } from 'server/src/lib/actions/serviceCategoryActions'; // Added import
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import EditPlanServiceQuantityDialog from './contract-lines/EditContractLineServiceQuantityDialog';
import { getContractLineById } from 'server/src/lib/actions/contractLineAction';
import { getContractById } from 'server/src/lib/actions/contractActions';
import { getCurrencySymbol } from 'server/src/constants/currency';
import { Badge } from 'server/src/components/ui/Badge';
// Removed ContractLineServiceForm import as 'Configure' is removed

// Define billing method options
const BILLING_METHOD_OPTIONS: Array<{ value: 'fixed' | 'hourly' | 'usage' | 'per_unit'; label: string }> = [
  { value: 'fixed', label: 'Fixed Price' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'usage', label: 'Usage Based' },
  { value: 'per_unit', label: 'Per Unit' }
];

interface FixedPlanServicesListProps {
  planId: string; // Changed from plan object to just planId
  onServiceAdded?: () => void; // Callback for when a service is added
}

// Simplified interface for display
interface SimplePlanService extends IContractLineService {
  service_name?: string;
  service_category?: string; // This will now hold the name
  billing_method?: 'fixed' | 'hourly' | 'usage' | 'per_unit' | null; // Allow null and per_unit to match IService
  unit_of_measure?: string;
  default_rate?: number;
  quantity?: number; // Added quantity field
  item_kind?: 'service' | 'product';
  sku?: string | null;
}

// Define the structure returned by getPlanServicesWithConfigurations
type PlanServiceWithConfig = {
  service: IService & { service_type_name?: string };
  configuration: IContractLineServiceConfiguration;
  typeConfig?: any;
};
const FixedPlanServicesList: React.FC<FixedPlanServicesListProps> = ({ planId, onServiceAdded }) => {
  const [planServices, setPlanServices] = useState<SimplePlanService[]>([]);
  const [availableServices, setAvailableServices] = useState<IService[]>([]);
  const [serviceCategories, setServiceCategories] = useState<IServiceCategory[]>([]); // Added state for categories
  const [selectedServicesToAdd, setSelectedServicesToAdd] = useState<string[]>([]);
  const [customRates, setCustomRates] = useState<Record<string, string>>({}); // Per-unit overrides for products missing currency prices
  const [contractCurrency, setContractCurrency] = useState<string>('USD');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState<SimplePlanService | null>(null);
  const [quantityDialogOpen, setQuantityDialogOpen] = useState(false);
  // Removed editingService state

  const fetchData = useCallback(async () => {
    if (!planId) return;

    setIsLoading(true);
    setError(null);

    try {
      // Fetch services with configurations to get service_type_name directly
      const [servicesWithConfigs, servicesResponse, planDetails] = await Promise.all([
        getContractLineServicesWithConfigurations(planId),
        getServices(1, 999, { item_kind: 'any' }),
        getContractLineById(planId)
      ]);
      // Extract the services array from the paginated response
      const allAvailableServices = Array.isArray(servicesResponse)
        ? servicesResponse
        : (servicesResponse.services || []);

      if (planDetails?.contract_id) {
        const contract = await getContractById(planDetails.contract_id);
        if (contract?.currency_code) {
          setContractCurrency(contract.currency_code);
        }
      }
      
      // No need to fetch categories separately as we get service_type_name directly
      
      // Enhance associated services with details for display
      const enhancedServices: SimplePlanService[] = servicesWithConfigs.map((configInfo: PlanServiceWithConfig) => {
        return {
          contract_line_id: planId,
          service_id: configInfo.configuration.service_id,
          tenant: configInfo.configuration.tenant,
          created_at: configInfo.configuration.created_at,
          updated_at: configInfo.configuration.updated_at,
          service_name: configInfo.service.service_name || 'Unknown Service',
          service_category: configInfo.service.service_type_name || 'N/A', // Now using service_type_name from IService
          billing_method: configInfo.service.billing_method,
          default_rate: configInfo.service.default_rate,
          quantity: configInfo.configuration.quantity, // Added quantity from configuration
          custom_rate: configInfo.configuration.custom_rate,
          item_kind: configInfo.service.item_kind,
          sku: configInfo.service.sku
        };
      });

      setPlanServices(enhancedServices);
      setAvailableServices(allAvailableServices);
      setSelectedServicesToAdd([]);
    } catch (error) {
      console.error('Error fetching data:', error);
      setError('Failed to load services data');
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);


  const handleAddService = async () => {
    if (!planId || selectedServicesToAdd.length === 0) return;

    try {
      for (const serviceId of selectedServicesToAdd) {
        const serviceToAdd = availableServices.find(s => s.service_id === serviceId);
        if (serviceToAdd) {
          if (serviceToAdd.item_kind === 'product') {
            const catalogRate = serviceToAdd.prices?.find(p => p.currency_code === contractCurrency)?.rate ?? null;
            if (catalogRate == null) {
              const override = customRates[serviceId];
              const parsed = override != null ? parseFloat(override) : NaN;
              if (!override || !Number.isFinite(parsed)) {
                throw new Error(
                  `Product "${serviceToAdd.service_name}" has no ${contractCurrency} price. Enter a custom rate before adding.`
                );
              }
              const cents = Math.round(parsed * 100);
              await addServiceToContractLine(planId, serviceId, 1, cents);
            } else {
              // Let the billing engine pick up the catalog price for the contract currency.
              await addServiceToContractLine(planId, serviceId, 1);
            }
          } else {
            // Fixed-fee services are billed via the contract line's base rate.
            await addServiceToContractLine(planId, serviceId, 1);
          }
        }
      }
      fetchData();
      setSelectedServicesToAdd([]);
      setCustomRates({});
      
      // Call the onServiceAdded callback if provided
      if (onServiceAdded) {
        onServiceAdded();
      }
    } catch (error) {
      console.error('Error adding services:', error);
      setError('Failed to add services');
    }
  };

  const handleRemoveService = async (serviceId: string) => {
    if (!planId) return;

    try {
      await removeServiceFromContractLine(planId, serviceId);
      fetchData();
      
      // Call the onServiceAdded callback if provided (also useful when removing services)
      if (onServiceAdded) {
        onServiceAdded();
      }
    } catch (error) {
      console.error('Error removing service:', error);
      setError('Failed to remove service');
    }
  };

  // Removed handleEditService and handleServiceUpdated

  // Add row click handler
  const handleRowClick = (record: SimplePlanService) => {
    setSelectedService(record);
    setQuantityDialogOpen(true);
  };

  const handleSaveService = async (
    serviceId: string,
    updates: { quantity: number; unitRateCents?: number | null }
  ) => {
    try {
      await updateContractLineService(planId, serviceId, {
        quantity: updates.quantity,
        customRate: updates.unitRateCents,
      });
      fetchData(); // Refresh the data
    } catch (error) {
      console.error('Error updating quantity:', error);
      throw error; // Let the dialog component handle the error
    }
  };

  const currencySymbol = getCurrencySymbol(contractCurrency);

  const getCatalogUnitPriceCents = (serviceId: string): number | null => {
    const service = availableServices.find((s) => s.service_id === serviceId);
    if (!service?.prices?.length) return null;
    const price = service.prices.find((p) => p.currency_code === contractCurrency);
    return price ? Number(price.rate) : null;
  };

const planServiceColumns: ColumnDefinition<SimplePlanService>[] = [
    {
      title: 'Service Name',
      dataIndex: 'service_name',
      render: (_value, record) => (
        <div className="flex items-center gap-2">
          <span>{record.service_name}</span>
          {record.item_kind === 'product' ? (
            <Badge variant="secondary">Product</Badge>
          ) : (
            <Badge variant="secondary">Service</Badge>
          )}
          {record.item_kind === 'product' && record.sku ? (
            <span className="text-xs text-muted-foreground">{record.sku}</span>
          ) : null}
        </div>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'service_category', // Now displays the name
    },
    {
      title: 'Billing Method',
      dataIndex: 'billing_method',
      render: (value) => BILLING_METHOD_OPTIONS.find(opt => opt.value === value)?.label || value || 'N/A',
    },
    {
      title: 'Quantity',
      dataIndex: 'quantity',
      render: (value) => value ?? 1, // Display quantity, default to 1 if null/undefined
    },
    // Removed UoM, Custom Rate, Config Type columns
    {
      title: ( // Use title prop for the header content
        <Tooltip content={ // Pass tooltip content to the 'content' prop
          <p>Service's standard rate, used for internal value allocation and reporting within the fixed plan total. Not directly editable here.</p>
        }>
          {/* Children are the trigger */}
          <span className="flex items-center cursor-help">
            Default Rate
            <HelpCircle className="h-4 w-4 ml-1 text-muted-foreground" />
          </span>
        </Tooltip>
      ),
      dataIndex: 'default_rate',
      render: (_value, record) => {
        if (record.item_kind === 'product') {
          const overrideCents =
            record.custom_rate !== undefined && record.custom_rate !== null
              ? Number(record.custom_rate)
              : null;
          const catalogCents = getCatalogUnitPriceCents(record.service_id);
          const unitCents = overrideCents ?? catalogCents;
          if (unitCents === null) {
            return <span className="text-amber-700">Missing {contractCurrency} price</span>;
          }
          return `${currencySymbol}${(unitCents / 100).toFixed(2)}`;
        }

        return record.default_rate !== undefined
          ? `$${Number(record.default_rate).toFixed(2)}`
          : 'N/A';
      },
    },
    {
      title: 'Actions',
      dataIndex: 'service_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`fixed-plan-service-actions-${value}`}
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Removed Configure item */}
            <DropdownMenuItem
              id={`edit-quantity-fixed-plan-service-${value}`}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedService(record);
                setQuantityDialogOpen(true);
              }}
            >
              Edit Quantity
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`remove-fixed-plan-service-${value}`}
              className="text-red-600 focus:text-red-600"
              onClick={(e) => {
                e.stopPropagation(); // Prevent row click
                handleRemoveService(value);
              }}
            >
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  // Filter out items already in the plan. For fixed contract lines, allow fixed services and products.
  const servicesAvailableToAdd = availableServices.filter(
    availService =>
      // Check if service is not already added to the plan
      !planServices.some(ps => ps.service_id === availService.service_id) &&
      // Do not offer inactive catalog items for attachment
      availService.is_active !== false &&
      (availService.item_kind === 'product' || availService.billing_method === 'fixed')
  );

  return (
    // Using div instead of Card directly to avoid nested Card issues if used within another Card
    // Removed TooltipProvider wrapper
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
              id="fixed-contract-line-services-table"
              data={planServices}
              columns={planServiceColumns}
              pagination={false} // Assuming pagination isn't needed for typical plan service lists
              onRowClick={handleRowClick} // Add row click handler
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
                            // Use service_type_name directly from the service object
                            const serviceTypeName = service.service_type_name || 'N/A';
                            const isProduct = service.item_kind === 'product';
                            const catalogRateCents =
                              isProduct
                                ? (service.prices?.find(p => p.currency_code === contractCurrency)?.rate ?? null)
                                : null;
                            return (
                                <div
                                key={service.service_id}
                                className="flex items-center space-x-2 p-1 hover:bg-muted/50 rounded"
                                >
                                <div className="[&>div]:mb-0">
                                    <Checkbox
                                        id={`add-service-${service.service_id}`}
                                        checked={selectedServicesToAdd.includes(service.service_id!)}
                                        onChange={(e) => {
                                            if ((e.target as HTMLInputElement).checked) {
                                                setSelectedServicesToAdd([...selectedServicesToAdd, service.service_id!]);
                                            } else {
                                                setSelectedServicesToAdd(selectedServicesToAdd.filter(id => id !== service.service_id));
                                            }
                                        }}
                                        className="cursor-pointer"
                                    />
                                </div>
                                <div className="flex-grow flex flex-col text-sm">
                                    <span className="flex items-center gap-2">
                                      {service.service_name}
                                      {isProduct ? <Badge variant="secondary">Product</Badge> : null}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                    Type: {serviceTypeName} | Method: {BILLING_METHOD_OPTIONS.find(opt => opt.value === service.billing_method)?.label || service.billing_method}
                                    {isProduct ? (
                                      <> | {contractCurrency} price: {catalogRateCents == null ? 'missing' : `${currencySymbol}${(Number(catalogRateCents) / 100).toFixed(2)}`}</>
                                    ) : (
                                      <> | Rate: ${ Number(service.default_rate).toFixed(2)}</>
                                    )}
                                    </span>
                                    {isProduct && catalogRateCents == null && selectedServicesToAdd.includes(service.service_id!) && (
                                      <div className="mt-2 flex items-center gap-2">
                                        <span className="text-xs text-muted-foreground">
                                          Override ({contractCurrency}):
                                        </span>
                                        <div className="relative w-28">
                                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">
                                            {currencySymbol}
                                          </span>
                                          <Input
                                            id={`fixed-add-product-rate-${service.service_id}`}
                                            type="text"
                                            inputMode="decimal"
                                            value={customRates[service.service_id] ?? ''}
                                            onChange={(e) => {
                                              const sanitized = e.target.value.replace(/[^0-9.]/g, '');
                                              const decimalCount = (sanitized.match(/\\./g) || []).length;
                                              if (decimalCount <= 1) {
                                                setCustomRates((prev) => ({ ...prev, [service.service_id!]: sanitized }));
                                              }
                                            }}
                                            className="pl-6 h-8 text-sm"
                                          />
                                        </div>
                                      </div>
                                    )}
                                </div>
                                </div>
                            );
                        })}
                        </div>
                    </div>
                    <Button
                        id="add-fixed-plan-services-button"
                        onClick={handleAddService}
                        disabled={selectedServicesToAdd.length === 0}
                        className="w-full sm:w-auto" // Adjust width
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Selected {selectedServicesToAdd.length > 0 ? `(${selectedServicesToAdd.length})` : ''} Services
                    </Button>
                 </>
             )}
          </div>
        </>
      )}
      {/* Removed ContractLineServiceForm modal */}

      {/* Add the dialog component */}
      {selectedService && (
        <EditPlanServiceQuantityDialog
          isOpen={quantityDialogOpen}
          onOpenChange={setQuantityDialogOpen}
          planId={planId}
          serviceId={selectedService.service_id}
          serviceName={selectedService.service_name || 'Unknown Service'}
          currentQuantity={selectedService.quantity || 1}
          currencySymbol={selectedService.item_kind === 'product' ? currencySymbol : undefined}
          currentUnitRateCents={
            selectedService.item_kind === 'product' ? (selectedService.custom_rate ?? null) : undefined
          }
          onSave={(updates) => handleSaveService(selectedService.service_id, updates)}
        />
      )}
    </div>
    // Removed TooltipProvider wrapper
  );
};

export default FixedPlanServicesList; // Use default export if preferred
