'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { IContractPricingSchedule } from '@alga-psa/types';
import {
  createPricingSchedule,
  updatePricingSchedule,
  type PricingScheduleLineScope
} from '@alga-psa/billing/actions/contractPricingScheduleActions';
import { toCalendarDateString, toCalendarDisplayDate } from '@alga-psa/core';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

/** New schedules name one line; legacy rows retain their stored scope. */
function initialScope(
  schedule: IContractPricingSchedule | null | undefined,
  eligibleLines: PricingScheduleLineScope[],
): string {
  if (schedule?.schedule_id) return schedule.contract_line_id ?? '';
  return eligibleLines.length === 1 ? eligibleLines[0].contract_line_id : '';
}

interface PricingScheduleDialogProps {
  contractId: string;
  schedule?: IContractPricingSchedule | null;
  /** Currency the owning contract is denominated in; custom_rate is stored in its minor units. */
  currencyCode?: string;
  /**
   * Fixed-fee lines a schedule rate actually reprices — the lines offered in the
   * picker and the ones a whole-contract schedule applies to. Unit-priced lines
   * are not in here: the engine prices their members from their own unit rates,
   * so a schedule would change nothing on them.
   */
  eligibleLines: PricingScheduleLineScope[];
  /** Stored binding's name, including lines no longer eligible for new schedules. */
  currentLineName?: string;
  /** Fixed lines left out because every member bills per unit. */
  unitPricedLineCount?: number;
  onClose: () => void;
  onSave: () => void;
}

export function PricingScheduleDialog({
  contractId,
  schedule,
  currencyCode,
  eligibleLines,
  currentLineName,
  unitPricedLineCount = 0,
  onClose,
  onSave
}: PricingScheduleDialogProps) {
  const { t } = useTranslation('msp/contracts');
  const { symbol, fractionDigits, money } = useCurrencyFormat();
  const rateFractionDigits = fractionDigits(currencyCode);
  const rateMinorUnitFactor = 10 ** rateFractionDigits;
  const [effectiveDate, setEffectiveDate] = useState<Date | undefined>(
    toCalendarDisplayDate(schedule?.effective_date) ?? undefined
  );
  const [endDate, setEndDate] = useState<Date | undefined>(
    toCalendarDisplayDate(schedule?.end_date) ?? undefined
  );
  const [hasEndDate, setHasEndDate] = useState(!!schedule?.end_date);
  const [useDuration, setUseDuration] = useState(!!schedule?.duration_value);
  const [durationValue, setDurationValue] = useState<string>(
    schedule?.duration_value?.toString() || ''
  );
  const [durationUnit, setDurationUnit] = useState<'days' | 'weeks' | 'months' | 'years'>(
    schedule?.duration_unit || 'months'
  );
  const [customRate, setCustomRate] = useState<string>(() =>
    schedule?.custom_rate !== undefined && schedule?.custom_rate !== null
      ? (schedule.custom_rate / rateMinorUnitFactor).toFixed(rateFractionDigits)
      : ''
  );
  // Once the user has touched the rate, no schedule re-sync may overwrite
  // what they typed.
  const userEditedRateRef = useRef(false);
  const [useDefaultRate, setUseDefaultRate] = useState(
    schedule?.custom_rate === undefined || schedule?.custom_rate === null
  );
  const [notes, setNotes] = useState(schedule?.notes || '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // A stored row opens on the scope it already has — a whole-contract row
  // reprices every fixed-fee line and is kept exactly as stored unless the user
  // re-scopes it.
  const [scope, setScope] = useState<string>(() => initialScope(schedule, eligibleLines));
  const isWholeContract = Boolean(schedule?.schedule_id && !schedule.contract_line_id && !scope);
  const selectedLine = eligibleLines.find((line) => line.contract_line_id === scope) ?? null;

  useEffect(() => {
    if (schedule) {
      setEffectiveDate(toCalendarDisplayDate(schedule.effective_date) ?? undefined);
      setEndDate(toCalendarDisplayDate(schedule.end_date) ?? undefined);
      setHasEndDate(!!schedule.end_date);
      setUseDefaultRate(schedule.custom_rate === undefined || schedule.custom_rate === null);
      setNotes(schedule.notes || '');
      setScope(initialScope(schedule, eligibleLines));
      userEditedRateRef.current = false;
    }
  }, [schedule]);

  // Re-derive the rate input when the schedule changes; skip once the user
  // has typed, so a re-sync can't clobber their input.
  useEffect(() => {
    if (userEditedRateRef.current) {
      return;
    }
    setCustomRate(
      schedule?.custom_rate !== undefined && schedule?.custom_rate !== null
        ? (schedule.custom_rate / rateMinorUnitFactor).toFixed(rateFractionDigits)
        : ''
    );
  }, [schedule, rateMinorUnitFactor, rateFractionDigits]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!effectiveDate) {
      setError(t('pricingSchedules.dialog.validation.effectiveDateRequired', { defaultValue: 'Effective date is required' }));
      return;
    }

    // Only a stored contract-wide row may retain its legacy NULL scope.
    if (!scope && !isWholeContract) {
      setError(t('pricingSchedules.dialog.validation.scopeRequired', {
        defaultValue: 'Choose a fixed-fee line for this schedule',
      }));
      return;
    }

    if (useDuration && !durationValue) {
      setError(t('pricingSchedules.dialog.validation.durationRequired', {
        defaultValue: 'Duration value is required when using duration',
      }));
      return;
    }

    if (useDuration && parseInt(durationValue) <= 0) {
      setError(t('pricingSchedules.dialog.validation.durationPositive', {
        defaultValue: 'Duration must be a positive number',
      }));
      return;
    }

    if (!useDuration && hasEndDate && !endDate) {
      setError(t('pricingSchedules.dialog.validation.endDateRequiredWhenEnabled', {
        defaultValue: 'End date is required when "Has end date" is enabled',
      }));
      return;
    }

    if (!useDuration && hasEndDate && endDate && endDate <= effectiveDate) {
      setError(t('pricingSchedules.dialog.validation.endDateAfterEffectiveDate', {
        defaultValue: 'End date must be after effective date',
      }));
      return;
    }

    if (!useDefaultRate && !customRate) {
      setError(t('pricingSchedules.dialog.validation.customRateRequired', {
        defaultValue: 'Custom rate is required when not using default rate',
      }));
      return;
    }

    if (!useDefaultRate && parseFloat(customRate) < 0) {
      setError(t('pricingSchedules.dialog.validation.customRatePositive', {
        defaultValue: 'Custom rate must be a positive number',
      }));
      return;
    }

    setIsSaving(true);

    try {
      const scheduleData = {
        contract_id: contractId,
        // NULL is the whole-contract scope the engine already honours; a line id
        // reprices that line only and wins over a whole-contract schedule.
        contract_line_id: isWholeContract ? null : scope,
        // Calendar dates, never instants: effective_date/end_date are DATE
        // columns, and an instant built from a local-midnight pick lands on the
        // previous day east of UTC.
        effective_date: toCalendarDateString(effectiveDate) as string,
        end_date: !useDuration && hasEndDate && endDate ? toCalendarDateString(endDate) : null,
        duration_value: useDuration ? parseInt(durationValue) : undefined,
        duration_unit: useDuration ? durationUnit : undefined,
        // Explicit null — undefined is dropped by Knex on update, silently keeping the old rate.
        custom_rate: useDefaultRate ? null : Math.round(parseFloat(customRate) * rateMinorUnitFactor),
        notes: notes || undefined
      };

      const result = schedule?.schedule_id
        ? await updatePricingSchedule(schedule.schedule_id, scheduleData)
        : await createPricingSchedule(scheduleData);

      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }

      onSave();
    } catch (err) {
      console.error('Error saving pricing schedule:', err);
      setError(
        err instanceof Error
          ? err.message
          : t('pricingSchedules.dialog.errors.failedToSavePricingSchedule', {
            defaultValue: 'Failed to save pricing schedule',
          })
      );
    } finally {
      setIsSaving(false);
    }
  };

  const scopeOptions = [
    // Keep the saved binding visible without making it available for authoring.
    ...(schedule?.schedule_id && schedule.contract_line_id
      && !eligibleLines.some((line) => line.contract_line_id === schedule.contract_line_id)
      ? [{
        value: schedule.contract_line_id,
        label: currentLineName
          || t('pricingSchedules.dialog.values.unnamedLine', { defaultValue: 'Unnamed line' }),
        disabled: true,
      }]
      : []),
    ...eligibleLines.map((line) => ({
      value: line.contract_line_id,
      label: line.contract_line_name
        || t('pricingSchedules.dialog.values.unnamedLine', { defaultValue: 'Unnamed line' }),
    })),
  ];
  // With no fixed-fee line there is nothing for a new schedule's scope to apply
  // to. A row that already exists stays editable either way, so its dates can
  // still be corrected after the contract's lines changed under it.
  const canSave = eligibleLines.length > 0 || Boolean(schedule?.schedule_id);
  // What the rate currently in the form bills on each line, so the
  // whole-contract notice can state the effect in numbers while it is picked.
  const enteredRate = !useDefaultRate && customRate.trim() !== ''
    ? Number.parseFloat(customRate)
    : Number.NaN;
  const wholeContractRate = Number.isFinite(enteredRate)
    ? money(Math.round(enteredRate * rateMinorUnitFactor), currencyCode)
    : null;

  return (
    <Dialog
      isOpen={true}
      onClose={onClose}
      title={schedule
        ? t('pricingSchedules.dialog.title.editPricingSchedule', { defaultValue: 'Edit Pricing Schedule' })
        : t('pricingSchedules.dialog.title.addPricingSchedule', { defaultValue: 'Add Pricing Schedule' })}
      className="max-w-lg"
      footer={(
        <div className="flex justify-end space-x-2">
          <Button
            id="cancel-pricing-schedule-btn"
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSaving}
          >
            {t('pricingSchedules.dialog.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            id="save-pricing-schedule-btn"
            type="button"
            onClick={() => (document.getElementById('pricing-schedule-form') as HTMLFormElement | null)?.requestSubmit()}
            disabled={isSaving || !canSave}
          >
            {isSaving
              ? t('pricingSchedules.dialog.actions.saving', { defaultValue: 'Saving...' })
              : schedule
                ? t('pricingSchedules.dialog.actions.updateSchedule', { defaultValue: 'Update Schedule' })
                : t('pricingSchedules.dialog.actions.addSchedule', { defaultValue: 'Add Schedule' })}
          </Button>
        </div>
      )}
    >
      <DialogContent>
        <form id="pricing-schedule-form" onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {eligibleLines.length === 0 && (
            <Alert variant="warning">
              <AlertDescription>
                {unitPricedLineCount > 0
                  ? t('pricingSchedules.dialog.notices.unitPricedExcluded', {
                    defaultValue: 'Lines that bill per unit are not listed: a pricing schedule never changes a per-unit price. Change the unit price on the line instead.',
                  })
                  : t('pricingSchedules.dialog.empty.noEligibleLines', {
                    defaultValue: 'This contract has no fixed-fee line, so a pricing schedule has nothing to reprice.',
                  })}
              </AlertDescription>
            </Alert>
          )}

          {canSave && (
            <div>
              <Label htmlFor="pricing-schedule-contract-line">
                {t('pricingSchedules.dialog.fields.appliesTo', { defaultValue: 'Applies to' })} *
              </Label>
              <CustomSelect
                id="pricing-schedule-contract-line"
                value={scope}
                onValueChange={setScope}
                options={scopeOptions}
                placeholder={isWholeContract
                  ? t('pricingSchedules.dialog.values.wholeContract', { defaultValue: 'Whole contract' })
                  : t('pricingSchedules.dialog.fields.appliesToPlaceholder', {
                    defaultValue: 'Select a fixed-fee line',
                  })}
                className="mt-1 w-full"
              />
              {isWholeContract && (
                <Alert variant="warning" className="mt-1">
                  <AlertDescription>{wholeContractRate && eligibleLines.length > 1
                    ? t('pricingSchedules.dialog.notices.wholeContractEffect', {
                      count: eligibleLines.length,
                      amount: wholeContractRate,
                      defaultValue: 'Whole contract: each of the {{count}} fixed-fee lines bills {{amount}} per billing period.',
                    })
                    : t('pricingSchedules.dialog.notices.wholeContract', {
                      defaultValue: 'Whole contract: this schedule applies to every fixed-fee line on this contract.',
                    })}</AlertDescription>
                </Alert>
              )}
              {unitPricedLineCount > 0 && (
                <p className="mt-1 text-xs text-[rgb(var(--color-text-600))]">
                  {t('pricingSchedules.dialog.notices.unitPricedExcluded', {
                    defaultValue: 'Lines that bill per unit are not listed: a pricing schedule never changes a per-unit price. Change the unit price on the line instead.',
                  })}
                </p>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="effective-date">
              {t('pricingSchedules.dialog.fields.effectiveDate', { defaultValue: 'Effective Date' })} *
            </Label>
            <DatePicker
              id="effective-date"
              value={effectiveDate}
              onChange={setEffectiveDate}
              className="mt-1 w-full"
            />
          </div>

          <div>
            <SwitchWithLabel
              label={t('pricingSchedules.dialog.fields.useDuration', { defaultValue: 'Use duration' })}
              checked={useDuration}
              onCheckedChange={(checked) => {
                setUseDuration(checked);
                if (checked) {
                  setHasEndDate(false);
                  setEndDate(undefined);
                }
              }}
            />
          </div>

          {useDuration && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="duration-value">
                  {t('pricingSchedules.dialog.fields.duration', { defaultValue: 'Duration' })} *
                </Label>
                <Input
                  id="duration-value"
                  type="number"
                  min="1"
                  value={durationValue}
                  onChange={(e) => setDurationValue(e.target.value)}
                  placeholder={t('pricingSchedules.dialog.fields.durationPlaceholder', { defaultValue: 'e.g., 6' })}
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div>
                <Label htmlFor="duration-unit">
                  {t('pricingSchedules.dialog.fields.unit', { defaultValue: 'Unit' })} *
                </Label>
                <CustomSelect
                  id="duration-unit"
                  value={durationUnit}
                  onValueChange={(value) => setDurationUnit(value as 'days' | 'weeks' | 'months' | 'years')}
                  options={[
                    {
                      value: 'days',
                      label: t('pricingSchedules.dialog.durationUnits.days', { defaultValue: 'Days' }),
                    },
                    {
                      value: 'weeks',
                      label: t('pricingSchedules.dialog.durationUnits.weeks', { defaultValue: 'Weeks' }),
                    },
                    {
                      value: 'months',
                      label: t('pricingSchedules.dialog.durationUnits.months', { defaultValue: 'Months' }),
                    },
                    {
                      value: 'years',
                      label: t('pricingSchedules.dialog.durationUnits.years', { defaultValue: 'Years' }),
                    }
                  ]}
                />
              </div>
            </div>
          )}

          {!useDuration && (
            <>
              <div>
                <SwitchWithLabel
                  label={t('pricingSchedules.dialog.fields.hasEndDate', { defaultValue: 'Has end date' })}
                  checked={hasEndDate}
                  onCheckedChange={(checked) => {
                    setHasEndDate(checked);
                    if (!checked) {
                      setEndDate(undefined);
                    }
                  }}
                />
              </div>

              {hasEndDate && (
                <div>
                  <Label htmlFor="end-date">{t('pricingSchedules.dialog.fields.endDate', { defaultValue: 'End Date' })}</Label>
                  <DatePicker
                    id="end-date"
                    value={endDate}
                    onChange={setEndDate}
                    className="mt-1 w-full"
                  />
                </div>
              )}
            </>
          )}

          <div>
            <SwitchWithLabel
              label={t('pricingSchedules.dialog.fields.useDefaultRate', { defaultValue: 'Use default rate' })}
              checked={useDefaultRate}
              onCheckedChange={(checked) => {
                setUseDefaultRate(checked);
                if (checked) {
                  userEditedRateRef.current = true;
                  setCustomRate('');
                }
              }}
            />
          </div>

          {!useDefaultRate && (
            <div>
              <Label htmlFor="custom-rate">
                {t('pricingSchedules.dialog.fields.lineFee', {
                  defaultValue: 'Fee per billing period',
                })} *
              </Label>
              <p className="text-xs text-[rgb(var(--color-text-600))]">
                {isWholeContract
                  ? t('pricingSchedules.dialog.fields.lineFeeHelpWholeContract', {
                    defaultValue: 'Every fixed-fee line on this contract bills this amount in every billing period the schedule covers.',
                  })
                  : selectedLine?.has_unit_priced_members
                    ? t('pricingSchedules.dialog.fields.lineFeeHelpMixed', {
                      defaultValue: 'Replaces the bundle fee of this line in every billing period the schedule covers. Members priced per unit keep their own unit price.',
                    })
                    : t('pricingSchedules.dialog.fields.lineFeeHelp', {
                      defaultValue: 'What this line bills in every billing period the schedule covers, replacing its usual fee.',
                    })}
              </p>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                  {symbol(currencyCode)}
                </span>
                <Input
                  id="custom-rate"
                  type="number"
                  min="0"
                  step={String(1 / rateMinorUnitFactor)}
                  value={customRate}
                  onChange={(e) => {
                    userEditedRateRef.current = true;
                    setCustomRate(e.target.value);
                  }}
                  className="pl-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder={(0).toFixed(rateFractionDigits)}
                />
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="notes">{t('pricingSchedules.dialog.fields.notes', { defaultValue: 'Notes' })}</Label>
            <TextArea
              id="notes"
              value={notes}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
              placeholder={t('pricingSchedules.dialog.fields.notesPlaceholder', {
                defaultValue: "Add notes about this pricing change (e.g., 'Annual rate increase')",
              })}
              className="min-h-[80px]"
            />
          </div>

        </form>
      </DialogContent>
    </Dialog>
  );
}
