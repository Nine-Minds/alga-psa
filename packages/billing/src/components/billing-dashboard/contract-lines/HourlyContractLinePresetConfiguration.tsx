// server/src/components/billing-dashboard/HourlyPresetConfiguration.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import Spinner from '@alga-psa/ui/components/Spinner';
import * as Tooltip from '@radix-ui/react-tooltip'; // Correct Radix UI import
import { getContractLinePresetById, updateContractLinePreset } from '@alga-psa/billing/actions/contractLinePresetActions';
import { useBillingFrequencyOptions } from '@alga-psa/billing/hooks/useBillingEnumOptions';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';
import HourlyContractLinePresetServicesList from './HourlyContractLinePresetServicesList';
import { IContractLinePreset } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

// --- Local Type Definitions ---

// Preset shape this editor reads and writes
type HourlyPlanData = IContractLinePreset;

// --- Component ---

interface HourlyPresetConfigurationProps {
  presetId: string;
  className?: string;
}

export function HourlyPresetConfiguration({
  presetId,
  className = '',
}: HourlyPresetConfigurationProps) {
  const { t } = useTranslation('msp/contract-lines');
  const billingFrequencyOptions = useBillingFrequencyOptions();
  // Plan-wide state
  const [plan, setPlan] = useState<HourlyPlanData | null>(null);

  // Plan basics state for inline editing
  const [planName, setPlanName] = useState('');
  const [billingFrequency, setBillingFrequency] = useState<string>('monthly');
  const [planBasicsErrors, setPlanBasicsErrors] = useState<string[]>([]);
  const [isSavingBasics, setIsSavingBasics] = useState(false);
  const [isBasicsDirty, setIsBasicsDirty] = useState(false);
  const tenant = useTenant()!;

  const markBasicsDirty = () => setIsBasicsDirty(true);

  // Hourly preset-specific fields
  const [minimumBillableTime, setMinimumBillableTime] = useState<number | undefined>(undefined);
  const [roundUpToNearest, setRoundUpToNearest] = useState<number | undefined>(undefined);

  // UI State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null); // General fetch error
  const [saveError, setSaveError] = useState<string | null>(null); // Save operation error

  const fetchPlanData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaveError(null);
    try {
      // Fetch base plan details
      const fetchedPlanResult = await getContractLinePresetById(presetId);
      if (isReturnedActionError(fetchedPlanResult)) {
        setError(getErrorMessage(fetchedPlanResult));
        return;
      }
      const fetchedPlan = fetchedPlanResult as HourlyPlanData | null;
      if (!fetchedPlan || fetchedPlan.contract_line_type !== 'Hourly') {
        setError(t('preset.hourly.errors.invalidPlanTypeOrNotFound', {
          defaultValue: 'Invalid plan type or plan not found.',
        }));
        return;
      }
      setPlan(fetchedPlan);

      // Populate plan basics form fields
      setPlanName(fetchedPlan.preset_name);
      setBillingFrequency(fetchedPlan.billing_frequency);
      setIsBasicsDirty(false);

      // Set preset-specific fields
      setMinimumBillableTime(fetchedPlan.minimum_billable_time ?? undefined);
      setRoundUpToNearest(fetchedPlan.round_up_to_nearest ?? undefined);
    } catch (err) {
      console.error('Error fetching plan data:', err);
      setError(t('preset.hourly.errors.failedToLoadPlanConfiguration', {
        defaultValue: 'Failed to load plan configuration. Please try again.',
      }));
    } finally {
      setLoading(false);
    }
  }, [presetId, t]);

  // Callback to refresh data when services are added/removed
  const handleServicesChanged = useCallback(() => {
    console.log('Services changed, refetching plan data...');
    fetchPlanData();
  }, [fetchPlanData]);

  useEffect(() => {
    fetchPlanData();
  }, [fetchPlanData]);

  // Plan basics save/reset handlers
  const validatePlanBasics = (): string[] => {
    const errors: string[] = [];
    if (!planName.trim()) {
      errors.push(t('preset.hourly.basics.validation.contractLinePresetName', {
        defaultValue: 'Contract line preset name',
      }));
    }
    if (!billingFrequency) {
      errors.push(t('preset.hourly.basics.validation.billingFrequency', {
        defaultValue: 'Billing frequency',
      }));
    }
    return errors;
  };

  const handleSavePlanBasics = async () => {
    const errors = validatePlanBasics();
    if (errors.length > 0) {
      setPlanBasicsErrors(errors);
      return;
    }

    setIsSavingBasics(true);
    setPlanBasicsErrors([]);
    try {
      const planData: Partial<HourlyPlanData> = {
        preset_name: planName,
        billing_frequency: billingFrequency,
        minimum_billable_time: minimumBillableTime ?? null,
        round_up_to_nearest: roundUpToNearest ?? null,
        tenant,
      };

      if (plan?.preset_id) {
        const result = await updateContractLinePreset(plan.preset_id, planData);
        if (isReturnedActionError(result)) {
          setSaveError(getErrorMessage(result));
          return;
        }
      }

      await fetchPlanData();
      setIsBasicsDirty(false);
    } catch (error) {
      console.error('Error saving contract line preset basics:', error);
      const errorMessage = error instanceof Error
        ? error.message
        : t('preset.hourly.errors.failedToSaveContractLinePreset', {
            defaultValue: 'Failed to save contract line preset',
          });
      setPlanBasicsErrors([errorMessage]);
    } finally {
      setIsSavingBasics(false);
    }
  };

  const handleResetPlanBasics = () => {
    if (plan) {
      setPlanName(plan.preset_name);
      setBillingFrequency(plan.billing_frequency);
      // Time settings are part of the basics form, so Reset owes them the same
      // restore as the name and frequency.
      setMinimumBillableTime(plan.minimum_billable_time ?? undefined);
      setRoundUpToNearest(plan.round_up_to_nearest ?? undefined);
      setIsBasicsDirty(false);
      setPlanBasicsErrors([]);
    }
  };

  if (loading && !plan) {
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
          {t('preset.hourly.errors.contractLineNotFoundOrInvalidType', {
            defaultValue: 'Contract line not found or invalid type.',
          })}
        </div>
      );
  }

  return (
    <Tooltip.Provider> {/* Use Radix Provider */}
        <div className={`space-y-6 ${className}`}>
            {saveError && (
                <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{saveError}</AlertDescription>
                </Alert>
            )}


            {/* Contract Line Preset Basics - Inline Editing */}
            <Card>
                <CardHeader>
                    <CardTitle>
                      {t('preset.hourly.basics.cardTitle', {
                        defaultValue: 'Edit Contract Line Preset: {{name}} (Hourly)',
                        name: plan?.preset_name || '...',
                      })}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    {planBasicsErrors.length > 0 && (
                        <Alert variant="destructive">
                            <AlertDescription>
                                <p className="font-medium mb-2">
                                  {t('common.validation.prefix', {
                                    defaultValue: 'Please correct the following:',
                                  })}
                                </p>
                                <ul className="list-disc list-inside space-y-1">
                                    {planBasicsErrors.map((err, idx) => (
                                        <li key={idx}>{err}</li>
                                    ))}
                                </ul>
                            </AlertDescription>
                        </Alert>
                    )}

                    <section className="space-y-4">
                        <div>
                            <h3 className="text-lg font-semibold">
                              {t('preset.hourly.basics.heading', {
                                defaultValue: 'Contract Line Preset Basics',
                              })}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                {t('preset.hourly.basics.description', {
                                  defaultValue:
                                    'Name the contract line preset and choose how it should bill by default.',
                                })}
                            </p>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <Label htmlFor="hourly-name">
                                  {t('preset.hourly.basics.nameLabel', {
                                    defaultValue: 'Contract Line Preset Name *',
                                  })}
                                </Label>
                                <Input
                                    id="hourly-name"
                                    value={planName}
                                    onChange={(e) => {
                                        setPlanName(e.target.value);
                                        markBasicsDirty();
                                    }}
                                    placeholder={t('preset.hourly.basics.namePlaceholder', {
                                      defaultValue: 'e.g. Time & Materials Support',
                                    })}
                                    required
                                />
                            </div>
                            <div>
                                <Label htmlFor="hourly-frequency">
                                  {t('preset.hourly.basics.billingFrequencyLabel', {
                                    defaultValue: 'Billing Frequency *',
                                  })}
                                </Label>
                                <CustomSelect
                                    id="hourly-frequency"
                                    value={billingFrequency}
                                    onValueChange={(value) => {
                                        setBillingFrequency(value);
                                        markBasicsDirty();
                                    }}
                                    options={billingFrequencyOptions}
                                    placeholder={t('preset.hourly.basics.billingFrequencyPlaceholder', {
                                      defaultValue: 'Select billing frequency',
                                    })}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
                            <div>
                                <Label htmlFor="minimum-billable-time">
                                  {t('preset.hourly.basics.minimumBillableTimeLabel', {
                                    defaultValue: 'Minimum Billable Time (minutes)',
                                  })}
                                </Label>
                                <Input
                                    id="minimum-billable-time"
                                    type="number"
                                    min="0"
                                    value={minimumBillableTime ?? ''}
                                    onChange={(e) => {
                                        setMinimumBillableTime(e.target.value ? parseInt(e.target.value) : undefined);
                                        markBasicsDirty();
                                    }}
                                    placeholder={t('preset.hourly.basics.minutesPlaceholder', {
                                      defaultValue: 'e.g., 15',
                                    })}
                                />
                                <p className="text-sm text-muted-foreground mt-1">
                                  {t('preset.hourly.basics.minimumBillableTimeHelp', {
                                    defaultValue:
                                      'e.g., 15 minutes - any time entry less than this will be rounded up',
                                  })}
                                </p>
                            </div>
                            <div>
                                <Label htmlFor="round-up-to-nearest">
                                  {t('preset.hourly.basics.roundUpToNearestLabel', {
                                    defaultValue: 'Round Up To Nearest (minutes)',
                                  })}
                                </Label>
                                <Input
                                    id="round-up-to-nearest"
                                    type="number"
                                    min="0"
                                    value={roundUpToNearest ?? ''}
                                    onChange={(e) => {
                                        setRoundUpToNearest(e.target.value ? parseInt(e.target.value) : undefined);
                                        markBasicsDirty();
                                    }}
                                    placeholder={t('preset.hourly.basics.minutesPlaceholder', {
                                      defaultValue: 'e.g., 15',
                                    })}
                                />
                                <p className="text-sm text-muted-foreground mt-1">
                                  {t('preset.hourly.basics.roundUpToNearestHelp', {
                                    defaultValue:
                                      'e.g., 15 minutes - time entries will be rounded up to the nearest interval',
                                  })}
                                </p>
                            </div>
                        </div>
                    </section>

                    <div className="flex justify-end gap-2 pt-4 border-t">
                        <Button
                            id="reset-hourly-plan-basics"
                            variant="outline"
                            onClick={handleResetPlanBasics}
                            disabled={isSavingBasics || !isBasicsDirty}
                        >
                            {t('common.actions.reset', { defaultValue: 'Reset' })}
                        </Button>
                        <Button
                            id="save-hourly-plan-basics"
                            onClick={handleSavePlanBasics}
                            disabled={isSavingBasics || !isBasicsDirty}
                        >
                            {isSavingBasics
                              ? t('common.actions.saving', { defaultValue: 'Saving...' })
                              : t('common.actions.saveChanges', { defaultValue: 'Save Changes' })}
                        </Button>
                    </div>
                </CardContent>
            </Card>


            {/* Add Services to Contract Line Preset */}
            <Card>
                <CardHeader>
                    <CardTitle>
                      {t('preset.hourly.services.manageCardTitle', {
                        defaultValue: 'Manage Contract Line Preset Services',
                      })}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <HourlyContractLinePresetServicesList presetId={presetId} onServiceAdded={handleServicesChanged} />
                </CardContent>
            </Card>
        </div>
    </Tooltip.Provider>
  );
}
