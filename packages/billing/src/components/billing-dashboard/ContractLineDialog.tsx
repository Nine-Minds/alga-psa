'use client'

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  createContractLinePreset,
  updateContractLinePreset,
  updateContractLinePresetFixedConfig,
  getContractLinePresetFixedConfig,
  updateContractLinePresetServices,
  getContractLinePresetServices,
} from '@alga-psa/billing/actions/contractLinePresetActions';
import { IContractLinePreset } from '@alga-psa/types';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';
import { Package, Clock, Activity, Plus, X, Coins } from 'lucide-react';
import { BILLING_FREQUENCY_OPTIONS } from '@alga-psa/billing/constants/billing';
import { getCurrencySymbol } from '@alga-psa/core';
import { getServiceById } from '@alga-psa/billing/actions';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { BucketOverlayFields } from './contracts/BucketOverlayFields';
import { BucketOverlayInput } from './contracts/ContractWizard';
import { ServiceCatalogPicker } from './contracts/ServiceCatalogPicker';
import { resolveBillingCycleAlignmentForCompatibility } from '@alga-psa/shared/billingClients/billingCycleAlignmentCompatibility';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type PlanType = 'Fixed' | 'Hourly' | 'Usage';

const BILLING_TIMING_OPTIONS = [
  {
    value: 'arrears',
    labelKey: 'dialog.basics.billingTiming.options.arrears',
    defaultLabel: 'Arrears - invoice after the period closes',
  },
  {
    value: 'advance',
    labelKey: 'dialog.basics.billingTiming.options.advance',
    defaultLabel: 'Advance - invoice at the start of the period',
  },
] as const;

interface ContractLineDialogProps {
  onPlanAdded: (newPresetId?: string) => void;
  editingPlan?: IContractLinePreset | null;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
  allServiceTypes: { id: string; name: string; billing_method: 'fixed' | 'hourly' | 'usage'; is_standard: boolean }[];
}

export function ContractLineDialog({ onPlanAdded, editingPlan, onClose, triggerButton }: ContractLineDialogProps) {
  const { t } = useTranslation('msp/contract-lines');
  const [open, setOpen] = useState(false);
  const [planName, setPlanName] = useState('');
  const [planType, setPlanType] = useState<PlanType | null>(null);
  const [billingFrequency, setBillingFrequency] = useState<string>('monthly');
  const [billingTiming, setBillingTiming] = useState<'arrears' | 'advance'>('arrears');

  // Fixed plan state
  const [baseRate, setBaseRate] = useState<number | undefined>(undefined);
  const [baseRateInput, setBaseRateInput] = useState<string>('');
  const [enableProration, setEnableProration] = useState<boolean>(false);
  const [billingCycleAlignment, setBillingCycleAlignment] = useState<'start' | 'end' | 'prorated'>('start');

  // Services state
  const [fixedServices, setFixedServices] = useState<Array<{ service_id: string; service_name: string; quantity: number }>>([]);
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
    bucket_overlay?: BucketOverlayInput | null;
  }>>([]);
  const [usageServiceRateInputs, setUsageServiceRateInputs] = useState<Record<number, string>>({});

  // Hourly plan state
  const [minimumBillableTime, setMinimumBillableTime] = useState<number | undefined>(undefined);
  const [roundUpToNearest, setRoundUpToNearest] = useState<number | undefined>(undefined);

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const tenant = useTenant()!;

  const markDirty = () => setIsDirty(true);

  // Catalog options are fetched server-side on demand via ServiceCatalogPicker.

  // Open dialog when editingPlan is provided
  useEffect(() => {
    if (editingPlan) {
      setOpen(true);
      setPlanName(editingPlan.preset_name);
      setBillingFrequency(editingPlan.billing_frequency);
      setPlanType(editingPlan.contract_line_type as PlanType);
      setBillingTiming(editingPlan.billing_timing ?? 'arrears');
      if (editingPlan.preset_id && editingPlan.contract_line_type === 'Fixed') {
        getContractLinePresetFixedConfig(editingPlan.preset_id)
          .then((cfg) => {
            if (cfg) {
              setBaseRate(cfg.base_rate ?? undefined);
              setEnableProration(!!cfg.enable_proration);
              setBillingCycleAlignment(
                resolveBillingCycleAlignmentForCompatibility({
                  billingCycleAlignment: cfg.billing_cycle_alignment,
                  enableProration: cfg.enable_proration,
                }) as any,
              );
            }
          })
          .catch(() => {});
      }
      // Load services for existing preset
      if (editingPlan.preset_id) {
        getContractLinePresetServices(editingPlan.preset_id)
          .then(async (presetServices) => {
            const resolved = await Promise.all(
              presetServices.map(async (s) => {
                const svc = await getServiceById(s.service_id);
                return { preset: s, serviceName: svc?.service_name ?? '' };
              })
            );

            if (editingPlan.contract_line_type === 'Fixed') {
              setFixedServices(
                resolved.map(({ preset, serviceName }) => ({
                  service_id: preset.service_id,
                  service_name: serviceName,
                  quantity: preset.quantity || 1,
                }))
              );
            } else if (editingPlan.contract_line_type === 'Hourly') {
              const next = resolved.map(({ preset, serviceName }) => ({
                service_id: preset.service_id,
                service_name: serviceName,
                hourly_rate: preset.custom_rate ?? undefined,
                bucket_overlay:
                  preset.bucket_total_minutes != null ||
                  preset.bucket_overage_rate != null ||
                  preset.bucket_allow_rollover != null
                    ? {
                        total_minutes: preset.bucket_total_minutes ?? undefined,
                        overage_rate: preset.bucket_overage_rate ?? undefined,
                        allow_rollover: preset.bucket_allow_rollover ?? false,
                        billing_period: editingPlan.billing_frequency as 'weekly' | 'monthly',
                      }
                    : null,
              }));
              setHourlyServices(next);
              setHourlyServiceRateInputs(
                next.reduce<Record<number, string>>((acc, s, idx) => {
                  if (s.hourly_rate) acc[idx] = (s.hourly_rate / 100).toFixed(2);
                  return acc;
                }, {})
              );
            } else if (editingPlan.contract_line_type === 'Usage') {
              const next = resolved.map(({ preset, serviceName }) => ({
                service_id: preset.service_id,
                service_name: serviceName,
                unit_rate: preset.custom_rate ?? undefined,
                unit_of_measure: preset.unit_of_measure || '',
                bucket_overlay:
                  preset.bucket_total_minutes != null ||
                  preset.bucket_overage_rate != null ||
                  preset.bucket_allow_rollover != null
                    ? {
                        total_minutes: preset.bucket_total_minutes ?? undefined,
                        overage_rate: preset.bucket_overage_rate ?? undefined,
                        allow_rollover: preset.bucket_allow_rollover ?? false,
                        billing_period: editingPlan.billing_frequency as 'weekly' | 'monthly',
                      }
                    : null,
              }));
              setUsageServices(next);
              setUsageServiceRateInputs(
                next.reduce<Record<number, string>>((acc, s, idx) => {
                  if (s.unit_rate) acc[idx] = (s.unit_rate / 100).toFixed(2);
                  return acc;
                }, {})
              );
            }
          })
          .catch(() => {});
      }
      setIsDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingPlan]);

  useEffect(() => {
    if (planType !== 'Fixed' && billingTiming !== 'arrears') {
      setBillingTiming('arrears');
    }
  }, [planType, billingTiming]);

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
    if (!planName.trim()) {
      errors.push(
        t('dialog.validation.nameRequired', {
          defaultValue: 'Contract line preset name is required',
        }),
      );
    }
    if (!billingFrequency) {
      errors.push(
        t('dialog.validation.billingFrequencyRequired', {
          defaultValue: 'Billing frequency is required',
        }),
      );
    }
    if (!planType) {
      errors.push(
        t('dialog.validation.contractLineTypeRequired', {
          defaultValue: 'Contract line type is required',
        }),
      );
    }

    if (planType === 'Fixed') {
      if (fixedServices.length === 0) {
        errors.push(
          t('dialog.validation.fixedServiceRequired', {
            defaultValue: 'At least one fixed service or product is required',
          }),
        );
      }
      // Base rate is now optional for presets - it can be set when creating actual contracts
      // Check that all services are selected
      fixedServices.forEach((service, index) => {
        if (!service.service_id) {
          errors.push(
            t('dialog.validation.serviceSelectRequired', {
              defaultValue: 'Service {{index}}: Please select a service',
              index: index + 1,
            }),
          );
        }
      });
    } else if (planType === 'Hourly') {
      if (hourlyServices.length === 0) {
        errors.push(
          t('dialog.validation.hourlyServiceRequired', {
            defaultValue: 'At least one hourly service is required',
          }),
        );
      }
      // Check that all services have rates
      hourlyServices.forEach((service, index) => {
        if (!service.service_id) {
          errors.push(
            t('dialog.validation.serviceSelectRequired', {
              defaultValue: 'Service {{index}}: Please select a service',
              index: index + 1,
            }),
          );
        }
        if (!service.hourly_rate || service.hourly_rate === 0) {
          errors.push(
            t('dialog.validation.hourlyRateRequired', {
              defaultValue: 'Service {{index}}: Hourly rate is required',
              index: index + 1,
            }),
          );
        }
      });
    } else if (planType === 'Usage') {
      if (usageServices.length === 0) {
        errors.push(
          t('dialog.validation.usageServiceRequired', {
            defaultValue: 'At least one usage-based service is required',
          }),
        );
      }
      // Check that all services have rates and units
      usageServices.forEach((service, index) => {
        if (!service.service_id) {
          errors.push(
            t('dialog.validation.serviceSelectRequired', {
              defaultValue: 'Service {{index}}: Please select a service',
              index: index + 1,
            }),
          );
        }
        if (!service.unit_rate || service.unit_rate === 0) {
          errors.push(
            t('dialog.validation.unitRateRequired', {
              defaultValue: 'Service {{index}}: Unit rate is required',
              index: index + 1,
            }),
          );
        }
        if (!service.unit_of_measure?.trim()) {
          errors.push(
            t('dialog.validation.unitOfMeasureRequired', {
              defaultValue: 'Service {{index}}: Unit of measure is required',
              index: index + 1,
            }),
          );
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
      const presetData: Partial<IContractLinePreset> = {
        preset_name: planName,
        billing_frequency: billingFrequency,
        contract_line_type: planType!,
        billing_timing: planType === 'Fixed' ? billingTiming : 'arrears',
        cadence_owner: 'client',
        tenant,
        // Add hourly-specific fields if this is an hourly preset
        ...(planType === 'Hourly' ? {
          minimum_billable_time: minimumBillableTime ?? null,
          round_up_to_nearest: roundUpToNearest ?? null,
        } : {}),
      };

      let savedPresetId: string | undefined;
      if (editingPlan?.preset_id) {
        const { preset_id, ...updateData } = presetData;
        const updatedPreset = await updateContractLinePreset(editingPlan.preset_id, updateData);
        savedPresetId = updatedPreset.preset_id;
      } else {
        const { preset_id, ...createData } = presetData;
        const newPreset = await createContractLinePreset(createData as any);
        savedPresetId = newPreset.preset_id;
      }

      // Save services based on plan type
      if (savedPresetId) {
        const servicesToSave: any[] = [];

        if (planType === 'Fixed') {
          // Save Fixed config
          await updateContractLinePresetFixedConfig(savedPresetId, {
            base_rate: baseRate ?? null,
            enable_proration: enableProration,
            billing_cycle_alignment: resolveBillingCycleAlignmentForCompatibility({
              billingCycleAlignment: billingCycleAlignment,
              enableProration: enableProration,
            }),
          });

          // Save Fixed services
          fixedServices.forEach(service => {
            if (service.service_id) {
              servicesToSave.push({
                preset_id: savedPresetId,
                service_id: service.service_id,
                quantity: service.quantity || 1,
                custom_rate: null,
                unit_of_measure: null
              });
            }
          });
        } else if (planType === 'Hourly') {
          // Save Hourly services
          hourlyServices.forEach(service => {
            if (service.service_id && service.hourly_rate) {
              servicesToSave.push({
                preset_id: savedPresetId,
                service_id: service.service_id,
                quantity: null,
                custom_rate: service.hourly_rate, // Already in cents from handleHourlyRateChange
                unit_of_measure: null,
                // Add bucket overlay fields
                bucket_total_minutes: service.bucket_overlay?.total_minutes ?? null,
                bucket_overage_rate: service.bucket_overlay?.overage_rate ?? null,
                bucket_allow_rollover: service.bucket_overlay?.allow_rollover ?? null
              });
            }
          });
        } else if (planType === 'Usage') {
          // Save Usage services
          usageServices.forEach(service => {
            if (service.service_id && service.unit_rate) {
              servicesToSave.push({
                preset_id: savedPresetId,
                service_id: service.service_id,
                quantity: null,
                custom_rate: service.unit_rate, // Already in cents from handleUsageRateChange
                unit_of_measure: service.unit_of_measure || '',
                // Add bucket overlay fields
                bucket_total_minutes: service.bucket_overlay?.total_minutes ?? null,
                bucket_overage_rate: service.bucket_overlay?.overage_rate ?? null,
                bucket_allow_rollover: service.bucket_overlay?.allow_rollover ?? null
              });
            }
          });
        }

        // Update services for the preset
        await updateContractLinePresetServices(savedPresetId, servicesToSave);
      }

      resetForm();
      setOpen(false);
      onPlanAdded(savedPresetId);
    } catch (error) {
      console.error('Error saving contract line preset:', error);
      const errorMessage = error instanceof Error
        ? error.message
        : t('dialog.errors.saveFailed', { defaultValue: 'Failed to save contract line preset' });
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

  const formatCurrency = (cents: number | undefined, currencyCode: string = 'USD') => {
    const symbol = getCurrencySymbol(currencyCode);
    if (!cents) return `${symbol}0.00`;
    return `${symbol}${(cents / 100).toFixed(2)}`;
  };

  const renderFixedConfig = () => {
    const handleAddFixedService = () => {
      setFixedServices([...fixedServices, { service_id: '', service_name: '', quantity: 1 }]);
      markDirty();
    };

    const handleRemoveFixedService = (index: number) => {
      const newServices = fixedServices.filter((_, i) => i !== index);
      setFixedServices(newServices);
      markDirty();
    };

    const handleQuantityChange = (index: number, quantity: number) => {
      const newServices = [...fixedServices];
      newServices[index] = { ...newServices[index], quantity };
      setFixedServices(newServices);
      markDirty();
    };

    return (
      <div className="space-y-4">
        <Alert variant="info">
          <AlertDescription className="text-sm">
            <strong>
              {t('dialog.fixed.alertTitle', {
                defaultValue: 'Fixed Fee Services:',
              })}
            </strong>{' '}
            {t('dialog.fixed.alertBody', {
              defaultValue:
                "The contract line's base rate is the billed amount. You can also attach products here; product quantities are billed as units, while fixed-fee service quantities are used for tax allocation only.",
            })}
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            {t('dialog.fixed.servicesAndProducts', {
              defaultValue: 'Services & Products',
            })}
          </Label>

          {fixedServices.map((service, index) => (
            <div key={index} className="flex items-start gap-3 p-4 border border-[rgb(var(--color-border-200))] rounded-md bg-muted">
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`fixed-service-${index}`} className="text-sm">
                    {t('dialog.fixed.itemLabel', {
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
                      markDirty();
                    }}
                    itemKinds={['service', 'product']}
                    placeholder={t('dialog.fixed.selectItemPlaceholder', {
                      defaultValue: 'Select an item',
                    })}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`quantity-${index}`} className="text-sm">
                    {t('dialog.common.quantity', { defaultValue: 'Quantity' })}
                  </Label>
                  <Input
                    id={`quantity-${index}`}
                    type="number"
                    value={service.quantity}
                    onChange={(e) => handleQuantityChange(index, parseInt(e.target.value) || 1)}
                    min="1"
                    className="w-24"
                  />
                </div>
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
            {t('dialog.fixed.addItem', { defaultValue: 'Add Item' })}
          </Button>
        </div>

        {fixedServices.length === 0 && (
          <div className="p-4 bg-muted border border-[rgb(var(--color-border-200))] rounded-md">
            <p className="text-sm text-muted-foreground text-center">
              {t('dialog.fixed.emptyState', {
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
      markDirty();
    };

    const handleRemoveHourlyService = (index: number) => {
      const newServices = hourlyServices.filter((_, i) => i !== index);
      setHourlyServices(newServices);
      const newInputs = { ...hourlyServiceRateInputs };
      delete newInputs[index];
      setHourlyServiceRateInputs(newInputs);
      markDirty();
    };

    const handleHourlyRateChange = (index: number, rate: number) => {
      const newServices = [...hourlyServices];
      newServices[index] = { ...newServices[index], hourly_rate: rate };
      setHourlyServices(newServices);
      markDirty();
    };

    return (
      <div className="space-y-4">
        <Alert variant="info">
          <AlertDescription className="text-sm">
            <strong>
              {t('dialog.hourly.alertTitle', {
                defaultValue: 'What are Hourly Services?',
              })}
            </strong>{' '}
            {t('dialog.hourly.alertBody', {
              defaultValue:
                'These services are billed based on actual time tracked. Each time entry will be multiplied by the hourly rate to calculate the invoice amount.',
            })}
          </AlertDescription>
        </Alert>

        {hourlyServices.length > 0 && (
          <>
            <div className="space-y-2">
              <Label htmlFor="minimum-billable-time" className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {t('dialog.hourly.minimumBillableTimeLabel', {
                  defaultValue: 'Minimum Billable Time (minutes)',
                })}
              </Label>
              <Input
                id="minimum-billable-time"
                type="number"
                value={minimumBillableTime || ''}
                onChange={(e) => setMinimumBillableTime(parseInt(e.target.value) || undefined)}
                placeholder={t('dialog.hourly.minutesPlaceholder', { defaultValue: '15' })}
                min="0"
                step="15"
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                {t('dialog.hourly.minimumBillableTimeHelp', {
                  defaultValue: 'e.g., 15 minutes - any time entry less than this will be rounded up',
                })}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="round-up-to-nearest" className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {t('dialog.hourly.roundUpToNearestLabel', {
                  defaultValue: 'Round Up To Nearest (minutes)',
                })}
              </Label>
              <Input
                id="round-up-to-nearest"
                type="number"
                value={roundUpToNearest || ''}
                onChange={(e) => setRoundUpToNearest(parseInt(e.target.value) || undefined)}
                placeholder={t('dialog.hourly.minutesPlaceholder', { defaultValue: '15' })}
                min="0"
                step="15"
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                {t('dialog.hourly.roundUpToNearestHelp', {
                  defaultValue: 'e.g., 15 minutes - time entries will be rounded up to the nearest interval',
                })}
              </p>
            </div>
          </>
        )}

        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {t('dialog.hourly.servicesHeading', { defaultValue: 'Hourly Services' })}
          </Label>

          {hourlyServices.map((service, index) => (
            <div key={index} className="flex items-start gap-3 p-4 border border-[rgb(var(--color-border-200))] rounded-md bg-muted">
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`hourly-service-${index}`} className="text-sm">
                    {t('dialog.hourly.serviceLabel', {
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
                      markDirty();
                    }}
                    itemKinds={['service']}
                    placeholder={t('dialog.hourly.selectServicePlaceholder', {
                      defaultValue: 'Select a service',
                    })}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`hourly-rate-${index}`} className="text-sm flex items-center gap-2">
                    <Coins className="h-3 w-3" />
                    {t('dialog.hourly.hourlyRateLabel', { defaultValue: 'Hourly Rate' })}
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
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
                      placeholder={t('dialog.common.moneyPlaceholder', { defaultValue: '0.00' })}
                      className="pl-10"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {service.hourly_rate
                      ? t('dialog.hourly.hourlyRateSummary', {
                          defaultValue: '{{rate}}/hour',
                          rate: formatCurrency(service.hourly_rate),
                        })
                      : t('dialog.hourly.enterHourlyRate', { defaultValue: 'Enter hourly rate' })}
                  </p>
                </div>

                {/* Bucket Overlay Section */}
                <div className="space-y-3 pt-3 border-t border-dashed border-[rgb(var(--color-border-200))]">
                  <SwitchWithLabel
                    label={t('dialog.hourly.recommendBucketLabel', {
                      defaultValue: 'Recommend bucket of hours',
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
                      markDirty();
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
                        markDirty();
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
            {t('dialog.hourly.addHourlyService', { defaultValue: 'Add Hourly Service' })}
          </Button>
        </div>

        {hourlyServices.length === 0 && (
          <div className="p-4 bg-muted border border-[rgb(var(--color-border-200))] rounded-md">
            <p className="text-sm text-muted-foreground text-center">
              {t('dialog.hourly.emptyState', {
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
      setUsageServices([
        ...usageServices,
        { service_id: '', service_name: '', unit_rate: undefined, unit_of_measure: 'unit' },
      ]);
      markDirty();
    };

    const handleRemoveUsageService = (index: number) => {
      const newServices = usageServices.filter((_, i) => i !== index);
      setUsageServices(newServices);
      const newInputs = { ...usageServiceRateInputs };
      delete newInputs[index];
      setUsageServiceRateInputs(newInputs);
      markDirty();
    };

    const handleUsageItemSelect = (index: number, item: { service_id: string; service_name: string; default_rate: number; unit_of_measure: string }) => {
      const newServices = [...usageServices];
      newServices[index] = {
        ...newServices[index],
        service_id: item.service_id,
        service_name: item.service_name || '',
        unit_rate: item.default_rate || undefined,
        unit_of_measure: item.unit_of_measure || 'unit'
      };
      setUsageServices(newServices);

      if (item.default_rate) {
        setUsageServiceRateInputs(prev => ({ ...prev, [index]: (item.default_rate / 100).toFixed(2) }));
      }
      markDirty();
    };

    const handleUsageRateChange = (index: number, rate: number) => {
      const newServices = [...usageServices];
      newServices[index] = { ...newServices[index], unit_rate: rate };
      setUsageServices(newServices);
      markDirty();
    };

    const handleUnitChange = (index: number, unit: string) => {
      const newServices = [...usageServices];
      newServices[index] = { ...newServices[index], unit_of_measure: unit };
      setUsageServices(newServices);
      markDirty();
    };

    return (
      <div className="space-y-4">
        <Alert variant="info">
          <AlertDescription className="text-sm">
            <strong>
              {t('dialog.usage.alertTitle', {
                defaultValue: 'What are Usage-Based Services?',
              })}
            </strong>{' '}
            {t('dialog.usage.alertBody', {
              defaultValue:
                'These services are billed based on actual consumption or usage metrics. Each unit consumed will be multiplied by the unit rate to calculate the invoice amount.',
            })}
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {t('dialog.usage.servicesHeading', { defaultValue: 'Usage-Based Services' })}
          </Label>

          {usageServices.map((service, index) => (
            <div key={index} className="flex items-start gap-3 p-4 border border-[rgb(var(--color-border-200))] rounded-md bg-muted">
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`usage-service-${index}`} className="text-sm">
                    {t('dialog.usage.serviceLabel', {
                      defaultValue: 'Service {{index}}',
                      index: index + 1,
                    })}
                  </Label>
                  <ServiceCatalogPicker
                    id={`usage-service-${index}`}
                    label={undefined}
                    value={service.service_id}
                    selectedLabel={service.service_name}
                    onSelect={(item) =>
                      handleUsageItemSelect(index, {
                        service_id: item.service_id,
                        service_name: item.service_name,
                        default_rate: item.default_rate,
                        unit_of_measure: item.unit_of_measure,
                      })
                    }
                    itemKinds={['service']}
                    placeholder={t('dialog.usage.searchServicesPlaceholder', {
                      defaultValue: 'Search services...',
                    })}
                    debounceMs={300}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={`unit-rate-${index}`} className="text-sm flex items-center gap-2">
                      <Coins className="h-3 w-3" />
                      {t('dialog.usage.ratePerUnitLabel', { defaultValue: 'Rate per Unit' })}
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
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
                        placeholder={t('dialog.common.moneyPlaceholder', { defaultValue: '0.00' })}
                        className="pl-10"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {service.unit_rate
                        ? t('dialog.usage.rateSummary', {
                            defaultValue: '{{rate}}/{{unit}}',
                            rate: formatCurrency(service.unit_rate),
                            unit: service.unit_of_measure || t('dialog.usage.defaultUnit', { defaultValue: 'unit' }),
                          })
                        : t('dialog.usage.enterUnitRate', { defaultValue: 'Enter unit rate' })}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`unit-measure-${index}`} className="text-sm">
                      {t('dialog.usage.unitOfMeasureLabel', { defaultValue: 'Unit of Measure' })}
                    </Label>
                    <Input
                      id={`unit-measure-${index}`}
                      type="text"
                      value={service.unit_of_measure || t('dialog.usage.defaultUnit', { defaultValue: 'unit' })}
                      onChange={(e) => handleUnitChange(index, e.target.value)}
                      placeholder={t('dialog.usage.unitOfMeasurePlaceholder', {
                        defaultValue: 'e.g., GB, API call, user',
                      })}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('dialog.usage.unitOfMeasureHelp', {
                        defaultValue: 'e.g., GB, API call, transaction',
                      })}
                    </p>
                  </div>
                </div>

                {/* Bucket Overlay Section */}
                <div className="space-y-3 pt-3 border-t border-dashed border-[rgb(var(--color-border-200))]">
                  <SwitchWithLabel
                    label={t('dialog.usage.recommendBucketLabel', {
                      defaultValue: 'Recommend bucket of consumption',
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
                      markDirty();
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
                        markDirty();
                      }}
                      unitLabel={service.unit_of_measure || t('dialog.usage.defaultUnits', { defaultValue: 'units' })}
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
            {t('dialog.usage.addUsageService', { defaultValue: 'Add Usage-Based Service' })}
          </Button>
        </div>

        {usageServices.length === 0 && (
          <div className="p-4 bg-muted border border-[rgb(var(--color-border-200))] rounded-md">
            <p className="text-sm text-muted-foreground text-center">
              {t('dialog.usage.emptyState', {
                defaultValue:
                  'No usage-based services added yet. Click "Add Usage-Based Service" above to get started.',
              })}
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {triggerButton && (
        <div
          onClick={() => {
            if (editingPlan) {
              setPlanName(editingPlan.preset_name);
              setBillingFrequency(editingPlan.billing_frequency);
              setPlanType(editingPlan.contract_line_type as PlanType);
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
        title={editingPlan
          ? t('dialog.title.edit', { defaultValue: 'Edit Contract Line Preset' })
          : t('dialog.title.add', { defaultValue: 'Add Contract Line Preset' })}
        className="max-w-3xl"
        hideCloseButton={!!editingPlan}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button id="contract-line-cancel" variant="outline" onClick={() => handleCloseRequest(true)}>
              {t('dialog.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="contract-line-submit"
              type="button"
              onClick={() => (document.getElementById('contract-line-dialog-form') as HTMLFormElement | null)?.requestSubmit()}
              disabled={isSaving}
              className={!planName.trim() || !planType || !billingFrequency ? 'opacity-50' : ''}
            >
              {isSaving
                ? t('dialog.actions.saving', { defaultValue: 'Saving...' })
                : editingPlan
                  ? t('dialog.actions.updatePreset', { defaultValue: 'Update Contract Line Preset' })
                  : t('dialog.actions.createPreset', { defaultValue: 'Create Contract Line Preset' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <form id="contract-line-dialog-form" onSubmit={handleSubmit} className="space-y-6" noValidate>
            {hasAttemptedSubmit && validationErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  <p className="font-medium mb-2">
                    {t('dialog.validation.prefix', {
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
                  {t('dialog.basics.heading', { defaultValue: 'Contract Line Preset Basics' })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t('dialog.basics.description', {
                    defaultValue:
                      'Create a reusable template that can be quickly added to contracts or contract templates. Define the billing model, services, and default rates that will be copied when this preset is used.',
                  })}
                </p>
              </div>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="name">
                    {t('dialog.basics.nameLabel', { defaultValue: 'Contract Line Preset Name *' })}
                  </Label>
                  <Input
                    id="name"
                    value={planName}
                    onChange={(e) => {
                      setPlanName(e.target.value);
                      clearErrorIfSubmitted();
                      markDirty();
                    }}
                    placeholder={t('dialog.basics.namePlaceholder', {
                      defaultValue: 'e.g. Managed Support - Gold',
                    })}
                    required
                    className={hasAttemptedSubmit && !planName.trim() ? 'border-red-500' : ''}
                  />
                </div>
                <div>
                  <Label htmlFor="frequency">
                    {t('dialog.basics.billingFrequencyLabel', { defaultValue: 'Billing Frequency *' })}
                  </Label>
                  <CustomSelect
                    id="frequency"
                    value={billingFrequency}
                    onValueChange={(value) => {
                      setBillingFrequency(value);
                      clearErrorIfSubmitted();
                      markDirty();
                    }}
                    options={BILLING_FREQUENCY_OPTIONS}
                    placeholder={t('dialog.basics.billingFrequencyPlaceholder', {
                      defaultValue: 'Select billing frequency',
                    })}
                    className={hasAttemptedSubmit && !billingFrequency ? 'ring-1 ring-red-500' : ''}
                  />
                </div>
                <div>
                  <Label htmlFor="billing-timing">
                    {t('dialog.basics.billingTimingLabel', { defaultValue: 'Billing Timing *' })}
                  </Label>
                  <CustomSelect
                    id="billing-timing"
                    value={billingTiming}
                    onValueChange={(value) => {
                      if (planType !== 'Fixed') {
                        return;
                      }
                      setBillingTiming(value as 'arrears' | 'advance');
                      clearErrorIfSubmitted();
                      markDirty();
                    }}
                    options={BILLING_TIMING_OPTIONS.map((option) => ({
                      value: option.value,
                      label: t(option.labelKey, { defaultValue: option.defaultLabel }),
                    }))}
                    disabled={planType !== 'Fixed'}
                    placeholder={t('dialog.basics.billingTimingPlaceholder', {
                      defaultValue: 'Select billing timing',
                    })}
                  />
                  {planType !== 'Fixed' ? (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('dialog.billingModel.timingHelp.nonFixed', {
                        defaultValue: 'Hourly and usage-based lines always bill in arrears.',
                      })}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('dialog.billingModel.timingHelp.fixed', {
                        defaultValue: 'Advance billing invoices the upcoming period at the cycle start.',
                      })}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {t('dialog.billingModel.heading', { defaultValue: 'Choose a Billing Model *' })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t('dialog.billingModel.description', {
                    defaultValue:
                      'Select the billing behavior that fits this offering. Services and overlays can be attached once the line exists.',
                  })}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {(
                  [
                    {
                      key: 'Fixed' as PlanType,
                      title: t('dialog.billingModel.cards.fixed.title', {
                        defaultValue: 'Fixed Fee',
                      }),
                      description: t('dialog.billingModel.cards.fixed.description', {
                        defaultValue: 'Charge a flat amount every billing period.',
                      }),
                      icon: Package,
                      accent: 'text-blue-600',
                    },
                    {
                      key: 'Hourly' as PlanType,
                      title: t('dialog.billingModel.cards.hourly.title', {
                        defaultValue: 'Hourly',
                      }),
                      description: t('dialog.billingModel.cards.hourly.description', {
                        defaultValue: 'Bill based on approved time entries and hourly overlays.',
                      }),
                      icon: Clock,
                      accent: 'text-emerald-600',
                    },
                    {
                      key: 'Usage' as PlanType,
                      title: t('dialog.billingModel.cards.usage.title', {
                        defaultValue: 'Usage-Based',
                      }),
                      description: t('dialog.billingModel.cards.usage.description', {
                        defaultValue: 'Invoice for units consumed such as devices or licenses.',
                      }),
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
                    {t('dialog.fixed.heading', { defaultValue: 'Fixed Fee Services' })}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t('dialog.fixed.description', {
                      defaultValue:
                        'Set up services that are billed at a fixed recurring rate, regardless of usage.',
                    })}
                  </p>
                </div>
                {renderFixedConfig()}

                {fixedServices.length > 0 && (
                  <>
                    <div className="space-y-2 pt-4 border-t">
                      <Label htmlFor="base-rate">
                        {t('dialog.fixed.baseRateLabel', {
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
                          placeholder={t('dialog.common.moneyPlaceholder', { defaultValue: '0.00' })}
                          className="pl-10"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t('dialog.fixed.baseRateHelp', {
                          defaultValue:
                            'Suggested recurring fee for all fixed services. Can be overridden when adding this preset to a contract.',
                        })}
                      </p>
                    </div>

                    <div className="border border-[rgb(var(--color-border-200))] rounded-md p-4 bg-card space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="enable-proration" className="font-medium text-[rgb(var(--color-text-800))]">
                          {t('dialog.fixed.adjustForPartialPeriodsLabel', {
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
                      {t('dialog.fixed.adjustForPartialPeriodsHelp', {
                        defaultValue:
                          'When enabled, the recurring fee scales to the covered portion of a service period when the contract starts or ends inside that period.',
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
                    {t('dialog.hourly.heading', { defaultValue: 'Hourly Services' })}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t('dialog.hourly.description', {
                      defaultValue:
                        'Configure services that are billed based on time tracked. Perfect for T&M (Time & Materials) work.',
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
                    {t('dialog.usage.heading', { defaultValue: 'Usage-Based Services' })}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t('dialog.usage.description', {
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
    </>
  );
}
