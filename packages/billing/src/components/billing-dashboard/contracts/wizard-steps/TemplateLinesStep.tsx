'use client';

import React, { useEffect, useRef } from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  useBillingFrequencyOptions,
  useFormatBillingFrequency,
  useFormatContractLineType,
} from '@alga-psa/billing/hooks/useBillingEnumOptions';
import { resolveEffectiveBillingTiming } from '@shared/billingClients/contractLineTimingRule';
import { useTemplateMoney } from '../useTemplateMoney';
import { TemplateAmountInput } from '../TemplateAmountInput';
import {
  describeTemplateAmountField,
  editedAmount,
  effectiveAmount,
  listTemplateAmountFields,
  prefillCatalogEdits,
  withAmountEdit,
  type TemplateAmountFieldRef,
} from './templateLineAmounts';
import type {
  ClientTemplateLineEditInput,
  ClientTemplateLinesView,
} from '@alga-psa/billing/actions/contractWizardActions';

interface TemplateLinesStepProps {
  view: ClientTemplateLinesView | null;
  isLoading: boolean;
  loadError: string | null;
  edits: ClientTemplateLineEditInput[];
  onChange: (edits: ClientTemplateLineEditInput[]) => void;
}

/**
 * Per-line editor for a contract being created from a template. The server
 * clones every template line; this step only collects per-line edits (keyed by
 * template line id) that are applied on top of the faithful clone. Anything
 * left untouched is copied from the template as-is.
 */
/** A template line keeps its own timing (cloned as-is); the wizard only displays it. */
function useFormatTemplateLineTiming() {
  const { t } = useTranslation('msp/contracts');
  return (line: { line_type: string; billing_timing: string }) =>
    resolveEffectiveBillingTiming(line.line_type, line.billing_timing) === 'advance'
      ? t('wizardReview.billingTiming.advance', { defaultValue: 'In advance' })
      : t('wizardReview.billingTiming.arrears', { defaultValue: 'In arrears' });
}

export function TemplateLinesStep({ view, isLoading, loadError, edits, onChange }: TemplateLinesStepProps) {
  const { t } = useTranslation('msp/contracts');

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

  return <TemplateLinesBody view={view} edits={edits} onChange={onChange} />;
}

function TemplateLinesBody({
  view,
  edits,
  onChange,
}: {
  view: ClientTemplateLinesView;
  edits: ClientTemplateLineEditInput[];
  onChange: (edits: ClientTemplateLineEditInput[]) => void;
}) {
  const { t } = useTranslation('msp/contracts');
  const frequencyOptions = useBillingFrequencyOptions();
  const formatFrequency = useFormatBillingFrequency();
  const formatLineType = useFormatContractLineType();
  const formatTiming = useFormatTemplateLineTiming();
  const templateMoney = useTemplateMoney(view.template_currency);

  // Pre-fill required, unset member rates from the contract-currency catalog once
  // per (template, currency). They are real edits, so the server writes exactly
  // what the form shows; an operator who clears one is not re-prefilled.
  const prefilledFor = useRef<string | null>(null);
  const prefillKey = `${view.template_id}|${view.currency_code}`;
  useEffect(() => {
    if (prefilledFor.current === prefillKey) return;
    prefilledFor.current = prefillKey;
    const next = prefillCatalogEdits(view, edits);
    if (next !== edits) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillKey]);

  const editFor = (lineId: string): ClientTemplateLineEditInput =>
    edits.find((edit) => edit.template_line_id === lineId) ?? { template_line_id: lineId };

  const patchLine = (lineId: string, patch: Partial<ClientTemplateLineEditInput>) => {
    const existing = edits.some((edit) => edit.template_line_id === lineId);
    const next = existing
      ? edits.map((edit) => (edit.template_line_id === lineId ? { ...edit, ...patch } : edit))
      : [...edits, { template_line_id: lineId, ...patch }];
    onChange(next);
  };

  const patchServiceQuantity = (lineId: string, serviceId: string, quantity: number) => {
    const services = [...(editFor(lineId).services ?? [])];
    const index = services.findIndex((service) => service.service_id === serviceId);
    if (index >= 0) {
      services[index] = { ...services[index], quantity };
    } else {
      services.push({ service_id: serviceId, quantity });
    }
    patchLine(lineId, { services });
  };

  /** One amount input with its provenance note, reference amount and block message. */
  const renderAmount = (ref: TemplateAmountFieldRef, label: string, idSuffix: string) => {
    const edited = editedAmount(edits, ref);
    const effective = effectiveAmount(edits, ref);
    const field = ref.field;
    const resolvedPlaceholder = field.amount ?? (ref.kind === 'member_rate' ? field.catalog_amount : null);
    const missing = field.required && effective == null;
    const showReference =
      field.amount == null && field.template_amount != null && view.template_currency !== view.currency_code;
    const catalogPrefilled =
      edited != null && field.amount == null && field.catalog_amount != null && edited === field.catalog_amount;
    return (
      <div className="space-y-1" key={idSuffix}>
        <Label htmlFor={`tpl-amount-${idSuffix}`} className="text-xs">
          {label}
        </Label>
        <TemplateAmountInput
          id={`tpl-amount-${idSuffix}`}
          currency={view.currency_code}
          valueCents={edited ?? undefined}
          placeholder={
            resolvedPlaceholder != null && field.amount != null
              ? templateMoney(resolvedPlaceholder).replace(/^\D+/, '')
              : ''
          }
          onCommit={(cents) => onChange(withAmountEdit(edits, ref, cents))}
        />
        {showReference && (
          <p className="text-xs text-muted-foreground">
            {t('wizardTemplateLines.templateReference', {
              defaultValue: 'Template: {{amount}} {{currency}}',
              amount: templateMoney(field.template_amount as number),
              currency: view.template_currency,
            })}
          </p>
        )}
        {catalogPrefilled && (
          <p className="text-xs text-muted-foreground">
            {t('wizardTemplateLines.catalogPrice', { defaultValue: 'Catalog price' })}
          </p>
        )}
        {missing && (
          <p className="text-xs text-amber-700">
            {t('wizardTemplateLines.noCurrencyAmount', {
              defaultValue: 'No {{currency}} amount. Enter one or the contract cannot be created.',
              currency: view.currency_code,
            })}
          </p>
        )}
        {!missing && edited === undefined && field.amount != null && (
          <p className="text-xs text-muted-foreground">
            {view.amount_source === 'price_set'
              ? t('wizardTemplateLines.fromTemplatePriceSet', {
                  defaultValue: "From the template's {{currency}} rates",
                  currency: view.currency_code,
                })
              : t('wizardTemplateLines.fromTemplateCurrency', {
                  defaultValue: 'From the template ({{currency}})',
                  currency: view.template_currency,
                })}
          </p>
        )}
      </div>
    );
  };

  const fieldsByLine = new Map<string, TemplateAmountFieldRef[]>();
  for (const ref of listTemplateAmountFields(view)) {
    const list = fieldsByLine.get(ref.line.template_line_id) ?? [];
    list.push(ref);
    fieldsByLine.set(ref.line.template_line_id, list);
  }
  /** A field is shown when the template has a slot for it (it is required or has a template amount). */
  const hasSlot = (ref: TemplateAmountFieldRef) =>
    ref.field.required || ref.field.template_amount != null || ref.field.amount != null;

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

      {view.amount_source === 'none' && (
        <Alert variant="info" id="template-fallback-alert">
          <AlertDescription>
            {t('wizardTemplateLines.fallbackAlert', {
              defaultValue:
                'This template has no {{currency}} rates. Its structure is copied; enter {{currency}} amounts below. Template amounts are shown for reference only and are not converted.',
              currency: view.currency_code,
            })}
          </AlertDescription>
        </Alert>
      )}

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
        const lineFields = fieldsByLine.get(lineId) ?? [];
        const lineRate = effectiveAmount(edits, lineFields.find((ref) => ref.kind === 'line_base_rate')!);
        const lineLevel = lineFields.filter(
          (ref) => (ref.kind === 'line_base_rate' && line.line_type === 'Fixed') || ref.kind === 'line_overtime_rate',
        );
        const poolFields = lineFields.filter((ref) => ref.kind === 'bucket_overage_rate');
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
              <div className="space-y-2">
                <Label htmlFor={`tpl-line-timing-${lineId}`}>
                  {t('wizardBasics.billingTiming.label', { defaultValue: 'Billing Timing' })}
                </Label>
                <p id={`tpl-line-timing-${lineId}`} className="text-sm">
                  {formatTiming(line)}
                </p>
              </div>
            </div>

            {lineLevel.filter(hasSlot).map((ref) =>
              renderAmount(
                ref,
                ref.kind === 'line_base_rate'
                  ? t('wizardTemplateLines.fixedBaseRate', { defaultValue: 'Fixed base rate' })
                  : t('wizardTemplateLines.overtimeRate', { defaultValue: 'Overtime rate' }),
                `${lineId}-${ref.kind}`,
              ),
            )}
            {line.line_type === 'Fixed' && !line.base_rate.required && line.base_rate.template_amount == null && (
              <p className="text-xs text-muted-foreground">
                {t('wizardTemplateLines.fixedBaseRateNone', {
                  defaultValue: 'The template sets no line rate; services follow their catalog prices.',
                })}
              </p>
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
                const memberFields = lineFields.filter((ref) => ref.service?.service_id === service.service_id);
                const rateRef = memberFields.find((ref) => ref.kind === 'member_rate')!;
                const effectiveRate = effectiveAmount(edits, rateRef);
                // A member the template stores no rate for follows the catalog at
                // billing time; it is only unpriced when the catalog has nothing either.
                const unpriced =
                  !service.rate.required &&
                  effectiveRate == null &&
                  !(line.line_type === 'Fixed' && (lineRate != null || service.has_currency_price)) &&
                  !(line.line_type !== 'Fixed' && service.rate.catalog_amount != null);
                const rateLabel =
                  line.line_type === 'Hourly'
                    ? t('wizardTemplateLines.hourlyRate', { defaultValue: 'Hourly rate' })
                    : line.line_type === 'Usage'
                      ? t('wizardTemplateLines.unitRate', { defaultValue: 'Unit rate' })
                      : t('wizardTemplateLines.serviceRate', { defaultValue: 'Service rate' });
                const extraFields = memberFields.filter((ref) => ref.kind !== 'member_rate' && hasSlot(ref));
                return (
                  <div key={service.service_id} className="space-y-3">
                    <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-[1fr_120px_180px]">
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
                            patchServiceQuantity(
                              lineId,
                              service.service_id,
                              Math.max(0, Number(event.target.value) || 0),
                            )
                          }
                        />
                      </div>
                      <div>
                        {renderAmount(rateRef, rateLabel, `${lineId}-${service.service_id}-rate`)}
                        {unpriced && (
                          <p className="text-xs text-amber-700">
                            {t('wizardTemplateLines.noCurrencyPrice', {
                              defaultValue:
                                'No {{currency}} price for this service. Enter a rate or the contract cannot be created.',
                              currency: view.currency_code,
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                    {extraFields.length > 0 && (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px_180px]">
                        <div />
                        <div />
                        <div className="space-y-3">
                          {extraFields.map((ref) =>
                            renderAmount(
                              ref,
                              ref.kind === 'member_overtime_rate'
                                ? t('wizardTemplateLines.overtimeRate', { defaultValue: 'Overtime rate' })
                                : t('wizardTemplateLines.bucketOverageRate', { defaultValue: 'Overage rate' }),
                              `${lineId}-${service.service_id}-${ref.kind}`,
                            ),
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {poolFields.filter(hasSlot).length > 0 && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {poolFields.filter(hasSlot).map((ref) =>
                  renderAmount(
                    ref,
                    `${ref.poolName ?? ''} ${t('wizardTemplateLines.bucketOverageRate', { defaultValue: 'Overage rate' })}`.trim(),
                    `${lineId}-pool-${ref.poolId}`,
                  ),
                )}
              </div>
            )}
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
  const formatTiming = useFormatTemplateLineTiming();
  const money = useTemplateMoney(view.currency_code);
  const refsByLine = new Map<string, TemplateAmountFieldRef[]>();
  for (const ref of listTemplateAmountFields(view)) {
    const list = refsByLine.get(ref.line.template_line_id) ?? [];
    list.push(ref);
    refsByLine.set(ref.line.template_line_id, list);
  }
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
                {formatLineType(line.line_type)} · {formatFrequency(edit?.billing_frequency ?? line.billing_frequency)} · {formatTiming(line)}
              </div>
              <div className="text-muted-foreground">
                {line.services
                  .map((service) => {
                    const ref = (refsByLine.get(line.template_line_id) ?? []).find(
                      (r) => r.kind === 'member_rate' && r.service?.service_id === service.service_id,
                    );
                    const amount = ref ? effectiveAmount(edits, ref) : null;
                    return amount == null ? service.service_name : `${service.service_name} (${money(amount)})`;
                  })
                  .join(', ')}
              </div>
              {(refsByLine.get(line.template_line_id) ?? [])
                .filter((ref) => ref.kind !== 'member_rate')
                .map((ref) => ({ ref, amount: effectiveAmount(edits, ref) }))
                .filter(({ amount }) => amount != null)
                .map(({ ref, amount }) => (
                  <div
                    key={`${ref.kind}-${ref.service?.service_id ?? ref.poolId ?? ''}`}
                    className="text-muted-foreground"
                  >
                    {describeTemplateAmountField(t, ref)}: {money(amount as number)}
                  </div>
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
