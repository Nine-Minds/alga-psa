import React, { useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { createMaintenanceSchedule, updateMaintenanceSchedule } from '../../actions/assetActions';
import type {
  MaintenanceType,
  MaintenanceFrequency,
  AssetMaintenanceSchedule,
  CreateMaintenanceScheduleRequest,
  UpdateMaintenanceScheduleRequest
} from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const [nextMaintenance, setNextMaintenance] = useState<Date | undefined>(undefined);
  const [isActive, setIsActive] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate form when editing
  React.useEffect(() => {
    if (schedule) {
      setScheduleName(schedule.schedule_name);
      setDescription(schedule.description || '');
      setMaintenanceType(schedule.maintenance_type);
      setFrequency(schedule.frequency);
      setFrequencyInterval(schedule.frequency_interval.toString());
      setNextMaintenance(schedule.next_maintenance ? new Date(schedule.next_maintenance) : undefined);
      setIsActive(schedule.is_active);
    } else {
      // Reset form for new schedule
      setScheduleName('');
      setDescription('');
      setMaintenanceType('');
      setFrequency('');
      setFrequencyInterval('1');
      setNextMaintenance(undefined);
      setIsActive(true);
    }
  }, [schedule, isOpen]);

  const maintenanceTypeOptions = [
    { value: 'preventive', label: t('maintenanceSchedulesTab.types.preventive', { defaultValue: 'Preventive' }) },
    { value: 'inspection', label: t('maintenanceSchedulesTab.types.inspection', { defaultValue: 'Inspection' }) },
    { value: 'calibration', label: t('maintenanceSchedulesTab.types.calibration', { defaultValue: 'Calibration' }) },
    { value: 'replacement', label: t('maintenanceSchedulesTab.types.replacement', { defaultValue: 'Replacement' }) }
  ];

  const frequencyOptions = [
    { value: 'daily', label: t('createMaintenanceScheduleDialog.frequencyOptions.daily', { defaultValue: 'Daily' }) },
    { value: 'weekly', label: t('createMaintenanceScheduleDialog.frequencyOptions.weekly', { defaultValue: 'Weekly' }) },
    { value: 'monthly', label: t('createMaintenanceScheduleDialog.frequencyOptions.monthly', { defaultValue: 'Monthly' }) },
    { value: 'quarterly', label: t('createMaintenanceScheduleDialog.frequencyOptions.quarterly', { defaultValue: 'Quarterly' }) },
    { value: 'yearly', label: t('createMaintenanceScheduleDialog.frequencyOptions.yearly', { defaultValue: 'Yearly' }) }
  ];


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
        schedule_config: {},
        next_maintenance: nextMaintenance.toISOString()
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
        await updateMaintenanceSchedule(schedule.schedule_id, updateData);
      } else {
        await createMaintenanceSchedule(scheduleData);
      }

      // Reset form
      setScheduleName('');
      setDescription('');
      setMaintenanceType('');
      setFrequency('');
      setFrequencyInterval('1');
      setNextMaintenance(undefined);
      setIsActive(true);
      setError(null);

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
      setScheduleName('');
      setDescription('');
      setMaintenanceType('');
      setFrequency('');
      setFrequencyInterval('1');
      setNextMaintenance(undefined);
      setIsActive(true);
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={handleClose} 
      title={isEditing
        ? t('createMaintenanceScheduleDialog.titles.edit', { defaultValue: 'Edit Maintenance Schedule' })
        : t('createMaintenanceScheduleDialog.titles.create', { defaultValue: 'Schedule Maintenance' })} 
      id={isEditing ? 'edit-maintenance-schedule-dialog' : 'create-maintenance-schedule-dialog'}
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
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
              <p className="text-xs text-gray-500 mt-1">
                {frequency && t('maintenanceSchedulesTab.frequency.every', {
                  count: parseInt(frequencyInterval, 10) || 0,
                  frequency: t(`maintenanceSchedulesTab.frequency.units.${frequency}`, {
                    defaultValue: frequency
                  }),
                  suffix: parseInt(frequencyInterval, 10) > 1 ? 's' : ''
                })}
              </p>
            </div>
          </div>

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

          <DialogFooter>
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
              type="submit"
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
