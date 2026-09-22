'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { createCustomContractLine, CreateCustomContractLineInput, CustomContractLineServiceConfig } from '@alga-psa/billing/actions/contractLinePresetActions';
import { Package, Clock, Activity, Plus, X, Coins } from 'lucide-react';
import { useBillingFrequencyOptions } from '@alga-psa/billing/hooks/useBillingEnumOptions';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { BucketOverlayFields } from './BucketOverlayFields';
import { BucketOverlayInput } from './ContractWizard';
import { ServiceCatalogPicker } from './ServiceCatalogPicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

import { UsageServiceConfigPanel } from '../service-configurations/UsageServiceConfigPanel';
import { FixedServiceConfigPanel } from '../service-configurations/FixedServiceConfigPanel';
import type { IContractLineServiceRateTier } from '@alga-psa/types';

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

type PlanType = 'Fixed' | 'Hourly' | 'Usage';

interface CreateCustomContractLineDialogProps {
  isOpen: boolean;
  onClose: () => void;
  contractId: string;
  currencyCode?: string;
  onCreated: () => Promise<void>;
}

export const CreateCustomContractLineDialog: React.FC<CreateCustomContractLineDialogProps> = ({
  isOpen,
  onClose,
  contractId,
  currencyCode,
  onCreated,
}) => {
  const { t } = useTranslation('msp/contracts');
  const { money: formatMoney, symbol: currencySymbol } = useCurrencyFormat();
  const money = (cents: number) => formatMoney(cents, currencyCode);
  const symbol = () => currencySymbol(currencyCode);
  const billingFrequencyOptions = useBillingFrequencyOptions();
  const [planName, setPlanName] = useState('');
  const [planType, setPlanType] = useState<PlanType | null>(null);
  const [billingFrequency, setBillingFrequency] = useState<string>('monthly');
  const [billingTiming, setBillingTiming] = useState<'arrears' | 'advance'>('arrears');

  // Fixed plan state
  const [baseRate, setBaseRate] = useState<number | undefined>(undefined);
  const [baseRateInput, setBaseRateInput] = useState<string>('');
  const [billingCycleAlignment, setBillingCycleAlignment] = useState<'start' | 'end' | 'prorated'>('start');
  const [enableProration, setEnableProration] = useState<boolean>(false);

  // Services state
  const [fixedServices, setFixedServices] = useState<Array<{ service_id: string; service_name: string; quantity: number; pricing_basis: 'bundle' | 'unit'; unit_rate?: number | null }>>([]);
  const [hourlyServices, setHourlyServices] = useState<Array<{
    service_id: string;
    service_name: string;
    hourly_rate: number | undefined;
    bucket_overlay?: BucketOverlayInput | null;
  }>>([]);
  const [hourlyServiceRateInputs, setHourlyServiceRateInputs] = useState<Record<number, string>>({});
  const [usageServices, setUsageServices] = useState<Array<{
    service_id: string;
    service_name: string;
    unit_rate: number | undefined;
    unit_of_measure: string;
    measurement_mode: 'additive' | 'period_total';
    minimum_usage: number;
    enable_tiered_pricing: boolean;
    rate_tiers: IContractLineServiceRateTier[];
    bucket_overlay?: BucketOverlayInput | null;
  }>>([]);
  const [usageServiceRateInputs, setUsageServiceRateInputs] = useState<Record<number, string>>({});

  // Hourly plan state
  const [minimumBillableTime, setMinimumBillableTime] = useState<number | undefined>(undefined);
  const [roundUpToNearest, setRoundUpToNearest] = useState<number | undefined>(undefined);

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Load services when dialog opens
  useEffect(() => {
    if (isOpen) {
      // Catalog options are fetched server-side on demand via ServiceCatalogPicker.
    } else {
      resetForm();
    }
  }, [isOpen]);

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const validateForm = (): string[] => {
    const errors: string[] = [];
    if (!planName.trim()) {
      errors.push(t('createCustomLine.validation.contractLineNameRequired', {
        defaultValue: 'Contract Line Name is required',
      }));
    }
    if (!billingFrequency) {
      errors.push(t('createCustomLine.validation.billingFrequencyRequired', {
        defaultValue: 'Billing frequency is required',
      }));
    }
    if (!planType) {
      errors.push(t('createCustomLine.validation.contractLineTypeRequired', {
        defaultValue: 'Contract Line Type is required',
      }));
    }

    if (planType === 'Fixed') {
      if (fixedServices.length === 0) {
        errors.push(t('createCustomLine.validation.fixedServiceRequired', {
          defaultValue: 'At least one fixed service or product is required',
        }));
      }
      fixedServices.forEach((service, index) => {
        if (!Number.isFinite(service.quantity) || service.quantity < 0) {
          errors.push(t('createCustomLine.validation.invalidQuantity', { defaultValue: 'Quantity must be zero or greater.' }));
        }
        if (service.pricing_basis === 'unit' && (service.unit_rate == null || !Number.isFinite(service.unit_rate) || service.unit_rate < 0)) {
          errors.push(t('createCustomLine.validation.recurringUnitRateRequired', { defaultValue: 'Enter a unit rate for each recurring service.' }));
        }
        if (!service.service_id) {
          errors.push(t('createCustomLine.validation.fixedServiceSelectRequired', {
            defaultValue: 'Item {{index}}: Please select a service or product',
            index: index + 1,
          }));
        }
      });
    } else if (planType === 'Hourly') {
      if (hourlyServices.length === 0) {
        errors.push(t('createCustomLine.validation.hourlyServiceRequired', {
          defaultValue: 'At least one hourly service is required',
        }));
      }
      hourlyServices.forEach((service, index) => {
        if (!service.service_id) {
          errors.push(t('createCustomLine.validation.hourlyServiceSelectRequired', {
            defaultValue: 'Service {{index}}: Please select a service',
            index: index + 1,
          }));
        }
        if (!service.hourly_rate || service.hourly_rate === 0) {
          errors.push(t('createCustomLine.validation.hourlyRateRequired', {
            defaultValue: 'Service {{index}}: Hourly rate is required',
            index: index + 1,
          }));
        }
      });
    } else if (planType === 'Usage') {
      if (usageServices.length === 0) {
        errors.push(t('createCustomLine.validation.usageServiceRequired', {
          defaultValue: 'At least one usage-based service is required',
        }));
      }
      usageServices.forEach((service, index) => {
        if (!service.service_id) {
          errors.push(t('createCustomLine.validation.usageServiceSelectRequired', {
            defaultValue: 'Service {{index}}: Please select a service',
            index: index + 1,
          }));
        }
        if (!service.unit_rate || service.unit_rate === 0) {
          errors.push(t('createCustomLine.validation.unitRateRequired', {
            defaultValue: 'Service {{index}}: Unit rate is required',
            index: index + 1,
          }));
        }
        if (!service.unit_of_measure?.trim()) {
          errors.push(t('createCustomLine.validation.unitOfMeasureRequired', {
            defaultValue: 'Service {{index}}: Unit of measure is required',
            index: index + 1,
          }));
        }
      });
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
      // Build services array based on plan type
      const serviceConfigs: CustomContractLineServiceConfig[] = [];

      if (planType === 'Fixed') {
        fixedServices.forEach(service => {
          if (service.service_id) {
            serviceConfigs.push({
              service_id: service.service_id,
              quantity: service.quantity,
              pricing_basis: service.pricing_basis,
              custom_rate: service.unit_rate ?? undefined,
            });
          }
        });
      } else if (planType === 'Hourly') {
        hourlyServices.forEach(service => {
          if (service.service_id && service.hourly_rate) {
            serviceConfigs.push({
              service_id: service.service_id,
              custom_rate: service.hourly_rate,
              bucket_overlay: service.bucket_overlay ? {
                total_minutes: service.bucket_overlay.total_minutes ?? 0,
                overage_rate: service.bucket_overlay.overage_rate ?? 0,
                allow_rollover: service.bucket_overlay.allow_rollover ?? false,
                billing_period: (service.bucket_overlay.billing_period || billingFrequency) as 'weekly' | 'monthly'
              } : null,
            });
          }
        });
      } else if (planType === 'Usage') {
        usageServices.forEach(service => {
          if (service.service_id && service.unit_rate) {
            serviceConfigs.push({
              service_id: service.service_id,
              custom_rate: service.unit_rate,
              unit_of_measure: service.unit_of_measure || 'unit',
              measurement_mode: service.measurement_mode,
              minimum_usage: service.minimum_usage,
              enable_tiered_pricing: service.enable_tiered_pricing,
              rate_tiers: service.rate_tiers.map(({ min_quantity, max_quantity, rate }) => ({ min_quantity, max_quantity: max_quantity ?? null, rate })),
              bucket_overlay: service.bucket_overlay ? {
                total_minutes: service.bucket_overlay.total_minutes ?? 0,
                overage_rate: service.bucket_overlay.overage_rate ?? 0,
                allow_rollover: service.bucket_overlay.allow_rollover ?? false,
                billing_period: (service.bucket_overlay.billing_period || billingFrequency) as 'weekly' | 'monthly'
              } : null,
            });
          }
        });
      }

      const input: CreateCustomContractLineInput = {
        contract_line_name: planName,
        contract_line_type: planType!,
        billing_frequency: billingFrequency,
        billing_timing: billingTiming,
        services: serviceConfigs,
        ...(planType === 'Fixed' ? {
          base_rate: fixedServices.some(service => service.pricing_basis === 'bundle') ? baseRate ?? null : null,
          enable_proration: enableProration,
          billing_cycle_alignment: billingCycleAlignment,
        } : {}),
        ...(planType === 'Hourly' ? {
          minimum_billable_time: minimumBillableTime ?? 15,
          round_up_to_nearest: roundUpToNearest ?? 15,
        } : {}),
      };

      const result = await createCustomContractLine(contractId, input);
      if (isReturnedActionError(result)) {
        setValidationErrors([getErrorMessage(result)]);
        return;
      }
      await onCreated();
      onClose();
    } catch (error) {
      console.error('Error creating contract line:', error);
      const errorMessage = error instanceof Error
        ? error.message
        : t('createCustomLine.validation.failedToCreate', {
          defaultValue: 'Failed to create contract line',
        });
      setValidationErrors([errorMessage]);
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setPlanName('');
    setPlanType(null);
    setBillingFrequency('monthly');
    setBillingTiming('arrears');
    setBaseRate(undefined);
    setBaseRateInput('');
    setEnableProration(false);
    setBillingCycleAlignment('start');
    setMinimumBillableTime(undefined);
    setRoundUpToNearest(undefined);
    setFixedServices([]);
    setHourlyServices([]);
    setHourlyServiceRateInputs({});
    setUsageServices([]);
    setUsageServiceRateInputs({});
    setValidationErrors([]);
    setHasAttemptedSubmit(false);
  };

  const formatCurrency = (cents: number | undefined) => {
    if (!cents) return money(0);
    return money(Number(cents));
  };

  const renderFixedConfig = () => {
    const handleAddFixedService = () => {
      setFixedServices([...fixedServices, { service_id: '', service_name: '', quantity: 1, pricing_basis: 'bundle' }]);
    };

    const handleRemoveFixedService = (index: number) => {
      const newServices = fixedServices.filter((_, i) => i !== index);
      setFixedServices(newServices);
    };

    const handleQuantityChange = (index: number, quantity: number) => {
      const newServices = [...fixedServices];
      newServices[index] = { ...newServices[index], quantity };
      setFixedServices(newServices);
    };

    return (
      <div className="space-y-4">
        <Alert variant="info">
          <AlertDescription className="text-sm">
            <strong>
              {t('createCustomLine.fixedServicesAlertHeading', {
                defaultValue: 'Fixed Fee Services',
              })}
              :
            </strong>{' '}
            {t('createCustomLine.fixedServicesPricingIntent', {
              defaultValue: 'Choose a bundle price or recurring seats/units for each service.',
            })}{' '}
            {t('createCustomLine.fixedServicesPricingExplanation', {
              defaultValue: 'Bundle allocations share the line base rate. Recurring seats bill the agreed quantity × unit rate each period without usage records.',
            })}
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            {t('createCustomLine.servicesAndProductsLabel', {
              defaultValue: 'Services & Products',
            })}
          </Label>

          {fixedServices.map((service, index) => (
            <div key={index} className="flex items-start gap-3 p-4 border border-[rgb(var(--color-border-200))] rounded-md bg-muted">
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`fixed-service-${index}`} className="text-sm">
                    {t('createCustomLine.itemLabel', {
                      defaultValue: 'Item {{index}}',
                      index: index + 1,
                    })}
                  </Label>
                  <ServiceCatalogPicker
                    value={service.service_id}
                    selectedLabel={service.service_name}
                    onSelect={(item) => {
                      const next = [...fixedServices];
                      next[index] = {
                        ...next[index],
                        service_id: item.service_id,
                        service_name: item.service_name
                      };
                      setFixedServices(next);
                    }}
                    itemKinds={['service', 'product']}
                    placeholder={t('createCustomLine.selectItemPlaceholder', {
                      defaultValue: 'Select an item',
                    })}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`quantity-${index}`} className="text-sm">
                    {t(service.pricing_basis === 'unit' ? 'createCustomLine.recurringQuantity' : 'createCustomLine.allocationQuantity', {
                      defaultValue: service.pricing_basis === 'unit' ? 'Recurring quantity' : 'Allocation quantity',
                    })}
                  </Label>
                  <Input
                    id={`quantity-${index}`}
                    type="number"
                    value={service.quantity}
                    onChange={(e) => handleQuantityChange(index, Number(e.target.value))}
                    min="0"
                    className="w-24"
                  />
                </div>
                <FixedServiceConfigPanel
                  idPrefix={`custom-fixed-${index}-`}
                  currencyCode={currencyCode}
                  configuration={{ pricing_basis: service.pricing_basis, base_rate: service.unit_rate }}
                  quantity={service.quantity}
                  planFixedConfig={{ enable_proration: enableProration, billing_cycle_alignment: billingCycleAlignment }}
                  onConfigurationChange={updates => setFixedServices(current => current.map((item, i) => i === index
                    ? { ...item, pricing_basis: updates.pricing_basis ?? item.pricing_basis,
                        unit_rate: updates.base_rate !== undefined ? updates.base_rate : item.unit_rate }
                    : item))}
                  onPlanFixedConfigChange={updates => {
                    setEnableProration(updates.enable_proration ?? enableProration);
                    setBillingCycleAlignment(updates.billing_cycle_alignment ?? billingCycleAlignment);
                  }}
                  disabled={isSaving}
                />
              </div>

              <Button
                id={`remove-fixed-service-${index}`}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveFixedService(index)}
                className="mt-8 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            id="add-fixed-service-button"
            type="button"
            variant="outline"
            onClick={handleAddFixedService}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('createCustomLine.addItem', {
              defaultValue: 'Add Item',
            })}
          </Button>
        </div>

        {fixedServices.length === 0 && (
          <div className="p-4 bg-muted border border-[rgb(var(--color-border-200))] rounded-md">
            <p className="text-sm text-muted-foreground text-center">
              {t('createCustomLine.noFixedItems', {
                defaultValue: 'No fixed fee items added yet. Click "Add Item" above to get started.',
              })}
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderHourlyConfig = () => {
    const handleAddHourlyService = () => {
      setHourlyServices([...hourlyServices, { service_id: '', service_name: '', hourly_rate: undefined }]);
    };

    const handleRemoveHourlyService = (index: number) => {
      const newServices = hourlyServices.filter((_, i) => i !== index);
      setHourlyServices(newServices);
      const newInputs = { ...hourlyServiceRateInputs };
      delete newInputs[index];
      setHourlyServiceRateInputs(newInputs);
    };

    const handleHourlyRateChange = (index: number, rate: number) => {
      const newServices = [...hourlyServices];
      newServices[index] = { ...newServices[index], hourly_rate: rate };
      setHourlyServices(newServices);
    };

    return (
      <div className="space-y-4">
        <Alert variant="info">
          <AlertDescription className="text-sm">
            <strong>
              {t('createCustomLine.hourlyServicesAlertHeading', {
                defaultValue: 'Hourly Services',
              })}
              :
            </strong>{' '}
            {t('createCustomLine.hourlyServicesAlertDescription', {
              defaultValue: 'These services are billed based on actual time tracked.',
            })}
          </AlertDescription>
        </Alert>

        {hourlyServices.length > 0 && (
          <>
            <div className="space-y-2">
              <Label htmlFor="minimum-billable-time" className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {t('createCustomLine.minimumBillableTimeLabel', {
                  defaultValue: 'Minimum Billable Time (minutes)',
                })}
              </Label>
              <Input
                id="minimum-billable-time"
                type="number"
                value={minimumBillableTime || ''}
                onChange={(e) => setMinimumBillableTime(parseInt(e.target.value) || undefined)}
                placeholder="15"
                min="0"
                step="15"
                className="w-32"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="round-up-to-nearest" className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {t('createCustomLine.roundUpToNearestLabel', {
                  defaultValue: 'Round Up To Nearest (minutes)',
                })}
              </Label>
              <Input
                id="round-up-to-nearest"
                type="number"
                value={roundUpToNearest || ''}
                onChange={(e) => setRoundUpToNearest(parseInt(e.target.value) || undefined)}
                placeholder="15"
                min="0"
                step="15"
                className="w-32"
              />
            </div>
          </>
        )}

        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {t('createCustomLine.hourlyServicesLabel', {
              defaultValue: 'Hourly Services',
            })}
          </Label>

          {hourlyServices.map((service, index) => (
            <div key={index} className="flex items-start gap-3 p-4 border border-[rgb(var(--color-border-200))] rounded-md bg-muted">
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`hourly-service-${index}`} className="text-sm">
                    {t('createCustomLine.serviceLabel', {
                      defaultValue: 'Service {{index}}',
                      index: index + 1,
                    })}
                  </Label>
                  <ServiceCatalogPicker
                    value={service.service_id}
                    selectedLabel={service.service_name}
                    onSelect={(item) => {
                      const next = [...hourlyServices];
                      next[index] = {
                        ...next[index],
                        service_id: item.service_id,
                        service_name: item.service_name,
                        hourly_rate: item.default_rate || undefined
                      };
                      setHourlyServices(next);
                      if (item.default_rate) {
                        setHourlyServiceRateInputs((prev) => ({
                          ...prev,
                          [index]: (item.default_rate / 100).toFixed(2)
                        }));
                      }
                    }}
                    itemKinds={['service']}
                    placeholder={t('createCustomLine.selectServicePlaceholder', {
                      defaultValue: 'Select a service',
                    })}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`hourly-rate-${index}`} className="text-sm flex items-center gap-2">
                    <Coins className="h-3 w-3" />
                    {t('createCustomLine.hourlyRateLabel', {
                      defaultValue: 'Hourly Rate',
                    })}
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{symbol()}</span>
                    <Input
                      id={`hourly-rate-${index}`}
                      type="text"
                      inputMode="decimal"
                      value={hourlyServiceRateInputs[index] || ''}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^0-9.]/g, '');
                        const decimalCount = (value.match(/\./g) || []).length;
                        if (decimalCount <= 1) {
                          setHourlyServiceRateInputs(prev => ({ ...prev, [index]: value }));
                        }
                      }}
                      onBlur={() => {
                        const inputValue = hourlyServiceRateInputs[index] || '';
                        if (inputValue.trim() === '' || inputValue === '.') {
                          setHourlyServiceRateInputs(prev => ({ ...prev, [index]: '' }));
                          handleHourlyRateChange(index, 0);
                        } else {
                          const dollars = parseFloat(inputValue) || 0;
                          const cents = Math.round(dollars * 100);
                          handleHourlyRateChange(index, cents);
                          setHourlyServiceRateInputs(prev => ({ ...prev, [index]: (cents / 100).toFixed(2) }));
                        }
                      }}
                      placeholder={t('createCustomLine.moneyPlaceholder', { defaultValue: '0.00' })}
                      className="pl-7"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {service.hourly_rate
                      ? t('createCustomLine.hourlyRateDisplay', {
                        defaultValue: '{{rate}}/hour',
                        rate: formatCurrency(service.hourly_rate),
                      })
                      : t('createCustomLine.enterHourlyRate', {
                        defaultValue: 'Enter hourly rate',
                      })}
                  </p>
                </div>

                {/* Bucket Overlay Section */}
                <div className="space-y-3 pt-3 border-t border-dashed border-[rgb(var(--color-border-200))]">
                  <SwitchWithLabel
                    label={t('createCustomLine.addBucketOfHours', {
                      defaultValue: 'Add bucket of hours',
                    })}
                    checked={Boolean(service.bucket_overlay)}
                    onCheckedChange={(checked) => {
                      const newServices = [...hourlyServices];
                      if (checked) {
                        newServices[index] = {
                          ...newServices[index],
                          bucket_overlay: {
                            total_minutes: undefined,
                            overage_rate: undefined,
                            allow_rollover: false,
                            billing_period: billingFrequency as 'weekly' | 'monthly'
                          }
                        };
                      } else {
                        newServices[index] = {
                          ...newServices[index],
                          bucket_overlay: null
                        };
                      }
                      setHourlyServices(newServices);
                    }}
                  />
                  {service.bucket_overlay && (
                    <BucketOverlayFields
                      mode="hours"
                      value={service.bucket_overlay}
                      onChange={(overlay) => {
                        const newServices = [...hourlyServices];
                        newServices[index] = {
                          ...newServices[index],
                          bucket_overlay: overlay
                        };
                        setHourlyServices(newServices);
                      }}
                      automationId={`hourly-bucket-${index}`}
                      billingFrequency={billingFrequency}
                    />
                  )}
                </div>
              </div>

              <Button
                id={`remove-hourly-service-${index}`}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveHourlyService(index)}
                className="mt-8 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            id="add-hourly-service-button"
            type="button"
            variant="outline"
            onClick={handleAddHourlyService}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('createCustomLine.addHourlyService', {
              defaultValue: 'Add Hourly Service',
            })}
          </Button>
        </div>

        {hourlyServices.length === 0 && (
          <div className="p-4 bg-muted border border-[rgb(var(--color-border-200))] rounded-md">
            <p className="text-sm text-muted-foreground text-center">
              {t('createCustomLine.noHourlyServices', {
                defaultValue: 'No hourly services added yet. Click "Add Hourly Service" above to get started.',
              })}
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderUsageConfig = () => {
    const handleAddUsageService = () => {
      setUsageServices([...usageServices, { service_id: '', service_name: '', unit_rate: undefined, unit_of_measure: 'unit', measurement_mode: 'additive', minimum_usage: 0, enable_tiered_pricing: false, rate_tiers: [] }]);
    };

    const handleRemoveUsageService = (index: number) => {
      const newServices = usageServices.filter((_, i) => i !== index);
      setUsageServices(newServices);
      const newInputs = { ...usageServiceRateInputs };
      delete newInputs[index];
      setUsageServiceRateInputs(newInputs);
    };

    const handleUsageRateChange = (index: number, rate: number) => {
      const newServices = [...usageServices];
      newServices[index] = { ...newServices[index], unit_rate: rate };
      setUsageServices(newServices);
    };

    return (
      <div className="space-y-4">
        <Alert variant="info">
          <AlertDescription className="text-sm">
            <strong>
              {t('createCustomLine.usageServicesAlertHeading', {
                defaultValue: 'Usage-Based Services',
              })}
              :
            </strong>{' '}
            {t('createCustomLine.usageServicesAlertDescription', {
              defaultValue: 'These services are billed based on actual consumption.',
            })}
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {t('createCustomLine.usageServicesLabel', {
              defaultValue: 'Usage-Based Services',
            })}
          </Label>

          {usageServices.map((service, index) => (
            <div key={index} className="flex items-start gap-3 p-4 border border-[rgb(var(--color-border-200))] rounded-md bg-muted">
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`usage-service-${index}`} className="text-sm">
                    {t('createCustomLine.serviceLabel', {
                      defaultValue: 'Service {{index}}',
                      index: index + 1,
                    })}
                  </Label>
                  <ServiceCatalogPicker
                    value={service.service_id}
                    selectedLabel={service.service_name}
                    onSelect={(item) => {
                      const next = [...usageServices];
                      next[index] = {
                        ...next[index],
                        service_id: item.service_id,
                        service_name: item.service_name,
                        unit_rate: item.default_rate || undefined,
                        unit_of_measure: item.unit_of_measure || 'unit'
                      };
                      setUsageServices(next);
                      if (item.default_rate) {
                        setUsageServiceRateInputs((prev) => ({
                          ...prev,
                          [index]: (item.default_rate / 100).toFixed(2)
                        }));
                      }
                    }}
                    itemKinds={['service']}
                    placeholder={t('createCustomLine.selectServicePlaceholder', {
                      defaultValue: 'Select a service',
                    })}
                    className="w-full"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={`unit-rate-${index}`} className="text-sm flex items-center gap-2">
                      <Coins className="h-3 w-3" />
                      {t('createCustomLine.ratePerUnitLabel', {
                        defaultValue: 'Rate per Unit',
                      })}
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{symbol()}</span>
                      <Input
                        id={`unit-rate-${index}`}
                        type="text"
                        inputMode="decimal"
                        value={usageServiceRateInputs[index] || ''}
                        onChange={(e) => {
                          const value = e.target.value.replace(/[^0-9.]/g, '');
                          const decimalCount = (value.match(/\./g) || []).length;
                          if (decimalCount <= 1) {
                            setUsageServiceRateInputs(prev => ({ ...prev, [index]: value }));
                          }
                        }}
                        onBlur={() => {
                          const inputValue = usageServiceRateInputs[index] || '';
                          if (inputValue.trim() === '' || inputValue === '.') {
                            setUsageServiceRateInputs(prev => ({ ...prev, [index]: '' }));
                            handleUsageRateChange(index, 0);
                          } else {
                            const dollars = parseFloat(inputValue) || 0;
                            const cents = Math.round(dollars * 100);
                            handleUsageRateChange(index, cents);
                            setUsageServiceRateInputs(prev => ({ ...prev, [index]: (cents / 100).toFixed(2) }));
                          }
                        }}
                        placeholder={t('createCustomLine.moneyPlaceholder', { defaultValue: '0.00' })}
                        className="pl-10"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {service.unit_rate
                        ? t('createCustomLine.unitRateDisplay', {
                          defaultValue: '{{rate}}/{{unit}}',
                          rate: formatCurrency(service.unit_rate),
                          unit: service.unit_of_measure || t('createCustomLine.defaultUnit', { defaultValue: 'unit' }),
                        })
                        : t('createCustomLine.enterUnitRate', {
                          defaultValue: 'Enter unit rate',
                        })}
                    </p>
                  </div>

                </div>
                <UsageServiceConfigPanel
                  idPrefix={`custom-usage-${index}-`}
                  configuration={service}
                  rateTiers={service.rate_tiers}
                  onConfigurationChange={updates => setUsageServices(current => current.map((item, i) => i === index ? { ...item, ...updates, measurement_mode: updates.measurement_mode ?? item.measurement_mode, minimum_usage: updates.minimum_usage ?? item.minimum_usage } : item))}
                  onRateTiersChange={tiers => setUsageServices(current => current.map((item, i) => i === index ? { ...item, rate_tiers: tiers } : item))}
                  disabled={isSaving}
                />

                {/* Bucket Overlay Section */}
                <div className="space-y-3 pt-3 border-t border-dashed border-[rgb(var(--color-border-200))]">
                  <SwitchWithLabel
                    label={t('createCustomLine.addBucketOfConsumption', {
                      defaultValue: 'Add bucket of consumption',
                    })}
                    checked={Boolean(service.bucket_overlay)}
                    onCheckedChange={(checked) => {
                      const newServices = [...usageServices];
                      if (checked) {
                        newServices[index] = {
                          ...newServices[index],
                          bucket_overlay: {
                            total_minutes: undefined,
                            overage_rate: undefined,
                            allow_rollover: false,
                            billing_period: billingFrequency as 'weekly' | 'monthly'
                          }
                        };
                      } else {
                        newServices[index] = {
                          ...newServices[index],
                          bucket_overlay: null
                        };
                      }
                      setUsageServices(newServices);
                    }}
                  />
                  {service.bucket_overlay && (
                    <BucketOverlayFields
                      mode="usage"
                      value={service.bucket_overlay}
                      onChange={(overlay) => {
                        const newServices = [...usageServices];
                        newServices[index] = {
                          ...newServices[index],
                          bucket_overlay: overlay
                        };
                        setUsageServices(newServices);
                      }}
                      unitLabel={service.unit_of_measure || t('createCustomLine.defaultUnits', { defaultValue: 'units' })}
                      automationId={`usage-bucket-${index}`}
                      billingFrequency={billingFrequency}
                    />
                  )}
                </div>
              </div>

              <Button
                id={`remove-usage-service-${index}`}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveUsageService(index)}
                className="mt-8 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            id="add-usage-service-button"
            type="button"
            variant="outline"
            onClick={handleAddUsageService}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('createCustomLine.addUsageService', {
              defaultValue: 'Add Usage-Based Service',
            })}
          </Button>
        </div>

        {usageServices.length === 0 && (
          <div className="p-4 bg-muted border border-[rgb(var(--color-border-200))] rounded-md">
            <p className="text-sm text-muted-foreground text-center">
              {t('createCustomLine.noUsageServices', {
                defaultValue: 'No usage-based services added yet. Click "Add Usage-Based Service" above to get started.',
              })}
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('createCustomLine.title', { defaultValue: 'Create Custom Contract Line' })}
      className="max-w-3xl"
      footer={(
        <div className="flex justify-end space-x-2">
          <Button id="custom-contract-line-cancel" variant="outline" onClick={onClose}>
            {t('common.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            id="custom-contract-line-submit"
            type="button"
            onClick={() => (document.getElementById('custom-contract-line-form') as HTMLFormElement | null)?.requestSubmit()}
            disabled={isSaving}
            className={!planName.trim() || !planType || !billingFrequency ? 'opacity-50' : ''}
          >
            {isSaving
              ? t('createCustomLine.creating', { defaultValue: 'Creating...' })
              : t('createCustomLine.create', { defaultValue: 'Create Contract Line' })}
          </Button>
        </div>
      )}
    >
      <DialogContent>
        <form id="custom-contract-line-form" onSubmit={handleSubmit} className="space-y-6" noValidate>
          {hasAttemptedSubmit && validationErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <p className="font-medium mb-2">
                  {t('common.errors.validationPrefix', {
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
                {t('createCustomLine.basicsTitle', { defaultValue: 'Contract Line Basics' })}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('createCustomLine.basicsDescription', {
                  defaultValue: 'Create a custom contract line directly for this contract.',
                })}
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <Label htmlFor="name">
                  {t('createCustomLine.contractLineNameLabel', { defaultValue: 'Contract Line Name *' })}
                </Label>
                <Input
                  id="name"
                  value={planName}
                  onChange={(e) => {
                    setPlanName(e.target.value);
                    clearErrorIfSubmitted();
                  }}
                  placeholder={t('createCustomLine.contractLineNamePlaceholder', {
                    defaultValue: 'e.g. Managed Support - Gold',
                  })}
                  required
                  className={hasAttemptedSubmit && !planName.trim() ? 'border-red-500' : ''}
                />
              </div>
              <div>
                <Label htmlFor="frequency">
                  {t('createCustomLine.billingFrequencyLabel', { defaultValue: 'Billing Frequency *' })}
                </Label>
                <CustomSelect
                  id="frequency"
                  value={billingFrequency}
                  onValueChange={(value) => {
                    setBillingFrequency(value);
                    clearErrorIfSubmitted();
                  }}
                  options={billingFrequencyOptions}
                  placeholder={t('createCustomLine.billingFrequencyPlaceholder', {
                    defaultValue: 'Select billing frequency',
                  })}
                  className={hasAttemptedSubmit && !billingFrequency ? 'ring-1 ring-red-500' : ''}
                />
              </div>
              <div>
                <Label htmlFor="billing-timing">
                  {t('billing.labels.timing', { defaultValue: 'Billing Timing' })}
                </Label>
                <CustomSelect
                  id="billing-timing"
                  value={billingTiming}
                  onValueChange={(value) => setBillingTiming(value as 'arrears' | 'advance')}
                  options={[
                    {
                      value: 'advance',
                      label: t('createCustomLine.billingTiming.advance', {
                        defaultValue: 'Advance (bill at start of period)',
                      }),
                    },
                    {
                      value: 'arrears',
                      label: t('createCustomLine.billingTiming.arrears', {
                        defaultValue: 'Arrears (bill at end of period)',
                      }),
                    }
                  ]}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('createCustomLine.billingTimingHelp', {
                    defaultValue: 'Advance billing is typical for fixed fees; arrears for time/usage-based services.',
                  })}
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold">
                {t('createCustomLine.chooseBillingModel', { defaultValue: 'Choose a Billing Model *' })}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('createCustomLine.chooseBillingModelDescription', {
                  defaultValue: 'Select the billing behavior that fits this offering.',
                })}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {([
                {
                  key: 'Fixed' as PlanType,
                  title: t('createCustomLine.billingModel.fixedTitle', { defaultValue: 'Fixed Fee' }),
                  description: t('createCustomLine.billingModel.fixedSemantics', {
                    defaultValue: 'Bill a bundle price or recurring quantity × unit rate every period.',
                  }),
                  icon: Package,
                  accent: 'text-blue-600',
                },
                {
                  key: 'Hourly' as PlanType,
                  title: t('createCustomLine.billingModel.hourlyTitle', { defaultValue: 'Hourly' }),
                  description: t('createCustomLine.billingModel.hourlyDescription', {
                    defaultValue: 'Bill based on approved time entries.',
                  }),
                  icon: Clock,
                  accent: 'text-emerald-600',
                },
                {
                  key: 'Usage' as PlanType,
                  title: t('createCustomLine.billingModel.usageTitle', { defaultValue: 'Usage-Based' }),
                  description: t('createCustomLine.billingModel.usageDescription', {
                    defaultValue: 'Invoice for units consumed.',
                  }),
                  icon: Activity,
                  accent: 'text-orange-600',
                },
              ] as const).map(({ key, title, description, icon: Icon, accent }) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => {
                    setPlanType(key);
                    clearErrorIfSubmitted();
                  }}
                  className={`text-left p-4 border-2 rounded-lg transition-all focus:outline-none ${
                    planType === key ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/20 dark:border-blue-400' : 'border-[rgb(var(--color-border-200))] hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/15 dark:hover:border-blue-400'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className={`h-8 w-8 mt-1 flex-shrink-0 ${accent}`} />
                    <div>
                      <h4 className="font-semibold text-[rgb(var(--color-text-900))] mb-1">{title}</h4>
                      <p className="text-sm text-muted-foreground">{description}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {planType === 'Fixed' && (
            <section className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {t('createCustomLine.fixedServicesTitle', { defaultValue: 'Fixed Fee Services' })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t('createCustomLine.fixedServicesDescription', {
                    defaultValue: 'Set up services that are billed at a fixed recurring rate.',
                  })}
                </p>
              </div>
              {renderFixedConfig()}

              {fixedServices.some(service => service.pricing_basis === 'bundle') && (
                <>
                  <div className="space-y-2 pt-4 border-t">
                    <Label htmlFor="base-rate">
                      {t('createCustomLine.recurringBaseRateLabel', { defaultValue: 'Recurring Base Rate' })}
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
                            setBaseRateInput(value);
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
                        placeholder={t('createCustomLine.moneyPlaceholder', { defaultValue: '0.00' })}
                        className="pl-10"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('createCustomLine.bundleBaseRateHelp', {
                        defaultValue: 'Recurring fee for bundle-priced services. Recurring seats are billed separately at quantity × unit rate.',
                      })}
                    </p>
                  </div>

                  <div className="border border-[rgb(var(--color-border-200))] rounded-md p-4 bg-card space-y-3">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="enable-proration" className="font-medium text-[rgb(var(--color-text-800))]">
                        {t('createCustomLine.adjustForPartialPeriods', {
                          defaultValue: 'Adjust for Partial Periods',
                        })}
                      </Label>
                      <Switch
                        id="enable-proration"
                        checked={enableProration}
                        onCheckedChange={setEnableProration}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('createCustomLine.adjustForPartialPeriodsHelp', {
                        defaultValue: 'When enabled, the recurring fee scales to the covered portion of a service period when the contract starts or ends inside that period.',
                      })}
                    </p>
                  </div>
                </>
              )}
            </section>
          )}

          {planType === 'Hourly' && (
            <section className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {t('createCustomLine.hourlyServicesTitle', { defaultValue: 'Hourly Services' })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t('createCustomLine.hourlyServicesDescription', {
                    defaultValue: 'Configure services that are billed based on time tracked.',
                  })}
                </p>
              </div>
              {renderHourlyConfig()}
            </section>
          )}

          {planType === 'Usage' && (
            <section className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {t('createCustomLine.usageServicesTitle', { defaultValue: 'Usage-Based Services' })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t('createCustomLine.usageServicesDescription', {
                    defaultValue: 'Configure services that are billed based on usage or consumption.',
                  })}
                </p>
              </div>
              {renderUsageConfig()}
            </section>
          )}

        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateCustomContractLineDialog;
