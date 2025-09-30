'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Card, Heading } from '@radix-ui/themes';
import { toast } from 'react-hot-toast'; // Import toast
import { Button } from 'server/src/components/ui/Button';
import { MoreVertical, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { BillingPlanDialog } from '../BillingPlanDialog';
import { getBillingPlans, deleteBillingPlan } from 'server/src/lib/actions/billingPlanAction';
import { IBillingPlan, IServiceType } from 'server/src/interfaces/billing.interfaces'; // Added IServiceType
import { getServiceTypesForSelection } from 'server/src/lib/actions/serviceActions'; // Added import for fetching types
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { PLAN_TYPE_DISPLAY, BILLING_FREQUENCY_DISPLAY } from 'server/src/constants/billing';

const BillingPlansOverview: React.FC = () => {
  const [billingPlans, setBillingPlans] = useState<IBillingPlan[]>([]);
  const [editingPlan, setEditingPlan] = useState<IBillingPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allServiceTypes, setAllServiceTypes] = useState<{ id: string; name: string; billing_method: 'fixed' | 'per_unit'; is_standard: boolean }[]>([]); // Added state for service types
  const router = useRouter();

  useEffect(() => {
    fetchBillingPlans();
    fetchAllServiceTypes(); // Fetch service types on mount
  }, []);

  const fetchBillingPlans = async () => {
    try {
      const plans = await getBillingPlans();
      setBillingPlans(plans);
      setError(null);
    } catch (error) {
      console.error('Error fetching contract lines:', error);
      setError('Failed to fetch contract lines');
    }
  };

  // Function to fetch all service types
  const fetchAllServiceTypes = async () => {
    try {
      const types = await getServiceTypesForSelection();
      setAllServiceTypes(types);
    } catch (error) {
      console.error('Error fetching service types:', error);
      // Optionally set an error state specific to service types
    }
  };

  const handleDeletePlan = async (planId: string) => {
    try {
      await deleteBillingPlan(planId);
      fetchBillingPlans();
    } catch (error) {
      console.error('Error deleting contract line:', error); // Keep console log for debugging
      if (error instanceof Error) {
        // Check for the specific error message for plans assigned to companies
        if (error.message === "Cannot delete billing plan: It is currently assigned to one or more companies.") {
            toast.error("Cannot delete contract line: It is currently assigned to one or more companies.");
        // Check for the specific error message for plans with associated services (from pre-check)
        } else if (error.message.includes('associated services')) {
          toast.error(error.message); // Use the exact message from the action
        } else {
          // Display other specific error messages directly
          toast.error(error.message);
        }
      } else {
        // Fallback for non-Error objects
        toast.error('An unexpected error occurred while deleting the contract line.');
      }
    }
  };

  const billingPlanColumns: ColumnDefinition<IBillingPlan>[] = [
    {
      title: 'Contract Line Name',
      dataIndex: 'plan_name',
    },
    {
      title: 'Billing Frequency',
      dataIndex: 'billing_frequency',
      render: (value) => BILLING_FREQUENCY_DISPLAY[value] || value,
    },
    {
      title: 'Contract Line Type',
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
              id="contract-line-actions-menu"
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
              id="edit-contract-line-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                if (record.plan_id) {
                  router.push(`/msp/billing?tab=contract-lines&planId=${record.plan_id}`);
                }
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id="delete-contract-line-menu-item"
              className="text-red-600 focus:text-red-600"
              onClick={async (e) => {
                e.stopPropagation();
                if (record.plan_id) {
                  handleDeletePlan(record.plan_id);
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

  const handleBillingPlanClick = (plan: IBillingPlan) => {
    if (plan.plan_id) {
      router.push(`/msp/billing?tab=contract-lines&planId=${plan.plan_id}`);
    }
  };

  return (
    <Card size="2">
      <Box p="4">
        <div className="flex justify-between items-center mb-4">
          <Heading as="h3" size="4">Contract Lines</Heading>
          <BillingPlanDialog
            onPlanAdded={(newPlanId) => {
              if (newPlanId) {
                // Navigate directly. PlanTypeRouter will fetch the plan details.
                router.push(`/msp/billing?tab=contract-lines&planId=${newPlanId}`);
              }
            }}
            editingPlan={editingPlan}
            onClose={() => setEditingPlan(null)}
            triggerButton={
              <Button id='add-contract-line-button'>
                <Plus className="h-4 w-4 mr-2" />
                Add Contract Line
              </Button>
            }
            allServiceTypes={allServiceTypes} // Pass the fetched service types
          />
        </div>
        
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        
        <DataTable
          data={billingPlans.filter(plan => plan.plan_id !== undefined)}
          columns={billingPlanColumns}
          pagination={true}
          onRowClick={handleBillingPlanClick}
          rowClassName={() => "cursor-pointer"}
        />
      </Box>
    </Card>
  );
};

export default BillingPlansOverview;