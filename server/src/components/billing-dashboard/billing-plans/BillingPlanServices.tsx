'use client';

import React, { useState, useEffect } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IBillingPlan, IPlanService, IService } from 'server/src/interfaces/billing.interfaces';
import {
  getPlanServices,
  getPlanServicesWithConfigurations
} from 'server/src/lib/actions/planServiceActions';
import {
  addServiceToPlan as addPlanService,
  removeServiceFromPlan as removePlanService
} from 'server/src/lib/actions/planServiceActions';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { useTenant } from 'server/src/components/TenantProvider';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import BillingPlanServiceForm from './BillingPlanServiceForm';
import { Badge } from 'server/src/components/ui/Badge';
import { IPlanServiceConfiguration } from 'server/src/interfaces/planServiceConfiguration.interfaces';

interface BillingPlanServicesProps {
  plan: IBillingPlan;
}

interface EnhancedPlanService extends IPlanService {
  configuration?: IPlanServiceConfiguration;
  configurationType?: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket';
}

const BillingPlanServices: React.FC<BillingPlanServicesProps> = ({ plan }) => {
  const [planServices, setPlanServices] = useState<EnhancedPlanService[]>([]);
  const [availableServices, setAvailableServices] = useState<IService[]>([]);
  const [selectedServicesToAdd, setSelectedServicesToAdd] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingService, setEditingService] = useState<EnhancedPlanService | null>(null);
  const tenant = useTenant()!;

  useEffect(() => {
    if (plan.plan_id) {
      fetchData();
    }
  }, [plan.plan_id]);

  const fetchData = async () => {
    if (!plan.plan_id) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Get services and plan services
      const [services, planServicesData] = await Promise.all([
        getServices(),
        getPlanServices(plan.plan_id)
      ]);
      
      // Get configurations for services
      const servicesWithConfigurations = await getPlanServicesWithConfigurations(plan.plan_id);
      
      // Enhance plan services with configuration data
      const enhancedServices: EnhancedPlanService[] = planServicesData.map(ps => {
        const configInfo = servicesWithConfigurations.find(
          sc => sc.configuration.service_id === ps.service_id
        );
        
        return {
          ...ps,
          configuration: configInfo?.configuration,
          configurationType: configInfo?.configuration.configuration_type
        };
      });
      
      setPlanServices(enhancedServices);
      setAvailableServices(services);
      
      // Initialize with empty selection
      setSelectedServicesToAdd([]);
    } catch (error) {
      console.error('Error fetching data:', error);
      setError('Failed to load services data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddService = async () => {
    if (!plan.plan_id || selectedServicesToAdd.length === 0) return;
    
    try {
      // Add each selected service to the plan
      for (const serviceId of selectedServicesToAdd) {
        const serviceToAdd = availableServices.find(s => s.service_id === serviceId);
        if (serviceToAdd) {
          await addPlanService(
            plan.plan_id,
            serviceId,
            1, // quantity
            serviceToAdd.default_rate // customRate
          );
        }
      }
      
      fetchData(); // Refresh data
      setSelectedServicesToAdd([]); // Clear selection after adding
    } catch (error) {
      console.error('Error adding services:', error);
      setError('Failed to add services');
    }
  };

  const handleRemoveService = async (serviceId: string) => {
    if (!plan.plan_id) return;
    
    try {
      await removePlanService(plan.plan_id, serviceId);
      fetchData(); // Refresh data
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
    fetchData(); // Refresh data
  };

  // Get configuration type badge color
  const getConfigTypeColor = (type?: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket') => {
    switch (type) {
      case 'Fixed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'Hourly':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'Usage':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'Bucket':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const planServiceColumns: ColumnDefinition<EnhancedPlanService>[] = [
    {
      title: 'Service Name',
      dataIndex: 'service_id',
      render: (value, record) => {
        const service = availableServices.find(s => s.service_id === value);
        return service?.service_name || 'Unknown Service';
      },
    },
    {
      title: 'Configuration Type',
      dataIndex: 'configurationType',
      render: (value) => (
        <Badge className={`${getConfigTypeColor(value)}`}>
          {value || 'Fixed'}
        </Badge>
      ),
    },
    {
      title: 'Quantity',
      dataIndex: 'quantity',
      render: (value) => value || 1,
    },
    {
      title: 'Unit of Measure',
      dataIndex: 'service_id',
      render: (value) => {
        const service = availableServices.find(s => s.service_id === value);
        return service?.unit_of_measure || 'Units';
      },
    },
    {
      title: 'Custom Rate',
      dataIndex: 'custom_rate',
      render: (value, record) => {
        const service = availableServices.find(s => s.service_id === record.service_id);
        const rate = value !== undefined ? value : (service?.default_rate || 0);
        return `$${parseFloat(rate).toFixed(2)}`;
      },
    },
    {
      title: 'Actions',
      dataIndex: 'service_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="plan-service-actions-menu"
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
              id="edit-plan-service-menu-item"
              onClick={() => handleEditService(record)}
            >
              <Settings className="h-4 w-4 mr-2" />
              Configure
            </DropdownMenuItem>
            <DropdownMenuItem
              id="remove-plan-service-menu-item"
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

  // Make all services available for selection
  const filteredAvailableServices = availableServices;

  return (
    <Card size="2">
      <Box p="4">
        <h3 className="text-lg font-medium mb-4">Plan Services</h3>
        
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
              />
            </div>
            
            <div className="mt-4">
              <h4 className="text-md font-medium mb-2">Add Services to Plan</h4>
              <div className="mb-3">
                <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto">
                  {filteredAvailableServices.map(service => {
                    const isAlreadyInPlan = planServices.some(ps => ps.service_id === service.service_id);
                    return (
                      <div
                        key={service.service_id}
                        className={`flex items-center space-x-2 p-2 border rounded ${isAlreadyInPlan ? 'bg-gray-50' : ''}`}
                      >
                        <input
                          type="checkbox"
                          id={`service-${service.service_id}`}
                          checked={selectedServicesToAdd.includes(service.service_id!)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedServicesToAdd([...selectedServicesToAdd, service.service_id!]);
                            } else {
                              setSelectedServicesToAdd(selectedServicesToAdd.filter(id => id !== service.service_id));
                            }
                          }}
                        />
                        <label htmlFor={`service-${service.service_id}`} className="flex-grow">
                          {service.service_name}
                          {isAlreadyInPlan && <span className="ml-2 text-xs text-blue-600">(Already in plan)</span>}
                        </label>
                        <span className="text-sm text-gray-500">${parseFloat(service.default_rate.toString()).toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <Button
                id="add-services-button"
                onClick={handleAddService}
                disabled={selectedServicesToAdd.length === 0 || filteredAvailableServices.length === 0}
                className="w-full"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add {selectedServicesToAdd.length} Selected {selectedServicesToAdd.length === 1 ? 'Service' : 'Services'}
              </Button>
            </div>
          </>
        )}
      </Box>
      
      {editingService && (
        <BillingPlanServiceForm
          planService={editingService}
          services={availableServices}
          onClose={() => setEditingService(null)}
          onServiceUpdated={handleServiceUpdated}
        />
      )}
    </Card>
  );
};

export default BillingPlanServices;