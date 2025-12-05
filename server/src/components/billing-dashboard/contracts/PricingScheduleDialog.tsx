'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { IContractPricingSchedule } from 'server/src/interfaces/contract.interfaces';
import {
  createPricingSchedule,
  updatePricingSchedule
} from 'server/src/lib/actions/contractPricingScheduleActions';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import CustomSelect from 'server/src/components/ui/CustomSelect';

interface PricingScheduleDialogProps {
  contractId: string;
  schedule?: IContractPricingSchedule | null;
  onClose: () => void;
  onSave: () => void;
}

export function PricingScheduleDialog({
  contractId,
  schedule,
  onClose,
  onSave
}: PricingScheduleDialogProps) {
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
  const [customRate, setCustomRate] = useState<string>(
    schedule?.custom_rate !== undefined && schedule?.custom_rate !== null
      ? (schedule.custom_rate / 100).toFixed(2)
      : ''
  );
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
      setCustomRate(
        schedule.custom_rate !== undefined && schedule.custom_rate !== null
          ? (schedule.custom_rate / 100).toFixed(2)
          : ''
      );
      setUseDefaultRate(schedule.custom_rate === undefined || schedule.custom_rate === null);
      setNotes(schedule.notes || '');
    }
  }, [schedule]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!effectiveDate) {
      setError('Effective date is required');
      return;
    }

    if (useDuration && !durationValue) {
      setError('Duration value is required when using duration');
      return;
    }

    if (useDuration && parseInt(durationValue) <= 0) {
      setError('Duration must be a positive number');
      return;
    }

    if (!useDuration && hasEndDate && !endDate) {
      setError('End date is required when "Has end date" is enabled');
      return;
    }

    if (!useDuration && hasEndDate && endDate && endDate <= effectiveDate) {
      setError('End date must be after effective date');
      return;
    }

    if (!useDefaultRate && !customRate) {
      setError('Custom rate is required when not using default rate');
      return;
    }

    if (!useDefaultRate && parseFloat(customRate) < 0) {
      setError('Custom rate must be a positive number');
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
        custom_rate: useDefaultRate ? undefined : Math.round(parseFloat(customRate) * 100),
        notes: notes || undefined
      };

      if (schedule?.schedule_id) {
        await updatePricingSchedule(schedule.schedule_id, scheduleData);
      } else {
        await createPricingSchedule(scheduleData);
      }

      onSave();
    } catch (err) {
      console.error('Error saving pricing schedule:', err);
      setError(err instanceof Error ? err.message : 'Failed to save pricing schedule');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      isOpen={true}
      onClose={onClose}
      title={schedule ? 'Edit Pricing Schedule' : 'Add Pricing Schedule'}
      className="max-w-lg"
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div>
            <Label htmlFor="effective-date">Effective Date *</Label>
            <DatePicker
              value={effectiveDate}
              onChange={setEffectiveDate}
              className="mt-1 w-full"
            />
          </div>

          <div>
            <SwitchWithLabel
              label="Use duration"
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
                <Label htmlFor="duration-value">Duration *</Label>
                <Input
                  id="duration-value"
                  type="number"
                  min="1"
                  value={durationValue}
                  onChange={(e) => setDurationValue(e.target.value)}
                  placeholder="e.g., 6"
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div>
                <Label htmlFor="duration-unit">Unit *</Label>
                <CustomSelect
                  id="duration-unit"
                  value={durationUnit}
                  onValueChange={(value) => setDurationUnit(value as 'days' | 'weeks' | 'months' | 'years')}
                  options={[
                    { value: 'days', label: 'Days' },
                    { value: 'weeks', label: 'Weeks' },
                    { value: 'months', label: 'Months' },
                    { value: 'years', label: 'Years' }
                  ]}
                />
              </div>
            </div>
          )}

          {!useDuration && (
            <>
              <div>
                <SwitchWithLabel
                  label="Has end date"
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
                  <Label htmlFor="end-date">End Date</Label>
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
              label="Use default rate"
              checked={useDefaultRate}
              onCheckedChange={(checked) => {
                setUseDefaultRate(checked);
                if (checked) {
                  setCustomRate('');
                }
              }}
            />
          </div>

          {!useDefaultRate && (
            <div>
              <Label htmlFor="custom-rate">Custom Rate *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                <Input
                  id="custom-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={customRate}
                  onChange={(e) => setCustomRate(e.target.value)}
                  className="pl-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder="0.00"
                />
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="notes">Notes</Label>
            <TextArea
              id="notes"
              value={notes}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
              placeholder="Add notes about this pricing change (e.g., 'Annual rate increase')"
              className="min-h-[80px]"
            />
          </div>

          <DialogFooter>
            <Button
              id="cancel-pricing-schedule-btn"
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              id="save-pricing-schedule-btn"
              type="submit"
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : schedule ? 'Update Schedule' : 'Add Schedule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
