// server/src/components/billing-dashboard/BillingPlanDialog.tsx (Simplified)
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import CustomSelect from '../ui/CustomSelect';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '../ui/Button';
// Removed Tabs imports
import { Label } from '../ui/Label';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';

import { createBillingPlan, updateBillingPlan } from 'server/src/lib/actions/billingPlanAction';
// Removed bucketPlanAction imports
import { IBillingPlan, IServiceType } from 'server/src/interfaces/billing.interfaces'; // Removed IBucketPlan, IService
// Removed planServiceActions imports
import { useTenant } from '../TenantProvider';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing'; // Removed PLAN_TYPE_OPTIONS
// Removed getServices, getPlanServices imports
// Removed OverlapWarningDialog import
import { PlanTypeSelector, PlanType } from './billing-plans/PlanTypeSelector'; // Import PlanTypeSelector again
// Removed ConfigPanel imports

interface BillingPlanDialogProps {
  onPlanAdded: (newPlanId?: string) => void; // Modified to pass new plan ID
  editingPlan?: IBillingPlan | null;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
  allServiceTypes: (IServiceType & { is_standard?: boolean })[]; // Kept for potential future use, though not used in simplified version
}

export function BillingPlanDialog({ onPlanAdded, editingPlan, onClose, triggerButton }: BillingPlanDialogProps) {
  const [open, setOpen] = useState(false);
  const [planName, setPlanName] = useState('');
  const [billingFrequency, setBillingFrequency] = useState('');
  const [planType, setPlanType] = useState<PlanType>('Fixed');
  const [isCustom, setIsCustom] = useState(false);
  const tenant = useTenant()!;
  // Removed activeTab state
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [showValidationSummary, setShowValidationSummary] = useState(false);
  const [isSaving, setIsSaving] = useState(false); // Added saving state

  // Removed all plan type specific state variables (baseRate, hourlyRate, totalHours, etc.)
  // Removed service selection state (selectedServices, availableServices, isLoading)
  // Removed overlap check state (showOverlapWarning, overlappingServices, pendingPlanData)

  // Update form when editingPlan changes or dialog opens
  useEffect(() => {
    if (open) {
        if (editingPlan) {
            setPlanName(editingPlan.plan_name);
            setBillingFrequency(editingPlan.billing_frequency);
            setPlanType(editingPlan.plan_type as PlanType);
            setIsCustom(editingPlan.is_custom);
            // No need to load specific config here anymore
        } else {
            // Reset form for new plan when dialog opens without editingPlan
            resetForm();
        }
    }
  }, [editingPlan, open]);


  // Simplified validation
  const validateForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!planName.trim()) errors.planName = 'Plan name is required';
    if (!billingFrequency) errors.billingFrequency = 'Billing frequency is required';
    // No type-specific validation needed here
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowValidationSummary(false); // Reset validation summary display

    const errors = validateForm();
    setValidationErrors(errors);

    if (Object.keys(errors).length > 0) {
      setShowValidationSummary(true);
      return;
    }

    // No overlap check needed here
    await savePlan();
  };

  // Simplified savePlan
  const savePlan = async () => {
    setIsSaving(true); // Set saving state
    setValidationErrors({}); // Clear previous errors

    try {
      const planData: Partial<IBillingPlan> = { // Use Partial for update
        plan_name: planName,
        billing_frequency: billingFrequency,
        is_custom: isCustom,
        plan_type: planType,
        tenant: tenant // Ensure tenant is included if required by backend actions
      };

      let savedPlanId: string | undefined;

      if (editingPlan?.plan_id) {
        // Ensure plan_id is not in the update payload if backend prohibits it
        const { plan_id, ...updateData } = planData;
        const updatedPlan = await updateBillingPlan(editingPlan.plan_id, updateData);
        savedPlanId = updatedPlan.plan_id;
      } else {
        // Ensure createBillingPlan expects Omit<IBillingPlan, 'plan_id'> or similar
        const { plan_id, ...createData } = planData;
        const newPlan = await createBillingPlan(createData as Omit<IBillingPlan, 'plan_id'>); // Cast might be needed depending on exact types
        savedPlanId = newPlan.plan_id;
      }

      // No need to save specific config or add services here

      resetForm();
      onPlanAdded(savedPlanId); // Pass the ID back
    } catch (error) {
      console.error('Error saving billing plan:', error);
      setValidationErrors({
        general: `Failed to save billing plan: ${error instanceof Error ? error.message : String(error)}`
      });
      setShowValidationSummary(true);
    } finally {
        setIsSaving(false); // Reset saving state
    }
  };

  const resetForm = () => {
    setPlanName('');
    setBillingFrequency('');
    setPlanType('Fixed');
    setIsCustom(false);
    setValidationErrors({});
    setShowValidationSummary(false);
    // No other state to reset
  };

  const handleClose = () => {
    // Don't reset form here if editing, only on successful save or explicit cancel/close without save
    if (!editingPlan) {
        resetForm();
    }
    setOpen(false);
    if (onClose) onClose();
  };

  // Removed handleOverlapConfirm and handleOverlapCancel

  return (<>
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {triggerButton && (
        <Dialog.Trigger asChild>
          {triggerButton}
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 data-[state=open]:animate-overlayShow" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-[600px] max-h-[90vh] overflow-y-auto data-[state=open]:animate-contentShow">
          <Dialog.Title className="text-lg font-medium text-gray-900 mb-4">
            {editingPlan ? 'Edit Billing Plan Basics' : 'Add New Billing Plan'}
          </Dialog.Title>
           {showValidationSummary && Object.keys(validationErrors).length > 0 && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Please fix the following errors:
                  <ul className="list-disc pl-5 mt-1 text-sm">
                    {Object.entries(validationErrors).map(([field, message]) => (
                      <li key={field}>{message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          <form onSubmit={handleSubmit}>
            {/* Removed Tabs - Only show basic info */}
            <div className="space-y-4">
              <div>
                <Label htmlFor="plan-name">Plan Name</Label>
                <Input
                  id="plan-name"
                  type="text"
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  placeholder="Enter plan name"
                  required
                  className={validationErrors.planName ? 'border-red-500' : ''}
                />
                {validationErrors.planName && (
                  <p className="text-red-500 text-xs mt-1">{validationErrors.planName}</p>
                )}
              </div>
              <div>
                <Label htmlFor="billing-frequency">Billing Frequency</Label>
                <CustomSelect
                  id="billing-frequency"
                  options={BILLING_FREQUENCY_OPTIONS}
                  onValueChange={setBillingFrequency}
                  value={billingFrequency}
                  placeholder="Select billing frequency"
                  className={`w-full ${validationErrors.billingFrequency ? 'border-red-500' : ''}`}
                  required
                />
                {validationErrors.billingFrequency && (
                  <p className="text-red-500 text-xs mt-1">{validationErrors.billingFrequency}</p>
                )}
              </div>
              <div>
                {/* Use PlanTypeSelector with cards */}
                <PlanTypeSelector
                   value={planType}
                   onChange={setPlanType}
                   className="w-full"
                   showDescriptions={true} // Keep descriptions for clarity
                   showCards={true} // Enable card view
                />
                {/* Removed CustomSelect */}
              </div>
              <div className="flex items-center space-x-2 pt-2">
                <Checkbox
                  id="is-custom"
                  checked={isCustom}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIsCustom(e.target.checked)}
                />
                <Label htmlFor="is-custom" className="cursor-pointer">
                  Is Custom Plan
                </Label>
              </div>
            </div>

            {/* Removed Config Tab Content and Service Selection */}

            <div className="flex justify-end gap-2 mt-6">
              <Button
                id="cancel-billing-plan-button"
                type="button"
                variant="outline"
                onClick={handleClose}
                className="bg-white hover:bg-gray-50"
              >
                Cancel
              </Button>
              <Button id='save-billing-plan-button' type="submit" disabled={isSaving}>
                {isSaving ? 'Saving...' : (editingPlan ? 'Update Plan Basics' : 'Save and Configure')}
              </Button>
            </div>
          </form>
           <Dialog.Close asChild>
                <button
                className="absolute top-4 right-4 inline-flex h-6 w-6 appearance-none items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400"
                aria-label="Close"
                onClick={handleClose} // Ensure reset/close logic runs
                >
                 &times; {/* Simple X */}
                </button>
            </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>

    {/* Removed OverlapWarningDialog */}
  </>
  );
}
