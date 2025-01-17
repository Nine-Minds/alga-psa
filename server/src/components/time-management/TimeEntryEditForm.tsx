'use client';

import { memo, useCallback, useMemo } from 'react';
import { formatISO, parseISO, addMinutes } from 'date-fns';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { MinusCircle, XCircle } from 'lucide-react';
import CustomSelect from '../ui/CustomSelect';
import { TimeEntryFormProps } from './types';
import { calculateDuration, formatTimeForInput, parseTimeToDate, getDurationParts } from './utils';

const TimeEntryEditForm = memo(function TimeEntryEditForm({
  id,
  entry,
  index,
  isEditable,
  services,
  taxRegions,
  timeInputs,
  totalDuration,
  onSave,
  onDelete,
  onCollapse,
  onUpdateEntry,
  onUpdateTimeInputs,
  lastNoteInputRef
}: TimeEntryFormProps) {
  const { hours: durationHours, minutes: durationMinutes } = useMemo(
    () => getDurationParts(totalDuration),
    [totalDuration]
  );

  const serviceOptions = useMemo(() => 
    services.map((service): { value: string; label: string } => ({
      value: service.id,
      label: service.name
    })),
    []
  );

  const taxRegionOptions = useMemo(() => 
    taxRegions.map((region): { value: string; label: string } => ({
      value: region.name,
      label: region.name
    })),
    []
  );

  const selectedService = useMemo(() => 
    services.find(s => s.id === entry.service_id),
    [entry.service_id]
  );

  const handleTimeChange = useCallback((type: 'start' | 'end', value: string) => {
    if (!isEditable) return;

    const currentDate = type === 'start' ? parseISO(entry.start_time) : parseISO(entry.end_time);
    const newTime = parseTimeToDate(value, currentDate);

    if (type === 'start' && newTime >= parseISO(entry.end_time)) {
      alert('Start time cannot be after end time');
      onUpdateTimeInputs({ [`${type}-${index}`]: formatTimeForInput(currentDate) });
      return;
    }

    if (type === 'end' && newTime <= parseISO(entry.start_time)) {
      alert('End time cannot be before start time');
      onUpdateTimeInputs({ [`${type}-${index}`]: formatTimeForInput(currentDate) });
      return;
    }

    const updatedEntry = { ...entry };
    if (type === 'start') {
      updatedEntry.start_time = formatISO(newTime);
    } else {
      updatedEntry.end_time = formatISO(newTime);
    }

    const duration = calculateDuration(
      parseISO(updatedEntry.start_time),
      parseISO(updatedEntry.end_time)
    );

    if (updatedEntry.billable_duration > 0) {
      updatedEntry.billable_duration = duration;
    }

    onUpdateEntry(index, updatedEntry);
    onUpdateTimeInputs({ [`${type}-${index}`]: formatTimeForInput(newTime) });
  }, [isEditable, entry, index, onUpdateEntry, onUpdateTimeInputs]);

  const handleDurationChange = useCallback((type: 'hours' | 'minutes', value: number) => {
    const hours = type === 'hours' ? value : durationHours;
    const minutes = type === 'minutes' ? value : durationMinutes;
    
    const startTime = parseISO(entry.start_time);
    const newEndTime = addMinutes(startTime, hours * 60 + minutes);
    const updatedEntry = {
      ...entry,
      end_time: formatISO(newEndTime),
    };
    
    if (updatedEntry.billable_duration > 0) {
      updatedEntry.billable_duration = hours * 60 + minutes;
    }
    
    onUpdateEntry(index, updatedEntry);
    onUpdateTimeInputs({
      [`end-${index}`]: formatTimeForInput(newEndTime),
    });
  }, [entry, index, durationHours, durationMinutes, onUpdateEntry, onUpdateTimeInputs]);

  return (
    <div className="border p-4 rounded">
      <div className="flex justify-end items-center mb-4">
        <div className="flex items-center">
          {entry.isDirty && (
            <span className="text-yellow-500 text-sm mr-2">Unsaved changes</span>
          )}
        </div>
        <div className="flex space-x-2">
          {!entry.isNew && (
            <Button
              id={`${id}-collapse-entry-${index}-btn`}
              onClick={onCollapse}
              variant="ghost"
              size="sm"
              className="h-10 w-10"
              title="Collapse entry"
            >
              <MinusCircle className="h-6 w-6" />
            </Button>
          )}
          <Button
            id={`${id}-delete-entry-${index}-btn`}
            onClick={() => onDelete(index)}
            variant="ghost"
            size="sm"
            className="h-10 w-10 text-red-500 hover:text-red-600"
            title="Delete entry"
          >
            <XCircle className="h-6 w-6" />
          </Button>
        </div>
      </div>

      <div className="border p-4 rounded space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Service <span className="text-red-500">*</span></label>
            <CustomSelect
              value={entry.service_id || ''}
              onValueChange={(value) => {
                const updatedEntry = { ...entry, service_id: value };
                onUpdateEntry(index, updatedEntry);
              }}
              disabled={!isEditable}
              className="mt-1 w-full"
              options={serviceOptions}
              placeholder="Select a service"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Tax Region {selectedService?.is_taxable && <span className="text-red-500">*</span>}
            </label>
            <CustomSelect
              value={entry.tax_region || ''}
              onValueChange={(value) => {
                const updatedEntry = { ...entry, tax_region: value };
                onUpdateEntry(index, updatedEntry);
              }}
              disabled={!isEditable || !selectedService?.is_taxable}
              className="mt-1 w-full"
              options={taxRegionOptions}
              placeholder="Select a tax region"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Start Time</label>
            <Input
              id='start-time'
              type="time"
              value={timeInputs[`start-${index}`] || formatTimeForInput(parseISO(entry.start_time))}
              onChange={(e) => handleTimeChange('start', e.target.value)}
              disabled={!isEditable}
              className="mt-1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">End Time</label>
            <Input
              id='end-time'
              type="time"
              value={timeInputs[`end-${index}`] || formatTimeForInput(parseISO(entry.end_time))}
              onChange={(e) => handleTimeChange('end', e.target.value)}
              disabled={!isEditable}
              className="mt-1"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Duration</label>
            <div className="flex items-center space-x-2">
              <Input
                id='duration-hours'
                type="number"
                min="0"
                value={durationHours}
                onChange={(e) => handleDurationChange('hours', parseInt(e.target.value) || 0)}
                disabled={!isEditable}
                className="w-20"
              />
              <span>h</span>
              <Input
                id='duration-minutes'
                type="number"
                min="0"
                max="59"
                value={durationMinutes}
                onChange={(e) => handleDurationChange('minutes', Math.min(59, parseInt(e.target.value) || 0))}
                disabled={!isEditable}
                className="w-20"
              />
              <span>m</span>
            </div>
          </div>

          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-gray-700">
                {entry.billable_duration > 0 ? 'Billable' : 'Non-billable'}
              </span>
              <Switch
                id='billable-duration'
                checked={entry.billable_duration > 0}
                onCheckedChange={(checked) => {
                  const duration = calculateDuration(
                    parseISO(entry.start_time),
                    parseISO(entry.end_time)
                  );
                  const updatedEntry = {
                    ...entry,
                    billable_duration: checked ? duration : 0,
                  };
                  onUpdateEntry(index, updatedEntry);
                }}
                className="data-[state=checked]:bg-primary-500"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Notes</label>
          <Input
            id='notes'
            value={entry.notes}
            onChange={(e) => {
              const updatedEntry = { ...entry, notes: e.target.value };
              onUpdateEntry(index, updatedEntry);
            }}
            placeholder="Notes"
            disabled={!isEditable}
            ref={lastNoteInputRef}
            className="mt-1 w-full"
          />
        </div>

        <div className="flex justify-end mt-4">
          <Button
            id={`${id}-save-entry-${index}-btn`}
            onClick={() => onSave(index)}
            variant="default"
            size="default"
            className="w-32"
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
});

export default TimeEntryEditForm;