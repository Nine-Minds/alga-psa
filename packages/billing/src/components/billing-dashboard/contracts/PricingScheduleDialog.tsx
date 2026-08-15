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
  updatePricingSchedule
} from '@alga-psa/billing/actions/contractPricingScheduleActions';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

interface PricingScheduleDialogProps {
  contractId: string;
  schedule?: IContractPricingSchedule | null;
  /** Currency the owning contract is denominated in; custom_rate is stored in its minor units. */
  currencyCode?: string;
  onClose: () => void;
  onSave: () => void;
}

export function PricingScheduleDialog({
  contractId,
  schedule,
  currencyCode,
  onClose,
  onSave
}: PricingScheduleDialogProps) {
  const { t } = useTranslation('msp/contracts');
  const { symbol, fractionDigits } = useCurrencyFormat();
  const { enabled: contractCurrencyEnabled, loading: flagLoading } = useFeatureFlag('release-v1.5-feature', {
    defaultValue: false,
  });
  // Flag off preserves the legacy ambient-currency behavior: two decimals, /100, ambient symbol.
  const rateFractionDigits = contractCurrencyEnabled ? fractionDigits(currencyCode) : 2;
  const rateMinorUnitFactor = 10 ** rateFractionDigits;
  const [effectiveDate, setEffectiveDate] = useState<Date | undefined>(
    schedule?.effective_date ? new Date(schedule.effective_date) : undefined
  );
  const [endDate, setEndDate] = useState<Date | undefined>(
    schedule?.end_date ? new Date(schedule.end_date) : undefined
  );
  const [hasEndDate, setHasEndDate] = useState(!!schedule?.end_date);
  const [useDuration, setUseDuration] = useState(!!schedule?.duration_value);
  const [durationValue, setDurationValue] = useState<string>(
    schedule?.duration_value?.toString() || ''
  );
  const [durationUnit, setDurationUnit] = useState<'days' | 'weeks' | 'months' | 'years'>(
    schedule?.duration_unit || 'months'
  );
  // The rate input only ever renders minor units converted with a *resolved*
  // flag's factor: initialize empty while the flag is still loading and let the
  // effect below fill it in on resolution.
  const [customRate, setCustomRate] = useState<string>(() =>
    !flagLoading && schedule?.custom_rate !== undefined && schedule?.custom_rate !== null
      ? (schedule.custom_rate / rateMinorUnitFactor).toFixed(rateFractionDigits)
      : ''
  );
  // Once the user has touched the rate, no flag resolution or schedule re-sync
  // may overwrite what they typed.
  const userEditedRateRef = useRef(false);
  const [useDefaultRate, setUseDefaultRate] = useState(
    schedule?.custom_rate === undefined || schedule?.custom_rate === null
  );
  const [notes, setNotes] = useState(schedule?.notes || '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (schedule) {
      setEffectiveDate(schedule.effective_date ? new Date(schedule.effective_date) : undefined);
      setEndDate(schedule.end_date ? new Date(schedule.end_date) : undefined);
      setHasEndDate(!!schedule.end_date);
      setUseDefaultRate(schedule.custom_rate === undefined || schedule.custom_rate === null);
      setNotes(schedule.notes || '');
      userEditedRateRef.current = false;
    }
  }, [schedule]);

  // Derive the rate input from the stored minor units only once the feature
  // flag has resolved, so the minor-unit factor is never taken from an
  // unresolved flag; skip entirely once the user has typed, so a late
  // resolution can't clobber their input.
  useEffect(() => {
    if (flagLoading || userEditedRateRef.current) {
      return;
    }
    setCustomRate(
      schedule?.custom_rate !== undefined && schedule?.custom_rate !== null
        ? (schedule.custom_rate / rateMinorUnitFactor).toFixed(rateFractionDigits)
        : ''
    );
  }, [schedule, flagLoading, rateMinorUnitFactor, rateFractionDigits]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!effectiveDate) {
      setError(t('pricingSchedules.dialog.validation.effectiveDateRequired', { defaultValue: 'Effective date is required' }));
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

    // Never convert with an unresolved flag: the minor-unit factor isn't known yet.
    if (!useDefaultRate && flagLoading) {
      setError(t('pricingSchedules.dialog.validation.currencySettingsLoading', {
        defaultValue: 'Currency settings are still loading; try again in a moment',
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
        effective_date: effectiveDate.toISOString(),
        end_date: !useDuration && hasEndDate && endDate ? endDate.toISOString() : null,
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
            disabled={isSaving}
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

          <div>
            <Label htmlFor="effective-date">
              {t('pricingSchedules.dialog.fields.effectiveDate', { defaultValue: 'Effective Date' })} *
            </Label>
            <DatePicker
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
                {t('pricingSchedules.dialog.fields.customRate', { defaultValue: 'Custom Rate' })} *
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                  {contractCurrencyEnabled ? symbol(currencyCode) : symbol()}
                </span>
                <Input
                  id="custom-rate"
                  type="number"
                  min="0"
                  step={contractCurrencyEnabled ? String(1 / rateMinorUnitFactor) : '0.01'}
                  value={customRate}
                  onChange={(e) => {
                    userEditedRateRef.current = true;
                    setCustomRate(e.target.value);
                  }}
                  className="pl-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder={contractCurrencyEnabled
                    ? (0).toFixed(rateFractionDigits)
                    : t('pricingSchedules.dialog.fields.customRatePlaceholder', { defaultValue: '0.00' })}
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
