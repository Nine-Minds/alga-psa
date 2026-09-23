// server/src/components/billing-dashboard/FixedPlanConfiguration.tsx
'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle, Package, Clock, Activity } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import Spinner from '@alga-psa/ui/components/Spinner';
import { getServices } from '@alga-psa/billing/actions/serviceActions';
import {
  getContractLineById,
  updateContractLine,
  updateContractLineFixedConfig,
  getContractLineFixedConfig,
} from '@alga-psa/billing/actions/contractLineAction';
import { IService, IContractLine } from '@alga-psa/types';
import FixedPlanServicesList from '../FixedContractLineServicesList'; // Import the actual component
import { useBillingFrequencyOptions } from '@alga-psa/billing/hooks/useBillingEnumOptions';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';
import { resolveBillingCycleAlignmentForCompatibility } from '@alga-psa/shared/billingClients/billingCycleAlignmentCompatibility';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

interface FixedPlanConfigurationProps {
  contractLineId: string;
  className?: string;
}

type PlanType = 'Fixed' | 'Hourly' | 'Usage';

const BILLING_TIMING_OPTIONS = [
  {
    value: 'arrears',
    labelKey: 'configuration.fixed.basics.billingTiming.options.arrears',
    defaultLabel: 'Arrears - invoice after the period closes',
  },
  {
    value: 'advance',
    labelKey: 'configuration.fixed.basics.billingTiming.options.advance',
    defaultLabel: 'Advance - invoice at the start of the period',
  },
] as const;

const CADENCE_OWNER_OPTIONS = [
  {
    value: 'client',
    labelKey: 'configuration.fixed.basics.cadenceOwner.options.client.label',
    defaultLabel: 'Invoice on client billing schedule',
    descriptionKey: 'configuration.fixed.basics.cadenceOwner.options.client.description',
    defaultDescription:
      "Use the client billing calendar so this recurring line stays aligned with the client's normal invoice cadence.",
  },
  {
    value: 'contract',
    labelKey: 'configuration.fixed.basics.cadenceOwner.options.contract.label',
    defaultLabel: 'Invoice on contract anniversary',
    descriptionKey: 'configuration.fixed.basics.cadenceOwner.options.contract.description',
    defaultDescription:
      "Use this contract line's own anniversary dates. Contract cadence currently supports monthly, quarterly, semi-annual, and annual recurring billing.",
  },
];

const isReturnedActionError = (value: unknown): boolean =>
  isActionMessageError(value) || isActionPermissionError(value);

export function FixedPlanConfiguration({
  contractLineId,
  className = '',
}: FixedPlanConfigurationProps) {
  const { t } = useTranslation('msp/contract-lines');
  const { symbol } = useCurrencyFormat();
  const billingFrequencyOptions = useBillingFrequencyOptions();
  const [plan, setPlan] = useState<IContractLine | null>(null);
  const [services, setServices] = useState<IService[]>([]);
  const [planLoading, setPlanLoading] = useState(true);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [planName, setPlanName] = useState('');
  const [invoiceLineDescription, setInvoiceLineDescription] = useState('');
  const [planType, setPlanType] = useState<PlanType>('Fixed');
  const [billingFrequency, setBillingFrequency] = useState<string>('monthly');
  const [isCustom, setIsCustom] = useState(false);
  const [billingTiming, setBillingTiming] = useState<'arrears' | 'advance'>('arrears');
  const [cadenceOwner, setCadenceOwner] = useState<'client' | 'contract'>('client');
  const [baseRate, setBaseRate] = useState<number | undefined>(undefined);
  const [baseRateInput, setBaseRateInput] = useState<string>('');
  const [enableProration, setEnableProration] = useState<boolean>(false);
  const [billingCycleAlignment, setBillingCycleAlignment] = useState<'start' | 'end' | 'prorated'>('start');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const tenant = useTenant()!;

  const markDirty = () => setIsDirty(true);

  // Seeds an empty base-rate field once from the resolved associated-service
  // total. A populated/edited/resumed value is never replaced.
  const baseRateSeededRef = useRef(false);
  // The persisted fixed config loads asynchronously and may resolve after the
  // service list has already reported its total. `fixedConfigLoadedRef` gates
  // that, while `baseRateValueRef`/`baseRateManualRef` carry the authoritative
  // live value synchronously so a service-total callback can never depend on a
  // stale React state closure or clobber a manual/persisted rate.
  const fixedConfigLoadedRef = useRef(false);
  const pendingServicesTotalRef = useRef<number | null>(null);
  const baseRateValueRef = useRef<number | undefined>(undefined);
  const baseRateManualRef = useRef(false);

  const applyServiceTotalSeed = useCallback((totalCents: number) => {
    if (baseRateSeededRef.current) return;
    if (!Number.isFinite(totalCents) || totalCents <= 0) return;
    // Never override a manually edited value or one already loaded from the
    // persisted config, regardless of what a stale closure believes.
    if (baseRateManualRef.current) return;
    const existing = baseRateValueRef.current;
    if (existing !== undefined && existing !== null && existing !== 0) return;
    baseRateSeededRef.current = true;
    baseRateValueRef.current = totalCents;
    setBaseRate(totalCents);
    setBaseRateInput((totalCents / 100).toFixed(2));
    setIsDirty(true);
  }, []);

  const handleServicesTotalResolved = useCallback(
    (totalCents: number) => {
      if (baseRateSeededRef.current) return;
      if (!Number.isFinite(totalCents) || totalCents <= 0) return;
      // Hold the total while the persisted config is still loading. A later
      // populated config wins; a later empty config seeds from this total.
      if (!fixedConfigLoadedRef.current) {
        pendingServicesTotalRef.current = totalCents;
        return;
      }
      applyServiceTotalSeed(totalCents);
    },
    [applyServiceTotalSeed],
  );

  const fetchPlanData = useCallback(async () => {
    setPlanLoading(true);
    setError(null);
    baseRateSeededRef.current = false;
    fixedConfigLoadedRef.current = false;
    pendingServicesTotalRef.current = null;
    try {
      // Fetch the basic contract line data
      const fetchedPlan = await getContractLineById(contractLineId);
      if (isReturnedActionError(fetchedPlan)) {
        setError(getErrorMessage(fetchedPlan));
        return;
      }
      if (fetchedPlan && fetchedPlan.contract_line_type === 'Fixed') {
        setPlan(fetchedPlan);

        // Populate form fields
        setPlanName(fetchedPlan.contract_line_name);
        setInvoiceLineDescription(fetchedPlan.invoice_line_description ?? '');
        setBillingFrequency(fetchedPlan.billing_frequency);
        setPlanType(fetchedPlan.contract_line_type as PlanType);
        setIsCustom(fetchedPlan.is_custom ?? false);
        setBillingTiming((fetchedPlan.billing_timing ?? 'arrears') as 'arrears' | 'advance');
        setCadenceOwner((fetchedPlan.cadence_owner ?? 'client') as 'client' | 'contract');

        // Fetch fixed config
        let persistedBaseRate: number | null | undefined;
        if (fetchedPlan.contract_line_id) {
          const cfg = await getContractLineFixedConfig(fetchedPlan.contract_line_id);
          if (isReturnedActionError(cfg)) {
            setError(getErrorMessage(cfg));
            return;
          }
          if (cfg) {
            persistedBaseRate = cfg.base_rate;
            // A manually edited value survives a service-list refresh/remount;
            // only a persisted rate (re)hydrates the field automatically.
            if (!baseRateManualRef.current) {
              baseRateValueRef.current = cfg.base_rate ?? undefined;
              setBaseRate(cfg.base_rate ?? undefined);
              if (cfg.base_rate !== undefined && cfg.base_rate !== null) {
                setBaseRateInput((cfg.base_rate / 100).toFixed(2));
              }
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

        // The persisted config has now resolved. A total reported while it was
        // loading may seed, but only when the persisted rate is empty and the
        // author has not entered their own value; a populated persisted rate
        // always wins and is never replaced.
        fixedConfigLoadedRef.current = true;
        const persistedIsPopulated =
          persistedBaseRate !== undefined &&
          persistedBaseRate !== null &&
          persistedBaseRate !== 0;
        const pendingTotal = pendingServicesTotalRef.current;
        pendingServicesTotalRef.current = null;
        if (!baseRateManualRef.current && !persistedIsPopulated && !baseRateSeededRef.current && pendingTotal) {
          applyServiceTotalSeed(pendingTotal);
        }

        if (baseRateManualRef.current) {
          // Preserve dirty manual input across service-list refreshes.
          setIsDirty(true);
        } else if (!baseRateSeededRef.current) {
          setIsDirty(false);
        }
      } else {
        setError(t('configuration.fixed.errors.invalidContractLineTypeOrNotFound', {
          defaultValue: 'Invalid contract line type or contract line not found.',
        }));
      }
    } catch (err) {
      console.error('Error fetching contract line data:', err);
      setError(t('configuration.fixed.errors.failedToLoadContractLineConfiguration', {
        defaultValue: 'Failed to load contract line configuration. Please try again.',
      }));
    } finally {
      setPlanLoading(false);
    }
  }, [contractLineId, t, applyServiceTotalSeed]);

  useEffect(() => {
    fetchPlanData();
  }, [fetchPlanData]);

  const validateForm = (): string[] => {
    const errors: string[] = [];
    if (!planName.trim()) {
      errors.push(t('configuration.fixed.validation.contractLineName', {
        defaultValue: 'Contract line name',
      }));
    }
    if (!billingFrequency) {
      errors.push(t('configuration.fixed.validation.billingFrequency', {
        defaultValue: 'Billing frequency',
      }));
    }
    if (!planType) {
      errors.push(t('configuration.fixed.validation.contractLineType', {
        defaultValue: 'Contract line type',
      }));
    }
    if (planType === 'Fixed') {
      if (baseRate === undefined || baseRate === null || Number.isNaN(baseRate) || baseRate === 0) {
        errors.push(t('configuration.fixed.validation.baseRateRequiredForFixedLines', {
          defaultValue: 'Base rate is required for fixed lines',
        }));
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
        invoice_line_description: invoiceLineDescription.trim() ? invoiceLineDescription.trim() : null,
        billing_frequency: billingFrequency,
        billing_timing: planType === 'Fixed' ? billingTiming : 'arrears',
        is_custom: isCustom,
        contract_line_type: planType!,
        cadence_owner: cadenceOwner,
        tenant,
      };

      if (plan?.contract_line_id) {
        const updateResult = await updateContractLine(plan.contract_line_id, planData);
        if (isReturnedActionError(updateResult)) {
          setValidationErrors([getErrorMessage(updateResult)]);
          return;
        }

        if (planType === 'Fixed') {
          const fixedConfigResult = await updateContractLineFixedConfig(plan.contract_line_id, {
            base_rate: baseRate ?? null,
            enable_proration: enableProration,
            billing_cycle_alignment: resolveBillingCycleAlignmentForCompatibility({
              billingCycleAlignment: billingCycleAlignment,
              enableProration: enableProration,
            }),
          });
          if (isReturnedActionError(fixedConfigResult)) {
            setValidationErrors([getErrorMessage(fixedConfigResult)]);
            return;
          }
        }
      }

      // The entered/derived base rate is now persisted; let the reload
      // rehydrate it from the saved config instead of treating it as manual.
      baseRateManualRef.current = false;
      baseRateValueRef.current = baseRate;

      await fetchPlanData();
      setIsDirty(false);
    } catch (error) {
      console.error('Error saving contract line:', error);
      const errorMessage = error instanceof Error
        ? error.message
        : t('configuration.fixed.errors.failedToSaveContractLine', {
            defaultValue: 'Failed to save contract line',
          });
      setValidationErrors([errorMessage]);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    // Explicit reset: drop the manual override so the persisted config wins.
    baseRateManualRef.current = false;
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
          {t('configuration.fixed.errors.contractLineNotFoundOrInvalidType', {
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
            {t('configuration.fixed.cardTitle', {
              defaultValue: 'Edit Contract Line: {{name}} (Fixed)',
              name: plan?.contract_line_name || '...',
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
                {t('configuration.fixed.basics.heading', { defaultValue: 'Contract Line Basics' })}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('configuration.fixed.basics.description', {
                  defaultValue: 'Name the contract line and choose how it should bill by default.',
                })}
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <Label htmlFor="name">
                  {t('configuration.fixed.basics.nameLabel', { defaultValue: 'Contract Line Name *' })}
                </Label>
                <Input
                  id="name"
                  value={planName}
                  onChange={(e) => {
                    setPlanName(e.target.value);
                    markDirty();
                  }}
                  placeholder={t('configuration.fixed.basics.namePlaceholder', {
                    defaultValue: 'e.g. Managed Support - Gold',
                  })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="invoice-line-description">
                  {t('configuration.fixed.basics.invoiceLineDescriptionLabel', {
                    defaultValue: 'Invoice Line Description',
                  })}
                </Label>
                <Input
                  id="invoice-line-description"
                  value={invoiceLineDescription}
                  onChange={(e) => {
                    setInvoiceLineDescription(e.target.value);
                    markDirty();
                  }}
                  placeholder={t('configuration.fixed.basics.invoiceLineDescriptionPlaceholder', {
                    defaultValue: 'e.g. Monthly phone system maintenance per 2019 agreement',
                  })}
                />
                <p className="text-sm text-muted-foreground mt-1">
                  {t('configuration.fixed.basics.invoiceLineDescriptionHelp', {
                    defaultValue:
                      'Used verbatim as the invoice line text for this fixed fee. Leave empty to use the contract line name.',
                  })}
                </p>
              </div>
              <div>
                <Label htmlFor="frequency">
                  {t('configuration.fixed.basics.billingFrequencyLabel', { defaultValue: 'Billing Frequency *' })}
                </Label>
                <CustomSelect
                  id="frequency"
                  value={billingFrequency}
                  onValueChange={(value) => {
                    setBillingFrequency(value);
                    markDirty();
                  }}
                  options={billingFrequencyOptions}
                  placeholder={t('configuration.fixed.basics.billingFrequencyPlaceholder', {
                    defaultValue: 'Select billing frequency',
                  })}
                />
              </div>
              <div>
                <Label htmlFor="billing-timing">
                  {t('configuration.fixed.basics.billingTimingLabel', { defaultValue: 'Billing Timing *' })}
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
                  placeholder={t('configuration.fixed.basics.billingTimingPlaceholder', {
                    defaultValue: 'Select billing timing',
                  })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('configuration.fixed.basics.billingTimingHelp', {
                    defaultValue: 'Advance billing invoices the upcoming period at the start of each cycle.',
                  })}
                </p>
              </div>
              <div className="border border-[rgb(var(--color-border-200))] rounded-md p-4 bg-card space-y-3">
                <div>
                  <Label className="text-sm font-medium text-[rgb(var(--color-text-900))]">
                    {t('configuration.fixed.basics.cadenceOwner.label', { defaultValue: 'Cadence Owner' })}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('configuration.fixed.basics.cadenceOwner.description', {
                      defaultValue: "Choose which schedule defines this recurring line's service periods.",
                    })}
                  </p>
                </div>
                <RadioGroup
                  id="cadence-owner"
                  name="cadence-owner"
                  value={cadenceOwner}
                  onChange={(value) => {
                    setCadenceOwner(value as 'client' | 'contract');
                    markDirty();
                  }}
                  options={CADENCE_OWNER_OPTIONS.map((option) => ({
                    value: option.value,
                    label: t(option.labelKey, { defaultValue: option.defaultLabel }),
                    description: t(option.descriptionKey, { defaultValue: option.defaultDescription }),
                  }))}
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold">
                {t('configuration.fixed.settings.heading', { defaultValue: 'Fixed Fee Settings' })}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('configuration.fixed.settings.description', {
                  defaultValue:
                    'Define the recurring base rate and whether partial-period coverage should adjust the charge. Service allocations can be tuned once the line is active.',
                })}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="base-rate">
                  {t('configuration.fixed.settings.baseRateLabel', { defaultValue: 'Recurring Base Rate *' })}
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{symbol()}</span>
                  <Input
                    id="base-rate"
                    type="text"
                    inputMode="decimal"
                    value={baseRateInput}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9.]/g, '');
                      const decimalCount = (value.match(/\./g) || []).length;
                      if (decimalCount <= 1) {
                        // Any edit is the author's own value; it must survive
                        // later service-list refreshes and catalog seeds.
                        baseRateManualRef.current = true;
                        setBaseRateInput(value);
                        markDirty();
                      }
                    }}
                    onBlur={() => {
                      if (baseRateInput.trim() === '' || baseRateInput === '.') {
                        // An explicit clear releases the manual override so a
                        // later service total may seed the empty field again.
                        baseRateManualRef.current = false;
                        baseRateValueRef.current = undefined;
                        setBaseRateInput('');
                        setBaseRate(undefined);
                      } else {
                        const dollars = parseFloat(baseRateInput) || 0;
                        const cents = Math.round(dollars * 100);
                        baseRateManualRef.current = true;
                        baseRateValueRef.current = cents;
                        setBaseRate(cents);
                        setBaseRateInput((cents / 100).toFixed(2));
                      }
                    }}
                    placeholder={t('common.moneyPlaceholder', { defaultValue: '0.00' })}
                    className="pl-10"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('configuration.fixed.settings.baseRateHelp', {
                    defaultValue: 'The total recurring fee for all fixed services combined',
                  })}
                </p>
              </div>
              <div className="border border-[rgb(var(--color-border-200))] rounded-md p-4 bg-card space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="enable-proration" className="font-medium text-[rgb(var(--color-text-800))]">
                    {t('configuration.fixed.settings.adjustForPartialPeriodsLabel', {
                      defaultValue: 'Adjust for Partial Periods',
                    })}
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
                <p className="text-xs text-muted-foreground">
                  {t('configuration.fixed.settings.adjustForPartialPeriodsHelp', {
                    defaultValue:
                      'Enable this when the recurring fee should scale to the covered portion of a service period if the contract starts or ends inside that period.',
                  })}
                </p>
                {enableProration && (
                  <div>
                    <Label htmlFor="alignment">
                      {t('configuration.fixed.settings.billingCycleAlignmentLabel', {
                        defaultValue: 'Billing Cycle Alignment',
                      })}
                    </Label>
                    <CustomSelect
                      id="alignment"
                      value={billingCycleAlignment}
                      onValueChange={(value: string) => {
                        setBillingCycleAlignment(value as 'start' | 'end' | 'prorated');
                        markDirty();
                      }}
                      options={[
                        { value: 'start', label: t('configuration.fixed.settings.billingCycleAlignment.options.start', { defaultValue: 'Start of Billing Cycle' }) },
                        { value: 'end', label: t('configuration.fixed.settings.billingCycleAlignment.options.end', { defaultValue: 'End of Billing Cycle' }) },
                        { value: 'prorated', label: t('configuration.fixed.settings.billingCycleAlignment.options.prorated', { defaultValue: 'Proportional Coverage' }) },
                      ]}
                      placeholder={t('configuration.fixed.settings.billingCycleAlignmentPlaceholder', {
                        defaultValue: 'Select alignment',
                      })}
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
                {t('configuration.fixed.services.associatedCardTitle', { defaultValue: 'Associated Services' })}
              </CardTitle>
          </CardHeader>
          <CardContent>
              <FixedPlanServicesList
                  planId={contractLineId}
                  onServicesTotalResolved={handleServicesTotalResolved}
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
