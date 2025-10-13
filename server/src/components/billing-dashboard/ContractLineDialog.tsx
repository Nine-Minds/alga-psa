'use client'

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Label } from '../ui/Label';
import { Input } from '../ui/Input';
import CustomSelect from '../ui/CustomSelect';
import { Switch } from '../ui/Switch';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { createContractLine, updateContractLine, updateContractLineFixedConfig, getContractLineFixedConfig } from 'server/src/lib/actions/contractLineAction';
import { IContractLine } from 'server/src/interfaces/billing.interfaces';
import { useTenant } from '../TenantProvider';

type PlanType = 'Fixed' | 'Hourly' | 'Bucket' | 'Usage';

interface ContractLineDialogProps {
  onPlanAdded: (newPlanId?: string) => void;
  editingPlan?: IContractLine | null;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
  allServiceTypes: { id: string; name: string; billing_method: 'fixed' | 'per_unit'; is_standard: boolean }[];
}

export function ContractLineDialog({ onPlanAdded, editingPlan, onClose, triggerButton }: ContractLineDialogProps) {
  const [open, setOpen] = useState(false);
  const [planName, setPlanName] = useState('');
  const [planType, setPlanType] = useState<PlanType | null>(null);
  const [billingFrequency, setBillingFrequency] = useState<string>('monthly');
  const [isCustom, setIsCustom] = useState(false);
  const [baseRate, setBaseRate] = useState<number | undefined>(undefined);
  const [enableProration, setEnableProration] = useState<boolean>(false);
  const [billingCycleAlignment, setBillingCycleAlignment] = useState<'start' | 'end' | 'calendar' | 'anniversary'>('start');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const tenant = useTenant()!;

  useEffect(() => {
    if (open) {
      if (editingPlan) {
        setPlanName(editingPlan.contract_line_name);
        setBillingFrequency(editingPlan.billing_frequency);
        setPlanType(editingPlan.contract_line_type as PlanType);
        setIsCustom(editingPlan.is_custom);
        if (editingPlan.contract_line_id && editingPlan.contract_line_type === 'Fixed') {
          // load fixed config
          getContractLineFixedConfig(editingPlan.contract_line_id).then(cfg => {
            if (cfg) {
              setBaseRate(cfg.base_rate ?? undefined);
              setEnableProration(!!cfg.enable_proration);
              setBillingCycleAlignment((cfg.billing_cycle_alignment ?? 'start') as any);
            }
          }).catch(() => {});
        }
      } else {
        resetForm();
      }
    } else {
      resetForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingPlan, open]);

  const validateForm = (): string[] => {
    const errors: string[] = [];
    if (!planName.trim()) errors.push('Contract line name');
    if (!billingFrequency) errors.push('Billing frequency');
    if (!planType) errors.push('Contract line type');
    if (planType === 'Fixed') {
      if (baseRate === undefined || baseRate === null || Number.isNaN(baseRate) || baseRate === 0) {
        errors.push('Base Rate is required for Fixed Fee lines');
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
    await savePlan();
  };

  const savePlan = async () => {
    setIsSaving(true);
    setValidationErrors([]);
    try {
      const planData: Partial<IContractLine> = {
        contract_line_name: planName,
        billing_frequency: billingFrequency,
        is_custom: isCustom,
        contract_line_type: planType!,
        tenant
      };

      let savedPlanId: string | undefined;
      if (editingPlan?.contract_line_id) {
        const { contract_line_id, ...updateData } = planData;
        const updatedPlan = await updateContractLine(editingPlan.contract_line_id, updateData);
        savedPlanId = updatedPlan.contract_line_id;
      } else {
        const { contract_line_id, ...createData } = planData;
        const newPlan = await createContractLine(createData as Omit<IContractLine, 'contract_line_id'>);
        savedPlanId = newPlan.contract_line_id;
      }

      if (savedPlanId && planType === 'Fixed') {
        await updateContractLineFixedConfig(savedPlanId, {
          base_rate: baseRate ?? null,
          enable_proration: enableProration,
          billing_cycle_alignment: enableProration ? (billingCycleAlignment as 'start' | 'end') : 'start'
        });
      }

      resetForm();
      setOpen(false);
      onPlanAdded(savedPlanId);
    } catch (error) {
      console.error('Error saving contract line:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to save contract line';
      setValidationErrors([errorMessage]);
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setPlanName('');
    setPlanType(null);
    setBillingFrequency('monthly');
    setIsCustom(false);
    setBaseRate(undefined);
    setEnableProration(false);
    setBillingCycleAlignment('start');
    setValidationErrors([]);
    setHasAttemptedSubmit(false);
  };

  const handleClose = () => {
    if (!editingPlan) resetForm();
    setOpen(false);
    onClose?.();
  };

  return (
    <>
      {triggerButton && (
        <div onClick={() => setOpen(true)}>
          {triggerButton}
        </div>
      )}
      <Dialog
        isOpen={open}
        onClose={handleClose}
        title={editingPlan ? 'Edit Contract Line' : 'Add Contract Line'}
      >
        <DialogContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {hasAttemptedSubmit && validationErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  <p className="font-medium mb-2">Please fill in the required fields:</p>
                  <ul className="list-disc list-inside space-y-1">
                    {validationErrors.map((err, idx) => <li key={idx}>{err}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div>
              <Label htmlFor="name">Contract Line Name *</Label>
              <Input
                id="name"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                placeholder="Enter contract line name"
                required
                className={hasAttemptedSubmit && !planName.trim() ? 'border-red-500' : ''}
              />
            </div>

            <div>
              <Label htmlFor="type">Contract Line Type *</Label>
              <CustomSelect
                id="type"
                value={planType ?? ''}
                onValueChange={(v: string) => setPlanType(v as PlanType)}
                options={[
                  { value: 'Fixed', label: 'Fixed' },
                  { value: 'Hourly', label: 'Hourly' },
                  { value: 'Bucket', label: 'Bucket' },
                  { value: 'Usage', label: 'Usage' }
                ]}
                placeholder="Select type"
              />
            </div>

            <div>
              <Label htmlFor="frequency">Billing Frequency *</Label>
              <CustomSelect
                id="frequency"
                value={billingFrequency}
                onValueChange={setBillingFrequency}
                options={[
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'quarterly', label: 'Quarterly' },
                  { value: 'annually', label: 'Annually' }
                ]}
                placeholder="Select billing frequency"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch id="is-custom" checked={isCustom} onCheckedChange={setIsCustom} />
              <Label htmlFor="is-custom" className="cursor-pointer">Custom Line</Label>
            </div>

            {planType === 'Fixed' && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="base-rate">Base Rate (USD) *</Label>
                  <Input
                    id="base-rate"
                    type="number"
                    value={baseRate ?? ''}
                    onChange={(e) => setBaseRate(e.target.value === '' ? undefined : Number(e.target.value))}
                    placeholder="Enter base rate"
                    min={0}
                    step={0.01}
                    required
                    className={hasAttemptedSubmit && (baseRate === undefined || Number.isNaN(baseRate)) ? 'border-red-500' : ''}
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Switch id="enable-proration" checked={enableProration} onCheckedChange={setEnableProration} />
                  <Label htmlFor="enable-proration" className="cursor-pointer">Enable Proration</Label>
                </div>
                {enableProration && (
                  <div>
                    <Label htmlFor="alignment">Billing Cycle Alignment</Label>
                    <CustomSelect
                      id="alignment"
                      value={billingCycleAlignment}
                      onValueChange={(v: string) => setBillingCycleAlignment(v as any)}
                      options={[
                        { value: 'start', label: 'Start of Billing Cycle' },
                        { value: 'end', label: 'End of Billing Cycle' },
                        { value: 'calendar', label: 'Calendar Month' },
                        { value: 'anniversary', label: 'Anniversary Date' }
                      ]}
                      placeholder="Select alignment"
                    />
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving} className={!planName.trim() ? 'opacity-50' : ''}>
                {editingPlan ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
