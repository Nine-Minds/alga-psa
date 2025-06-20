// server/src/components/billing-dashboard/BillingPlanDialog.tsx (Simplified)
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import CustomSelect from '../ui/CustomSelect';
import { Dialog, DialogContent, DialogFooter } from '../ui/Dialog';
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
  allServiceTypes: { id: string; name: string; billing_method: 'fixed' | 'per_unit'; is_standard: boolean }[]; // Updated to match getServiceTypesForSelection return type
}

export function BillingPlanDialog({ onPlanAdded, editingPlan, onClose, triggerButton }: BillingPlanDialogProps) {
  const [open, setOpen] = useState(false);
  const [planName, setPlanName] = useState('');
  const [billingFrequency, setBillingFrequency] = useState('');
  const [planType, setPlanType] = useState<PlanType>('Fixed');
  const [isCustom, setIsCustom] = useState(false);
  const tenant = useTenant()!;
  // Removed activeTab state
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false); // Added saving state
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

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


  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  // Simplified validation
  const validateForm = (): string[] => {
    const errors: string[] = [];
    if (!planName.trim()) errors.push('Plan name');
    if (!billingFrequency) errors.push('Billing frequency');
    // No type-specific validation needed here
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    const errors = validateForm();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    // No overlap check needed here
    await savePlan();
  };

  // Simplified savePlan
  const savePlan = async () => {
    setIsSaving(true); // Set saving state
    setValidationErrors([]); // Clear previous errors

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
      setValidationErrors([`Failed to save billing plan: ${error instanceof Error ? error.message : String(error)}`]);
    } finally {
        setIsSaving(false); // Reset saving state
    }
  };

  const resetForm = () => {
    setPlanName('');
    setBillingFrequency('');
    setPlanType('Fixed');
    setIsCustom(false);
    setValidationErrors([]);
    setHasAttemptedSubmit(false);
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
    {triggerButton && (
      <div onClick={() => setOpen(true)}>
        {triggerButton}
      </div>
    )}
    <Dialog
      isOpen={open}
      onClose={handleClose}
      title={editingPlan ? 'Edit Billing Plan Basics' : 'Add New Billing Plan'}
      className="max-w-2xl"
    >
      <DialogContent>
          <form onSubmit={handleSubmit} noValidate>
            {hasAttemptedSubmit && validationErrors.length > 0 && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>
                  <p className="font-medium mb-2">Please fill in the required fields:</p>
                  <ul className="list-disc list-inside space-y-1">
                    {validationErrors.map((err, index) => (
                      <li key={index}>{err}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {/* Removed Tabs - Only show basic info */}
            <div className="space-y-4">
              <div>
                <Label htmlFor="plan-name">Plan Name *</Label>
                <Input
                  id="plan-name"
                  type="text"
                  value={planName}
                  onChange={(e) => {
                    setPlanName(e.target.value);
                    clearErrorIfSubmitted();
                  }}
                  placeholder="Enter plan name"
                  required
                  className={hasAttemptedSubmit && !planName.trim() ? 'border-red-500' : ''}
                />
              </div>
              <div>
                <Label htmlFor="billing-frequency">Billing Frequency *</Label>
                <CustomSelect
                  id="billing-frequency"
                  options={BILLING_FREQUENCY_OPTIONS}
                  onValueChange={(value) => {
                    setBillingFrequency(value);
                    clearErrorIfSubmitted();
                  }}
                  value={billingFrequency}
                  placeholder="Select billing frequency"
                  className={`w-full ${hasAttemptedSubmit && !billingFrequency ? 'ring-1 ring-red-500' : ''}`}
                  required
                />
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
            </div>

            {/* Removed Config Tab Content and Service Selection */}

            <DialogFooter>
              <Button
                id="cancel-billing-plan-button"
                type="button"
                variant="outline"
                onClick={() => {
                  setHasAttemptedSubmit(false);
                  setValidationErrors([]);
                  handleClose();
                }}
                className="bg-white hover:bg-gray-50"
              >
                Cancel
              </Button>
              <Button id='save-billing-plan-button' type="submit" disabled={isSaving} className={!planName.trim() || !billingFrequency ? 'opacity-50' : ''}>
                {isSaving ? 'Saving...' : (editingPlan ? 'Update Plan Basics' : 'Save and Configure')}
              </Button>
            </DialogFooter>
          </form>
      </DialogContent>
    </Dialog>

    {/* Removed OverlapWarningDialog */}
  </>
  );
}
