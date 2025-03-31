// server/src/components/billing-dashboard/FixedPlanServicesList.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical } from 'lucide-react'; // Removed Settings icon
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IBillingPlan, IPlanService, IService, IServiceCategory } from 'server/src/interfaces/billing.interfaces'; // Added IServiceCategory
import { IPlanServiceConfiguration } from 'server/src/interfaces/planServiceConfiguration.interfaces';
import {
  getPlanServices,
  addServiceToPlan as addPlanService,
  removeServiceFromPlan as removePlanService,
  getPlanServicesWithConfigurations
} from 'server/src/lib/actions/planServiceActions';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { getServiceCategories } from 'server/src/lib/actions/serviceCategoryActions'; // Added import
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
// Removed BillingPlanServiceForm import as 'Configure' is removed

// Define billing method options
const BILLING_METHOD_OPTIONS: Array<{ value: 'fixed' | 'per_unit'; label: string }> = [
  { value: 'fixed', label: 'Fixed Price' },
  { value: 'per_unit', label: 'Per Unit' }
];

interface FixedPlanServicesListProps {
  planId: string; // Changed from plan object to just planId
}

// Simplified interface for display
interface SimplePlanService extends IPlanService {
  service_name?: string;
  service_category?: string; // This will now hold the name
  billing_method?: string;
  default_rate?: number;
}

// Define the structure returned by getPlanServicesWithConfigurations
type PlanServiceWithConfig = {
  service: IService & { service_type_name?: string };
  configuration: IPlanServiceConfiguration;
  typeConfig?: any;
};

const FixedPlanServicesList: React.FC<FixedPlanServicesListProps> = ({ planId }) => {
  const [planServices, setPlanServices] = useState<SimplePlanService[]>([]);
  const [availableServices, setAvailableServices] = useState<IService[]>([]);
  const [serviceCategories, setServiceCategories] = useState<IServiceCategory[]>([]); // Added state for categories
  const [selectedServicesToAdd, setSelectedServicesToAdd] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Removed editingService state

  const fetchData = useCallback(async () => {
    if (!planId) return;

    setIsLoading(true);
    setError(null);

    try {
      // Fetch services with configurations to get service_type_name directly
      const servicesWithConfigs = await getPlanServicesWithConfigurations(planId);
      const allAvailableServices = await getServices();
      
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
          service_category: configInfo.service.service_type_name || 'N/A', // Use service_type_name directly
          billing_method: configInfo.service.billing_method,
          default_rate: configInfo.service.default_rate
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
          // For fixed plans, quantity/custom rate might not be relevant here, default to 1 and default_rate
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
    } catch (error) {
      console.error('Error removing service:', error);
      setError('Failed to remove service');
    }
  };

  // Removed handleEditService and handleServiceUpdated

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
    // Removed Quantity, UoM, Custom Rate, Config Type columns
    {
      title: 'Default Rate', // Show default rate for reference
      dataIndex: 'default_rate',
      render: (value) => value !== undefined ? `$${(value / 100).toFixed(2)}` : 'N/A', // Assuming rate is in cents
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
              id={`remove-fixed-plan-service-${value}`}
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

  // Filter out services already in the plan from the add list
  const servicesAvailableToAdd = availableServices.filter(
    availService => !planServices.some(ps => ps.service_id === availService.service_id)
  );

  return (
    // Using div instead of Card directly to avoid nested Card issues if used within another Card
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
                            // Use service_type_name directly from the service object if available
                            // Cast to any since IService might not have service_type_name yet
                            const serviceTypeName = (service as any).service_type_name || 'N/A';
                            return (
                                <div
                                key={service.service_id}
                                className="flex items-center space-x-2 p-1 hover:bg-muted/50 rounded"
                                >
                                <input
                                    type="checkbox"
                                    id={`add-service-${service.service_id}`}
                                    checked={selectedServicesToAdd.includes(service.service_id!)}
                                    onChange={(e) => {
                                    if (e.target.checked) {
                                        setSelectedServicesToAdd([...selectedServicesToAdd, service.service_id!]);
                                    } else {
                                        setSelectedServicesToAdd(selectedServicesToAdd.filter(id => id !== service.service_id));
                                    }
                                    }}
                                    className="cursor-pointer"
                                />
                                <label htmlFor={`add-service-${service.service_id}`} className="flex-grow cursor-pointer flex flex-col text-sm">
                                    <span>{service.service_name}</span>
                                    <span className="text-xs text-muted-foreground">
                                    Service Type: {serviceTypeName} | Method: {BILLING_METHOD_OPTIONS.find(opt => opt.value === service.billing_method)?.label || service.billing_method} | Rate: ${ (service.default_rate / 100).toFixed(2)}
                                    </span>
                                </label>
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
    </div>
  );
};

export default FixedPlanServicesList; // Use default export if preferred