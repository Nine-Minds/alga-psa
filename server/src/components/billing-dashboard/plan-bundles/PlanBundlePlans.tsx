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
import { IPlanBundle, IBundleBillingPlan } from 'server/src/interfaces/planBundle.interfaces';
import { IBillingPlan } from 'server/src/interfaces/billing.interfaces';
import { getBillingPlans } from 'server/src/lib/actions/billingPlanAction';
import {
  getDetailedBundlePlans,
  addPlanToBundle,
  removePlanFromBundle,
  updatePlanInBundle
} from 'server/src/lib/actions/bundleBillingPlanActions';
import { getBundlePlans } from 'server/src/lib/actions/planBundleActions';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { BundlePlanRateDialog } from './BundlePlanRateDialog';

interface PlanBundlePlansProps {
  bundle: IPlanBundle;
}

interface DetailedBundlePlan extends IBundleBillingPlan {
  plan_name: string;
  billing_frequency: string;
  plan_type: string;
  default_rate?: number;
}

const PlanBundlePlans: React.FC<PlanBundlePlansProps> = ({ bundle }) => {
  const [bundlePlans, setBundlePlans] = useState<DetailedBundlePlan[]>([]);
  const [availablePlans, setAvailablePlans] = useState<IBillingPlan[]>([]);
  const [selectedPlanToAdd, setSelectedPlanToAdd] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<DetailedBundlePlan | null>(null);

  useEffect(() => {
    if (bundle.bundle_id) {
      fetchData();
    }
  }, [bundle.bundle_id]);

  const fetchData = async () => {
    if (!bundle.bundle_id) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Get all billing plans and bundle plans
      const [plans, detailedBundlePlans] = await Promise.all([
        getBillingPlans(),
        getDetailedBundlePlans(bundle.bundle_id)
      ]);
      
      setBundlePlans(detailedBundlePlans);
      setAvailablePlans(plans);
      
      // Set default selected plan if available
      const filteredPlans = plans.filter(
        p => !detailedBundlePlans.some(bp => bp.plan_id === p.plan_id)
      );
      
      if (filteredPlans.length > 0) {
        setSelectedPlanToAdd(filteredPlans[0].plan_id || null);
      } else {
        setSelectedPlanToAdd(null);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setError('Failed to load plans data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddPlan = async () => {
    if (!bundle.bundle_id || !selectedPlanToAdd) return;
    
    try {
      const planToAdd = availablePlans.find(p => p.plan_id === selectedPlanToAdd);
      if (planToAdd) {
        // Pass undefined initially, indicating no custom rate is set
        const initialCustomRate = undefined;
        await addPlanToBundle(
          bundle.bundle_id,
          selectedPlanToAdd,
          initialCustomRate // Pass undefined
        );
        
        fetchData(); // Refresh data
      }
    } catch (error) {
      console.error('Error adding plan to bundle:', error);
      setError('Failed to add plan to bundle');
    }
  };

  const handleRemovePlan = async (planId: string) => {
    if (!bundle.bundle_id) return;
    
    try {
      await removePlanFromBundle(bundle.bundle_id, planId);
      fetchData(); // Refresh data
    } catch (error) {
      console.error('Error removing plan from bundle:', error);
      if (error instanceof Error) {
        setError(error.message); // Preserve specific error message
      } else {
        setError('Failed to remove plan from bundle');
      }
    }
  };

  const handleEditPlan = (plan: DetailedBundlePlan) => {
    setEditingPlan(plan);
  };

  const handlePlanUpdated = async (planId: string, customRate: number | undefined) => { // Allow undefined
    if (!bundle.bundle_id) return;

    try {
      // Pass the potentially undefined customRate to the action
      await updatePlanInBundle(bundle.bundle_id, planId, { custom_rate: customRate });
      fetchData(); // Refresh data
      setEditingPlan(null);
    } catch (error) {
      console.error('Error updating plan in bundle:', error);
      setError('Failed to update plan in bundle');
    }
  };

  const bundlePlanColumns: ColumnDefinition<DetailedBundlePlan>[] = [
    {
      title: 'Plan Name',
      dataIndex: 'plan_name',
    },
    {
      title: 'Plan Type',
      dataIndex: 'plan_type',
    },
    {
      title: 'Billing Frequency',
      dataIndex: 'billing_frequency',
    },
    {
      title: 'Default Rate',
      dataIndex: 'default_rate',
      render: (value) => value !== undefined ? `$${parseFloat(value.toString()).toFixed(2)}` : 'N/A',
    },
    {
      title: 'Custom Rate',
      dataIndex: 'custom_rate',
      // Check for both null and undefined before formatting
      render: (value) => (value !== undefined && value !== null) ? `$${parseFloat(value.toString()).toFixed(2)}` : 'Same as default',
    },
    {
      title: 'Actions',
      dataIndex: 'plan_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="bundle-plan-actions-menu"
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
              id="edit-bundle-plan-rate-menu-item"
              onClick={() => handleEditPlan(record)}
            >
              <Settings className="h-4 w-4 mr-2" />
              Set Custom Rate
            </DropdownMenuItem>
            <DropdownMenuItem
              id="remove-bundle-plan-menu-item"
              className="text-red-600 focus:text-red-600"
              onClick={(e) => { e.stopPropagation(); handleRemovePlan(value); }}
            >
              Remove from Bundle
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  // Filter available plans to only show those not already in the bundle
  const filteredAvailablePlans = availablePlans.filter(
    plan => !bundlePlans.some(bp => bp.plan_id === plan.plan_id)
  );

  return (
    <Card size="2">
      <Box p="4">
        <h3 className="text-lg font-medium mb-4">Bundle Plans</h3>
        
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {isLoading ? (
          <div className="text-center py-4">Loading plans...</div>
        ) : (
          <>
            <div className="mb-4">
              {bundlePlans.length === 0 ? (
                <div className="text-center py-4 text-gray-500">
                  No plans have been added to this bundle yet.
                </div>
              ) : (
                <DataTable
                  data={bundlePlans}
                  columns={bundlePlanColumns}
                  pagination={false}
                  onRowClick={handleEditPlan}
                  rowClassName={() => 'cursor-pointer'}
                />
              )}
            </div>
            
            <div className="flex space-x-2 mt-4">
              <CustomSelect
                options={filteredAvailablePlans.map(p => ({
                  value: p.plan_id!,
                  label: p.plan_name
                }))}
                onValueChange={setSelectedPlanToAdd}
                value={selectedPlanToAdd || ''}
                placeholder="Select plan..."
                className="flex-grow"
              />
              <Button
                id="add-plan-to-bundle-button"
                onClick={handleAddPlan}
                disabled={!selectedPlanToAdd || filteredAvailablePlans.length === 0}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Plan to Bundle
              </Button>
            </div>
          </>
        )}
      </Box>
      
      {editingPlan && (
        <BundlePlanRateDialog
          plan={editingPlan}
          onClose={() => setEditingPlan(null)}
          // Type assertion needed here as onSave now accepts number | undefined
          onSave={(customRate: number | undefined) => handlePlanUpdated(editingPlan.plan_id, customRate)}
        />
      )}
    </Card>
  );
};

export default PlanBundlePlans;