import React, { useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { createMaintenanceSchedule, updateMaintenanceSchedule } from '../../actions/assetActions';
import type { MaintenanceType, MaintenanceFrequency, AssetMaintenanceSchedule } from '@alga-psa/types';

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
    { value: 'preventive', label: 'Preventive' },
    { value: 'inspection', label: 'Inspection' },
    { value: 'calibration', label: 'Calibration' },
    { value: 'replacement', label: 'Replacement' }
  ];

  const frequencyOptions = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'yearly', label: 'Yearly' }
  ];


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!scheduleName.trim()) {
      setError('Schedule name is required');
      return;
    }

    if (!maintenanceType) {
      setError('Maintenance type is required');
      return;
    }

    if (!frequency) {
      setError('Frequency is required');
      return;
    }

    if (!nextMaintenance) {
      setError('Next maintenance date is required');
      return;
    }

    const interval = parseInt(frequencyInterval, 10);
    if (isNaN(interval) || interval < 1) {
      setError('Frequency interval must be at least 1');
      return;
    }

    setIsSubmitting(true);

    try {
      const scheduleData: any = {
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
        await updateMaintenanceSchedule(schedule.schedule_id, {
          ...scheduleData,
          is_active: isActive
        });
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
      setError(err instanceof Error ? err.message : 'Failed to create maintenance schedule');
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
      title={isEditing ? 'Edit Maintenance Schedule' : 'Schedule Maintenance'} 
      id={isEditing ? 'edit-maintenance-schedule-dialog' : 'create-maintenance-schedule-dialog'}
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div>
            <Label htmlFor="schedule-name">Schedule Name *</Label>
            <Input
              id="schedule-name"
              value={scheduleName}
              onChange={(e) => setScheduleName(e.target.value)}
              placeholder="e.g., Monthly Server Maintenance"
              className="mt-1"
              required
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <TextArea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              className="mt-1"
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="maintenance-type">Maintenance Type *</Label>
            <CustomSelect
              id="maintenance-type"
              options={maintenanceTypeOptions}
              value={maintenanceType}
              onValueChange={(value) => setMaintenanceType(value as MaintenanceType)}
              placeholder="Select maintenance type"
              className="mt-1"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="frequency">Frequency *</Label>
              <CustomSelect
                id="frequency"
                options={frequencyOptions}
                value={frequency}
                onValueChange={(value) => setFrequency(value as MaintenanceFrequency)}
                placeholder="Select frequency"
                className="mt-1"
                required
              />
            </div>

            <div>
              <Label htmlFor="frequency-interval">Interval *</Label>
              <Input
                id="frequency-interval"
                type="number"
                min="1"
                value={frequencyInterval}
                onChange={(e) => setFrequencyInterval(e.target.value)}
                placeholder="1"
                className="mt-1"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                {frequency && `Every ${frequencyInterval} ${frequency}${parseInt(frequencyInterval) > 1 ? 's' : ''}`}
              </p>
            </div>
          </div>

          <div>
            <Label htmlFor="next-maintenance">Next Maintenance Date *</Label>
            <DatePicker
              id="next-maintenance"
              value={nextMaintenance}
              onChange={setNextMaintenance}
              placeholder="Select date"
              className="mt-1"
              required
            />
          </div>

          {isEditing && (
            <div>
              <SwitchWithLabel
                label="Active"
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
              Cancel
            </Button>
            <Button
              id="submit-maintenance-schedule-btn"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? (isEditing ? 'Updating...' : 'Creating...') : (isEditing ? 'Update Schedule' : 'Create Schedule')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
