'use client';

import React, { useEffect, useState } from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { getCurrencySymbol } from '@alga-psa/core';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  useBillingFrequencyOptions,
  useFormatBillingFrequency,
  useFormatContractLineType,
} from '@alga-psa/billing/hooks/useBillingEnumOptions';
import type {
  ClientTemplateLineEditInput,
  ClientTemplateLinesView,
} from '@alga-psa/billing/actions/contractWizardActions';

type TemplateLineViewItem = ClientTemplateLinesView['lines'][number];
type TemplateServiceViewItem = TemplateLineViewItem['services'][number];

interface TemplateLinesStepProps {
  view: ClientTemplateLinesView | null;
  isLoading: boolean;
  loadError: string | null;
  edits: ClientTemplateLineEditInput[];
  onChange: (edits: ClientTemplateLineEditInput[]) => void;
}

const formatCents = (cents: number | null | undefined, symbol: string): string =>
  cents == null ? '' : `${symbol}${(cents / 100).toFixed(2)}`;

/** Cents input: text while typing, committed on blur. Empty = "no override". */
function CentsInput({
  id,
  valueCents,
  placeholder,
  symbol,
  onCommit,
}: {
  id: string;
  valueCents: number | null | undefined;
  placeholder: string;
  symbol: string;
  onCommit: (cents: number | undefined) => void;
}) {
  const [text, setText] = useState(valueCents != null ? (valueCents / 100).toFixed(2) : '');
  useEffect(() => {
    setText(valueCents != null ? (valueCents / 100).toFixed(2) : '');
  }, [valueCents]);

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgb(var(--color-text-400))]">{symbol}</span>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        className="pl-10"
        onChange={(event) => {
          const next = event.target.value.replace(/[^0-9.]/g, '');
          if ((next.match(/\./g) || []).length <= 1) setText(next);
        }}
        onBlur={() => {
          if (text.trim() === '' || text === '.') {
            setText('');
            onCommit(undefined);
            return;
          }
          const cents = Math.round((parseFloat(text) || 0) * 100);
          setText((cents / 100).toFixed(2));
          onCommit(cents);
        }}
      />
    </div>
  );
}

/**
 * Per-line editor for a contract being created from a template. The server
 * clones every template line; this step only collects per-line edits (keyed by
 * template line id) that are applied on top of the faithful clone. Anything
 * left untouched is copied from the template as-is.
 */
export function TemplateLinesStep({ view, isLoading, loadError, edits, onChange }: TemplateLinesStepProps) {
  const { t } = useTranslation('msp/contracts');
  const frequencyOptions = useBillingFrequencyOptions();
  const formatFrequency = useFormatBillingFrequency();
  const formatLineType = useFormatContractLineType();

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('wizardTemplateLines.loading', { defaultValue: 'Loading template lines...' })}
      </p>
    );
  }
  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }
  if (!view) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('wizardTemplateLines.noTemplate', { defaultValue: 'Select a template on the first step.' })}
      </p>
    );
  }

  const symbol = getCurrencySymbol(view.currency_code);
  const editFor = (lineId: string): ClientTemplateLineEditInput =>
    edits.find((edit) => edit.template_line_id === lineId) ?? { template_line_id: lineId };

  const patchLine = (lineId: string, patch: Partial<ClientTemplateLineEditInput>) => {
    const existing = edits.some((edit) => edit.template_line_id === lineId);
    const next = existing
      ? edits.map((edit) => (edit.template_line_id === lineId ? { ...edit, ...patch } : edit))
      : [...edits, { template_line_id: lineId, ...patch }];
    onChange(next);
  };

  const patchService = (
    lineId: string,
    serviceId: string,
    patch: { quantity?: number | null; rate?: number | null },
  ) => {
    const services = [...(editFor(lineId).services ?? [])];
    const index = services.findIndex((service) => service.service_id === serviceId);
    if (index >= 0) {
      services[index] = { ...services[index], ...patch };
    } else {
      services.push({ service_id: serviceId, ...patch });
    }
    patchLine(lineId, { services });
  };

  const effectiveMemberRate = (
    line: TemplateLineViewItem,
    service: TemplateServiceViewItem,
    edit: ClientTemplateLineEditInput,
  ): number | null => {
    const override = edit.services?.find((s) => s.service_id === service.service_id)?.rate;
    if (override !== undefined) return override;
    return service.template_rate ?? (line.line_type === 'Fixed' ? null : service.currency_rate);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">
          {t('wizardTemplateLines.title', { defaultValue: 'Template Lines' })}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('wizardTemplateLines.description', {
            defaultValue:
              'Every line of the template is created on the contract with its own name, billing frequency, services and rates. Change anything below to override it for this contract only; untouched values are copied from the template. Rates are in {{currency}}.',
            currency: view.currency_code,
          })}
        </p>
      </div>

      {view.lines.length === 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            {t('wizardTemplateLines.emptyTemplate', {
              defaultValue: 'This template has no lines, so there is nothing to create.',
            })}
          </AlertDescription>
        </Alert>
      )}

      {view.lines.map((line) => {
        const edit = editFor(line.template_line_id);
        const lineId = line.template_line_id;
        const lineRate = edit.fixed_base_rate !== undefined ? edit.fixed_base_rate : line.fixed_base_rate;
        return (
          <section key={lineId} className="space-y-4 rounded-md border p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {formatLineType(line.line_type)}
              </span>
              {line.bucket_pool_count > 0 && (
                <span className="text-xs text-muted-foreground">
                  {t('wizardTemplateLines.bucketPools', {
                    defaultValue: '{{count}} bucket pool(s) copied from the template',
                    count: line.bucket_pool_count,
                  })}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`tpl-line-name-${lineId}`}>
                  {t('wizardTemplateLines.lineName', { defaultValue: 'Line name' })}
                </Label>
                <Input
                  id={`tpl-line-name-${lineId}`}
                  value={edit.line_name ?? line.line_name}
                  onChange={(event) => patchLine(lineId, { line_name: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`tpl-line-frequency-${lineId}`}>
                  {t('wizardTemplateLines.billingFrequency', { defaultValue: 'Billing frequency' })}
                </Label>
                <CustomSelect
                  id={`tpl-line-frequency-${lineId}`}
                  options={frequencyOptions}
                  value={edit.billing_frequency ?? line.billing_frequency}
                  onValueChange={(value: string) => patchLine(lineId, { billing_frequency: value })}
                  placeholder={formatFrequency(line.billing_frequency)}
                />
              </div>
            </div>

            {line.line_type === 'Fixed' && (
              <div className="space-y-2">
                <Label htmlFor={`tpl-line-rate-${lineId}`}>
                  {t('wizardTemplateLines.fixedBaseRate', { defaultValue: 'Fixed base rate' })}
                </Label>
                <CentsInput
                  id={`tpl-line-rate-${lineId}`}
                  valueCents={edit.fixed_base_rate !== undefined ? edit.fixed_base_rate : undefined}
                  placeholder={
                    line.fixed_base_rate != null
                      ? (line.fixed_base_rate / 100).toFixed(2)
                      : '0.00'
                  }
                  symbol={symbol}
                  onCommit={(cents) => patchLine(lineId, { fixed_base_rate: cents })}
                />
                <p className="text-xs text-muted-foreground">
                  {lineRate != null
                    ? t('wizardTemplateLines.fixedBaseRateHint', {
                        defaultValue: 'Template rate {{rate}}. Leave empty to keep it.',
                        rate: formatCents(line.fixed_base_rate, symbol) || formatCents(lineRate, symbol),
                      })
                    : t('wizardTemplateLines.fixedBaseRateNone', {
                        defaultValue: 'The template sets no line rate; services follow their catalog prices.',
                      })}
                </p>
              </div>
            )}

            {line.line_type === 'Hourly' && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`tpl-line-min-${lineId}`}>
                    {t('wizardTemplateLines.minimumBillableTime', { defaultValue: 'Minimum billable time (minutes)' })}
                  </Label>
                  <Input
                    id={`tpl-line-min-${lineId}`}
                    type="number"
                    min="0"
                    value={
                      (edit.minimum_billable_time !== undefined
                        ? edit.minimum_billable_time
                        : line.minimum_billable_time) ?? ''
                    }
                    onChange={(event) =>
                      patchLine(lineId, {
                        minimum_billable_time: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`tpl-line-round-${lineId}`}>
                    {t('wizardTemplateLines.roundUpToNearest', { defaultValue: 'Round up to nearest (minutes)' })}
                  </Label>
                  <Input
                    id={`tpl-line-round-${lineId}`}
                    type="number"
                    min="0"
                    value={
                      (edit.round_up_to_nearest !== undefined
                        ? edit.round_up_to_nearest
                        : line.round_up_to_nearest) ?? ''
                    }
                    onChange={(event) =>
                      patchLine(lineId, {
                        round_up_to_nearest: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                  />
                </div>
              </div>
            )}

            <div className="space-y-3">
              {line.services.map((service) => {
                const memberEdit = edit.services?.find((s) => s.service_id === service.service_id);
                const effectiveRate = effectiveMemberRate(line, service, edit);
                const unpriced =
                  effectiveRate == null &&
                  !(line.line_type === 'Fixed' && (lineRate != null || service.has_currency_price)) &&
                  !(line.line_type !== 'Fixed' && service.currency_rate != null);
                const rateLabel =
                  line.line_type === 'Hourly'
                    ? t('wizardTemplateLines.hourlyRate', { defaultValue: 'Hourly rate' })
                    : line.line_type === 'Usage'
                      ? t('wizardTemplateLines.unitRate', { defaultValue: 'Unit rate' })
                      : t('wizardTemplateLines.serviceRate', { defaultValue: 'Service rate' });
                return (
                  <div
                    key={service.service_id}
                    className="grid grid-cols-1 items-start gap-3 md:grid-cols-[1fr_120px_180px]"
                  >
                    <div className="pt-6 text-sm font-medium">{service.service_name}</div>
                    <div className="space-y-1">
                      <Label htmlFor={`tpl-qty-${lineId}-${service.service_id}`} className="text-xs">
                        {t('wizardTemplateLines.quantity', { defaultValue: 'Quantity' })}
                      </Label>
                      <Input
                        id={`tpl-qty-${lineId}-${service.service_id}`}
                        type="number"
                        min="0"
                        value={
                          (memberEdit?.quantity !== undefined ? memberEdit.quantity : service.quantity) ?? ''
                        }
                        onChange={(event) =>
                          patchService(lineId, service.service_id, {
                            quantity: Math.max(0, Number(event.target.value) || 0),
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`tpl-rate-${lineId}-${service.service_id}`} className="text-xs">
                        {rateLabel}
                      </Label>
                      <CentsInput
                        id={`tpl-rate-${lineId}-${service.service_id}`}
                        valueCents={memberEdit?.rate ?? undefined}
                        placeholder={
                          effectiveRate != null ? (effectiveRate / 100).toFixed(2) : '0.00'
                        }
                        symbol={symbol}
                        onCommit={(cents) => patchService(lineId, service.service_id, { rate: cents })}
                      />
                      {unpriced && (
                        <p className="text-xs text-amber-700">
                          {t('wizardTemplateLines.noCurrencyPrice', {
                            defaultValue:
                              'No {{currency}} price for this service. Enter a rate or the contract cannot be created.',
                            currency: view.currency_code,
                          })}
                        </p>
                      )}
                      {!unpriced && service.template_rate != null && memberEdit?.rate === undefined && (
                        <p className="text-xs text-muted-foreground">
                          {t('wizardTemplateLines.templateRateNote', {
                            defaultValue: 'From the template (amount is not currency-tagged).',
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Compact read-only summary used on the review step in template mode. */
export function TemplateLinesReview({
  view,
  edits,
}: {
  view: ClientTemplateLinesView;
  edits: ClientTemplateLineEditInput[];
}) {
  const { t } = useTranslation('msp/contracts');
  const formatFrequency = useFormatBillingFrequency();
  const formatLineType = useFormatContractLineType();
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">
        {t('wizardTemplateLines.reviewTitle', { defaultValue: 'Lines created from the template' })}
      </h3>
      <ul className="space-y-2 text-sm">
        {view.lines.map((line) => {
          const edit = edits.find((e) => e.template_line_id === line.template_line_id);
          return (
            <li key={line.template_line_id} className="rounded-md border p-3">
              <div className="font-medium">{edit?.line_name ?? line.line_name}</div>
              <div className="text-muted-foreground">
                {formatLineType(line.line_type)} · {formatFrequency(edit?.billing_frequency ?? line.billing_frequency)}
              </div>
              <div className="text-muted-foreground">
                {line.services.map((service) => service.service_name).join(', ')}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
