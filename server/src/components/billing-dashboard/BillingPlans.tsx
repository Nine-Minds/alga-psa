import React, { useState, useEffect } from 'react';
import { Box, Card, Heading } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { MoreVertical, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { BillingPlanDialog } from './BillingPlanDialog';
import { UnitOfMeasureInput } from './UnitOfMeasureInput';
import { getBillingPlans, getBillingPlanById, updateBillingPlan, deleteBillingPlan } from 'server/src/lib/actions/billingPlanAction';
import { getPlanServices, addServiceToPlan, updatePlanService, removeServiceFromPlan } from 'server/src/lib/actions/planServiceActions';
// Import new action and type
import { getServiceTypesForSelection } from 'server/src/lib/actions/serviceActions';
import { IBillingPlan, IPlanService, IService, IServiceType } from 'server/src/interfaces/billing.interfaces';
import { useTenant } from '../TenantProvider';
import { toast } from 'react-hot-toast';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { PLAN_TYPE_DISPLAY, BILLING_FREQUENCY_DISPLAY } from 'server/src/constants/billing';
import { add } from 'date-fns';

interface BillingPlansProps {
  initialServices: IService[];
}

const BillingPlans: React.FC<BillingPlansProps> = ({ initialServices }) => {
  const router = useRouter();
  const [billingPlans, setBillingPlans] = useState<IBillingPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [planServices, setPlanServices] = useState<IPlanService[]>([]);
  const [selectedServiceToAdd, setSelectedServiceToAdd] = useState<string | null>(null);
  const [availableServices, setAvailableServices] = useState<IService[]>(initialServices);
  const [error, setError] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<IBillingPlan | null>(null);
  // Add state for all service types (standard + tenant-specific)
  const [allServiceTypes, setAllServiceTypes] = useState<{ id: string; name: string; billing_method: 'fixed' | 'per_unit'; is_standard: boolean }[]>([]);
  const tenant = useTenant();

  useEffect(() => {
    fetchBillingPlans();
    fetchAllServiceTypes(); // Fetch service types on mount
  }, []);

  // Effect to fetch all service types
  const fetchAllServiceTypes = async () => {
    try {
      const types = await getServiceTypesForSelection();
      setAllServiceTypes(types);
    } catch (fetchError) {
      console.error('Error fetching service types:', fetchError);
      // Correctly handle unknown error type
      if (fetchError instanceof Error) {
        setError(fetchError.message);
      } else {
        setError('An unknown error occurred while fetching service types');
      }
    }
  };

  useEffect(() => {
    if (selectedPlan) {
      fetchPlanServices(selectedPlan);
    }
  }, [selectedPlan]);

  useEffect(() => {
    const updatedAvailableServices = initialServices.filter(s => !planServices.some(ps => ps.service_id === s.service_id));
    setAvailableServices(updatedAvailableServices);

    if (!selectedServiceToAdd || !updatedAvailableServices.some(s => s.service_id === selectedServiceToAdd)) {
      setSelectedServiceToAdd(updatedAvailableServices[0]?.service_id || null);
    }
  }, [planServices, initialServices, selectedServiceToAdd]);

  const fetchBillingPlans = async () => {
    try {
      const plans = await getBillingPlans();
      setBillingPlans(plans);
      setError(null);
    } catch (error) {
      console.error('Error fetching billing plans:', error);
      setError('Failed to fetch billing plans');
    }
  };

  const fetchPlanServices = async (planId: string) => {
    try {
      const services = await getPlanServices(planId);
      setPlanServices(services);
      setError(null);
    } catch (error) {
      console.error('Error fetching plan services:', error);
      setError('Failed to fetch plan services');
    }
  };

  const handleAddPlanService = async (serviceId: string) => {
    if (!selectedPlan) return;
    try {
      const addedService = initialServices.find(s => s.service_id === serviceId);
      if (addedService) {
        const newPlanService = {
          plan_id: selectedPlan,
          service_id: serviceId,
          quantity: 1,
          custom_rate: addedService.default_rate,
          tenant: tenant!
        };
        await addServiceToPlan(
          selectedPlan,
          serviceId,
          newPlanService.quantity,
          newPlanService.custom_rate
        );
        // setPlanServices(prevServices => [...prevServices, newPlanService]); // Remove optimistic update
        fetchPlanServices(selectedPlan); // Re-fetch the list from the server
        setError(null);
      }
    } catch (error) {
      console.error('Error adding plan service:', error);
      setError('Failed to add plan service');
    }
  };

  const handleUpdatePlanService = async (serviceId: string, quantity: number, customRate: number | undefined) => {
    if (!selectedPlan) return;
    try {
      await updatePlanService(selectedPlan, serviceId, { quantity, customRate });
      fetchPlanServices(selectedPlan);
      setError(null);
    } catch (error) {
      console.error('Error updating plan service:', error);
      setError('Failed to update plan service');
    }
  };

  const handleRemovePlanService = async (serviceId: string) => {
    if (!selectedPlan) return;
    try {
      await removeServiceFromPlan(selectedPlan, serviceId);
      fetchPlanServices(selectedPlan);
      setError(null);
    } catch (error) {
      console.error('Error removing plan service:', error);
      setError('Failed to remove plan service');
    }
  };

  const billingPlanColumns: ColumnDefinition<IBillingPlan>[] = [
    {
      title: 'Plan Name',
      dataIndex: 'plan_name',
    },
    {
      title: 'Billing Frequency',
      dataIndex: 'billing_frequency',
      render: (value) => BILLING_FREQUENCY_DISPLAY[value] || value,
    },
    {
      title: 'Plan Type',
      dataIndex: 'plan_type',
      render: (value) => PLAN_TYPE_DISPLAY[value] || value,
    },
    {
      title: 'Is Custom',
      dataIndex: 'is_custom',
      render: (value) => value ? 'Yes' : 'No',
    },
    {
      title: 'Actions',
      dataIndex: 'plan_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="billing-plan-actions-menu"
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
              id="edit-billing-plan-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setEditingPlan({...record});
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id="delete-billing-plan-menu-item"
              className="text-red-600 focus:text-red-600"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await deleteBillingPlan(record.plan_id!);
                  fetchBillingPlans();
                  toast.success('Billing plan deleted successfully');
                } catch (error) {
                  if (error instanceof Error) {
                    // Display user-friendly error message using toast
                    if (error.message.includes('associated services')) {
                      toast.error('Cannot delete plan that has associated services. Please remove all services from this plan before deleting.');
                    } else if (error.message.includes('in use')) {
                      toast.error('Cannot delete plan that is currently in use by companies.');
                    } else {
                      toast.error(error.message);
                    }
                  } else {
                    toast.error('Failed to delete plan');
                  }
                }
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const planServiceColumns: ColumnDefinition<IPlanService>[] = [
    {
      title: 'Service Name',
      dataIndex: 'service_id',
      render: (value, record) => {
        const service = initialServices.find(s => s.service_id === value);
        return (
          <div className="flex items-center">
            <span>{service?.service_name || ''}</span>
          </div>
        );
      },
    },
    {
      title: 'Quantity',
      dataIndex: 'quantity',
      render: (value, record) => (
        <input
          type="number"
          value={value?.toString() || ''}
          onChange={(e) => handleUpdatePlanService(record.service_id, Number(e.target.value), record.custom_rate)}
          className="w-24 px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      ),
    },
    {
      title: 'Unit of Measure',
      dataIndex: 'service_id',
      render: (value) => {
        const service = initialServices.find(s => s.service_id === value);
        return (
          <UnitOfMeasureInput
            value={service?.unit_of_measure || ''}
            onChange={(value) => {
              if (service) {
                // Update the service's unit of measure in the database
                // This would typically update the service itself, not the plan-service relationship
                console.log('Updating unit of measure for service:', service.service_id, 'to', value);
                // In Phase 2, implement actual service update here
              }
            }}
          />
        );
      },
    },
    {
      title: 'Custom Rate',
      dataIndex: 'custom_rate',
      render: (value, record) => (
        <input
          type="number"
          value={value?.toString() || ''}
          onChange={(e) => {
            const newValue = e.target.value === '' ? undefined : Number(e.target.value);
            handleUpdatePlanService(record.service_id, record.quantity || 0, newValue);
          }}
          className="w-24 px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      ),
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
              id="remove-plan-service-menu-item"
              className="text-red-600 focus:text-red-600"
              onClick={(e) => {
                e.stopPropagation();
                handleRemovePlanService(value);
              }}
            >
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const handleBillingPlanClick = (plan: IBillingPlan) => {
    if (plan.plan_id) {
      setSelectedPlan(plan.plan_id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card size="2">
          <Box p="4">
            <Heading as="h3" size="4" mb="4">Billing Plans</Heading>
            <div className="mb-4">
              <BillingPlanDialog
                onPlanAdded={(newPlanId) => {
                  fetchBillingPlans().then(async () => {
                    if (newPlanId) {
                      setSelectedPlan(newPlanId);
                      
                      // Fetch the newly created plan and navigate to its configuration page
                      try {
                        const newPlan = await getBillingPlanById(newPlanId);
                        if (newPlan) {
                          // Navigate to the appropriate configuration page based on plan type
                          router.push(`/msp/billing?tab=plans&planId=${newPlanId}`);
                        }
                      } catch (error) {
                        console.error('Error fetching new plan for configuration:', error);
                      }
                    }
                  });
                }}
                editingPlan={editingPlan}
                onClose={() => setEditingPlan(null)}
                allServiceTypes={allServiceTypes} // Pass service types down
                triggerButton={
                  <Button id='add-billing-plan-button'>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Plan
                  </Button>
                }
              />
            </div>
            <DataTable
              data={billingPlans.filter(plan => plan.plan_id !== undefined)}
              columns={billingPlanColumns}
              pagination={false}
              onRowClick={handleBillingPlanClick}
            />
          </Box>
        </Card>
        <Card size="2">
          <Box p="4">
            <Heading as="h3" size="4" mb="4">Plan Services</Heading>
            {selectedPlan ? (
              <>
                <div className="flex justify-between items-center mb-4">
                  <h4>Services for {billingPlans.find(p => p.plan_id === selectedPlan)?.plan_name}</h4>
                </div>
                <div className="overflow-x-auto">
                  <DataTable
                    data={planServices}
                    columns={planServiceColumns}
                    pagination={false}
                  />
                </div>
                <div className="flex space-x-2 mt-4">
                  <CustomSelect
                    options={availableServices.map((s): { value: string; label: string } => ({
                      value: s.service_id!,
                      label: s.service_name
                    }))}
                    onValueChange={setSelectedServiceToAdd}
                    value={selectedServiceToAdd || 'unassigned'}
                    placeholder="Select service..."
                  />
                  <Button
                    id='add-button'
                    onClick={() => {
                      if (selectedServiceToAdd && selectedServiceToAdd !== 'unassigned') {
                        handleAddPlanService(selectedServiceToAdd);
                      }
                    }}
                    disabled={!selectedServiceToAdd || selectedServiceToAdd === 'unassigned' || availableServices.length === 0}
                  >
                    Add Service
                  </Button>
                </div>
              </>
            ) : (
              <p>Select a plan to manage its services</p>
            )}
          </Box>
        </Card>
      </div>
    </div>
  );
};

export default BillingPlans;
