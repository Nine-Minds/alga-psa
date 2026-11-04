'use client';

import React from 'react';
import { Plus, X, Coins } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { CurrencyInput } from '@alga-psa/ui/components/CurrencyInput';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ServiceCatalogPicker, type ServiceCatalogPickerItem } from './ServiceCatalogPicker';
import { PrepaidBlockConfigFields } from './PrepaidBlockConfigFields';
import {
  draftToInput,
  emptyPrepaidBlockLineDraft,
  majorToMinor,
  minorToMajor,
  prepaidLineSoldAsRate,
  type PrepaidBlockDraftErrorCode,
  type PrepaidBlockLineDraft,
} from './prepaidBlockConfigDraft';
import { resolveContractAuthoringRate } from '../../../lib/contractAuthoringRate';

interface PrepaidBlockLinesEditorProps {
  /** Prefix for element ids. */
  idPrefix: string;
  lines: PrepaidBlockLineDraft[];
  onChange: (lines: PrepaidBlockLineDraft[]) => void;
  /** Contract currency in the client wizard; the authoring currency scale in the template wizard. */
  currencyCode: string;
  /** Template mode: currency-neutral price, and no per-service hourly rate input. */
  neutral?: boolean;
}

// LEVERAGE: pattern prepaid-block-draft-error-text — same code->message switch as CreateCustomContractLineDialog and PrepaidBlockPanel
export function usePrepaidBlockDraftErrorText(): (code: PrepaidBlockDraftErrorCode) => string {
  const { t } = useTranslation('msp/contracts');
  return (code) => {
    switch (code) {
      case 'hoursInvalid':
        return t('prepaidBlock.errors.hoursInvalid', { defaultValue: 'Enter a block size greater than zero (fractions of an hour are allowed).' });
      case 'priceInvalid':
        return t('prepaidBlock.errors.priceInvalid', { defaultValue: 'Enter a block price of zero or more.' });
      case 'expiryInvalid':
        return t('prepaidBlock.errors.expiryInvalid', { defaultValue: 'Expiry must be a whole number of months from 1 to 120, or empty.' });
      case 'thresholdInvalid':
        return t('prepaidBlock.errors.thresholdInvalid', { defaultValue: 'The usage threshold must be a whole percentage from 1 to 99, or empty.' });
      default:
        return t('prepaidBlock.errors.serviceRequired', { defaultValue: 'The line needs at least one hourly service.' });
    }
  };
}

/**
 * Wizard editor for Prepaid Block lines. Each entry becomes its own Hourly line
 * with a block config; used by the client contract wizard and the template wizard.
 */
export function PrepaidBlockLinesEditor({
  idPrefix,
  lines,
  onChange,
  currencyCode,
  neutral = false,
}: PrepaidBlockLinesEditorProps) {
  const { t } = useTranslation('msp/contracts');
  const errorText = usePrepaidBlockDraftErrorText();

  const updateLine = (lineIndex: number, patch: Partial<PrepaidBlockLineDraft>) => {
    onChange(lines.map((line, i) => (i === lineIndex ? { ...line, ...patch } : line)));
  };

  const updateService = (
    lineIndex: number,
    serviceIndex: number,
    patch: Partial<PrepaidBlockLineDraft['services'][number]>,
  ) => {
    const line = lines[lineIndex];
    updateLine(lineIndex, {
      services: line.services.map((s, i) => (i === serviceIndex ? { ...s, ...patch } : s)),
    });
  };

  const handleServicePicked = (lineIndex: number, serviceIndex: number, item: ServiceCatalogPickerItem) => {
    const resolved = neutral ? { rate: null } : resolveContractAuthoringRate(item, currencyCode);
    updateService(lineIndex, serviceIndex, {
      service_id: item.service_id,
      service_name: item.service_name,
      hourly_rate: resolved.rate ?? undefined,
    });
  };

  return (
    <div id={`${idPrefix}-section`} className="space-y-4">
      <div>
        <h4 className="text-base font-semibold">
          {t('wizardPrepaidBlock.heading', { defaultValue: 'Prepaid block lines' })}
        </h4>
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          {neutral
            ? t('wizardPrepaidBlock.templateDescription', {
                defaultValue: 'Sell hours in advance. Each line invoices a block of hours at a fixed price, and tracked time draws the block down. The price takes the client\'s currency when a contract is created from this template.',
              })
            : t('wizardPrepaidBlock.description', {
                defaultValue: 'Sell hours in advance. Each line invoices a block of hours at a fixed price, and tracked time draws the block down; hours beyond the block bill at the hourly rate.',
              })}
        </p>
      </div>

      {lines.map((line, lineIndex) => {
        const linePrefix = `${idPrefix}-${lineIndex}`;
        const coveredServices = line.services
          .filter((s) => s.service_id)
          .map((s) => ({
            service_id: s.service_id,
            service_name: s.service_name || s.service_id,
            hourly_rate: s.hourly_rate,
          }));
        const parsed = draftToInput(line.block, prepaidLineSoldAsRate(line));
        const draftErrors =
          line.services.some((s) => s.service_id) && 'errors' in parsed ? parsed.errors.map(errorText) : [];

        return (
          <div
            key={lineIndex}
            id={`${linePrefix}-card`}
            className="space-y-4 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor={`${linePrefix}-name`}>
                  {t('wizardPrepaidBlock.lineName', { defaultValue: 'Line name (optional)' })}
                </Label>
                <Input
                  id={`${linePrefix}-name`}
                  value={line.name ?? ''}
                  placeholder={t('wizardPrepaidBlock.lineNamePlaceholder', { defaultValue: 'Prepaid Block' })}
                  onChange={(e) => updateLine(lineIndex, { name: e.target.value })}
                />
              </div>
              <Button
                id={`${linePrefix}-remove`}
                type="button"
                variant="ghost"
                size="sm"
                className="mt-6 text-[rgb(var(--color-destructive))]"
                onClick={() => onChange(lines.filter((_, i) => i !== lineIndex))}
                aria-label={t('wizardPrepaidBlock.removeLine', { defaultValue: 'Remove prepaid block line' })}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {line.services.map((service, serviceIndex) => (
              <div key={serviceIndex} className="flex items-start gap-3">
                <div className="flex-1 space-y-1">
                  <Label htmlFor={`${linePrefix}-service-${serviceIndex}`}>
                    {t('wizardPrepaidBlock.serviceItem', {
                      defaultValue: 'Service {{index}}',
                      index: serviceIndex + 1,
                    })}
                  </Label>
                  <ServiceCatalogPicker
                    id={`${linePrefix}-service-${serviceIndex}`}
                    value={service.service_id}
                    selectedLabel={service.service_name}
                    onSelect={(item) => handleServicePicked(lineIndex, serviceIndex, item)}
                    itemKinds={['service']}
                    currencyCode={currencyCode}
                    placeholder={t('wizardHourly.labels.selectServicePlaceholder', { defaultValue: 'Select a service' })}
                  />
                </div>
                {!neutral && (
                  <div className="w-40 space-y-1">
                    <Label htmlFor={`${linePrefix}-rate-${serviceIndex}`} className="flex items-center gap-1 text-sm">
                      <Coins className="h-3 w-3" />
                      {t('wizardPrepaidBlock.overageRate', { defaultValue: 'Hourly rate' })}
                    </Label>
                    <CurrencyInput
                      id={`${linePrefix}-rate-${serviceIndex}`}
                      value={minorToMajor(service.hourly_rate, currencyCode)}
                      currencyCode={currencyCode}
                      onChange={(major) =>
                        updateService(lineIndex, serviceIndex, { hourly_rate: majorToMinor(major, currencyCode) })
                      }
                    />
                  </div>
                )}
                {line.services.length > 1 && (
                  <Button
                    id={`${linePrefix}-remove-service-${serviceIndex}`}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-6"
                    onClick={() =>
                      updateLine(lineIndex, { services: line.services.filter((_, i) => i !== serviceIndex) })
                    }
                    aria-label={t('wizardPrepaidBlock.removeService', { defaultValue: 'Remove service' })}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}

            <Button
              id={`${linePrefix}-add-service`}
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                updateLine(lineIndex, {
                  services: [...line.services, { service_id: '', service_name: '', hourly_rate: undefined }],
                })
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('wizardPrepaidBlock.addService', { defaultValue: 'Add service to this line' })}
            </Button>

            <PrepaidBlockConfigFields
              idPrefix={linePrefix}
              value={line.block}
              onChange={(block) => updateLine(lineIndex, { block })}
              currencyCode={currencyCode}
              coveredServices={coveredServices}
              errors={draftErrors}
              neutralPrice={neutral}
            />
          </div>
        );
      })}

      <Button
        id={`${idPrefix}-add-line`}
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => onChange([...lines, emptyPrepaidBlockLineDraft()])}
      >
        <Plus className="mr-2 h-4 w-4" />
        {t('wizardPrepaidBlock.addLine', { defaultValue: 'Add Prepaid Block Line' })}
      </Button>
    </div>
  );
}
