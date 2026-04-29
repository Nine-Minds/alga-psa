'use client';

import React, { useState, useEffect } from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { BucketOverlayInput, ContractWizardData } from '../ContractWizard';
import { ServiceCatalogPicker, ServiceCatalogPickerItem } from '../ServiceCatalogPicker';
import { Plus, X, Clock, Coins } from 'lucide-react';
import { getCurrencySymbol } from '@alga-psa/core';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { BucketOverlayFields } from '../BucketOverlayFields';
import { BillingFrequencyOverrideSelect } from '../BillingFrequencyOverrideSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFormatBillingFrequency } from '@alga-psa/billing/hooks/useBillingEnumOptions';

interface HourlyServicesStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

export function HourlyServicesStep({ data, updateData }: HourlyServicesStepProps) {
  const { t } = useTranslation('msp/contracts');
  const [rateInputs, setRateInputs] = useState<Record<number, string>>({});

  useEffect(() => {
    const inputs: Record<number, string> = {};
    data.hourly_services.forEach((service, index) => {
      if (service.hourly_rate !== undefined) {
        inputs[index] = (service.hourly_rate / 100).toFixed(2);
      }
    });
    setRateInputs(inputs);
  }, [data.hourly_services]);

  const handleAddService = () => {
    updateData({
      hourly_services: [
        ...data.hourly_services,
        { service_id: '', service_name: '', hourly_rate: undefined, bucket_overlay: undefined },
      ],
    });
  };

  const handleRemoveService = (index: number) => {
    const next = data.hourly_services.filter((_, i) => i !== index);
    updateData({ hourly_services: next });
  };

  const handleServiceChange = (index: number, item: ServiceCatalogPickerItem) => {
    const next = [...data.hourly_services];
    next[index] = {
      ...next[index],
      service_id: item.service_id,
      service_name: item.service_name,
      // Use default_rate from catalog if available
      hourly_rate: item.default_rate > 0 ? item.default_rate : undefined,
    };
    updateData({ hourly_services: next });
  };

  const handleRateChange = (index: number, cents: number) => {
    const next = [...data.hourly_services];
    next[index] = { ...next[index], hourly_rate: cents };
    updateData({ hourly_services: next });
  };

  const defaultOverlay = (billingFrequency: string): BucketOverlayInput => ({
    total_minutes: undefined,
    overage_rate: undefined,
    allow_rollover: false,
    billing_period: billingFrequency as 'monthly' | 'weekly',
  });

  const toggleBucketOverlay = (index: number, enabled: boolean) => {
    const next = [...data.hourly_services];
    if (enabled) {
      const existing = next[index].bucket_overlay;
      const effectiveBillingFrequency = data.hourly_billing_frequency ?? data.billing_frequency;
      next[index] = {
        ...next[index],
        bucket_overlay: existing ? { ...existing } : defaultOverlay(effectiveBillingFrequency),
      };
    } else {
      next[index] = {
        ...next[index],
        bucket_overlay: undefined,
      };
    }
    updateData({ hourly_services: next });
  };

  const updateBucketOverlay = (index: number, overlay: BucketOverlayInput) => {
    const next = [...data.hourly_services];
    next[index] = {
      ...next[index],
      bucket_overlay: { ...overlay },
    };
    updateData({ hourly_services: next });
  };

  const currencySymbol = getCurrencySymbol(data.currency_code);

  const formatCurrency = (cents: number | undefined) => {
    if (!cents) return `${currencySymbol}0.00`;
    return `${currencySymbol}${(cents / 100).toFixed(2)}`;
  };

  const formatBillingFrequency = useFormatBillingFrequency();
  const hasAlternateBillingFrequency =
    data.hourly_billing_frequency !== undefined &&
    data.hourly_billing_frequency !== data.billing_frequency;

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">
          {t('wizardHourly.heading', { defaultValue: 'Hourly Services' })}
        </h3>
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          {t('wizardHourly.description', {
            defaultValue: 'Configure services that are billed based on time tracked. Perfect for T&M (Time & Materials) work.',
          })}
        </p>
      </div>

      <div className="p-4 bg-[rgb(var(--color-accent-50))] border border-[rgb(var(--color-accent-200))] rounded-md mb-6">
        <p className="text-sm text-[rgb(var(--color-accent-800))]">
          <strong>{t('wizardHourly.explainer.title', { defaultValue: 'What are Hourly Services?' })}</strong>{' '}
          {t('wizardHourly.explainer.description', {
            defaultValue: 'These services are billed based on actual time tracked. Each time entry will be multiplied by the hourly rate to calculate the invoice amount.',
          })}
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="minimum-billable-time" className="flex items-center gap-2 font-semibold">
            <Clock className="h-4 w-4" />
            {t('wizardHourly.minimumBillableTime.label', { defaultValue: 'Minimum Billable Time (minutes)' })}
          </Label>
          <Input
            id="minimum-billable-time"
            type="number"
            min="0"
            value={data.minimum_billable_time ?? ''}
            onChange={(event) =>
              updateData({
                minimum_billable_time: Math.max(0, Number(event.target.value) || 0),
              })
            }
            placeholder={t('wizardHourly.minimumBillableTime.placeholder', { defaultValue: '15' })}
          />
          <p className="text-xs text-[rgb(var(--color-text-400))]">
            {t('wizardHourly.minimumBillableTime.hint', {
              defaultValue: 'e.g., 15 minutes - any time entry less than this will be rounded up',
            })}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="round-up-to" className="flex items-center gap-2 font-semibold">
            <Clock className="h-4 w-4" />
            {t('wizardHourly.roundUpToNearest.label', { defaultValue: 'Round Up To Nearest (minutes)' })}
          </Label>
          <Input
            id="round-up-to"
            type="number"
            min="0"
            value={data.round_up_to_nearest ?? ''}
            onChange={(event) =>
              updateData({
                round_up_to_nearest: Math.max(0, Number(event.target.value) || 0),
              })
            }
            placeholder={t('wizardHourly.roundUpToNearest.placeholder', { defaultValue: '15' })}
          />
          <p className="text-xs text-[rgb(var(--color-text-400))]">
            {t('wizardHourly.roundUpToNearest.hint', {
              defaultValue: 'e.g., 15 minutes - time entries will be rounded up to the nearest interval',
            })}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <Label className="flex items-center gap-2 font-semibold">
          <Clock className="h-4 w-4" />
          {t('wizardHourly.labels.hourlyServices', { defaultValue: 'Hourly Services' })}
        </Label>

        {data.hourly_services.map((service, index) => (
          <div
            key={index}
            className="flex items-start gap-3 p-4 border border-[rgb(var(--color-border-200))] rounded-md bg-[rgb(var(--color-border-50))]"
          >
            <div className="flex-1 space-y-3">
              <div className="space-y-2">
                <Label htmlFor={`hourly-service-${index}`} className="text-sm">
                  {t('wizardHourly.labels.serviceItem', {
                    defaultValue: 'Service {{index}}',
                    index: index + 1,
                  })}
                </Label>
                <ServiceCatalogPicker
                  id={`hourly-service-${index}`}
                  value={service.service_id}
                  selectedLabel={service.service_name}
                  onSelect={(item) => handleServiceChange(index, item)}
                  itemKinds={['service']}
                  placeholder={t('wizardHourly.labels.selectServicePlaceholder', { defaultValue: 'Select a service' })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={`hourly-rate-${index}`} className="text-sm flex items-center gap-2">
                  <Coins className="h-3 w-3" />
                  {t('wizardHourly.labels.hourlyRate', { defaultValue: 'Hourly Rate' })}
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgb(var(--color-text-400))]">
                    {currencySymbol}
                  </span>
                  <Input
                    id={`hourly-rate-${index}`}
                    type="text"
                    inputMode="decimal"
                    value={rateInputs[index] ?? ''}
                    onChange={(event) => {
                      const value = event.target.value.replace(/[^0-9.]/g, '');
                      const decimalCount = (value.match(/\./g) || []).length;
                      if (decimalCount <= 1) {
                        setRateInputs((prev) => ({ ...prev, [index]: value }));
                      }
                    }}
                    onBlur={() => {
                      const inputValue = rateInputs[index] ?? '';
                      if (inputValue.trim() === '' || inputValue === '.') {
                        setRateInputs((prev) => ({ ...prev, [index]: '' }));
                        handleRateChange(index, 0);
                      } else {
                        const dollars = parseFloat(inputValue) || 0;
                        const cents = Math.round(dollars * 100);
                        handleRateChange(index, cents);
                        setRateInputs((prev) => ({ ...prev, [index]: (cents / 100).toFixed(2) }));
                      }
                    }}
                    placeholder={t('wizardHourly.labels.hourlyRatePlaceholder', { defaultValue: '0.00' })}
                    className="pl-10"
                  />
                </div>
                <p className="text-xs text-[rgb(var(--color-text-400))]">
                  {service.hourly_rate
                    ? t('wizardHourly.labels.hourlyRatePerHour', {
                      defaultValue: '{{rate}}/hour',
                      rate: formatCurrency(service.hourly_rate),
                    })
                    : t('wizardHourly.labels.enterHourlyRate', { defaultValue: 'Enter the hourly rate' })}
                </p>
              </div>

              <div className="space-y-3 pt-2 border-t border-dashed border-blue-100">
                <SwitchWithLabel
                  label={t('wizardHourly.labels.setBucketOfHours', { defaultValue: 'Set bucket of hours' })}
                  checked={Boolean(service.bucket_overlay)}
                  onCheckedChange={(checked) => toggleBucketOverlay(index, Boolean(checked))}
                />
                {service.bucket_overlay && (
                  <BucketOverlayFields
                    mode="hours"
                    value={service.bucket_overlay ?? defaultOverlay(data.hourly_billing_frequency ?? data.billing_frequency)}
                    onChange={(next) => updateBucketOverlay(index, next)}
                    automationId={`hourly-bucket-${index}`}
                    billingFrequency={data.hourly_billing_frequency ?? data.billing_frequency}
                  />
                )}
              </div>
            </div>

            <Button
              id={`remove-hourly-service-${index}`}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleRemoveService(index)}
              className="mt-8 text-[rgb(var(--color-destructive))] hover:text-[rgb(var(--color-destructive))] hover:bg-[rgb(var(--color-destructive)/0.1)]"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}

        <Button
          id="add-hourly-service-button"
          type="button"
          variant="outline"
          onClick={handleAddService}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          {t('wizardHourly.actions.addHourlyService', { defaultValue: 'Add Hourly Service' })}
        </Button>
      </div>

      {data.hourly_services.length === 0 && (
        <div className="p-4 bg-[rgb(var(--color-border-50))] border border-[rgb(var(--color-border-200))] rounded-md">
          <p className="text-sm text-[rgb(var(--color-text-500))] text-center">
            {t('wizardHourly.emptyState', {
              defaultValue: 'No hourly services added yet. Click “Add Hourly Service” above or “Skip” if you don’t need time & materials billing.',
            })}
          </p>
        </div>
      )}

      {data.hourly_services.length > 0 && (
        <BillingFrequencyOverrideSelect
          contractBillingFrequency={data.billing_frequency}
          value={data.hourly_billing_frequency}
          onChange={(value) => updateData({ hourly_billing_frequency: value })}
          label={t('wizardHourly.alternateFrequencyLabel', { defaultValue: 'Alternate Billing Frequency (Optional)' })}
        />
      )}

      {data.hourly_services.length > 0 && (
        <Alert variant="info" className="mt-6">
          <AlertDescription>
            <h4 className="text-sm font-semibold mb-2">
              {t('wizardHourly.summary.title', { defaultValue: 'Hourly Services Summary' })}
            </h4>
            <div className="text-sm space-y-1">
              <p>
                <strong>{t('wizardHourly.summary.labels.services', { defaultValue: 'Services:' })}</strong>{' '}
                {data.hourly_services.length}
              </p>
              {data.minimum_billable_time !== undefined && (
                <p>
                  <strong>{t('wizardHourly.summary.labels.minimumTime', { defaultValue: 'Minimum Time:' })}</strong>{' '}
                  {t('wizardHourly.summary.values.minutes', {
                    defaultValue: '{{count}} minutes',
                    count: data.minimum_billable_time,
                  })}
                </p>
              )}
              {data.round_up_to_nearest !== undefined && (
                <p>
                  <strong>{t('wizardHourly.summary.labels.roundUp', { defaultValue: 'Round Up:' })}</strong>{' '}
                  {t('wizardHourly.summary.values.everyMinutes', {
                    defaultValue: 'Every {{count}} minutes',
                    count: data.round_up_to_nearest,
                  })}
                </p>
              )}
              {hasAlternateBillingFrequency && data.hourly_billing_frequency && (
                <p>
                  <strong>
                    {t('wizardHourly.summary.labels.alternateFrequency', {
                      defaultValue: 'Alternate Billing Frequency:',
                    })}
                  </strong>{' '}
                  {formatBillingFrequency(data.hourly_billing_frequency)}
                </p>
              )}
              {data.hourly_services.some((service) => service.bucket_overlay) && (
                <div className="pt-2">
                  <p className="font-semibold">
                    {t('wizardHourly.summary.labels.bucketsHeading', { defaultValue: 'Buckets:' })}
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    {data.hourly_services.map((service, index) => {
                      if (!service.bucket_overlay) return null;
                      const overlay = service.bucket_overlay;
                      const includedHours =
                        overlay.total_minutes !== undefined ? overlay.total_minutes / 60 : undefined;
                      const serviceLabel =
                        service.service_name ||
                        t('wizardHourly.summary.labels.serviceFallback', {
                          defaultValue: 'Service {{index}}',
                          index: index + 1,
                        });
                      return (
                        <li key={`hourly-bucket-summary-${index}`}>
                          <span className="block">
                            <strong>{serviceLabel}</strong>
                          </span>
                          {includedHours !== undefined && (
                            <span className="block">
                              <strong>
                                {t('wizardHourly.summary.labels.includedHours', { defaultValue: 'Included Hours:' })}
                              </strong>{' '}
                              {t('wizardHourly.summary.values.hours', {
                                defaultValue: '{{count}} hours',
                                count: includedHours,
                              })}
                            </span>
                          )}
                          {overlay.overage_rate !== undefined && (
                            <span className="block">
                              <strong>
                                {t('wizardHourly.summary.labels.overageRate', { defaultValue: 'Overage Rate:' })}
                              </strong>{' '}
                              {t('wizardHourly.summary.values.overageRatePerHour', {
                                defaultValue: '{{rate}}/hour',
                                rate: formatCurrency(overlay.overage_rate),
                              })}
                            </span>
                          )}
                          {overlay.allow_rollover !== undefined && (
                            <span className="block">
                              <strong>
                                {t('wizardHourly.summary.labels.rollover', { defaultValue: 'Rollover:' })}
                              </strong>{' '}
                              {overlay.allow_rollover
                                ? t('wizardHourly.summary.values.rolloverEnabled', { defaultValue: 'Enabled' })
                                : t('wizardHourly.summary.values.rolloverDisabled', { defaultValue: 'Disabled' })}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
