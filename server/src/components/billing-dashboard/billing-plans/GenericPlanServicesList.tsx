// server/src/components/billing-dashboard/GenericPlanServicesList.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react'; // Added useCallback
import { Card, Box } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
// Removed CustomSelect import as it wasn't used
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IBillingPlan, IPlanService, IService, IServiceCategory } from 'server/src/interfaces/billing.interfaces'; // Added IServiceCategory
import {
  getPlanServicesWithConfigurations
} from 'server/src/lib/actions/planServiceActions';
import {
  addServiceToPlan as addPlanService,
  removeServiceFromPlan as removePlanService
} from 'server/src/lib/actions/planServiceActions';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { getBillingPlanById } from 'server/src/lib/actions/billingPlanAction'; // Import action to get plan details
import { getServiceCategories } from 'server/src/lib/actions/serviceCategoryActions'; // Added import
// Removed useTenant import as it wasn't used
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import BillingPlanServiceForm from './BillingPlanServiceForm'; // Adjusted path
import { Badge } from 'server/src/components/ui/Badge';
import { IPlanServiceConfiguration } from 'server/src/interfaces/planServiceConfiguration.interfaces';

// Define billing method options
const BILLING_METHOD_OPTIONS: Array<{ value: 'fixed' | 'per_unit'; label: string }> = [
  { value: 'fixed', label: 'Fixed Price' },
  { value: 'per_unit', label: 'Per Unit' }
];

interface GenericPlanServicesListProps {
  planId: string; // Changed from plan object to just planId
}


interface EnhancedPlanService extends IPlanService {
  configuration?: IPlanServiceConfiguration;
  configurationType?: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket';
  // Added fields for display consistency
  service_name?: string;
  service_type_name?: string; // Changed from service_category
  billing_method?: string;
  unit_of_measure?: string;
  default_rate?: number;
}

const GenericPlanServicesList: React.FC<GenericPlanServicesListProps> = ({ planId }) => {
  const [planServices, setPlanServices] = useState<EnhancedPlanService[]>([]);
  const [availableServices, setAvailableServices] = useState<IService[]>([]);
  // Removed serviceCategories state
  const [selectedServicesToAdd, setSelectedServicesToAdd] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingService, setEditingService] = useState<EnhancedPlanService | null>(null);
  const [planType, setPlanType] = useState<IBillingPlan['plan_type'] | null>(null); // State for plan type
  // Removed tenant state

  const fetchData = useCallback(async () => { // Added useCallback
    if (!planId) return;

    setIsLoading(true);
    setError(null);

    try {
      // Fetch plan details, services, and configurations
      const [planDetails, allAvailableServices, servicesWithConfigurations] = await Promise.all([
        getBillingPlanById(planId), // Fetch the plan details
        getServices(),
        getPlanServicesWithConfigurations(planId),
      ]);

      if (!planDetails) {
        throw new Error(`Billing plan with ID ${planId} not found.`);
      }
      setPlanType(planDetails.plan_type); // Store the plan type

      // Enhance services with details and configuration
      const enhancedServices: EnhancedPlanService[] = servicesWithConfigurations.map(configInfo => {
        // Find the corresponding full service details from the getServices() call
        // Note: configInfo.service already contains service_type_name from the updated action
        const fullServiceDetails = allAvailableServices.find(s => s.service_id === configInfo.configuration.service_id);

        return {
          plan_id: planId,
          service_id: configInfo.configuration.service_id,
          quantity: configInfo.configuration.quantity,
          custom_rate: configInfo.configuration.custom_rate,
          tenant: configInfo.configuration.tenant,
          created_at: configInfo.configuration.created_at,
          updated_at: configInfo.configuration.updated_at,
          configuration: configInfo.configuration,
          configurationType: configInfo.configuration.configuration_type,
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
  }, [planId]); // Added planId dependency

  useEffect(() => {
    fetchData();
  }, [fetchData]); // Use fetchData in dependency array


  const handleAddService = async () => {
    if (!planId || selectedServicesToAdd.length === 0) return;

    try {
      for (const serviceId of selectedServicesToAdd) {
        const serviceToAdd = availableServices.find(s => s.service_id === serviceId);
        if (serviceToAdd) {
          await addPlanService(
            planId,
            serviceId,
            1, // Default quantity
            serviceToAdd.default_rate // Default rate
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
    { title: 'Service Name', dataIndex: 'service_name' },
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
        } else if (record.billing_method === 'per_unit') {
          if (record.unit_of_measure?.toLowerCase().includes('hour')) {
            derivedType = 'Hourly';
          } else {
            derivedType = 'Usage';
          }
        }
        // Note: 'Bucket' type might need different logic if applicable

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
            <DropdownMenuItem
              id={`edit-generic-plan-service-${value}`}
              onClick={() => handleEditService(record)}
            >
              <Settings className="h-4 w-4 mr-2" />
              Configure
            </DropdownMenuItem>
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
    // Check if service is already added
    const isAlreadyAdded = planServices.some(ps => ps.service_id === availService.service_id);
    if (isAlreadyAdded) {
      return false;
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

    // TODO: Add filtering logic for other plan types if needed (using availService.billing_method)
    // Example:
    // if (planType === 'Fixed') {
    //   // Only allow services with 'fixed' billing method?
    //   return availService.billing_method === 'fixed';
    // }

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
              data={planServices}
              columns={planServiceColumns}
              pagination={false}
              onRowClick={(row) => handleEditService(row)} // Pass row data directly
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
                      // Use service_type_name directly from the service object (fetched via updated getServices)
                      const serviceTypeName = (service as any).service_type_name || 'N/A'; // Cast needed as IService doesn't have it yet
                      return (
                        <div
                          key={service.service_id}
                          className="flex items-center space-x-2 p-1 hover:bg-muted/50 rounded"
                        >
                          <input
                            type="checkbox"
                            id={`add-generic-service-${service.service_id}`}
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
                          <label htmlFor={`add-generic-service-${service.service_id}`} className="flex-grow cursor-pointer flex flex-col text-sm">
                            <span>{service.service_name}</span>
                            <span className="text-xs text-muted-foreground">
                              Service Type: {serviceTypeName} | Method: {BILLING_METHOD_OPTIONS.find(opt => opt.value === service.billing_method)?.label || service.billing_method} | Rate: ${service.default_rate.toFixed(2)}
                            </span>
                          </label>
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
        <BillingPlanServiceForm
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