// server/src/components/billing-dashboard/FixedPlanServicesList.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Checkbox } from 'server/src/components/ui/Checkbox';
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
import { IBillingPlan, IPlanService, IService, IServiceCategory } from 'server/src/interfaces/billing.interfaces'; // Added IServiceCategory
import { IPlanServiceConfiguration } from 'server/src/interfaces/planServiceConfiguration.interfaces';
import {
  getPlanServices,
  addServiceToPlan as addPlanService,
  removeServiceFromPlan as removePlanService,
  updatePlanService, // Added updatePlanService
  getPlanServicesWithConfigurations
} from 'server/src/lib/actions/planServiceActions';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { getServiceCategories } from 'server/src/lib/actions/serviceCategoryActions'; // Added import
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { EditPlanServiceQuantityDialog } from './EditPlanServiceQuantityDialog'; // Added dialog import
// Removed BillingPlanServiceForm import as 'Configure' is removed

// Define billing method options
const BILLING_METHOD_OPTIONS: Array<{ value: 'fixed' | 'per_unit'; label: string }> = [
  { value: 'fixed', label: 'Fixed Price' },
  { value: 'per_unit', label: 'Per Unit' }
];

interface FixedPlanServicesListProps {
  planId: string; // Changed from plan object to just planId
  onServiceAdded?: () => void; // Callback for when a service is added
}

// Simplified interface for display
interface SimplePlanService extends IPlanService {
  service_name?: string;
  service_category?: string; // This will now hold the name
  billing_method?: 'fixed' | 'per_unit' | null; // Allow null to match IService
  default_rate?: number;
  quantity?: number; // Added quantity field
}

// Define the structure returned by getPlanServicesWithConfigurations
type PlanServiceWithConfig = {
  service: IService & { service_type_name?: string };
  configuration: IPlanServiceConfiguration;
  typeConfig?: any;
};
const FixedPlanServicesList: React.FC<FixedPlanServicesListProps> = ({ planId, onServiceAdded }) => {
  const [planServices, setPlanServices] = useState<SimplePlanService[]>([]);
  const [availableServices, setAvailableServices] = useState<IService[]>([]);
  const [serviceCategories, setServiceCategories] = useState<IServiceCategory[]>([]); // Added state for categories
  const [selectedServicesToAdd, setSelectedServicesToAdd] = useState<string[]>([]);
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
      const servicesWithConfigs = await getPlanServicesWithConfigurations(planId);
      const servicesResponse = await getServices();
      // Extract the services array from the paginated response
      const allAvailableServices = Array.isArray(servicesResponse)
        ? servicesResponse
        : (servicesResponse.services || []);
      
      // No need to fetch categories separately as we get service_type_name directly
      
      // Enhance associated services with details for display
      const enhancedServices: SimplePlanService[] = servicesWithConfigs.map((configInfo: PlanServiceWithConfig) => {
        return {
          plan_id: planId,
          service_id: configInfo.configuration.service_id,
          tenant: configInfo.configuration.tenant,
          created_at: configInfo.configuration.created_at,
          updated_at: configInfo.configuration.updated_at,
          service_name: configInfo.service.service_name || 'Unknown Service',
          service_category: configInfo.service.service_type_name || 'N/A', // Now using service_type_name from IService
          billing_method: configInfo.service.billing_method,
          default_rate: configInfo.service.default_rate,
          quantity: configInfo.configuration.quantity // Added quantity from configuration
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
          // For fixed plans, all services share the same base rate configured at the plan level
          // Here we just add the service with default values
          await addPlanService(
            planId,
            serviceId,
            1,
            serviceToAdd.default_rate
          );
        }
      }
      fetchData();
      setSelectedServicesToAdd([]);
      
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
      await removePlanService(planId, serviceId);
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

  // Add handler for saving quantity
  const handleSaveQuantity = async (planId: string, serviceId: string, newQuantity: number) => {
    try {
      await updatePlanService(planId, serviceId, { quantity: newQuantity });
      fetchData(); // Refresh the data
    } catch (error) {
      console.error('Error updating quantity:', error);
      throw error; // Let the dialog component handle the error
    }
  };

  const planServiceColumns: ColumnDefinition<SimplePlanService>[] = [
    {
      title: 'Service Name',
      dataIndex: 'service_name',
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
      render: (value) => value !== undefined ? `$${Number(value).toFixed(2)}` : 'N/A', // Display rate directly as dollars
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

  // Filter out services already in the plan from the add list and only include services with 'fixed' billing method
  const servicesAvailableToAdd = availableServices.filter(
    availService =>
      // Check if service is not already added to the plan
      !planServices.some(ps => ps.service_id === availService.service_id) &&
      // Only include services with 'fixed' billing method for Fixed plans
      availService.billing_method === 'fixed'
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
              data={planServices}
              columns={planServiceColumns}
              pagination={false} // Assuming pagination isn't needed for typical plan service lists
              onRowClick={handleRowClick} // Add row click handler
            />
             {planServices.length === 0 && <p className="text-sm text-muted-foreground mt-2">No services currently associated with this plan.</p>}
          </div>

          <div className="mt-6 border-t pt-4">
            <h4 className="text-md font-medium mb-2">Add Services to Plan</h4>
             {servicesAvailableToAdd.length === 0 ? (
                 <p className="text-sm text-muted-foreground">All available services are already associated with this plan.</p>
             ) : (
                 <>
                    <div className="mb-3">
                        <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto border rounded p-2">
                        {servicesAvailableToAdd.map(service => {
                            // Use service_type_name directly from the service object
                            const serviceTypeName = service.service_type_name || 'N/A';
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
                                    <span>{service.service_name}</span>
                                    <span className="text-xs text-muted-foreground">
                                    Service Type: {serviceTypeName} | Method: {BILLING_METHOD_OPTIONS.find(opt => opt.value === service.billing_method)?.label || service.billing_method} | Rate: ${ Number(service.default_rate).toFixed(2)}
                                    </span>
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
      {/* Removed BillingPlanServiceForm modal */}

      {/* Add the dialog component */}
      {selectedService && (
        <EditPlanServiceQuantityDialog
          isOpen={quantityDialogOpen}
          onOpenChange={setQuantityDialogOpen}
          planId={planId}
          serviceId={selectedService.service_id}
          serviceName={selectedService.service_name || 'Unknown Service'}
          currentQuantity={selectedService.quantity || 1}
          onSave={handleSaveQuantity}
        />
      )}
    </div>
    // Removed TooltipProvider wrapper
  );
};

export default FixedPlanServicesList; // Use default export if preferred
