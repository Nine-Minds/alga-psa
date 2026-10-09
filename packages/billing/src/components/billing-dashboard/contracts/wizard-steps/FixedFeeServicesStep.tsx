'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { QuantityInput } from '../QuantityInput';
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
import { getUnsupportedRecurringAuthoringCombination } from '@alga-psa/shared/billingClients/recurringAuthoringValidation';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFormatBillingFrequency } from '@alga-psa/billing/hooks/useBillingEnumOptions';
import { resolveContractAuthoringRate } from '../../../../lib/contractAuthoringRate';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { getServiceCatalogRatesForCurrency } from '@alga-psa/billing/actions/serviceActions';
import { FixedServiceConfigPanel } from '../../service-configurations/FixedServiceConfigPanel';
import {
  fixedServicesRecurringTotalCents,
  hasBundleFixedService,
  isUnitFixedService,
  unitFixedServiceAmountCents,
} from '../../../../lib/fixedServiceBasis';

interface FixedFeeServicesStepProps {
  data: ContractWizardData;
  /**
   * Accepts a partial to shallow-merge, or a function that derives the partial
   * from the latest wizard state. Use the function form after an `await`, where
   * `data` is the render that started the async work and may be stale.
   */
  updateData: (
    data: Partial<ContractWizardData> | ((prev: ContractWizardData) => Partial<ContractWizardData>),
  ) => void;
}

type FixedServiceDraft = ContractWizardData['fixed_services'][number];

function computeWeightedResolvedRate(services: FixedServiceDraft[]): number {
  return services.reduce((sum, service) => {
    // Only bundle members share the line base rate; per-seat/unit members bill
    // quantity × unit rate separately and must not inflate the suggestion.
    if (isUnitFixedService(service)) return sum;
    const rate =
      typeof service.resolved_rate === 'number' && Number.isFinite(service.resolved_rate)
        ? service.resolved_rate
        : 0;
    const quantity = Number.isFinite(service.quantity) ? service.quantity : 0;
    return sum + Math.round(rate * quantity);
  }, 0);
}

export function FixedFeeServicesStep({ data, updateData }: FixedFeeServicesStepProps) {
  const { t } = useTranslation('msp/contracts');
  const [baseRateInput, setBaseRateInput] = useState<string>('');
  // A populated base rate (manual edit, resumed draft, or existing line) is
  // authoritative; the service-derived total is only a suggestion while the
  // field remains auto-derived.
  const [baseRateIsManual, setBaseRateIsManual] = useState<boolean>(
    () => typeof data.fixed_base_rate === 'number' && data.fixed_base_rate > 0,
  );
  const { money } = useCurrencyFormat();
  // Catalog price in the contract currency (service_prices), keyed by service so
  // reordering or removing rows cannot attach a price to the wrong service.
  const [catalogRates, setCatalogRates] = useState<Record<string, number | null>>({});

  // Services whose unit rate the operator deliberately emptied. Catalog prefill
  // is for rows that never had a rate; an emptied field must stay empty while
  // the operator types the replacement, and is then rejected by step validation
  // and submission (getFixedServiceBasisIssue) instead of being refilled. A ref
  // so the async prefill below always reads the latest set, not a render's copy.
  const clearedRateServices = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (data.fixed_base_rate !== undefined) {
      setBaseRateInput((data.fixed_base_rate / 100).toFixed(2));
    } else {
      // An auto-derived suggestion that drops to zero clears the field so the
      // existing non-zero validation still applies. A manually cleared field is
      // left alone.
      setBaseRateInput((previous) => (baseRateIsManual ? previous : ''));
    }
    // Intentionally keyed only on the committed rate: re-running when the
    // manual flag flips would clobber an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.fixed_base_rate]);

  /**
   * Returns the base-rate field update that keeps the suggestion in sync while
   * it is auto-derived. Once the author edits the field, returns nothing so the
   * manual value survives later service/quantity changes.
   */
  const getAutoBaseRateUpdate = (services: FixedServiceDraft[]): Partial<ContractWizardData> => {
    if (baseRateIsManual) {
      return {};
    }
    const total = computeWeightedResolvedRate(services);
    return { fixed_base_rate: total > 0 ? total : undefined };
  };

  // A per-seat service that arrives without a unit rate (from a template,
  // which is currency-neutral, or a resumed draft) follows the catalog price in
  // the contract currency until the operator overrides it.
  const unitServicesMissingRate = data.fixed_services
    .filter((service) => isUnitFixedService(service) && service.service_id && service.unit_rate == null && !clearedRateServices.current.has(service.service_id))
    .map((service) => service.service_id);
  const missingRateKey = Array.from(new Set(unitServicesMissingRate)).sort().join(',');

  useEffect(() => {
    if (!missingRateKey || !data.currency_code) return;
    let cancelled = false;
    (async () => {
      try {
        const rates = await getServiceCatalogRatesForCurrency(missingRateKey.split(','), data.currency_code);
        if (cancelled) return;
        setCatalogRates((prev) => ({ ...prev, ...rates }));
        // Apply against the wizard state as it is now: the operator may have
        // edited rows while the request was pending, and only a still-unpriced
        // per-unit row on the same service is filled in.
        updateData((prev) => ({
          fixed_services: prev.fixed_services.map((service) =>
            isUnitFixedService(service) && service.service_id && service.unit_rate == null && !clearedRateServices.current.has(service.service_id) && rates[service.service_id] != null
              ? { ...service, unit_rate: rates[service.service_id] as number }
              : service
          ),
        }));
      } catch (error) {
        console.error('Failed to load catalog prices for recurring services', error);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingRateKey, data.currency_code]);

  const handleAddService = () => {
    const next = [
      ...data.fixed_services,
      {
        service_id: '',
        service_name: '',
        quantity: 1,
        pricing_basis: 'bundle' as const,
        unit_rate: undefined,
        bucket_overlay: undefined,
      },
    ];
    updateData({ fixed_services: next, ...getAutoBaseRateUpdate(next) });
  };

  const handleRemoveService = (index: number) => {
    clearedRateServices.current.delete(data.fixed_services[index]?.service_id);
    const next = data.fixed_services.filter((_, i) => i !== index);
    updateData({ fixed_services: next, ...getAutoBaseRateUpdate(next) });
  };

  const handleServiceChange = (index: number, item: ServiceCatalogPickerItem) => {
    const catalogRate =
      item.currency_rate != null && item.currency_rate > 0 ? Math.round(item.currency_rate) : null;
    setCatalogRates((prev) => ({ ...prev, [item.service_id]: catalogRate }));

    const next = [...data.fixed_services];
    const current = next[index];
    const resolved = resolveContractAuthoringRate(item, data.currency_code);
    // A unit row follows the newly chosen service's catalog price; the operator
    // can still overwrite it. A bundle row carries no unit rate.
    const serviceChanged = current.service_id !== item.service_id;
    if (serviceChanged) {
      clearedRateServices.current.delete(current.service_id);
      clearedRateServices.current.delete(item.service_id);
    }
    next[index] = {
      ...current,
      service_id: item.service_id,
      service_name: item.service_name,
      resolved_rate: resolved.rate,
      resolved_rate_source: resolved.source,
      unit_rate:
        isUnitFixedService(current) && (serviceChanged || current.unit_rate == null)
          ? (catalogRate ?? resolved.rate ?? undefined)
          : current.unit_rate,
    };
    updateData({ fixed_services: next, ...getAutoBaseRateUpdate(next) });
  };

  const handleQuantityChange = (index: number, rawValue: number) => {
    const next = [...data.fixed_services];
    const isUnit = isUnitFixedService(next[index]);
    // Recurring seats are a whole number >= 0 (zero is a stored zero, never 1);
    // an allocation keeps its historical minimum of 1.
    const quantity = isUnit
      ? Math.max(0, Math.floor(Number.isFinite(rawValue) ? rawValue : 0))
      : Math.max(1, rawValue || 1);
    next[index] = { ...next[index], quantity };
    updateData({ fixed_services: next, ...getAutoBaseRateUpdate(next) });
  };

  const handleConfigurationChange = (
    index: number,
    updates: { pricing_basis?: 'bundle' | 'unit' | null; base_rate?: number | null },
  ) => {
    const next = [...data.fixed_services];
    const current = next[index];
    const pricingBasis: 'bundle' | 'unit' = updates.pricing_basis === 'unit' ? 'unit' : updates.pricing_basis === 'bundle' ? 'bundle' : current.pricing_basis;
    let unitRate = updates.base_rate !== undefined ? updates.base_rate : current.unit_rate;
    if (updates.base_rate === null) clearedRateServices.current.add(current.service_id);
    else if (updates.base_rate !== undefined) clearedRateServices.current.delete(current.service_id);
    let quantity = current.quantity;
    if (updates.pricing_basis && updates.pricing_basis !== current.pricing_basis) {
      clearedRateServices.current.delete(current.service_id);
      if (updates.pricing_basis === 'unit') {
        // Prefill from the catalog price in the contract currency, overridable.
        if (unitRate == null) unitRate = catalogRates[current.service_id] ?? undefined;
      } else {
        quantity = Math.max(1, quantity || 1);
      }
    }
    next[index] = { ...current, pricing_basis: pricingBasis, unit_rate: unitRate, quantity };
    updateData({ fixed_services: next, ...getAutoBaseRateUpdate(next) });
  };

  const currencySymbol = getCurrencySymbol(data.currency_code);

  const formatCurrency = (cents: number | undefined) => money(cents ?? 0, data.currency_code);
  const hasBundleMember = hasBundleFixedService(data.fixed_services);
  const unitServices = data.fixed_services.filter(
    (service) => service.service_id && isUnitFixedService(service),
  );
  const recurringTotalCents = fixedServicesRecurringTotalCents(
    data.fixed_services.filter((service) => service.service_id),
    data.fixed_base_rate,
  );

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

  // Arrears is the default and the wizard has no other timing control, so this is
  // where an operator can move a new fixed-fee line to invoice on its start date.
  // Contract cadence only supports some frequencies; don't offer a switch that
  // would fail validation.
  const canSuggestAdvanceOnContractCadence =
    data.billing_timing !== 'advance' &&
    !getUnsupportedRecurringAuthoringCombination({
      lineType: 'Fixed',
      cadenceOwner: 'contract',
      billingFrequency: data.fixed_billing_frequency ?? data.billing_frequency,
    });

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

        {data.fixed_services.length > 0 && hasBundleMember && (
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
                    // Any edit makes the field authoritative; later service or
                    // quantity changes must not overwrite the author's value.
                    setBaseRateIsManual(true);
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
              {unitServices.length > 0
                ? t('wizardFixed.baseRate.hintWithUnits', {
                    defaultValue:
                      'Total recurring fee for the bundle services. Recurring seats/units bill quantity × unit rate separately and are not part of this rate.',
                  })
                : t('wizardFixed.baseRate.hint', {
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
                    currencyCode={data.currency_code}
                    placeholder={t('wizardFixed.services.selectServicePlaceholder', {
                      defaultValue: 'Select a service',
                    })}
                  />
                  {service.resolved_rate_source === 'catalog-default' && service.resolved_rate !== null && service.resolved_rate !== undefined ? (
                    <p className="text-xs text-[rgb(var(--color-text-400))]">
                      {t('wizardFixed.services.catalogDefaultHint', {
                        defaultValue: 'No {{currency}} catalog price; using the catalog default rate.',
                        currency: data.currency_code,
                      })}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`quantity-${index}`} className="text-sm">
                    {isUnitFixedService(service)
                      ? t('wizardFixed.services.recurringQuantityLabel', { defaultValue: 'Recurring quantity' })
                      : t('wizardFixed.services.allocationQuantityLabel', { defaultValue: 'Allocation quantity' })}
                  </Label>
                  <QuantityInput
                    id={`quantity-${index}`}
                    value={service.quantity}
                    onCommit={(value) => handleQuantityChange(index, value)}
                    min={isUnitFixedService(service) ? 0 : 1}
                    className="w-24"
                  />
                </div>

                <FixedServiceConfigPanel
                  idPrefix={`wizard-fixed-${index}-`}
                  currencyCode={data.currency_code}
                  configuration={{ pricing_basis: service.pricing_basis, base_rate: service.unit_rate }}
                  quantity={service.quantity}
                  planFixedConfig={{ enable_proration: data.enable_proration }}
                  onConfigurationChange={(updates) => handleConfigurationChange(index, updates)}
                  onPlanFixedConfigChange={() => undefined}
                  hideProration
                />

                {isUnitFixedService(service) && service.service_id && catalogRates[service.service_id] === null && (
                  <p className="text-xs text-amber-700" id={`fixed-service-no-catalog-price-${index}`}>
                    {t('wizardFixed.services.noCurrencyPrice', {
                      defaultValue: 'No {{currency}} price in the catalog. Enter a unit rate.',
                      currency: data.currency_code,
                    })}
                  </p>
                )}
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
                {hasBundleMember && data.fixed_base_rate ? (
                  <p>
                    <strong>{t('wizardFixed.preview.labels.recurringRate', { defaultValue: 'Recurring Rate:' })}</strong>{' '}
                    {formatCurrency(data.fixed_base_rate)}
                  </p>
                ) : null}
                {unitServices.length > 0 && (
                  <div id="fixed-unit-services-preview">
                    <strong>{t('wizardFixed.preview.labels.recurringUnits', { defaultValue: 'Recurring seats/units:' })}</strong>
                    <ul className="list-disc pl-5 space-y-1">
                      {unitServices.map((service) => (
                        <li key={service.service_id}>
                          {t('wizardFixed.preview.unitRow', {
                            defaultValue: '{{serviceName}}: {{quantity}} × {{rate}} = {{amount}}',
                            serviceName: service.service_name || service.service_id,
                            quantity: service.quantity,
                            rate: formatCurrency(service.unit_rate ?? 0),
                            amount: formatCurrency(
                              unitFixedServiceAmountCents(service.quantity, service.unit_rate ?? 0),
                            ),
                          })}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {unitServices.length > 0 && (
                  <p>
                    <strong>{t('wizardFixed.preview.labels.recurringTotal', { defaultValue: 'Total per period:' })}</strong>{' '}
                    {formatCurrency(recurringTotalCents)}
                  </p>
                )}
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

        {data.fixed_services.length > 0 && canSuggestAdvanceOnContractCadence && (
          <Alert variant="info" id="fixed-fee-advance-suggestion">
            <AlertDescription>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">
                  {t('wizardFixed.advanceSuggestion.message', {
                    defaultValue:
                      "Billed in arrears, this line can't be invoiced until its first service period ends. Billing in advance on the contract's cadence invoices it on the start date instead.",
                  })}
                </p>
                <Button
                  id="fixed-fee-bill-in-advance-on-contract-cadence"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => updateData({ billing_timing: 'advance', cadence_owner: 'contract' })}
                >
                  {t('wizardFixed.advanceSuggestion.action', {
                    defaultValue: "Bill in advance on the contract's cadence",
                  })}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </ReflectionContainer>
  );
}
