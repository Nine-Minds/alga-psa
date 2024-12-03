import React, { useState, useEffect } from 'react';
import { Box, Card, Heading } from '@radix-ui/themes';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import CustomSelect from '@/components/ui/CustomSelect';
import { QuickAddBillingPlan } from './QuickAddBillingPlan';
import { UnitOfMeasureInput } from './UnitOfMeasureInput';
import { getBillingPlans } from '@/lib/actions/billingPlanAction';
import { getPlanServices, addPlanService, updatePlanService, removePlanService } from '@/lib/actions/planServiceActions';
import { IBillingPlan, IPlanService, IService } from '@/interfaces/billing.interfaces';
import { useTenant } from '../TenantProvider';
import { DataTable } from '@/components/ui/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';

interface BillingPlansProps {
  initialServices: IService[];
}

const BillingPlans: React.FC<BillingPlansProps> = ({ initialServices }) => {
  const [billingPlans, setBillingPlans] = useState<IBillingPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [planServices, setPlanServices] = useState<IPlanService[]>([]);
  const [selectedServiceToAdd, setSelectedServiceToAdd] = useState<string | null>(null);
  const [availableServices, setAvailableServices] = useState<IService[]>(initialServices);
  const [error, setError] = useState<string | null>(null);
  const tenant = useTenant();

  useEffect(() => {
    fetchBillingPlans();
  }, []);

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
        await addPlanService(newPlanService);
        setPlanServices(prevServices => [...prevServices, newPlanService]);
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
      await updatePlanService(selectedPlan, serviceId, { quantity, custom_rate: customRate });
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
      await removePlanService(selectedPlan, serviceId);
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
    },
    {
      title: 'Is Custom',
      dataIndex: 'is_custom',
      render: (value) => value ? 'Yes' : 'No',
    },
  ];

  const planServiceColumns: ColumnDefinition<IPlanService>[] = [
    {
      title: 'Service Name',
      dataIndex: 'service_id',
      render: (value, record) => {
        const service = initialServices.find(s => s.service_id === value);
        return service?.service_name || '';
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
              console.log('Updating unit of measure:', value);
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
      render: (value) => (
        <Button onClick={() => handleRemovePlanService(value)}>Remove</Button>
      ),
    },
  ];

  const handleBillingPlanClick = (plan: IBillingPlan) => {
    if (plan.plan_id) {
      setSelectedPlan(plan.plan_id);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card size="2">
        <Box p="4">
          <Heading as="h3" size="4" mb="4">Billing Plans</Heading>
          <QuickAddBillingPlan onPlanAdded={fetchBillingPlans} />
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
              <h4>Services for {billingPlans.find(p => p.plan_id === selectedPlan)?.plan_name}</h4>
              <DataTable
                data={planServices}
                columns={planServiceColumns}
                pagination={false}
              />
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
  );
};

export default BillingPlans;
