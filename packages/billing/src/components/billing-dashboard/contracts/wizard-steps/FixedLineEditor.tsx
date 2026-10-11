'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { ContractWizardFixedLine } from '@alga-psa/types';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { Plus, X, Package, HelpCircle, Coins } from 'lucide-react';
import { getCurrencySymbol } from '@alga-psa/core';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFormatBillingFrequency } from '@alga-psa/billing/hooks/useBillingEnumOptions';
import { getServiceCatalogRatesForCurrency } from '@alga-psa/billing/actions/serviceActions';
import type { ContractWizardData } from '../ContractWizard';
import { QuantityInput } from '../QuantityInput';
import { ServiceCatalogPicker, ServiceCatalogPickerItem } from '../ServiceCatalogPicker';
import { BillingFrequencyOverrideSelect } from '../BillingFrequencyOverrideSelect';
import { getRecurringAuthoringPreview } from '../recurringAuthoringPreview';
import { FixedServiceConfigPanel } from '../../service-configurations/FixedServiceConfigPanel';
import { resolveContractAuthoringRate } from '../../../../lib/contractAuthoringRate';
import { isServicelessFixedLine } from '../../../../lib/contractWizardFixedLines';
import {
  fixedServicesRecurringTotalCents,
  hasBundleFixedService,
  isUnitFixedService,
  unitFixedServiceAmountCents,
} from '../../../../lib/fixedServiceBasis';

type FixedServiceDraft = ContractWizardFixedLine['services'][number];

export interface FixedLineEditorProps {
  line: ContractWizardFixedLine;
  index: number;
  /** Contract-level settings a line falls back to. */
  contract: Pick<ContractWizardData, 'currency_code' | 'billing_frequency' | 'cadence_owner' | 'billing_timing'>;
  /** Shallow-merges into this line; the function form reads the latest line (use after an `await`). */
  updateLine: (
    patch: Partial<ContractWizardFixedLine> | ((line: ContractWizardFixedLine) => Partial<ContractWizardFixedLine>),
  ) => void;
  onRemove: () => void;
}

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

/**
 * One recurring Fixed contract line: its own base rate, members, proration and
 * cadence override. The base-rate input text and the manual/auto flag are local
 * to the line, so editing one line never disturbs another.
 */
export function FixedLineEditor({ line, index, contract, updateLine, onRemove }: FixedLineEditorProps) {
  const { t } = useTranslation('msp/contracts');
  const { money } = useCurrencyFormat();
  const formatBillingFrequency = useFormatBillingFrequency();
  const idPrefix = `fixed-line-${index}`;

  const [baseRateInput, setBaseRateInput] = useState<string>(() =>
    typeof line.base_rate === 'number' ? (line.base_rate / 100).toFixed(2) : '',
  );
  // A populated base rate (manual edit, resumed draft, or existing line) is
  // authoritative; the service-derived total is only a suggestion while the
  // field remains auto-derived.
  const [baseRateIsManual, setBaseRateIsManual] = useState<boolean>(
    () => typeof line.base_rate === 'number' && line.base_rate > 0,
  );
  // Catalog price in the contract currency, keyed by service so reordering or
  // removing rows cannot attach a price to the wrong service.
  const [catalogRates, setCatalogRates] = useState<Record<string, number | null>>({});
  // Services whose unit rate the operator deliberately emptied: the catalog
  // prefill must not refill them while the replacement is typed.
  const clearedRateServices = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof line.base_rate === 'number') {
      setBaseRateInput((line.base_rate / 100).toFixed(2));
    } else {
      setBaseRateInput((previous) => (baseRateIsManual ? previous : ''));
    }
    // Keyed only on the committed rate: re-running when the manual flag flips
    // would clobber an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.base_rate]);

  const autoBaseRate = (services: FixedServiceDraft[]): Partial<ContractWizardFixedLine> => {
    if (baseRateIsManual) return {};
    const total = computeWeightedResolvedRate(services);
    return { base_rate: total > 0 ? total : null };
  };

  const mutateServices = (change: (services: FixedServiceDraft[]) => FixedServiceDraft[]) => {
    updateLine((current) => {
      const next = change(current.services);
      return { services: next, ...autoBaseRate(next) };
    });
  };

  const unitServicesMissingRate = line.services
    .filter(
      (service) =>
        isUnitFixedService(service) &&
        service.service_id &&
        service.unit_rate == null &&
        !clearedRateServices.current.has(service.service_id),
    )
    .map((service) => service.service_id);
  const missingRateKey = Array.from(new Set(unitServicesMissingRate)).sort().join(',');

  useEffect(() => {
    if (!missingRateKey || !contract.currency_code) return;
    let cancelled = false;
    (async () => {
      try {
        const rates = await getServiceCatalogRatesForCurrency(missingRateKey.split(','), contract.currency_code);
        if (cancelled) return;
        setCatalogRates((prev) => ({ ...prev, ...rates }));
        // Apply against the line as it is now: only a still-unpriced per-unit
        // row on the same service is filled in.
        updateLine((current) => ({
          services: current.services.map((service) =>
            isUnitFixedService(service) &&
            service.service_id &&
            service.unit_rate == null &&
            !clearedRateServices.current.has(service.service_id) &&
            rates[service.service_id] != null
              ? { ...service, unit_rate: rates[service.service_id] as number }
              : service,
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
  }, [missingRateKey, contract.currency_code]);

  const handleAddService = () => {
    mutateServices((services) => [
      ...services,
      {
        service_id: '',
        service_name: '',
        quantity: 1,
        pricing_basis: 'bundle' as const,
        unit_rate: undefined,
        bucket_overlay: undefined,
      },
    ]);
  };

  const handleRemoveService = (serviceIndex: number) => {
    clearedRateServices.current.delete(line.services[serviceIndex]?.service_id);
    mutateServices((services) => services.filter((_, i) => i !== serviceIndex));
  };

  const handleServiceChange = (serviceIndex: number, item: ServiceCatalogPickerItem) => {
    const catalogRate =
      item.currency_rate != null && item.currency_rate > 0 ? Math.round(item.currency_rate) : null;
    setCatalogRates((prev) => ({ ...prev, [item.service_id]: catalogRate }));
    const resolved = resolveContractAuthoringRate(item, contract.currency_code);
    mutateServices((services) => {
      const next = [...services];
      const current = next[serviceIndex];
      const serviceChanged = current.service_id !== item.service_id;
      if (serviceChanged) {
        clearedRateServices.current.delete(current.service_id);
        clearedRateServices.current.delete(item.service_id);
      }
      next[serviceIndex] = {
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
      return next;
    });
  };

  const handleQuantityChange = (serviceIndex: number, rawValue: number) => {
    mutateServices((services) => {
      const next = [...services];
      const isUnit = isUnitFixedService(next[serviceIndex]);
      // Recurring seats are a whole number >= 0 (zero is a stored zero, never 1);
      // an allocation keeps its historical minimum of 1.
      const quantity = isUnit
        ? Math.max(0, Math.floor(Number.isFinite(rawValue) ? rawValue : 0))
        : Math.max(1, rawValue || 1);
      next[serviceIndex] = { ...next[serviceIndex], quantity };
      return next;
    });
  };

  const handleConfigurationChange = (
    serviceIndex: number,
    updates: { pricing_basis?: 'bundle' | 'unit' | null; base_rate?: number | null },
  ) => {
    mutateServices((services) => {
      const next = [...services];
      const current = next[serviceIndex];
      const pricingBasis: 'bundle' | 'unit' =
        updates.pricing_basis === 'unit'
          ? 'unit'
          : updates.pricing_basis === 'bundle'
            ? 'bundle'
            : current.pricing_basis;
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
      next[serviceIndex] = { ...current, pricing_basis: pricingBasis, unit_rate: unitRate, quantity };
      return next;
    });
  };

  const currencySymbol = getCurrencySymbol(contract.currency_code);
  const formatCurrency = (cents: number | null | undefined) => money(cents ?? 0, contract.currency_code);
  const selectedServices = line.services.filter((service) => service.service_id);
  const hasBundleMember = hasBundleFixedService(line.services);
  const unitServices = selectedServices.filter((service) => isUnitFixedService(service));
  const recurringTotalCents = fixedServicesRecurringTotalCents(selectedServices, line.base_rate);
  const effectiveFrequency = line.billing_frequency ?? contract.billing_frequency;
  const hasAlternateBillingFrequency =
    line.billing_frequency !== undefined && line.billing_frequency !== contract.billing_frequency;
  const showBaseRate =
    (line.services.length > 0 && hasBundleMember) ||
    (line.services.length === 0 && (Boolean(line.base_rate) || baseRateInput !== ''));
  const servicelessWarning = isServicelessFixedLine(line);

  const recurringPreview = getRecurringAuthoringPreview(
    {
      cadenceOwner: contract.cadence_owner,
      billingTiming: line.billing_timing ?? contract.billing_timing,
      billingFrequency: effectiveFrequency,
      enableProration: line.enable_proration,
    },
    t,
  );

  return (
    <div
      id={idPrefix}
      className="space-y-4 p-4 border border-[rgb(var(--color-border-200))] rounded-md bg-[rgb(var(--color-border-50))]"
    >
      <div className="flex items-end gap-3">
        <div className="flex-1 space-y-2">
          <Label htmlFor={`${idPrefix}-name`} className="text-sm">
            {t('wizard.fixedLines.nameLabel', { defaultValue: 'Line name (optional)' })}
          </Label>
          <Input
            id={`${idPrefix}-name`}
            value={line.contract_line_name ?? ''}
            onChange={(event) => updateLine({ contract_line_name: event.target.value })}
            placeholder={t('wizard.fixedLines.namePlaceholder', {
              defaultValue: 'Fixed line {{number}}',
              number: index + 1,
            })}
          />
        </div>
        <Button
          id={`remove-fixed-line-${index}`}
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={t('wizard.fixedLines.removeLine', { defaultValue: 'Remove fixed line' })}
          className="text-[rgb(var(--color-destructive))] hover:text-[rgb(var(--color-destructive))] hover:bg-[rgb(var(--color-destructive)/0.1)]"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {servicelessWarning && (
        <Alert variant="warning" id={`${idPrefix}-no-service-warning`}>
          <AlertDescription>
            {t('wizard.fixedLines.noServiceWarning', {
              defaultValue:
                'This line has a recurring amount but no service to bill it on. Add a service before finishing; you can still save it as a draft.',
            })}
          </AlertDescription>
        </Alert>
      )}

      {showBaseRate && (
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-base-rate`} className="flex items-center gap-2">
            <Coins className="h-4 w-4" />
            {t('wizardFixed.baseRate.label', { defaultValue: 'Recurring Base Rate' })} *
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgb(var(--color-text-400))]">
              {currencySymbol}
            </span>
            <Input
              id={`${idPrefix}-base-rate`}
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
                  updateLine({ base_rate: null });
                } else {
                  const cents = Math.round((parseFloat(baseRateInput) || 0) * 100);
                  updateLine({ base_rate: cents });
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

      {line.services.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <SwitchWithLabel
              label={t('wizardFixed.proration.label', { defaultValue: 'Adjust for Partial Periods' })}
              checked={line.enable_proration}
              onCheckedChange={(checked) => updateLine({ enable_proration: checked })}
            />
            <Tooltip
              content={t('wizardFixed.proration.tooltip', {
                defaultValue: 'Adjust the recurring fee when contract dates cover only part of a service period.',
              })}
            >
              <HelpCircle className="h-4 w-4 text-[rgb(var(--color-text-300))] cursor-help" />
            </Tooltip>
          </div>
          <p className="text-xs text-[rgb(var(--color-text-400))]">{recurringPreview.partialPeriodSummary}</p>
        </div>
      )}

      <div className="space-y-4">
        <Label className="flex items-center gap-2">
          <Package className="h-4 w-4" />
          {t('wizardFixed.services.label', { defaultValue: 'Services' })}
        </Label>

        {line.services.map((service, serviceIndex) => (
          <div
            key={serviceIndex}
            className="flex items-start gap-3 p-4 border border-[rgb(var(--color-border-200))] rounded-md bg-white"
          >
            <div className="flex-1 space-y-3">
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-service-select-${serviceIndex}`} className="text-sm">
                  {t('wizardFixed.services.serviceItemLabel', {
                    defaultValue: 'Service {{index}}',
                    index: serviceIndex + 1,
                  })}
                </Label>
                <ServiceCatalogPicker
                  id={`${idPrefix}-service-select-${serviceIndex}`}
                  value={service.service_id}
                  selectedLabel={service.service_name}
                  onSelect={(item) => handleServiceChange(serviceIndex, item)}
                  itemKinds={['service']}
                  currencyCode={contract.currency_code}
                  placeholder={t('wizardFixed.services.selectServicePlaceholder', {
                    defaultValue: 'Select a service',
                  })}
                />
                {service.resolved_rate_source === 'catalog-default' &&
                service.resolved_rate !== null &&
                service.resolved_rate !== undefined ? (
                  <p className="text-xs text-[rgb(var(--color-text-400))]">
                    {t('wizardFixed.services.catalogDefaultHint', {
                      defaultValue: 'No {{currency}} catalog price; using the catalog default rate.',
                      currency: contract.currency_code,
                    })}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-quantity-${serviceIndex}`} className="text-sm">
                  {isUnitFixedService(service)
                    ? t('wizardFixed.services.recurringQuantityLabel', { defaultValue: 'Recurring quantity' })
                    : t('wizardFixed.services.allocationQuantityLabel', { defaultValue: 'Allocation quantity' })}
                </Label>
                <QuantityInput
                  id={`${idPrefix}-quantity-${serviceIndex}`}
                  value={service.quantity}
                  onCommit={(value) => handleQuantityChange(serviceIndex, value)}
                  min={isUnitFixedService(service) ? 0 : 1}
                  className="w-24"
                />
              </div>

              <FixedServiceConfigPanel
                idPrefix={`wizard-fixed-${index}-${serviceIndex}-`}
                currencyCode={contract.currency_code}
                configuration={{ pricing_basis: service.pricing_basis, base_rate: service.unit_rate }}
                quantity={service.quantity}
                planFixedConfig={{ enable_proration: line.enable_proration }}
                onConfigurationChange={(updates) => handleConfigurationChange(serviceIndex, updates)}
                onPlanFixedConfigChange={() => undefined}
                hideProration
              />

              {isUnitFixedService(service) && service.service_id && catalogRates[service.service_id] === null && (
                <p className="text-xs text-amber-700" id={`${idPrefix}-no-catalog-price-${serviceIndex}`}>
                  {t('wizardFixed.services.noCurrencyPrice', {
                    defaultValue: 'No {{currency}} price in the catalog. Enter a unit rate.',
                    currency: contract.currency_code,
                  })}
                </p>
              )}
            </div>

            <Button
              id={`${idPrefix}-remove-service-${serviceIndex}`}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleRemoveService(serviceIndex)}
              className="mt-8 text-[rgb(var(--color-destructive))] hover:text-[rgb(var(--color-destructive))] hover:bg-[rgb(var(--color-destructive)/0.1)]"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}

        <Button
          id={`${idPrefix}-add-service-button`}
          type="button"
          variant="outline"
          onClick={handleAddService}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          {t('wizardFixed.services.addService', { defaultValue: 'Add Service' })}
        </Button>
      </div>

      {(line.services.length > 0 || servicelessWarning) && (
        <BillingFrequencyOverrideSelect
          contractBillingFrequency={contract.billing_frequency}
          value={hasAlternateBillingFrequency ? line.billing_frequency : undefined}
          onChange={(value) => updateLine({ billing_frequency: value })}
          label={t('wizardFixed.alternateFrequencyLabel', { defaultValue: 'Alternate Billing Frequency (Optional)' })}
        />
      )}

      {line.services.length > 0 && (
        <Alert variant="info" className="mt-2">
          <AlertDescription>
            <h4 className="text-sm font-semibold mb-2">
              {t('wizardFixed.preview.title', { defaultValue: 'Recurring Preview Before Save' })}
            </h4>
            <div className="text-sm space-y-1">
              <p>
                <strong>{t('wizardFixed.preview.labels.services', { defaultValue: 'Services:' })}</strong>{' '}
                {line.services.length}
              </p>
              {hasBundleMember && line.base_rate ? (
                <p>
                  <strong>{t('wizardFixed.preview.labels.recurringRate', { defaultValue: 'Recurring Rate:' })}</strong>{' '}
                  {formatCurrency(line.base_rate)}
                </p>
              ) : null}
              {unitServices.length > 0 && (
                <div id={`${idPrefix}-unit-services-preview`}>
                  <strong>
                    {t('wizardFixed.preview.labels.recurringUnits', { defaultValue: 'Recurring seats/units:' })}
                  </strong>
                  <ul className="list-disc pl-5 space-y-1">
                    {unitServices.map((service) => (
                      <li key={service.service_id}>
                        {t('wizardFixed.preview.unitRow', {
                          defaultValue: '{{serviceName}}: {{quantity}} × {{rate}} = {{amount}}',
                          serviceName: service.service_name || service.service_id,
                          quantity: service.quantity,
                          rate: formatCurrency(service.unit_rate ?? 0),
                          amount: formatCurrency(unitFixedServiceAmountCents(service.quantity, service.unit_rate ?? 0)),
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
              {hasAlternateBillingFrequency && line.billing_frequency && (
                <p>
                  <strong>
                    {t('wizardFixed.preview.labels.alternateFrequency', {
                      defaultValue: 'Alternate Billing Frequency:',
                    })}
                  </strong>{' '}
                  {formatBillingFrequency(line.billing_frequency)}
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
  );
}
