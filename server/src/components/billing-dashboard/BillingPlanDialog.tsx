// server/src/components/billing-dashboard/BillingPlanDialog.tsx
'use client'

import React, { useState, useEffect } from 'react';
import CustomSelect, { SelectOption } from '../ui/CustomSelect';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '../ui/Button';

type PlanType = 'Fixed' | 'Bucket' | 'Hourly' | 'Usage';
import { createBillingPlan, updateBillingPlan } from 'server/src/lib/actions/billingPlanAction';
import { IBillingPlan } from 'server/src/interfaces/billing.interfaces';
import { useTenant } from '../TenantProvider';
import { PLAN_TYPE_OPTIONS, BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';

interface BillingPlanDialogProps {
  onPlanAdded: () => void;
  editingPlan?: IBillingPlan | null;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
}

export function BillingPlanDialog({ onPlanAdded, editingPlan, onClose, triggerButton }: BillingPlanDialogProps) {
  const [open, setOpen] = useState(false);
  const [planName, setPlanName] = useState(editingPlan?.plan_name || '');
  const [billingFrequency, setBillingFrequency] = useState(editingPlan?.billing_frequency || '');
  const [planType, setPlanType] = useState<PlanType>(editingPlan?.plan_type as PlanType || 'Fixed');
  const [isCustom, setIsCustom] = useState(editingPlan?.is_custom || false);
  const tenant = useTenant()!;

  // Update form when editingPlan changes
  useEffect(() => {
    if (editingPlan) {
      setPlanName(editingPlan.plan_name);
      setBillingFrequency(editingPlan.billing_frequency);
      setPlanType(editingPlan.plan_type as PlanType);
      setIsCustom(editingPlan.is_custom);
      setOpen(true);
    }
  }, [editingPlan]);

  const isPlanType = (value: string): value is PlanType => {
    return ['Fixed', 'Bucket', 'Hourly', 'Usage'].includes(value);
  };

  const handlePlanTypeChange = (value: string) => {
    if (isPlanType(value)) {
      setPlanType(value);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const planData = {
        plan_name: planName,
        billing_frequency: billingFrequency,
        is_custom: isCustom,
        plan_type: planType,
        tenant: tenant
      };

      if (editingPlan?.plan_id) {
        await updateBillingPlan(editingPlan.plan_id, planData);
      } else {
        await createBillingPlan(planData);
      }

      // Clear form fields and close dialog
      setPlanName('');
      setBillingFrequency('');
      setPlanType('Fixed');
      setIsCustom(false);
      setOpen(false);
      onPlanAdded();
      if (onClose) {
        onClose();
      }
    } catch (error) {
      console.error('Error saving billing plan:', error);
      // Handle error (e.g., show error message to user)
    }
  };

  const handleClose = () => {
    // Reset form state when closing
    setPlanName('');
    setBillingFrequency('');
      setPlanType('Fixed');
    setIsCustom(false);
    setOpen(false);
    if (onClose) {
      onClose();
    }
  };

  return (
    <Dialog.Root 
      open={open || !!editingPlan} 
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          handleClose();
        } else if (editingPlan) {
          setPlanName(editingPlan.plan_name);
          setBillingFrequency(editingPlan.billing_frequency);
          setPlanType(editingPlan.plan_type as PlanType);
          setIsCustom(editingPlan.is_custom);
        }
        setOpen(isOpen);
      }}
    >
      {triggerButton && (
        <Dialog.Trigger asChild>
          {triggerButton}
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-96">
          <Dialog.Title className="text-lg font-medium text-gray-900 mb-4">
            {editingPlan ? 'Edit Billing Plan' : 'Add New Billing Plan'}
          </Dialog.Title>
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block mb-2 text-sm font-medium text-gray-700">Plan Name</label>
              <input
                type="text"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                placeholder="Enter plan name"
                className="w-full p-2 border rounded hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                required
              />
            </div>
            <div className="mb-4">
              <label className="block mb-2 text-sm font-medium text-gray-700">Billing Frequency</label>
              <CustomSelect
                options={BILLING_FREQUENCY_OPTIONS}
                onValueChange={setBillingFrequency}
                value={billingFrequency}
                placeholder="Select billing frequency"
                className="w-full"
                required
              />
            </div>
            <div className="mb-4">
              <label className="block mb-2 text-sm font-medium text-gray-700">Plan Type</label>
              <CustomSelect
                options={PLAN_TYPE_OPTIONS}
                onValueChange={handlePlanTypeChange}
                value={planType}
                placeholder="Select plan type"
                className="w-full"
              />
            </div>
            <label className="flex items-center mb-4 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={isCustom}
                onChange={(e) => setIsCustom(e.target.checked)}
                className="mr-2 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              Is Custom Plan
            </label>
            <div className="flex justify-end gap-2 mt-4">
              <Button 
                id="cancel-billing-plan-button"
                type="button" 
                variant="outline" 
                onClick={handleClose}
                className="bg-white hover:bg-gray-50"
              >
                Cancel
              </Button>
              <Button id='save-billing-plan-button' type="submit">
                {editingPlan ? 'Update Plan' : 'Save Plan'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
