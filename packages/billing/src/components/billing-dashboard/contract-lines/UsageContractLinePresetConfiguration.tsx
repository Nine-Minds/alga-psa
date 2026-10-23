// server/src/components/billing-dashboard/contract-lines/UsageContractLinePresetConfiguration.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import Spinner from '@alga-psa/ui/components/Spinner';

// Import actions and types
import { IContractLinePreset } from '@alga-psa/types';
import { getContractLinePresetById, updateContractLinePreset } from '@alga-psa/billing/actions/contractLinePresetActions'; // Added action to get base plan details
import { useBillingFrequencyOptions } from '@alga-psa/billing/hooks/useBillingEnumOptions';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

import UsageContractLinePresetServicesList from './UsageContractLinePresetServicesList';
const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

interface UsagePresetConfigurationProps {
  presetId: string;
  className?: string;
}

export function UsagePresetConfiguration({
  presetId,
  className = '',
}: UsagePresetConfigurationProps) {
  const { t } = useTranslation('msp/contract-lines');
  const billingFrequencyOptions = useBillingFrequencyOptions();
  // State for the base plan details
  const [plan, setPlan] = useState<IContractLinePreset | null>(null);

  // Plan basics state for inline editing
  const [planName, setPlanName] = useState('');
  const [billingFrequency, setBillingFrequency] = useState<string>('monthly');
  const [planBasicsErrors, setPlanBasicsErrors] = useState<string[]>([]);
  const [isSavingBasics, setIsSavingBasics] = useState(false);
  const [isBasicsDirty, setIsBasicsDirty] = useState(false);
  const tenant = useTenant()!;

  const markBasicsDirty = () => setIsBasicsDirty(true);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- Data Fetching ---
  const fetchPlanData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPlan(null); // Reset plan on fetch
    try {
      // Fetch base plan details. Preset services live in
      // contract_line_preset_services and are managed by the services list
      // below, which loads them itself.
      const fetchedPlan = await getContractLinePresetById(presetId);
      if (isReturnedActionError(fetchedPlan)) {
        setError(getErrorMessage(fetchedPlan));
        return;
      }
      if (!fetchedPlan || fetchedPlan.contract_line_type !== 'Usage') {
        setError(t('preset.usage.errors.invalidPlanTypeOrNotFound', {
          defaultValue: 'Invalid plan type or plan not found.',
        }));
        return;
      }
      setPlan(fetchedPlan); // Store base plan details

      // Populate plan basics form fields
      setPlanName(fetchedPlan.preset_name);
      setBillingFrequency(fetchedPlan.billing_frequency);
      setIsBasicsDirty(false);
    } catch (err) {
      console.error('Error fetching plan services or configurations:', err);
      setError(t('preset.usage.errors.failedToLoadPlanServicesOrConfigurations', {
        defaultValue: 'Failed to load plan services or configurations. Please try again.',
      }));
    } finally {
      setLoading(false);
    }
  }, [presetId, t]);

  useEffect(() => {
    fetchPlanData();
  }, [fetchPlanData]);

  // --- Plan Basics Handlers ---
  const validatePlanBasics = (): string[] => {
    const errors: string[] = [];
    if (!planName.trim()) {
      errors.push(t('preset.usage.basics.validation.contractLinePresetName', {
        defaultValue: 'Contract line preset name',
      }));
    }
    if (!billingFrequency) {
      errors.push(t('preset.usage.basics.validation.billingFrequency', {
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
      const planData: Partial<IContractLinePreset> = {
        preset_name: planName,
        billing_frequency: billingFrequency,
        tenant,
      };

      if (plan?.preset_id) {
        const result = await updateContractLinePreset(plan.preset_id, planData);
        if (isReturnedActionError(result)) {
          setPlanBasicsErrors([getErrorMessage(result)]);
          return;
        }
      }

      await fetchPlanData();
      setIsBasicsDirty(false);
    } catch (error) {
      console.error('Error saving contract line preset basics:', error);
      const errorMessage = error instanceof Error
        ? error.message
        : t('preset.usage.errors.failedToSaveContractLinePreset', {
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
      setIsBasicsDirty(false);
      setPlanBasicsErrors([]);
    }
  };

  // Callback to refresh data when services are added/removed in the child component
  const handleServicesChanged = useCallback(() => {
    console.log('Services changed, refetching plan data...');
    fetchPlanData();
  }, [fetchPlanData]);

  // --- Rendering ---
  if (loading) {
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

  return (
      <div className={`space-y-6 ${className}`}>
          {/* Contract Line Preset Basics - Inline Editing */}
          <Card>
              <CardHeader>
                  <CardTitle>
                    {t('preset.usage.basics.cardTitle', {
                      defaultValue: 'Edit Contract Line Preset: {{name}} (Usage)',
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
                            {t('preset.usage.basics.heading', {
                              defaultValue: 'Contract Line Preset Basics',
                            })}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                              {t('preset.usage.basics.description', {
                                defaultValue:
                                  'Name the contract line preset and choose how it should bill by default.',
                              })}
                          </p>
                      </div>
                      <div className="space-y-3">
                          <div>
                              <Label htmlFor="name">
                                {t('preset.usage.basics.nameLabel', {
                                  defaultValue: 'Contract Line Preset Name *',
                                })}
                              </Label>
                              <Input
                                  id="name"
                                  value={planName}
                                  onChange={(e) => {
                                      setPlanName(e.target.value);
                                      markBasicsDirty();
                                  }}
                                  placeholder={t('preset.usage.basics.namePlaceholder', {
                                    defaultValue: 'e.g. Usage-Based Services',
                                  })}
                                  required
                              />
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                  <Label htmlFor="frequency">
                                    {t('preset.usage.basics.billingFrequencyLabel', {
                                      defaultValue: 'Billing Frequency *',
                                    })}
                                  </Label>
                                  <CustomSelect
                                      id="frequency"
                                      value={billingFrequency}
                                      onValueChange={(value) => {
                                          setBillingFrequency(value);
                                          markBasicsDirty();
                                      }}
                                      options={billingFrequencyOptions}
                                      placeholder={t('preset.usage.basics.billingFrequencyPlaceholder', {
                                        defaultValue: 'Select billing frequency',
                                      })}
                                  />
                              </div>
                          </div>
                      </div>
                  </section>

                  <div className="flex justify-end gap-2 pt-4 border-t">
                      <Button
                          id="reset-usage-plan-basics"
                          variant="outline"
                          onClick={handleResetPlanBasics}
                          disabled={isSavingBasics || !isBasicsDirty}
                      >
                          {t('common.actions.reset', { defaultValue: 'Reset' })}
                      </Button>
                      <Button
                          id="save-usage-plan-basics"
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

          <Card>
              <CardHeader>
                  <CardTitle>
                    {t('preset.usage.services.manageCardTitle', {
                      defaultValue: 'Manage Contract Line Preset Services',
                    })}
                  </CardTitle>
              </CardHeader>
              <CardContent>
                  <UsageContractLinePresetServicesList presetId={presetId} onServiceAdded={handleServicesChanged} />
              </CardContent>
          </Card>
      </div>
  );
}
