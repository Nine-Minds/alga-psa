'use client'

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Label } from '../ui/Label';
import { Input } from '../ui/Input';
import CustomSelect from '../ui/CustomSelect';
import { Switch } from '../ui/Switch';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import {
  createContractLine,
  updateContractLine,
  updateContractLineFixedConfig,
  getContractLineFixedConfig,
} from 'server/src/lib/actions/contractLineAction';
import { IContractLine } from 'server/src/interfaces/billing.interfaces';
import { useTenant } from '../TenantProvider';
import { Package, Clock, Activity } from 'lucide-react';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';

type PlanType = 'Fixed' | 'Hourly' | 'Usage';

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
  const [billingCycleAlignment, setBillingCycleAlignment] = useState<'start' | 'end' | 'prorated'>('start');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const tenant = useTenant()!;

  const markDirty = () => setIsDirty(true);

  // Open dialog when editingPlan is provided
  useEffect(() => {
    if (editingPlan) {
      setOpen(true);
      setPlanName(editingPlan.contract_line_name);
      setBillingFrequency(editingPlan.billing_frequency);
      setPlanType(editingPlan.contract_line_type as PlanType);
      setIsCustom(editingPlan.is_custom);
      if (editingPlan.contract_line_id && editingPlan.contract_line_type === 'Fixed') {
        getContractLineFixedConfig(editingPlan.contract_line_id)
          .then((cfg) => {
            if (cfg) {
              setBaseRate(cfg.base_rate ?? undefined);
              setEnableProration(!!cfg.enable_proration);
              setBillingCycleAlignment((cfg.billing_cycle_alignment ?? 'start') as any);
            }
          })
          .catch(() => {});
      }
      setIsDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingPlan]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open && !editingPlan) {
      resetForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const validateForm = (): string[] => {
    const errors: string[] = [];
    if (!planName.trim()) errors.push('Contract line name');
    if (!billingFrequency) errors.push('Billing frequency');
    if (!planType) errors.push('Contract line type');
    if (planType === 'Fixed') {
      if (baseRate === undefined || baseRate === null || Number.isNaN(baseRate) || baseRate === 0) {
        errors.push('Base rate is required for fixed lines');
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
        tenant,
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
          billing_cycle_alignment: enableProration ? billingCycleAlignment : 'start',
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
    setIsDirty(false);
  };

  const closeDialog = () => {
    setOpen(false);
    resetForm();
    onClose?.();
  };

  const handleCloseRequest = (force = false) => {
    if (!force && isDirty) {
      setOpen(true);
      return;
    }
    closeDialog();
  };

  return (
    <>
      {triggerButton && (
        <div
          onClick={() => {
            if (editingPlan) {
              setPlanName(editingPlan.contract_line_name);
              setBillingFrequency(editingPlan.billing_frequency);
              setPlanType(editingPlan.contract_line_type as PlanType);
              setIsCustom(editingPlan.is_custom);
              setIsDirty(false);
            }
            setOpen(true);
          }}
        >
          {triggerButton}
        </div>
      )}
      <Dialog
        isOpen={open}
        onClose={() => handleCloseRequest(false)}
        title={editingPlan ? 'Edit Contract Line' : 'Add Contract Line'}
        className="max-w-3xl"
        hideCloseButton={!!editingPlan}
      >
        <DialogContent>
          <form onSubmit={handleSubmit} className="space-y-6" noValidate>
            {hasAttemptedSubmit && validationErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  <p className="font-medium mb-2">Please correct the following:</p>
                  <ul className="list-disc list-inside space-y-1">
                    {validationErrors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <section className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">Contract Line Basics</h3>
                <p className="text-sm text-gray-600">
                  Name the contract line and choose how it should bill by default. Overlays and service-specific rates can be
                  refined after creation.
                </p>
              </div>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="name">Contract Line Name *</Label>
                  <Input
                    id="name"
                    value={planName}
                    onChange={(e) => {
                      setPlanName(e.target.value);
                      clearErrorIfSubmitted();
                      markDirty();
                    }}
                    placeholder="e.g. Managed Support – Gold"
                    required
                    className={hasAttemptedSubmit && !planName.trim() ? 'border-red-500' : ''}
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="frequency">Billing Frequency *</Label>
                    <CustomSelect
                      id="frequency"
                      value={billingFrequency}
                      onValueChange={(value) => {
                        setBillingFrequency(value);
                        clearErrorIfSubmitted();
                        markDirty();
                      }}
                      options={BILLING_FREQUENCY_OPTIONS}
                      placeholder="Select billing frequency"
                      className={hasAttemptedSubmit && !billingFrequency ? 'ring-1 ring-red-500' : ''}
                    />
                  </div>
                  <div className="border border-gray-200 rounded-md p-3 bg-white">
                    <div className="flex items-center gap-3">
                      <Switch
                        id="is-custom"
                        checked={isCustom}
                        onCheckedChange={(checked) => {
                          setIsCustom(checked);
                          markDirty();
                        }}
                      />
                      <div>
                        <Label htmlFor="is-custom" className="cursor-pointer">
                          Custom Line
                        </Label>
                        <p className="text-xs text-gray-500">
                          Flag the line as bespoke for reporting and analytics.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">Choose a Billing Model *</h3>
                <p className="text-sm text-gray-600">
                  Select the billing behavior that fits this offering. Services and overlays can be attached once the line exists.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {(
                  [
                    {
                      key: 'Fixed' as PlanType,
                      title: 'Fixed Fee',
                      description: 'Charge a flat amount every billing period.',
                      icon: Package,
                      accent: 'text-blue-600',
                    },
                    {
                      key: 'Hourly' as PlanType,
                      title: 'Time & Materials',
                      description: 'Bill based on approved time entries and hourly overlays.',
                      icon: Clock,
                      accent: 'text-emerald-600',
                    },
                    {
                      key: 'Usage' as PlanType,
                      title: 'Usage-Based',
                      description: 'Invoice for units consumed such as devices or licenses.',
                      icon: Activity,
                      accent: 'text-orange-600',
                    },
                  ] as const
                ).map(({ key, title, description, icon: Icon, accent }) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => {
                      setPlanType(key);
                      clearErrorIfSubmitted();
                      markDirty();
                    }}
                    className={`text-left p-4 border-2 rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      planType === key ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-500 hover:bg-blue-50'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className={`h-8 w-8 mt-1 flex-shrink-0 ${accent}`} />
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-1">{title}</h4>
                        <p className="text-sm text-gray-600">{description}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {planType === 'Fixed' && (
              <section className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Fixed Fee Settings</h3>
                  <p className="text-sm text-gray-600">
                    Define the recurring base rate and optional proration behavior. Service allocations can be tuned once the line is active.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="base-rate">Base Rate (USD) *</Label>
                    <Input
                      id="base-rate"
                      type="number"
                      value={baseRate ?? ''}
                      onChange={(e) => {
                        setBaseRate(e.target.value === '' ? undefined : Number(e.target.value));
                        markDirty();
                      }}
                      placeholder="0.00"
                      min={0}
                      step={0.01}
                      required
                      className={hasAttemptedSubmit && (baseRate === undefined || Number.isNaN(baseRate)) ? 'border-red-500' : ''}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      This value becomes the base recurring charge before overlays or usage adjustments.
                    </p>
                  </div>
                  <div className="border border-gray-200 rounded-md p-4 bg-white space-y-3">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="enable-proration" className="font-medium text-gray-800">
                        Enable Proration
                      </Label>
                      <Switch
                        id="enable-proration"
                        checked={enableProration}
                        onCheckedChange={(checked) => {
                          setEnableProration(checked);
                          markDirty();
                        }}
                      />
                    </div>
                    <p className="text-xs text-gray-500">
                      Toggle this on if you want the base rate to be prorated when the contract starts mid-cycle.
                    </p>
                    {enableProration && (
                      <div>
                        <Label htmlFor="alignment">Billing Cycle Alignment</Label>
                        <CustomSelect
                          id="alignment"
                          value={billingCycleAlignment}
                          onValueChange={(value: string) => {
                            setBillingCycleAlignment(value as 'start' | 'end' | 'prorated');
                            markDirty();
                          }}
                          options={[
                            { value: 'start', label: 'Start of Billing Cycle' },
                            { value: 'end', label: 'End of Billing Cycle' },
                            { value: 'prorated', label: 'Prorated' },
                          ]}
                          placeholder="Select alignment"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {planType === 'Hourly' && (
              <section className="rounded-md border border-gray-200 bg-slate-50 p-4 space-y-2">
                <h3 className="text-lg font-semibold text-slate-900">Hourly contract line</h3>
                <p className="text-sm text-slate-700">
                  Attach services after saving to define hourly rates, minimum billable increments, and user-type overrides.
                </p>
                <p className="text-xs text-slate-500">
                  Overlays live with each service, giving you detailed control per labor category.
                </p>
              </section>
            )}

            {planType === 'Usage' && (
              <section className="rounded-md border border-gray-200 bg-indigo-50 p-4 space-y-2">
                <h3 className="text-lg font-semibold text-indigo-900">Usage-based contract line</h3>
                <p className="text-sm text-indigo-700">
                  Configure unit pricing, tiering, and allowances once the line is active and services have been attached.
                </p>
                <p className="text-xs text-indigo-600">
                  Pair with pricing schedules to manage seasonal or promotional rate changes.
                </p>
              </section>
            )}

            <DialogFooter>
              <Button id="contract-line-cancel" variant="outline" onClick={() => handleCloseRequest(true)}>
                Cancel
              </Button>
              <Button
                id="contract-line-submit"
                type="submit"
                disabled={isSaving}
                className={!planName.trim() || !planType || !billingFrequency ? 'opacity-50' : ''}
              >
                {isSaving ? 'Saving…' : editingPlan ? 'Update Contract Line' : 'Create Contract Line'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
