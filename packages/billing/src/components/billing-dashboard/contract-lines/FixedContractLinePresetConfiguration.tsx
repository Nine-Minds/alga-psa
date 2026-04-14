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
import { getServices } from '@alga-psa/billing/actions';
import {
  getContractLinePresetById,
  updateContractLinePreset,
  updateContractLinePresetFixedConfig,
  getContractLinePresetFixedConfig,
} from '@alga-psa/billing/actions/contractLinePresetActions';
import { IService, IContractLinePreset } from '@alga-psa/types';
import FixedContractLinePresetServicesList from '../FixedContractLinePresetServicesList'; // Import the preset-specific component
import { useBillingFrequencyOptions } from '@alga-psa/billing/hooks/useBillingEnumOptions';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';
import { resolveBillingCycleAlignmentForCompatibility } from '@alga-psa/shared/billingClients/billingCycleAlignmentCompatibility';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface FixedPresetConfigurationProps {
  presetId: string;
  className?: string;
}

type PlanType = 'Fixed' | 'Hourly' | 'Usage';
const BILLING_TIMING_OPTIONS = [
  {
    value: 'arrears',
    labelKey: 'preset.fixed.settings.billingTiming.options.arrears',
    defaultLabel: 'Arrears - invoice after the period closes',
  },
  {
    value: 'advance',
    labelKey: 'preset.fixed.settings.billingTiming.options.advance',
    defaultLabel: 'Advance - invoice at the start of the period',
  },
] as const;

export function FixedPresetConfiguration({
  presetId,
  className = '',
}: FixedPresetConfigurationProps) {
  const { t } = useTranslation('msp/contract-lines');
  const billingFrequencyOptions = useBillingFrequencyOptions();
  const [plan, setPlan] = useState<IContractLinePreset | null>(null);
  const [services, setServices] = useState<IService[]>([]);
  const [planLoading, setPlanLoading] = useState(true);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [planName, setPlanName] = useState('');
  const [planType, setPlanType] = useState<PlanType>('Fixed');
  const [billingFrequency, setBillingFrequency] = useState<string>('monthly');
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
      // Fetch the basic contract line preset data
      const fetchedPlan = await getContractLinePresetById(presetId);
      if (fetchedPlan && fetchedPlan.contract_line_type === 'Fixed') {
        setPlan(fetchedPlan);

        // Populate form fields
        setPlanName(fetchedPlan.preset_name);
        setBillingFrequency(fetchedPlan.billing_frequency);
        setPlanType(fetchedPlan.contract_line_type as PlanType);
        setBillingTiming(fetchedPlan.billing_timing ?? 'arrears');

        // Fetch fixed config
        if (fetchedPlan.preset_id) {
          const cfg = await getContractLinePresetFixedConfig(fetchedPlan.preset_id);
          if (cfg) {
            setBaseRate(cfg.base_rate ?? undefined);
            if (cfg.base_rate !== undefined && cfg.base_rate !== null) {
              setBaseRateInput((cfg.base_rate / 100).toFixed(2));
            }
            setEnableProration(!!cfg.enable_proration);
            setBillingCycleAlignment(
              resolveBillingCycleAlignmentForCompatibility({
                billingCycleAlignment: cfg.billing_cycle_alignment,
                enableProration: cfg.enable_proration,
              }) as any,
            );
          }
        }
        setIsDirty(false);
      } else {
        setError(t('preset.fixed.errors.invalidContractLinePresetTypeOrNotFound', {
          defaultValue: 'Invalid contract line preset type or contract line preset not found.',
        }));
      }
    } catch (err) {
      console.error('Error fetching contract line preset data:', err);
      setError(t('preset.fixed.errors.failedToLoadContractLinePresetConfiguration', {
        defaultValue: 'Failed to load contract line preset configuration. Please try again.',
      }));
    } finally {
      setPlanLoading(false);
    }
  }, [presetId, t]);

  useEffect(() => {
    fetchPlanData();
  }, [fetchPlanData]);

  const validateForm = (): string[] => {
    const errors: string[] = [];
    if (!planName.trim()) {
      errors.push(t('preset.fixed.validation.contractLinePresetName', {
        defaultValue: 'Contract line preset name',
      }));
    }
    if (!billingFrequency) {
      errors.push(t('preset.fixed.validation.billingFrequency', {
        defaultValue: 'Billing frequency',
      }));
    }
    if (!planType) {
      errors.push(t('preset.fixed.validation.contractLineType', {
        defaultValue: 'Contract line type',
      }));
    }
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
        billing_timing: billingTiming,
        cadence_owner: plan?.cadence_owner ?? 'client',
        tenant,
      };

      if (plan?.preset_id) {
        await updateContractLinePreset(plan.preset_id, planData);

        if (planType === 'Fixed') {
          await updateContractLinePresetFixedConfig(plan.preset_id, {
            base_rate: baseRate ?? null,
            enable_proration: enableProration,
            billing_cycle_alignment: resolveBillingCycleAlignmentForCompatibility({
              billingCycleAlignment: billingCycleAlignment,
              enableProration: enableProration,
            }),
          });
        }
      }

      await fetchPlanData();
      setIsDirty(false);
    } catch (error) {
      console.error('Error saving contract line preset:', error);
      const errorMessage = error instanceof Error
        ? error.message
        : t('preset.fixed.errors.failedToSaveContractLinePreset', {
            defaultValue: 'Failed to save contract line preset',
          });
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
      return (
        <div className="p-4">
          {t('preset.fixed.errors.contractLineNotFoundOrInvalidType', {
            defaultValue: 'Contract line not found or invalid type.',
          })}
        </div>
      ); // Should not happen if error handling is correct
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <Card>
        <CardHeader>
          <CardTitle>
            {t('preset.fixed.cardTitle', {
              defaultValue: 'Edit Contract Line Preset: {{name}} (Fixed)',
              name: plan?.preset_name || '...',
            })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {validationErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <p className="font-medium mb-2">
                  {t('common.validation.prefix', {
                    defaultValue: 'Please correct the following:',
                  })}
                </p>
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
              <h3 className="text-lg font-semibold">
                {t('preset.fixed.basics.heading', { defaultValue: 'Contract Line Preset Basics' })}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('preset.fixed.basics.description', {
                  defaultValue: 'Name the contract line preset and choose how it should bill by default.',
                })}
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <Label htmlFor="name">
                  {t('preset.fixed.basics.nameLabel', { defaultValue: 'Contract Line Preset Name *' })}
                </Label>
                <Input
                  id="name"
                  value={planName}
                  onChange={(e) => {
                    setPlanName(e.target.value);
                    markDirty();
                  }}
                  placeholder={t('preset.fixed.basics.namePlaceholder', {
                    defaultValue: 'e.g. Managed Support - Gold',
                  })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="frequency">
                  {t('preset.fixed.basics.billingFrequencyLabel', { defaultValue: 'Billing Frequency *' })}
                </Label>
                <CustomSelect
                  id="frequency"
                  value={billingFrequency}
                  onValueChange={(value) => {
                    setBillingFrequency(value);
                    markDirty();
                  }}
                  options={billingFrequencyOptions}
                  placeholder={t('preset.fixed.basics.billingFrequencyPlaceholder', {
                    defaultValue: 'Select billing frequency',
                  })}
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold">
                {t('preset.fixed.settings.heading', { defaultValue: 'Fixed Fee Settings' })}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('preset.fixed.settings.description', {
                  defaultValue:
                    'Define the recurring base rate and whether partial-period coverage should adjust the charge. Service allocations can be tuned once the line is active.',
                })}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="base-rate">
                  {t('preset.fixed.settings.baseRateLabel', {
                    defaultValue: 'Recurring Base Rate (Optional)',
                  })}
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
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
                    placeholder={t('common.moneyPlaceholder', { defaultValue: '0.00' })}
                    className="pl-10"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('preset.fixed.settings.baseRateHelp', {
                    defaultValue:
                      'Suggested recurring fee for all fixed services. Can be overridden when adding this preset to a contract.',
                  })}
                </p>
              </div>
              <div className="border border-[rgb(var(--color-border-200))] rounded-md p-4 bg-card space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="enable-proration" className="font-medium text-[rgb(var(--color-text-800))]">
                    {t('preset.fixed.settings.adjustForPartialPeriodsLabel', {
                      defaultValue: 'Adjust for Partial Periods',
                    })}
                  </Label>
                  <Switch
                    id="enable-proration"
                    checked={enableProration}
                    onCheckedChange={(checked) => {
                      setEnableProration(checked);
                      setBillingCycleAlignment((currentAlignment) =>
                        checked
                          ? currentAlignment === 'start'
                            ? 'prorated'
                            : currentAlignment
                          : 'start',
                      );
                      markDirty();
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('preset.fixed.settings.adjustForPartialPeriodsHelp', {
                    defaultValue:
                      'Enable this when the recurring fee should scale to the covered portion of a service period if the contract starts or ends inside that period.',
                  })}
                </p>
                {enableProration && (
                  <div>
                    <Label htmlFor="billing-cycle-alignment">
                      {t('preset.fixed.settings.billingCycleAlignmentLabel', {
                        defaultValue: 'Billing Cycle Alignment',
                      })}
                    </Label>
                    <CustomSelect
                      id="billing-cycle-alignment"
                      value={billingCycleAlignment}
                      onValueChange={(value: string) => {
                        setBillingCycleAlignment(value as 'start' | 'end' | 'prorated');
                        markDirty();
                      }}
                      options={[
                        { value: 'start', label: t('preset.fixed.settings.billingCycleAlignment.options.start', { defaultValue: 'Start of Billing Cycle' }) },
                        { value: 'end', label: t('preset.fixed.settings.billingCycleAlignment.options.end', { defaultValue: 'End of Billing Cycle' }) },
                        { value: 'prorated', label: t('preset.fixed.settings.billingCycleAlignment.options.prorated', { defaultValue: 'Proportional Coverage' }) },
                      ]}
                      placeholder={t('preset.fixed.settings.billingCycleAlignmentPlaceholder', {
                        defaultValue: 'Select alignment',
                      })}
                    />
                  </div>
                )}
              </div>
              <div>
                <Label htmlFor="billing-timing">
                  {t('preset.fixed.settings.billingTimingLabel', { defaultValue: 'Billing Timing' })}
                </Label>
                <CustomSelect
                  id="billing-timing"
                  value={billingTiming}
                  onValueChange={(value) => {
                    setBillingTiming(value as 'arrears' | 'advance');
                    markDirty();
                  }}
                  options={BILLING_TIMING_OPTIONS.map((option) => ({
                    value: option.value,
                    label: t(option.labelKey, { defaultValue: option.defaultLabel }),
                  }))}
                  placeholder={t('preset.fixed.settings.billingTimingPlaceholder', {
                    defaultValue: 'Select billing timing',
                  })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('preset.fixed.settings.billingTimingHelp', {
                    defaultValue:
                      'This preset keeps its cadence owner explicit when it is copied to a recurring line. Billing timing still controls whether the copied recurring line bills at the start or end of each covered period.',
                  })}
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
              {t('common.actions.reset', { defaultValue: 'Reset' })}
            </Button>
            <Button
              id="save-plan-basics"
              onClick={handleSave}
              disabled={isSaving || !isDirty}
            >
              {isSaving
                ? t('common.actions.saving', { defaultValue: 'Saving...' })
                : t('common.actions.saveChanges', { defaultValue: 'Save Changes' })}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Services List */}
      <Card>
          <CardHeader>
              <CardTitle>
                {t('preset.fixed.services.associatedCardTitle', { defaultValue: 'Associated Services' })}
              </CardTitle>
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
