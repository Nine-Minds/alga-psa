import React, { useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { createMaintenanceSchedule, updateMaintenanceSchedule } from '../../actions/assetActions';
import { unwrapAssetActionResult } from '../../actions/assetActionErrors';
import { toCalendarDateString, toCalendarDisplayDate } from '@alga-psa/core';
import { customRecurrenceSchema, MAINTENANCE_RECURRENCE_UNITS, type CustomRecurrence, type MaintenanceRecurrenceUnit } from '../../lib/maintenanceRecurrence';
import { describeMaintenanceCadence, WEEKDAY_KEYS } from '../../lib/maintenanceCadence';
import type {
  MaintenanceType,
  MaintenanceFrequency,
  AssetMaintenanceSchedule,
  CreateMaintenanceScheduleRequest,
  UpdateMaintenanceScheduleRequest
} from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, index) => index + 1);
const WEEKDAY_ENGLISH = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface CreateMaintenanceScheduleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  assetId: string;
  schedule?: AssetMaintenanceSchedule;
  onSuccess: () => void;
}

export const CreateMaintenanceScheduleDialog: React.FC<CreateMaintenanceScheduleDialogProps> = ({
  isOpen,
  onClose,
  assetId,
  schedule,
  onSuccess
}) => {
  const { t } = useTranslation('msp/assets');
  const isEditing = !!schedule;
  const [scheduleName, setScheduleName] = useState('');
  const [description, setDescription] = useState('');
  const [maintenanceType, setMaintenanceType] = useState<MaintenanceType | ''>('');
  const [frequency, setFrequency] = useState<MaintenanceFrequency | ''>('');
  const [frequencyInterval, setFrequencyInterval] = useState<string>('1');
  // Custom recurrence rule (frequency === 'custom'); the interval above is its multiplier.
  const [recurrenceUnit, setRecurrenceUnit] = useState<MaintenanceRecurrenceUnit>('days');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [daysOfMonth, setDaysOfMonth] = useState<number[]>([]);
  const [nextMaintenance, setNextMaintenance] = useState<Date | undefined>(undefined);
  const [isActive, setIsActive] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setScheduleName('');
    setDescription('');
    setMaintenanceType('');
    setFrequency('');
    setFrequencyInterval('1');
    setRecurrenceUnit('days');
    setWeekdays([]);
    setDaysOfMonth([]);
    setNextMaintenance(undefined);
    setIsActive(true);
    setError(null);
  };

  // Populate form when editing
  React.useEffect(() => {
    if (schedule) {
      setScheduleName(schedule.schedule_name);
      setDescription(schedule.description || '');
      setMaintenanceType(schedule.maintenance_type);
      setFrequency(schedule.frequency);
      setFrequencyInterval(schedule.frequency_interval.toString());
      const rule = customRecurrenceSchema.safeParse(schedule.schedule_config?.recurrence);
      setRecurrenceUnit(rule.success ? rule.data.unit : 'days');
      setWeekdays(rule.success ? rule.data.weekdays ?? [] : []);
      setDaysOfMonth(rule.success ? rule.data.days_of_month ?? [] : []);
      setNextMaintenance(toCalendarDisplayDate(schedule.next_maintenance) ?? undefined);
      setIsActive(schedule.is_active);
    } else {
      resetForm();
    }
  }, [schedule, isOpen]);

  const customRecurrence = (): CustomRecurrence => ({
    unit: recurrenceUnit,
    ...(recurrenceUnit === 'weeks' && weekdays.length ? { weekdays: [...weekdays].sort((a, b) => a - b) } : {}),
    ...(recurrenceUnit === 'months' && daysOfMonth.length ? { days_of_month: [...daysOfMonth].sort((a, b) => a - b) } : {}),
  });

  // Keep other config keys (e.g. checklist) when editing; only `recurrence` is owned here.
  const buildScheduleConfig = (): Record<string, unknown> => {
    const { recurrence: _previous, ...preserved } = schedule?.schedule_config ?? {};
    return frequency === 'custom' ? { ...preserved, recurrence: customRecurrence() } : preserved;
  };

  const toggle = (values: number[], value: number) =>
    values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];

  const maintenanceTypeOptions = [
    { value: 'preventive', label: t('maintenanceSchedulesTab.types.preventive', { defaultValue: 'Preventive' }) },
    { value: 'corrective', label: t('maintenanceSchedulesTab.types.corrective', { defaultValue: 'Corrective' }) },
    { value: 'inspection', label: t('maintenanceSchedulesTab.types.inspection', { defaultValue: 'Inspection' }) },
    { value: 'calibration', label: t('maintenanceSchedulesTab.types.calibration', { defaultValue: 'Calibration' }) },
    { value: 'replacement', label: t('maintenanceSchedulesTab.types.replacement', { defaultValue: 'Replacement' }) }
  ];

  const frequencyOptions = [
    { value: 'daily', label: t('createMaintenanceScheduleDialog.frequencyOptions.daily', { defaultValue: 'Daily' }) },
    { value: 'weekly', label: t('createMaintenanceScheduleDialog.frequencyOptions.weekly', { defaultValue: 'Weekly' }) },
    { value: 'monthly', label: t('createMaintenanceScheduleDialog.frequencyOptions.monthly', { defaultValue: 'Monthly' }) },
    { value: 'quarterly', label: t('createMaintenanceScheduleDialog.frequencyOptions.quarterly', { defaultValue: 'Quarterly' }) },
    { value: 'yearly', label: t('createMaintenanceScheduleDialog.frequencyOptions.yearly', { defaultValue: 'Yearly' }) },
    { value: 'custom', label: t('createMaintenanceScheduleDialog.frequencyOptions.custom', { defaultValue: 'Custom' }) }
  ];

  const recurrenceUnitOptions = MAINTENANCE_RECURRENCE_UNITS.map((unit) => ({
    value: unit,
    label: t(`createMaintenanceScheduleDialog.recurrenceUnits.${unit}`, {
      defaultValue: unit.charAt(0).toUpperCase() + unit.slice(1)
    })
  }));

  const dayOfMonthOptions = [
    { value: '', label: t('createMaintenanceScheduleDialog.dayOfMonthOptions.any', { defaultValue: 'Any day' }) },
    // A rule written through the API may name several days; keep it selectable so
    // editing an unrelated field does not quietly drop the extra ones.
    ...(daysOfMonth.length > 1 ? [{ value: daysOfMonth.join(','), label: [...daysOfMonth].sort((a, b) => a - b).join(', ') }] : []),
    ...DAYS_OF_MONTH.map((day) => ({ value: String(day), label: String(day) }))
  ];

  const cadencePreview = frequency
    ? describeMaintenanceCadence(
        t,
        frequency,
        parseInt(frequencyInterval, 10) || 0,
        frequency === 'custom' ? { recurrence: customRecurrence() } : undefined
      )
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!scheduleName.trim()) {
      setError(t('createMaintenanceScheduleDialog.errors.scheduleNameRequired', {
        defaultValue: 'Schedule name is required'
      }));
      return;
    }

    if (!maintenanceType) {
      setError(t('createMaintenanceScheduleDialog.errors.maintenanceTypeRequired', {
        defaultValue: 'Maintenance type is required'
      }));
      return;
    }

    if (!frequency) {
      setError(t('createMaintenanceScheduleDialog.errors.frequencyRequired', {
        defaultValue: 'Frequency is required'
      }));
      return;
    }

    if (!nextMaintenance) {
      setError(t('createMaintenanceScheduleDialog.errors.nextMaintenanceRequired', {
        defaultValue: 'Next maintenance date is required'
      }));
      return;
    }

    const interval = parseInt(frequencyInterval, 10);
    if (isNaN(interval) || interval < 1) {
      setError(t('createMaintenanceScheduleDialog.errors.frequencyIntervalMin', {
        defaultValue: 'Frequency interval must be at least 1'
      }));
      return;
    }

    setIsSubmitting(true);

    try {
      const scheduleData: CreateMaintenanceScheduleRequest = {
        asset_id: assetId,
        schedule_name: scheduleName.trim(),
        maintenance_type: maintenanceType as MaintenanceType,
        frequency: frequency as MaintenanceFrequency,
        frequency_interval: interval,
        schedule_config: buildScheduleConfig(),
        next_maintenance: toCalendarDateString(nextMaintenance)!
      };

      // Only include description if it's not empty
      if (description.trim()) {
        scheduleData.description = description.trim();
      }

      if (isEditing && schedule) {
        const updateData: UpdateMaintenanceScheduleRequest = {
          ...scheduleData,
          is_active: isActive
        };
        unwrapAssetActionResult(await updateMaintenanceSchedule(schedule.schedule_id, updateData));
      } else {
        unwrapAssetActionResult(await createMaintenanceSchedule(scheduleData));
      }

      resetForm();
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error
        ? err.message
        : t('createMaintenanceScheduleDialog.errors.saveFailed', {
          defaultValue: 'Failed to create maintenance schedule'
        }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      resetForm();
      onClose();
    }
  };

  const footer = (
    <div className="flex justify-end space-x-2">
      <Button
        id="cancel-maintenance-schedule-btn"
        type="button"
        variant="secondary"
        onClick={handleClose}
        disabled={isSubmitting}
      >
        {t('common.actions.cancel', { defaultValue: 'Cancel' })}
      </Button>
      <Button
        id="submit-maintenance-schedule-btn"
        type="button"
        onClick={() => (document.getElementById('maintenance-schedule-form') as HTMLFormElement | null)?.requestSubmit()}
        disabled={isSubmitting}
      >
        {isSubmitting
          ? (isEditing
              ? t('createMaintenanceScheduleDialog.actions.updating', { defaultValue: 'Updating...' })
              : t('createMaintenanceScheduleDialog.actions.creating', { defaultValue: 'Creating...' }))
          : (isEditing
              ? t('createMaintenanceScheduleDialog.actions.update', { defaultValue: 'Update Schedule' })
              : t('createMaintenanceScheduleDialog.actions.create', { defaultValue: 'Create Schedule' }))}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditing
        ? t('createMaintenanceScheduleDialog.titles.edit', { defaultValue: 'Edit Maintenance Schedule' })
        : t('createMaintenanceScheduleDialog.titles.create', { defaultValue: 'Schedule Maintenance' })}
      id={isEditing ? 'edit-maintenance-schedule-dialog' : 'create-maintenance-schedule-dialog'}
      footer={footer}
    >
      <DialogContent>
        <form id="maintenance-schedule-form" onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div>
            <Label htmlFor="schedule-name">
              {t('createMaintenanceScheduleDialog.fields.scheduleName', { defaultValue: 'Schedule Name *' })}
            </Label>
            <Input
              id="schedule-name"
              value={scheduleName}
              onChange={(e) => setScheduleName(e.target.value)}
              placeholder={t('createMaintenanceScheduleDialog.placeholders.scheduleName', {
                defaultValue: 'e.g., Monthly Server Maintenance'
              })}
              className="mt-1"
              required
            />
          </div>

          <div>
            <Label htmlFor="description">
              {t('createMaintenanceScheduleDialog.fields.description', { defaultValue: 'Description' })}
            </Label>
            <TextArea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('createMaintenanceScheduleDialog.placeholders.description', {
                defaultValue: 'Optional description...'
              })}
              className="mt-1"
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="maintenance-type">
              {t('createMaintenanceScheduleDialog.fields.maintenanceType', {
                defaultValue: 'Maintenance Type *'
              })}
            </Label>
            <CustomSelect
              id="maintenance-type"
              options={maintenanceTypeOptions}
              value={maintenanceType}
              onValueChange={(value) => setMaintenanceType(value as MaintenanceType)}
              placeholder={t('createMaintenanceScheduleDialog.placeholders.maintenanceType', {
                defaultValue: 'Select maintenance type'
              })}
              className="mt-1"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="frequency">
                {t('createMaintenanceScheduleDialog.fields.frequency', { defaultValue: 'Frequency *' })}
              </Label>
              <CustomSelect
                id="frequency"
                options={frequencyOptions}
                value={frequency}
                onValueChange={(value) => setFrequency(value as MaintenanceFrequency)}
                placeholder={t('createMaintenanceScheduleDialog.placeholders.frequency', {
                  defaultValue: 'Select frequency'
                })}
                className="mt-1"
                required
              />
            </div>

            <div>
              <Label htmlFor="frequency-interval">
                {t('createMaintenanceScheduleDialog.fields.interval', { defaultValue: 'Interval *' })}
              </Label>
              <Input
                id="frequency-interval"
                type="number"
                min="1"
                value={frequencyInterval}
                onChange={(e) => setFrequencyInterval(e.target.value)}
                placeholder={t('createMaintenanceScheduleDialog.placeholders.interval', { defaultValue: '1' })}
                className="mt-1"
                required
              />
              <p className="text-xs text-[rgb(var(--color-text-500))] mt-1">{cadencePreview}</p>
            </div>
          </div>

          {frequency === 'custom' && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="recurrence-unit">
                  {t('createMaintenanceScheduleDialog.fields.recurrenceUnit', { defaultValue: 'Unit *' })}
                </Label>
                <CustomSelect
                  id="recurrence-unit"
                  options={recurrenceUnitOptions}
                  value={recurrenceUnit}
                  onValueChange={(value) => setRecurrenceUnit(value as MaintenanceRecurrenceUnit)}
                  className="mt-1"
                />
              </div>

              {recurrenceUnit === 'weeks' && (
                <div>
                  <Label>
                    {t('createMaintenanceScheduleDialog.fields.onWeekdays', { defaultValue: 'On weekdays (optional)' })}
                  </Label>
                  <div id="recurrence-weekdays" role="group" className="mt-1 flex flex-wrap gap-2">
                    {WEEKDAY_KEYS.map((key, day) => {
                      const selected = weekdays.includes(day);
                      return (
                        <Button
                          key={key}
                          id={`recurrence-weekday-${key}`}
                          type="button"
                          size="xs"
                          variant={selected ? 'default' : 'outline'}
                          aria-pressed={selected}
                          onClick={() => setWeekdays(toggle(weekdays, day))}
                        >
                          {t(`maintenanceSchedulesTab.frequency.weekdays.${key}`, { defaultValue: WEEKDAY_ENGLISH[day] })}
                        </Button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-[rgb(var(--color-text-500))] mt-1">
                    {t('createMaintenanceScheduleDialog.hints.selectors', {
                      defaultValue: 'Leave unselected to repeat from the completion date.'
                    })}
                  </p>
                </div>
              )}

              {recurrenceUnit === 'months' && (
                <div>
                  <Label htmlFor="recurrence-day-of-month">
                    {t('createMaintenanceScheduleDialog.fields.onDayOfMonth', { defaultValue: 'On day of the month (optional)' })}
                  </Label>
                  <CustomSelect
                    id="recurrence-day-of-month"
                    options={dayOfMonthOptions}
                    value={daysOfMonth.join(',')}
                    onValueChange={(value) => setDaysOfMonth(value ? value.split(',').map((day) => parseInt(day, 10)) : [])}
                    className="mt-1"
                    // "Any day" already stands for an empty rule; a disabled
                    // "Select..." row above it would just read as a second one.
                    showPlaceholderInDropdown={false}
                  />
                  <p className="text-xs text-[rgb(var(--color-text-500))] mt-1">
                    {t('createMaintenanceScheduleDialog.hints.selectors', {
                      defaultValue: 'Leave unselected to repeat from the completion date.'
                    })}
                  </p>
                </div>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="next-maintenance">
              {t('createMaintenanceScheduleDialog.fields.nextMaintenanceDate', {
                defaultValue: 'Next Maintenance Date *'
              })}
            </Label>
            <DatePicker
              id="next-maintenance"
              value={nextMaintenance}
              onChange={setNextMaintenance}
              placeholder={t('createMaintenanceScheduleDialog.placeholders.nextMaintenanceDate', {
                defaultValue: 'Select date'
              })}
              className="mt-1"
              required
            />
          </div>

          {isEditing && (
            <div>
              <SwitchWithLabel
                label={t('createMaintenanceScheduleDialog.fields.active', { defaultValue: 'Active' })}
                checked={isActive}
                onCheckedChange={setIsActive}
              />
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
};
