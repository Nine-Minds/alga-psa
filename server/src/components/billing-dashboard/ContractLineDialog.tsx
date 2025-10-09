// server/src/components/billing-dashboard/ContractLineDialog.tsx (Simplified)
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import CustomSelect from '../ui/CustomSelect';
import { Dialog, DialogContent, DialogFooter } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Label } from '../ui/Label';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';
import { Switch } from '../ui/Switch';
import { createContractLine, updateContractLine, updateContractLineFixedConfig, getContractLineFixedConfig } from 'server/src/lib/actions/contractLineAction';
import { IContractLine, IServiceType } from 'server/src/interfaces/billing.interfaces'; // Removed IBucketPlan, IService
import { useTenant } from '../TenantProvider';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing'; // Removed PLAN_TYPE_OPTIONS
import { PlanTypeSelector, PlanType } from './contract-lines/ContractLineTypeSelector'; // Import PlanTypeSelector again


interface ContractLineDialogProps {
  onPlanAdded: (newPlanId?: string) => void; // Modified to pass new plan ID
  editingPlan?: IContractLine | null;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
  allServiceTypes: { id: string; name: string; billing_method: 'fixed' | 'per_unit'; is_standard: boolean }[]; // Updated to match getServiceTypesForSelection return type
}

export function ContractLineDialog({ onPlanAdded, editingPlan, onClose, triggerButton }: ContractLineDialogProps) {
  const [open, setOpen] = useState(false);
  const [planName, setPlanName] = useState('');
  const [billingFrequency, setBillingFrequency] = useState('');
  const [planType, setPlanType] = useState<PlanType>('Fixed');
  const [isCustom, setIsCustom] = useState(false);
  const [baseRate, setBaseRate] = useState<number | undefined>(undefined);
  const [enableProration, setEnableProration] = useState<boolean>(false);
  const [billingCycleAlignment, setBillingCycleAlignment] = useState<string>('start');
  const tenant = useTenant()!;
  // Removed activeTab state
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false); // Added saving state
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  // Removed other plan type specific state variables (hourlyRate, totalHours, etc.)
  // Removed service selection state (selectedServices, availableServices, isLoading)
  // Removed overlap check state (showOverlapWarning, overlappingServices, pendingPlanData)

  // Update form when editingPlan changes or dialog opens
  useEffect(() => {
    const loadFixedConfig = async (planId: string) => {
        try {
            const config = await getContractLineFixedConfig(planId);
            setBaseRate(config?.base_rate ?? undefined);
            setEnableProration(config?.enable_proration ?? false);
            setBillingCycleAlignment(config?.billing_cycle_alignment ?? 'start');
        } catch (err) {
            console.error('Error loading plan config:', err);
        }
    };

    if (open) {
        if (editingPlan) {
            setPlanName(editingPlan.contract_line_name);
            setBillingFrequency(editingPlan.billing_frequency);
            setPlanType(editingPlan.contract_line_type as PlanType);
            setIsCustom(editingPlan.is_custom);
            if (editingPlan.contract_line_id && editingPlan.contract_line_type === 'Fixed') {
                loadFixedConfig(editingPlan.contract_line_id);
            }
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
    if (!planName.trim()) errors.push('Contract line name');
    if (!billingFrequency) errors.push('Billing frequency');
    if (planType === 'Fixed') {
      if (baseRate === undefined || baseRate === null || isNaN(baseRate)) {
        errors.push('Base rate');
      }
    }
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
      const planData: Partial<IContractLine> = { // Use Partial for update
        contract_line_name: planName,
        billing_frequency: billingFrequency,
        is_custom: isCustom,
        contract_line_type: planType,
        tenant: tenant // Ensure tenant is included if required by backend actions
      };

      let savedPlanId: string | undefined;

      if (editingPlan?.contract_line_id) {
        // Ensure contract_line_id is not in the update payload if backend prohibits it
        const { contract_line_id, ...updateData } = planData;
        const updatedPlan = await updateContractLine(editingPlan.contract_line_id, updateData);
        savedPlanId = updatedPlan.contract_line_id;
      } else {
        // Ensure createContractLine expects Omit<IContractLine, 'contract_line_id'> or similar
        const { contract_line_id, ...createData } = planData;
        const newPlan = await createContractLine(createData as Omit<IContractLine, 'contract_line_id'>); // Cast might be needed depending on exact types
        savedPlanId = newPlan.contract_line_id;
      }

      if (savedPlanId && planType === 'Fixed') {
        await updateContractLineFixedConfig(savedPlanId, {
          base_rate: baseRate ?? null,
          enable_proration: enableProration,
          billing_cycle_alignment: enableProration ? billingCycleAlignment as 'start' | 'end' : 'start'
        });
      }

      resetForm();
      setOpen(false); // Close the dialog after successful save
      onPlanAdded(savedPlanId); // Pass the ID back
    } catch (error) {
      console.error('Error saving contract line:', error);
      setValidationErrors([`Failed to save contract line: ${error instanceof Error ? error.message : String(error)}`]);
    } finally {
        setIsSaving(false); // Reset saving state
    }
  };

  const resetForm = () => {
    setPlanName('');
    setBillingFrequency('');
    setPlanType('Fixed');
    setIsCustom(false);
    setBaseRate(undefined);
    setEnableProration(false);
    setBillingCycleAlignment('start');
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
      title={editingPlan ? 'Edit Contract Line Basics' : 'Add New Contract Line'}
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
                <Label htmlFor="plan-name">Contract Line Name *</Label>
                <Input
                  id="plan-name"
                  type="text"
                  value={planName}
                  onChange={(e) => {
                    setPlanName(e.target.value);
                    clearErrorIfSubmitted();
                  }}
                  placeholder="Enter contract line name"
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
              {planType === 'Fixed' && (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="base-rate">Base Rate *</Label>
                    <Input
                      id="base-rate"
                      type="number"
                      value={baseRate !== undefined ? baseRate : ''}
                      onChange={(e) => setBaseRate(e.target.value === '' ? undefined : Number(e.target.value))}
                      placeholder="Enter base rate"
                      min={0}
                      step={0.01}
                      required
                      className={hasAttemptedSubmit && (baseRate === undefined || isNaN(baseRate)) ? 'border-red-500' : ''}
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="enable-proration"
                      checked={enableProration}
                      onCheckedChange={setEnableProration}
                    />
                    <Label htmlFor="enable-proration" className="cursor-pointer">
                      Enable Proration
                    </Label>
                  </div>
                  {enableProration && (
                    <div className="pl-8 space-y-2">
                      <Label htmlFor="billing-cycle-alignment">Billing Cycle Alignment</Label>
                      <CustomSelect
                        id="billing-cycle-alignment"
                        options={[
                          { value: 'start', label: 'Start of Billing Cycle' },
                          { value: 'end', label: 'End of Billing Cycle' },
                          { value: 'calendar', label: 'Calendar Month' },
                          { value: 'anniversary', label: 'Anniversary Date' }
                        ]}
                        onValueChange={setBillingCycleAlignment}
                        value={billingCycleAlignment}
                        placeholder="Select alignment"
                        className="w-full"
                      />
                      <p className="text-sm text-muted-foreground">
                        {billingCycleAlignment === 'start' && 'Proration is calculated based on the start date of the billing cycle.'}
                        {billingCycleAlignment === 'end' && 'Proration is calculated based on the end date of the billing cycle.'}
                        {billingCycleAlignment === 'calendar' && 'Proration aligns to the calendar month (e.g., the 1st of the month).'}
                        {billingCycleAlignment === 'anniversary' && 'Proration aligns to the anniversary date of the subscription or plan start.'}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Removed Config Tab Content and Service Selection */}

            <DialogFooter>
              <Button
                id="cancel-contract-line-button"
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
              <Button id='save-contract-line-button' type="submit" disabled={isSaving} className={!planName.trim() || !billingFrequency ? 'opacity-50' : ''}>
                {isSaving ? 'Saving...' : (editingPlan ? 'Update Contract Line Basics' : 'Save and Configure')}
              </Button>
            </DialogFooter>
          </form>
      </DialogContent>
    </Dialog>

    {/* Removed OverlapWarningDialog */}
  </>
  );
}
