'use client';

import React, { useState, useEffect } from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { BucketOverlayInput, ContractWizardData } from '../ContractWizard';
import { ServiceCatalogPicker, ServiceCatalogPickerItem } from '../ServiceCatalogPicker';
import { Plus, X, Package, HelpCircle, Coins } from 'lucide-react';
import { getCurrencySymbol } from '@alga-psa/core';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { BucketOverlayFields } from '../BucketOverlayFields';
import { BillingFrequencyOverrideSelect } from '../BillingFrequencyOverrideSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { getRecurringAuthoringPreview } from '../recurringAuthoringPreview';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFormatBillingFrequency } from '@alga-psa/billing/hooks/useBillingEnumOptions';

interface FixedFeeServicesStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

export function FixedFeeServicesStep({ data, updateData }: FixedFeeServicesStepProps) {
  const { t } = useTranslation('msp/contracts');
  const [baseRateInput, setBaseRateInput] = useState<string>('');

  useEffect(() => {
    if (data.fixed_base_rate !== undefined) {
      setBaseRateInput((data.fixed_base_rate / 100).toFixed(2));
    }
  }, [data.fixed_base_rate]);

  const handleAddService = () => {
    updateData({
      fixed_services: [
        ...data.fixed_services,
        { service_id: '', service_name: '', quantity: 1, bucket_overlay: undefined },
      ],
    });
  };

  const handleRemoveService = (index: number) => {
    const next = data.fixed_services.filter((_, i) => i !== index);
    updateData({ fixed_services: next });
  };

  const handleServiceChange = (index: number, item: ServiceCatalogPickerItem) => {
    const next = [...data.fixed_services];
    next[index] = {
      ...next[index],
      service_id: item.service_id,
      service_name: item.service_name,
    };
    updateData({ fixed_services: next });
  };

  const handleQuantityChange = (index: number, quantity: number) => {
    const next = [...data.fixed_services];
    next[index] = { ...next[index], quantity };
    updateData({ fixed_services: next });
  };

  const currencySymbol = getCurrencySymbol(data.currency_code);

  const formatCurrency = (cents: number | undefined) => {
    if (!cents) return `${currencySymbol}0.00`;
    return `${currencySymbol}${(cents / 100).toFixed(2)}`;
  };

  const getDefaultOverlay = (): BucketOverlayInput => ({
    total_minutes: undefined,
    overage_rate: undefined,
    allow_rollover: false,
    billing_period: 'monthly',
  });

  const toggleBucketOverlay = (index: number, enabled: boolean) => {
    const next = [...data.fixed_services];
    if (enabled) {
      const existing = next[index].bucket_overlay;
      next[index] = {
        ...next[index],
        bucket_overlay: existing ? { ...existing } : getDefaultOverlay(),
      };
    } else {
      next[index] = {
        ...next[index],
        bucket_overlay: undefined,
      };
    }
    updateData({ fixed_services: next });
  };

  const updateBucketOverlay = (index: number, overlay: BucketOverlayInput) => {
    const next = [...data.fixed_services];
    next[index] = {
      ...next[index],
      bucket_overlay: { ...overlay },
    };
    updateData({ fixed_services: next });
  };

  const recurringPreview = getRecurringAuthoringPreview({
    cadenceOwner: data.cadence_owner,
    billingTiming: data.billing_timing,
    billingFrequency: data.fixed_billing_frequency ?? data.billing_frequency,
    enableProration: data.enable_proration,
  }, t);

  const formatBillingFrequency = useFormatBillingFrequency();
  const hasAlternateBillingFrequency =
    data.fixed_billing_frequency !== undefined &&
    data.fixed_billing_frequency !== data.billing_frequency;

  return (
    <ReflectionContainer id="fixed-fee-services-step">
      <div className="space-y-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">
            {t('wizardFixed.heading', { defaultValue: 'Fixed Fee Services' })}
          </h3>
          <p className="text-sm text-[rgb(var(--color-text-500))]">
            {t('wizardFixed.description', {
              defaultValue: 'Configure services that are billed at a fixed rate each billing cycle. You can still track time, but billing is based on this flat amount.',
            })}
          </p>
        </div>

        <div className="p-4 bg-[rgb(var(--color-accent-50))] border border-[rgb(var(--color-accent-200))] rounded-md">
          <p className="text-sm text-[rgb(var(--color-accent-800))]">
            <strong>{t('wizardFixed.explainer.title', { defaultValue: 'What are Fixed Fee Services?' })}</strong>{' '}
            {t('wizardFixed.explainer.description', {
              defaultValue: 'These services have a set recurring price. You\'ll still track time entries for these services, but billing is based on the fixed rate, not hours worked.',
            })}
          </p>
        </div>

        {data.fixed_services.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="fixed_base_rate" className="flex items-center gap-2">
              <Coins className="h-4 w-4" />
              {t('wizardFixed.baseRate.label', { defaultValue: 'Recurring Base Rate' })} *
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgb(var(--color-text-400))]">
                {currencySymbol}
              </span>
              <Input
                id="fixed_base_rate"
                type="text"
                inputMode="decimal"
                value={baseRateInput}
                onChange={(event) => {
                  const value = event.target.value.replace(/[^0-9.]/g, '');
                  const decimalCount = (value.match(/\./g) || []).length;
                  if (decimalCount <= 1) {
                    setBaseRateInput(value);
                  }
                }}
                onBlur={() => {
                  if (baseRateInput.trim() === '' || baseRateInput === '.') {
                    setBaseRateInput('');
                    updateData({ fixed_base_rate: undefined });
                  } else {
                    const dollars = parseFloat(baseRateInput) || 0;
                    const cents = Math.round(dollars * 100);
                    updateData({ fixed_base_rate: cents });
                    setBaseRateInput((cents / 100).toFixed(2));
                  }
                }}
                placeholder={t('wizardFixed.baseRate.placeholder', { defaultValue: '0.00' })}
                className="pl-10"
              />
            </div>
            <p className="text-xs text-[rgb(var(--color-text-400))]">
              {t('wizardFixed.baseRate.hint', {
                defaultValue: 'Total recurring fee for all fixed services combined.',
              })}
            </p>
          </div>
        )}

        {data.fixed_services.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <SwitchWithLabel
                label={t('wizardFixed.proration.label', { defaultValue: 'Adjust for Partial Periods' })}
                checked={data.enable_proration}
                onCheckedChange={(checked) => updateData({ enable_proration: checked })}
              />
              <Tooltip content={t('wizardFixed.proration.tooltip', {
                defaultValue: 'Adjust the recurring fee when contract dates cover only part of a service period.',
              })}>
                <HelpCircle className="h-4 w-4 text-[rgb(var(--color-text-300))] cursor-help" />
              </Tooltip>
            </div>
            <p className="text-xs text-[rgb(var(--color-text-400))]">
              {recurringPreview.partialPeriodSummary}
            </p>
          </div>
        )}

        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            {t('wizardFixed.services.label', { defaultValue: 'Services' })}
          </Label>

          {data.fixed_services.map((service, index) => (
            <div
              key={index}
              className="flex items-start gap-3 p-4 border border-[rgb(var(--color-border-200))] rounded-md bg-[rgb(var(--color-border-50))]"
            >
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`service-${index}`} className="text-sm">
                    {t('wizardFixed.services.serviceItemLabel', {
                      defaultValue: 'Service {{index}}',
                      index: index + 1,
                    })}
                  </Label>
                  <ServiceCatalogPicker
                    id={`service-select-${index}`}
                    value={service.service_id}
                    selectedLabel={service.service_name}
                    onSelect={(item) => handleServiceChange(index, item)}
                    itemKinds={['service']}
                    placeholder={t('wizardFixed.services.selectServicePlaceholder', {
                      defaultValue: 'Select a service',
                    })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`quantity-${index}`} className="text-sm">
                    {t('wizardFixed.services.quantityLabel', { defaultValue: 'Quantity' })}
                  </Label>
                  <Input
                    id={`quantity-${index}`}
                    type="number"
                    value={service.quantity}
                    onChange={(event) =>
                      handleQuantityChange(index, Math.max(1, Number(event.target.value) || 1))
                    }
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
                onClick={() => handleRemoveService(index)}
                className="mt-8 text-[rgb(var(--color-destructive))] hover:text-[rgb(var(--color-destructive))] hover:bg-[rgb(var(--color-destructive)/0.1)]"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            id="add-fixed-service-button"
            type="button"
            variant="outline"
            onClick={handleAddService}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('wizardFixed.services.addService', { defaultValue: 'Add Service' })}
          </Button>
        </div>

        {data.fixed_services.length === 0 && (
          <div className="p-4 bg-[rgb(var(--color-border-50))] border border-[rgb(var(--color-border-200))] rounded-md">
            <p className="text-sm text-[rgb(var(--color-text-500))] text-center">
              {t('wizardFixed.emptyState', {
                defaultValue: 'No fixed fee services added yet. Click “Add Service” above or “Skip” to move on.',
              })}
            </p>
          </div>
        )}

        {data.fixed_services.length > 0 && (
          <BillingFrequencyOverrideSelect
            contractBillingFrequency={data.billing_frequency}
            value={data.fixed_billing_frequency}
            onChange={(value) => updateData({ fixed_billing_frequency: value })}
            label={t('wizardFixed.alternateFrequencyLabel', { defaultValue: 'Alternate Billing Frequency (Optional)' })}
          />
        )}

        {data.fixed_services.length > 0 && (
          <Alert variant="info" className="mt-6">
            <AlertDescription>
              <h4 className="text-sm font-semibold mb-2">
                {t('wizardFixed.preview.title', { defaultValue: 'Recurring Preview Before Save' })}
              </h4>
              <div className="text-sm space-y-1">
                <p>
                  <strong>{t('wizardFixed.preview.labels.services', { defaultValue: 'Services:' })}</strong>{' '}
                  {data.fixed_services.length}
                </p>
                {data.fixed_base_rate ? (
                  <p>
                    <strong>{t('wizardFixed.preview.labels.recurringRate', { defaultValue: 'Recurring Rate:' })}</strong>{' '}
                    {formatCurrency(data.fixed_base_rate)}
                  </p>
                ) : null}
                <p>
                  <strong>{t('wizardFixed.preview.labels.cadenceOwner', { defaultValue: 'Cadence Owner:' })}</strong>{' '}
                  {recurringPreview.cadenceOwnerLabel}
                </p>
                <p>{recurringPreview.cadenceOwnerSummary}</p>
                <p>
                  <strong>{t('wizardFixed.preview.labels.billingTiming', { defaultValue: 'Billing Timing:' })}</strong>{' '}
                  {recurringPreview.billingTimingLabel}
                </p>
                <p>{recurringPreview.billingTimingSummary}</p>
                <p>{recurringPreview.firstInvoiceSummary}</p>
                <p>{recurringPreview.partialPeriodSummary}</p>
                {hasAlternateBillingFrequency && data.fixed_billing_frequency && (
                  <p>
                    <strong>
                      {t('wizardFixed.preview.labels.alternateFrequency', {
                        defaultValue: 'Alternate Billing Frequency:',
                      })}
                    </strong>{' '}
                    {formatBillingFrequency(data.fixed_billing_frequency)}
                  </p>
                )}
                <div className="pt-2">
                  <p className="flex items-center gap-1">
                    <strong>{recurringPreview.materializedPeriodsHeading}:</strong>
                    <Tooltip
                      content={t('wizardFixed.preview.materializedPeriods.tooltip', {
                        defaultValue:
                          'A preview of the next few service periods and the invoice windows that would be generated for them based on the current settings. These help you sanity-check the cadence before saving — actual invoices are produced later by the billing run.',
                      })}
                    >
                      <HelpCircle className="h-3.5 w-3.5 text-[rgb(var(--color-text-300))] cursor-help" />
                    </Tooltip>
                  </p>
                  <p>{recurringPreview.materializedPeriodsSummary}</p>
                  <ul className="list-disc pl-5 space-y-1">
                    {recurringPreview.materializedPeriods.map((period) => (
                      <li key={`${period.servicePeriodLabel}:${period.invoiceWindowLabel}`}>
                        <span>
                          <strong>{t('wizardFixed.preview.labels.service', { defaultValue: 'Service:' })}</strong>{' '}
                          {period.servicePeriodLabel}
                        </span>
                        <span className="block">
                          <strong>{t('wizardFixed.preview.labels.invoiceWindow', { defaultValue: 'Invoice window:' })}</strong>{' '}
                          {period.invoiceWindowLabel}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </ReflectionContainer>
  );
}
