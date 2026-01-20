// server/src/components/billing-dashboard/FixedPlanConfiguration.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle, Package, Clock, Activity } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import Spinner from '@alga-psa/ui/components/Spinner';
import { getServices } from '@alga-psa/billing/actions';
import {
  getContractLineById,
  updateContractLine,
  updateContractLineFixedConfig,
  getContractLineFixedConfig,
  upsertContractLineTerms,
} from '@alga-psa/billing/actions/contractLineAction';
import { IService, IContractLine } from '@alga-psa/types';
import FixedPlanServicesList from '../FixedContractLineServicesList'; // Import the actual component
import { BILLING_FREQUENCY_OPTIONS } from '@alga-psa/billing/constants/billing';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';

interface FixedPlanConfigurationProps {
  contractLineId: string;
  className?: string;
}

type PlanType = 'Fixed' | 'Hourly' | 'Usage';

const BILLING_TIMING_OPTIONS = [
  {
    value: 'arrears',
    label: 'Arrears – invoice after the period closes',
  },
  {
    value: 'advance',
    label: 'Advance – invoice at the start of the period',
  },
] as const;

export function FixedPlanConfiguration({
  contractLineId,
  className = '',
}: FixedPlanConfigurationProps) {
  const [plan, setPlan] = useState<IContractLine | null>(null);
  const [services, setServices] = useState<IService[]>([]);
  const [planLoading, setPlanLoading] = useState(true);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [planName, setPlanName] = useState('');
  const [planType, setPlanType] = useState<PlanType>('Fixed');
  const [billingFrequency, setBillingFrequency] = useState<string>('monthly');
  const [isCustom, setIsCustom] = useState(false);
  const [billingTiming, setBillingTiming] = useState<'arrears' | 'advance'>('arrears');
  const [baseRate, setBaseRate] = useState<number | undefined>(undefined);
  const [baseRateInput, setBaseRateInput] = useState<string>('');
  const [enableProration, setEnableProration] = useState<boolean>(false);
  const [billingCycleAlignment, setBillingCycleAlignment] = useState<'start' | 'end' | 'prorated'>('start');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const tenant = useTenant()!;

  const markDirty = () => setIsDirty(true);

  const fetchPlanData = useCallback(async () => {
    setPlanLoading(true);
    setError(null);
    try {
      // Fetch the basic contract line data
      const fetchedPlan = await getContractLineById(contractLineId);
      if (fetchedPlan && fetchedPlan.contract_line_type === 'Fixed') {
        setPlan(fetchedPlan);

        // Populate form fields
        setPlanName(fetchedPlan.contract_line_name);
        setBillingFrequency(fetchedPlan.billing_frequency);
        setPlanType(fetchedPlan.contract_line_type as PlanType);
        setIsCustom(fetchedPlan.is_custom ?? false);
        setBillingTiming((fetchedPlan.billing_timing ?? 'arrears') as 'arrears' | 'advance');

        // Fetch fixed config
        if (fetchedPlan.contract_line_id) {
          const cfg = await getContractLineFixedConfig(fetchedPlan.contract_line_id);
          if (cfg) {
            setBaseRate(cfg.base_rate ?? undefined);
            if (cfg.base_rate !== undefined && cfg.base_rate !== null) {
              setBaseRateInput((cfg.base_rate / 100).toFixed(2));
            }
            setEnableProration(!!cfg.enable_proration);
            setBillingCycleAlignment((cfg.billing_cycle_alignment ?? 'start') as any);
          }
        }
        setIsDirty(false);
      } else {
        setError('Invalid contract line type or contract line not found.');
      }
    } catch (err) {
      console.error('Error fetching contract line data:', err);
      setError('Failed to load contract line configuration. Please try again.');
    } finally {
      setPlanLoading(false);
    }
  }, [contractLineId]);

  useEffect(() => {
    fetchPlanData();
  }, [fetchPlanData]);

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

  const handleSave = async () => {
    const errors = validateForm();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

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

      if (plan?.contract_line_id) {
        await updateContractLine(plan.contract_line_id, planData);

        if (planType === 'Fixed') {
          await updateContractLineFixedConfig(plan.contract_line_id, {
            base_rate: baseRate ?? null,
            enable_proration: enableProration,
            billing_cycle_alignment: enableProration ? billingCycleAlignment : 'start',
          });
        }

        await upsertContractLineTerms(
          plan.contract_line_id,
          planType === 'Fixed' ? billingTiming : 'arrears'
        );
      }

      await fetchPlanData();
      setIsDirty(false);
    } catch (error) {
      console.error('Error saving contract line:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to save contract line';
      setValidationErrors([errorMessage]);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    fetchPlanData();
    setValidationErrors([]);
  };


  if (planLoading && !plan) {
    return <div className="flex justify-center items-center p-8"><Spinner size="sm" /></div>;
  }

  if (error) {
    return (
      <Alert variant="destructive" className={`m-4 ${className}`}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!plan) {
      return <div className="p-4">Contract line not found or invalid type.</div>; // Should not happen if error handling is correct
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <Card>
        <CardHeader>
          <CardTitle>Edit Contract Line: {plan?.contract_line_name || '...'} (Fixed)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {validationErrors.length > 0 && (
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
                Name the contract line and choose how it should bill by default.
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
                    markDirty();
                  }}
                  placeholder="e.g. Managed Support – Gold"
                  required
                />
              </div>
              <div>
                <Label htmlFor="frequency">Billing Frequency *</Label>
                <CustomSelect
                  id="frequency"
                  value={billingFrequency}
                  onValueChange={(value) => {
                    setBillingFrequency(value);
                    markDirty();
                  }}
                  options={BILLING_FREQUENCY_OPTIONS}
                  placeholder="Select billing frequency"
                />
              </div>
              <div>
                <Label htmlFor="billing-timing">Billing Timing *</Label>
                <CustomSelect
                  id="billing-timing"
                  value={billingTiming}
                  onValueChange={(value) => {
                    setBillingTiming(value as 'arrears' | 'advance');
                    markDirty();
                  }}
                  options={BILLING_TIMING_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  placeholder="Select billing timing"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Advance billing invoices the upcoming period at the start of each cycle.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Fixed Fee Settings</h3>
              <p className="text-sm text-gray-600">
                Define the recurring base rate and optional proration behavior. Service allocations can be tuned once the line is active.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="base-rate">Recurring Base Rate *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <Input
                    id="base-rate"
                    type="text"
                    inputMode="decimal"
                    value={baseRateInput}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9.]/g, '');
                      const decimalCount = (value.match(/\./g) || []).length;
                      if (decimalCount <= 1) {
                        setBaseRateInput(value);
                        markDirty();
                      }
                    }}
                    onBlur={() => {
                      if (baseRateInput.trim() === '' || baseRateInput === '.') {
                        setBaseRateInput('');
                        setBaseRate(undefined);
                      } else {
                        const dollars = parseFloat(baseRateInput) || 0;
                        const cents = Math.round(dollars * 100);
                        setBaseRate(cents);
                        setBaseRateInput((cents / 100).toFixed(2));
                      }
                    }}
                    placeholder="0.00"
                    className="pl-10"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  The total recurring fee for all fixed services combined
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

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              id="reset-plan-basics"
              variant="outline"
              onClick={handleReset}
              disabled={isSaving || !isDirty}
            >
              Reset
            </Button>
            <Button
              id="save-plan-basics"
              onClick={handleSave}
              disabled={isSaving || !isDirty}
            >
              {isSaving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Services List */}
      <Card>
          <CardHeader>
              <CardTitle>Associated Services</CardTitle>
          </CardHeader>
          <CardContent>
              <FixedPlanServicesList
                  planId={contractLineId}
                  onServiceAdded={() => {
                      // Refresh the plan data when a service is added
                      fetchPlanData();
                  }}
              />
          </CardContent>
      </Card>
    </div>
  );
}
