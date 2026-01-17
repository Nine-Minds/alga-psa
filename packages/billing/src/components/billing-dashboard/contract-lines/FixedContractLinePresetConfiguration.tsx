// server/src/components/billing-dashboard/FixedPresetConfiguration.tsx
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
import { getServices } from 'server/src/lib/actions/serviceActions';
import {
  getContractLinePresetById,
  updateContractLinePreset,
  updateContractLinePresetFixedConfig,
  getContractLinePresetFixedConfig,
} from '@alga-psa/billing/actions/contractLinePresetActions';
import { IService, IContractLinePreset } from 'server/src/interfaces/billing.interfaces';
import FixedContractLinePresetServicesList from '../FixedContractLinePresetServicesList'; // Import the preset-specific component
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';

interface FixedPresetConfigurationProps {
  presetId: string;
  className?: string;
}

type PlanType = 'Fixed' | 'Hourly' | 'Usage';

export function FixedPresetConfiguration({
  presetId,
  className = '',
}: FixedPresetConfigurationProps) {
  const [plan, setPlan] = useState<IContractLinePreset | null>(null);
  const [services, setServices] = useState<IService[]>([]);
  const [planLoading, setPlanLoading] = useState(true);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [planName, setPlanName] = useState('');
  const [planType, setPlanType] = useState<PlanType>('Fixed');
  const [billingFrequency, setBillingFrequency] = useState<string>('monthly');
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
      // Fetch the basic contract line preset data
      const fetchedPlan = await getContractLinePresetById(presetId);
      if (fetchedPlan && fetchedPlan.contract_line_type === 'Fixed') {
        setPlan(fetchedPlan);

        // Populate form fields
        setPlanName(fetchedPlan.preset_name);
        setBillingFrequency(fetchedPlan.billing_frequency);
        setPlanType(fetchedPlan.contract_line_type as PlanType);

        // Fetch fixed config
        if (fetchedPlan.preset_id) {
          const cfg = await getContractLinePresetFixedConfig(fetchedPlan.preset_id);
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
        setError('Invalid contract line preset type or contract line preset not found.');
      }
    } catch (err) {
      console.error('Error fetching contract line preset data:', err);
      setError('Failed to load contract line preset configuration. Please try again.');
    } finally {
      setPlanLoading(false);
    }
  }, [presetId]);

  useEffect(() => {
    fetchPlanData();
  }, [fetchPlanData]);

  const validateForm = (): string[] => {
    const errors: string[] = [];
    if (!planName.trim()) errors.push('Contract line name');
    if (!billingFrequency) errors.push('Billing frequency');
    if (!planType) errors.push('Contract line type');
    // Base rate is now optional for presets - it can be set when creating actual contracts
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
      const planData: Partial<IContractLinePreset> = {
        preset_name: planName,
        billing_frequency: billingFrequency,
        contract_line_type: planType!,
        tenant,
      };

      if (plan?.preset_id) {
        await updateContractLinePreset(plan.preset_id, planData);

        if (planType === 'Fixed') {
          await updateContractLinePresetFixedConfig(plan.preset_id, {
            base_rate: baseRate ?? null,
            enable_proration: enableProration,
            billing_cycle_alignment: enableProration ? billingCycleAlignment : 'start',
          });
        }
      }

      await fetchPlanData();
      setIsDirty(false);
    } catch (error) {
      console.error('Error saving contract line preset:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to save contract line preset';
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
          <CardTitle>Edit Contract Line Preset: {plan?.preset_name || '...'} (Fixed)</CardTitle>
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
              <h3 className="text-lg font-semibold">Contract Line Preset Basics</h3>
              <p className="text-sm text-gray-600">
                Name the contract line preset and choose how it should bill by default.
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <Label htmlFor="name">Contract Line Preset Name *</Label>
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
                <Label htmlFor="base-rate">Recurring Base Rate (Optional)</Label>
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
                  Suggested recurring fee for all fixed services. Can be overridden when adding this preset to a contract.
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
              <FixedContractLinePresetServicesList
                  planId={presetId}
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
