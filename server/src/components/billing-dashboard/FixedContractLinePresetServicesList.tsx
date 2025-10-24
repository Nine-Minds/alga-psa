// server/src/components/billing-dashboard/FixedContractLinePresetServicesList.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Plus, MoreVertical, HelpCircle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IContractLinePresetService, IService } from 'server/src/interfaces/billing.interfaces';
import {
  getContractLinePresetServices,
  updateContractLinePresetServices
} from 'server/src/lib/actions/contractLinePresetActions';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';

// Define billing method options
const BILLING_METHOD_OPTIONS: Array<{ value: 'fixed' | 'hourly' | 'usage'; label: string }> = [
  { value: 'fixed', label: 'Fixed Price' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'usage', label: 'Usage Based' }
];

interface FixedContractLinePresetServicesListProps {
  planId: string; // This is actually the presetId
  onServiceAdded?: () => void;
}

// Simplified interface for display
interface SimplePresetService {
  preset_id: string;
  service_id: string;
  service_name?: string;
  service_type_name?: string;
  billing_method?: 'fixed' | 'hourly' | 'usage' | null;
  default_rate?: number;
  quantity?: number;
}

const FixedContractLinePresetServicesList: React.FC<FixedContractLinePresetServicesListProps> = ({ planId, onServiceAdded }) => {
  const [presetServices, setPresetServices] = useState<SimplePresetService[]>([]);
  const [availableServices, setAvailableServices] = useState<IService[]>([]);
  const [selectedServicesToAdd, setSelectedServicesToAdd] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!planId) return;

    setIsLoading(true);
    setError(null);

    try {
      // Fetch preset services
      const presetServicesData = await getContractLinePresetServices(planId);

      // Fetch all available services
      const servicesResponse = await getServices();
      const allAvailableServices = Array.isArray(servicesResponse)
        ? servicesResponse
        : (servicesResponse.services || []);

      // Enhance preset services with service details
      const enhancedServices: SimplePresetService[] = presetServicesData.map((presetService) => {
        const serviceDetails = allAvailableServices.find(s => s.service_id === presetService.service_id);
        return {
          preset_id: presetService.preset_id,
          service_id: presetService.service_id,
          service_name: serviceDetails?.service_name || 'Unknown Service',
          service_type_name: serviceDetails?.service_type_name || 'N/A',
          billing_method: serviceDetails?.billing_method,
          default_rate: serviceDetails?.default_rate,
          quantity: presetService.quantity || 1
        };
      });

      setPresetServices(enhancedServices);
      setAvailableServices(allAvailableServices);
      setSelectedServicesToAdd([]);
    } catch (error) {
      console.error('Error fetching preset services data:', error);
      setError('Failed to load services data');
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddServices = async () => {
    if (!planId || selectedServicesToAdd.length === 0) return;

    try {
      // Get current services
      const currentServices = await getContractLinePresetServices(planId);

      // Add new services to the list
      const newServices = selectedServicesToAdd.map(serviceId => ({
        preset_id: planId,
        service_id: serviceId,
        quantity: 1
      }));

      // Combine current and new services
      const allServices = [
        ...currentServices.map(s => ({
          preset_id: s.preset_id,
          service_id: s.service_id,
          quantity: s.quantity || 1
        })),
        ...newServices
      ];

      // Update all services
      await updateContractLinePresetServices(planId, allServices);

      fetchData();
      setSelectedServicesToAdd([]);

      if (onServiceAdded) {
        onServiceAdded();
      }
    } catch (error) {
      console.error('Error adding services to preset:', error);
      setError('Failed to add services');
    }
  };

  const handleRemoveService = async (serviceId: string) => {
    if (!planId) return;

    try {
      // Get current services
      const currentServices = await getContractLinePresetServices(planId);

      // Remove the service
      const updatedServices = currentServices
        .filter(s => s.service_id !== serviceId)
        .map(s => ({
          preset_id: s.preset_id,
          service_id: s.service_id,
          quantity: s.quantity || 1
        }));

      // Update services
      await updateContractLinePresetServices(planId, updatedServices);

      fetchData();

      if (onServiceAdded) {
        onServiceAdded();
      }
    } catch (error) {
      console.error('Error removing service from preset:', error);
      setError('Failed to remove service');
    }
  };

  const presetServiceColumns: ColumnDefinition<SimplePresetService>[] = [
    {
      title: 'Service Name',
      dataIndex: 'service_name',
    },
    {
      title: 'Category',
      dataIndex: 'service_type_name',
    },
    {
      title: 'Billing Method',
      dataIndex: 'billing_method',
      render: (value) => BILLING_METHOD_OPTIONS.find(opt => opt.value === value)?.label || value || 'N/A',
    },
    {
      title: 'Quantity',
      dataIndex: 'quantity',
      render: (value) => value ?? 1,
    },
    {
      title: (
        <Tooltip content={
          <p>Service's standard rate, used for internal value allocation and reporting within the fixed plan total.</p>
        }>
          <span className="flex items-center cursor-help">
            Default Rate
            <HelpCircle className="h-4 w-4 ml-1 text-muted-foreground" />
          </span>
        </Tooltip>
      ),
      dataIndex: 'default_rate',
      render: (value) => value !== undefined ? `$${(Number(value) / 100).toFixed(2)}` : 'N/A',
    },
    {
      title: 'Actions',
      dataIndex: 'service_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`preset-service-actions-${value}`}
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
              id={`remove-preset-service-${value}`}
              className="text-red-600 focus:text-red-600"
              onClick={(e) => {
                e.stopPropagation();
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

  // Filter out services already in the preset from the add list and only include services with 'fixed' billing method
  const servicesAvailableToAdd = availableServices.filter(
    availService =>
      !presetServices.some(ps => ps.service_id === availService.service_id) &&
      availService.billing_method === 'fixed'
  );

  return (
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
              data={presetServices}
              columns={presetServiceColumns}
              pagination={false}
            />
            {presetServices.length === 0 && <p className="text-sm text-muted-foreground mt-2">No services currently associated with this contract line.</p>}
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
                              Service Type: {serviceTypeName} | Method: {BILLING_METHOD_OPTIONS.find(opt => opt.value === service.billing_method)?.label || service.billing_method} | Rate: ${(Number(service.default_rate) / 100).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <Button
                  id="add-preset-services-button"
                  onClick={handleAddServices}
                  disabled={selectedServicesToAdd.length === 0}
                  className="w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Selected Services {selectedServicesToAdd.length > 0 ? `(${selectedServicesToAdd.length})` : ''}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default FixedContractLinePresetServicesList;
