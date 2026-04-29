'use client';

import { memo, useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getEligibleContractLinesForUI, getClientIdForWorkItem } from '../../../../lib/contractLineDisambiguation';
import { getSchedulingClientById } from '../../../../actions/clientInteractionLookupActions';
import { formatISO, isSameDay, parseISO, setHours, setMinutes, setSeconds } from 'date-fns';
import { IService } from '@alga-psa/types';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { TimePicker } from '@alga-psa/ui/components/TimePicker';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { MinusCircle, XCircle, Info, AlertTriangle } from 'lucide-react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { TimeEntryFormProps } from './types';
import { calculateDuration, clampDurationToSameDay, formatTimeForInput, parseTimeToDate, getDurationParts } from './utils';
import { ISO8601String } from '@alga-psa/types';
import ContractInfoBanner from './ContractInfoBanner';
import { TimeEntryChangeRequestPanel } from './TimeEntryChangeRequestFeedback';

// Define the expected structure returned by getEligibleContractLinesForUI,
// including the date fields needed for filtering.
// Type matching the apparent return structure of getEligibleContractLinesForUI
interface EligiblePlanUI {
  client_contract_line_id: string;
  contract_line_name: string;
  contract_line_type: string;
  start_date: ISO8601String; // Required for filtering
  end_date?: ISO8601String | null; // Required for filtering
  contract_name?: string; // Contract name for display
  has_bucket_overlay: boolean;
}

const TimeEntryEditForm = memo(function TimeEntryEditForm({
  id,
  entry,
  index,
  isEditable,
  services, // Should now include tax_rate_id
  // taxRegions, // Removed - No longer needed
  timeInputs,
  totalDuration,
  onSave,
  onDelete,
  onUpdateEntry,
  onUpdateTimeInputs,
  lastNoteInputRef,
  date,
  isNewEntry = false,
  isSaving = false,
  disableSave = false
}: TimeEntryFormProps) {
  const { t } = useTranslation('msp/time-entry');
  // Use work item times for ad-hoc entries - only update if values actually changed
  useEffect(() => {
    if (entry?.work_item_type === 'ad_hoc' && entry.start_time && entry.end_time) {
      const start = parseISO(entry.start_time);
      const end = parseISO(entry.end_time);

      const newStartInput = formatTimeForInput(start);
      const newEndInput = formatTimeForInput(end);

      // Only update if the formatted times are different from current inputs
      if (timeInputs[`start-${index}`] !== newStartInput ||
        timeInputs[`end-${index}`] !== newEndInput) {
        onUpdateTimeInputs({
          [`start-${index}`]: newStartInput,
          [`end-${index}`]: newEndInput
        });
      }
    }
  }, [entry?.work_item_type, entry?.start_time, entry?.end_time, index, onUpdateTimeInputs, timeInputs]);
  const { hours: durationHours, minutes: durationMinutes } = useMemo(
    () => entry?.start_time && entry?.end_time
      ? getDurationParts(calculateDuration(parseISO(entry.start_time), parseISO(entry.end_time)))
      : { hours: 0, minutes: 0 },
    [entry?.start_time, entry?.end_time]
  );

  const serviceOptions = useMemo(() => {
    if (!services) return [];
    return services.map((service): { value: string; label: string } => ({
      value: service.id,
      label: service.name
    }))
  }, [services]);

  const selectedService = useMemo(() =>
    services.find(s => s.id === entry?.service_id),
    [services, entry?.service_id] // Added services dependency
  );

  const [validationErrors, setValidationErrors] = useState<{
    startTime?: string;
    endTime?: string;
    duration?: string;
    service?: string;
    contractLine?: string;
  }>({});

  const [showErrors, setShowErrors] = useState(false);
  const [eligibleContractLines, setEligibleContractLines] = useState<EligiblePlanUI[]>([]);
  const [showContractLineSelector, setShowContractLineSelector] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const prevServiceIdRef = useRef<string | undefined | null>(undefined);
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    if (entry?.start_time) {
      return parseISO(entry.start_time);
    }
    return date || new Date();
  });

  const validateTimes = useCallback(() => {
    if (!entry?.start_time || !entry?.end_time) return false;
    const startTime = parseISO(entry.start_time);
    const endTime = parseISO(entry.end_time);
    const duration = calculateDuration(startTime, endTime);
    const newErrors: typeof validationErrors = {};

    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
      newErrors.duration = t('timeEntryForm.validation.invalidTimeRange', {
        defaultValue: 'Enter a valid time range'
      });
    } else if (!isSameDay(startTime, endTime)) {
      newErrors.duration = t('timeEntryForm.validation.durationSameDay', {
        defaultValue: 'Duration must end on the same day'
      });
      newErrors.endTime = t('timeEntryForm.validation.endSameDay', {
        defaultValue: 'End time must be on the same day as start time'
      });
    }

    if (startTime >= endTime) {
      newErrors.startTime = t('timeEntryForm.validation.startBeforeEnd', {
        defaultValue: 'Start time must be earlier than end time'
      });
      newErrors.endTime = t('timeEntryForm.validation.endAfterStart', {
        defaultValue: 'End time must be later than start time'
      });
    }

    if (duration <= 0) {
      newErrors.duration = t('timeEntryForm.validation.durationMinimum', {
        defaultValue: 'Duration must be at least 1 minute'
      });
    } else if (duration < 1) {
      newErrors.duration = t('timeEntryForm.validation.minimumDuration', {
        defaultValue: 'Minimum duration is 1 minute'
      });
    }

    setValidationErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [entry?.start_time, entry?.end_time, t]);

  // Get client ID from entry or work item
  useEffect(() => {
    const fetchClientId = async () => {
      let resolvedClientId: string | null = null;
      if (entry?.client_id) {
        console.log('Using client ID directly from entry:', entry.client_id);
        resolvedClientId = entry.client_id;
      } else if (entry?.work_item_id) {
        console.log('Attempting to get client ID from work item:', entry.work_item_id);
        try {
          // Pass tenant ID as the second argument
          resolvedClientId = await getClientIdForWorkItem(entry.work_item_id, entry.work_item_type);
          console.log('Resolved client ID from work item:', resolvedClientId);
        } catch (error) {
          console.error('Error fetching client ID for work item:', error);
          resolvedClientId = null;
        }
      } else {
        console.log('No client ID or work item ID in entry.');
        resolvedClientId = null;
      }

      if (clientId !== resolvedClientId) {
        setClientId(resolvedClientId);
        console.log('Set clientId state to:', resolvedClientId);
      }
    };

    fetchClientId();
  }, [entry?.client_id, entry?.work_item_id, clientId]); // Added work_item_id and clientId dependencies

  // Load eligible contract lines and set default tax region when service or client ID changes
  useEffect(() => {
    const loadDataAndSetDefaults = async () => {
      // --- Removed Tax Region / Default Rate Logic ---
      // Tax details are now determined by the backend based on service_id's tax_rate_id
      // --- End Removed Logic ---

      // Always show the plan selector
      setShowContractLineSelector(true);

      let clientDetails: any | null = null;
      let currentEligiblePlans: EligiblePlanUI[] = [];

      // 1. Fetch Client Details (if clientId exists) - Still needed for plan logic
      if (clientId) {
        try {
          clientDetails = await getSchedulingClientById(clientId);
          console.log('Fetched client details:', clientDetails);
        } catch (error) {
          console.error('Error fetching client details:', error);
          clientDetails = null; // Ensure it's null on error
        }
      } else {
        console.log('No client ID available, cannot fetch client details.');
      }

      // 2. Load Eligible Contract Lines (dependent on service and client)
      if (!entry?.service_id) {
        console.log('No service ID available, cannot load contract lines');
        setEligibleContractLines([]);
      } else if (!clientId) {
        console.log('No client ID available, using default contract line logic (no specific lines loaded)');
        setEligibleContractLines([]);
      } else {
        // Fetch and filter plans only if service and client are known
        try {
          const plans = await getEligibleContractLinesForUI(
            clientId,
            entry.service_id,
            entry.start_time ?? selectedDate.toISOString()
          ) as EligiblePlanUI[];
          const entryDate = entry.start_time ? new Date(entry.start_time) : new Date(); // Use current date if start_time not set yet

          const filteredPlans = plans.filter(plan => {
            const start = new Date(plan.start_date as string);
            const end = plan.end_date ? new Date(plan.end_date as string) : null;
            // Ensure entryDate is valid before comparison
            return !isNaN(entryDate.getTime()) && start <= entryDate && (!end || end >= entryDate);
          });

          currentEligiblePlans = filteredPlans;
          setEligibleContractLines(currentEligiblePlans);
          console.log('Eligible contract lines loaded:', currentEligiblePlans);

          // 3. Set Default Contract Line (only if lines were loaded)
          const currentContractLineId = entry?.contract_line_id; // Use entry from closure
          if (!currentContractLineId && currentEligiblePlans.length > 0) {
            let defaultPlanId: string | null = null;
            if (currentEligiblePlans.length === 1) {
              defaultPlanId = currentEligiblePlans[0].client_contract_line_id;
              console.log('Setting default contract line (only one eligible):', defaultPlanId);
            } else {
              const overlayPlans = currentEligiblePlans.filter(plan => plan.has_bucket_overlay);
              if (overlayPlans.length === 1) {
                defaultPlanId = overlayPlans[0].client_contract_line_id;
                console.log('Setting default contract line (single bucket line):', defaultPlanId);
              } else {
                console.log('Multiple eligible contract lines, no single default determined.');
              }
            }

            if (defaultPlanId) {
              const entryWithUpdatedPlan = {
                ...entry, // Includes tax updates already applied
                contract_line_id: defaultPlanId
              };
              onUpdateEntry(index, entryWithUpdatedPlan);
              // Update the 'entry' variable in this scope
              entry = entryWithUpdatedPlan;
            }
          } else {
            console.log('Contract line already set or no eligible lines found, skipping default selection.');
          }

        } catch (error) {
          console.error('Error loading eligible contract lines:', error);
          setEligibleContractLines([]); // Reset on error
        }
      }
    }

    // Only run if entry exists
    if (entry) {
      loadDataAndSetDefaults();
    }
  }, [entry?.service_id, clientId, entry?.start_time, entry?.contract_line_id, index, onUpdateEntry]);

const updateBillableDuration = useCallback((updatedEntry: typeof entry, newDuration: number) => {
  const durationToSet = Math.max(0, newDuration);

  const newBillableDuration = updatedEntry.billable_duration === 0 ? 0 : durationToSet;

  console.log('Updating billable duration:', {
    oldBillableDuration: updatedEntry.billable_duration,
    newDuration: durationToSet,
    newBillableDuration,
    isExplicitlyZero: updatedEntry.billable_duration === 0
  });

  return {
    ...updatedEntry,
    billable_duration: newBillableDuration
  };
}, []);

  const markEntryAsDirty = useCallback((updatedEntry: typeof entry) => {
    if (!entry?.entry_id) {
      return updatedEntry;
    }

    return {
      ...updatedEntry,
      isDirty: true,
    };
  }, [entry?.entry_id]);

  const handleSave = useCallback(() => {
    if (!onSave) return;

    setShowErrors(true);
    if (!validateTimes()) {
      return;
    }

    if (!entry?.service_id?.trim()) {
      setValidationErrors(prev => ({
        ...prev,
        service: t('timeEntryForm.validation.serviceRequired', {
          defaultValue: 'Service is required for time entries'
        })
      }));
      return;
    }

    // Contract line validation removed - contract line is no longer required

    // Clear any existing validation errors
    setValidationErrors({});

    // Call parent's onSave with the current entry
    onSave(index);
  }, [onSave, validateTimes, entry?.service_id, entry?.work_item_type, showContractLineSelector, eligibleContractLines.length, entry?.contract_line_id, index, setShowErrors, t]);

  const handleTimeChange = useCallback((type: 'start' | 'end', value: string) => {
    if (!isEditable || !entry) return;

    const currentDate = parseISO(entry.start_time);
    const newTime = parseTimeToDate(value, currentDate);

    const updatedEntry = markEntryAsDirty(updateBillableDuration(
      {
        ...entry,
        [type === 'start' ? 'start_time' : 'end_time']: formatISO(newTime)
      },
      calculateDuration(
        type === 'start' ? newTime : parseISO(entry.start_time),
        type === 'end' ? newTime : parseISO(entry.end_time)
      )
    ));

    onUpdateEntry(index, updatedEntry);
    onUpdateTimeInputs({
      [`${type}-${index}`]: value
    });

    setValidationErrors({});
    if (showErrors) {
      validateTimes();
    }
  }, [isEditable, entry, index, markEntryAsDirty, onUpdateEntry, onUpdateTimeInputs, showErrors, updateBillableDuration, validateTimes]);




  const parseDurationInputValue = useCallback((value: string): number => {
    if (value.trim() === '') return 0;

    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      return 0;
    }

    return Math.floor(parsedValue);
  }, []);

  const handleDurationChange = useCallback((type: 'hours' | 'minutes', value: string) => {
    if (!isEditable || !entry) return;
    const parsedValue = parseDurationInputValue(value);
    const hours = type === 'hours' ? parsedValue : durationHours;
    const minutes = type === 'minutes' ? Math.min(59, parsedValue) : durationMinutes;

    const startTime = parseISO(entry.start_time);
    if (Number.isNaN(startTime.getTime())) {
      setValidationErrors(prev => ({
        ...prev,
        duration: t('timeEntryForm.validation.invalidTimeRange', {
          defaultValue: 'Enter a valid time range'
        }),
      }));
      return;
    }

    const requestedTotalMinutes = hours * 60 + minutes;
    const {
      durationMinutes: totalMinutes,
      endTime: newEndTime,
      maxDurationMinutes,
      wasClampedToSameDay,
    } = clampDurationToSameDay(startTime, requestedTotalMinutes);

    const newBillableDuration = entry.billable_duration === 0 ? 0 : totalMinutes;

    const updatedEntry = markEntryAsDirty({
      ...entry,
      end_time: formatISO(newEndTime),
      billable_duration: newBillableDuration
    });

    console.log('Duration change:', {
      hours,
      minutes,
      requestedTotalMinutes,
      totalMinutes,
      maxDurationMinutes,
      oldBillableDuration: entry.billable_duration,
      newBillableDuration
    });

    onUpdateEntry(index, updatedEntry);
    onUpdateTimeInputs({
      [`end-${index}`]: formatTimeForInput(newEndTime),
    });

    const durationError = wasClampedToSameDay
      ? t('timeEntryForm.validation.durationSameDay', {
        defaultValue: 'Duration must end on the same day'
      })
      : undefined;

    setValidationErrors(prev => ({
      ...prev,
      startTime: undefined,
      endTime: undefined,
      duration: durationError,
    }));
    if (showErrors && !durationError) {
      validateTimes();
    }
  }, [durationHours, durationMinutes, entry, index, isEditable, markEntryAsDirty, onUpdateEntry, onUpdateTimeInputs, parseDurationInputValue, showErrors, t, validateTimes]);

  return (
    <div className="space-y-5">
      <TimeEntryChangeRequestPanel changeRequests={entry?.change_requests} />

      {/* Only show delete button and status for existing entries that have been saved */}
      {(entry?.entry_id && !isNewEntry && isEditable) && (
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            {entry?.isDirty && (
              <span className="text-yellow-500 text-sm mr-2">
                {t('timeEntryForm.labels.unsavedChanges', { defaultValue: 'Unsaved changes' })}
              </span>
            )}
          </div>
          <div className="flex space-x-2">
            <Button
              id={`${id}-delete-entry-${index}-btn`}
              onClick={() => onDelete(index)}
              variant="destructive"
              disabled={!isEditable}
            >
              {t('timeEntryForm.labels.deleteTimeEntry', { defaultValue: 'Delete Time Entry' })}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700">
          {t('timeEntryForm.labels.service', { defaultValue: 'Service' })} <span className="text-red-500">*</span>
        </label>
        <CustomSelect
          value={entry?.service_id || ''}
          onValueChange={(value) => {
            if (entry) {
              const isServiceOverridden = entry._isServicePrefilled && value !== entry._originalServiceId;
              const updatedEntry = markEntryAsDirty({
                ...entry,
                service_id: value,
                _serviceOverridden: isServiceOverridden
              });
              onUpdateEntry(index, updatedEntry);
              setValidationErrors(prev => ({
                ...prev,
                service: undefined
              }));
            }
          }}
          disabled={!isEditable}
          className="w-full"
          options={serviceOptions}
          placeholder={t('timeEntryForm.placeholders.selectService', { defaultValue: 'Select a service' })}
        />
        {showErrors && validationErrors.service && (
          <span className="text-sm text-red-500">{validationErrors.service}</span>
        )}
      </div>

      {/* Contract Info Banner - shows which contract will be used */}
      {entry?.work_item_id && entry?.service_id && (
        <ContractInfoBanner
          workItemId={entry.work_item_id}
          workItemType={entry.work_item_type}
          serviceId={entry.service_id}
          entryDate={entry.start_time ? parseISO(entry.start_time) : undefined}
          clientId={clientId}
        />
      )}

      {isNewEntry && (
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('timeEntryForm.labels.date', { defaultValue: 'Date' })} <span className="text-red-500">*</span>
          </label>
          <DatePicker
            value={selectedDate}
            onChange={(newDate) => {
              if (!newDate || !entry) return;

              setSelectedDate(newDate);

              // Update the entry's start time to the new date and preserve duration when it still fits the same day.
              const startTime = parseISO(entry.start_time);
              const endTime = parseISO(entry.end_time);

              const newStartTime = setSeconds(
                setMinutes(
                  setHours(newDate, startTime.getHours()),
                  startTime.getMinutes()
                ),
                startTime.getSeconds()
              );

              const originalDuration = calculateDuration(startTime, endTime);
              const {
                durationMinutes,
                endTime: newEndTime,
                wasClampedToSameDay,
              } = clampDurationToSameDay(newStartTime, originalDuration);

              onUpdateEntry(index, markEntryAsDirty({
                ...entry,
                start_time: formatISO(newStartTime),
                end_time: formatISO(newEndTime),
                billable_duration: entry.billable_duration === 0 ? 0 : durationMinutes,
              }));
              onUpdateTimeInputs({
                [`start-${index}`]: formatTimeForInput(newStartTime),
                [`end-${index}`]: formatTimeForInput(newEndTime),
              });
              setValidationErrors(prev => ({
                ...prev,
                duration: wasClampedToSameDay
                  ? t('timeEntryForm.validation.durationSameDay', {
                    defaultValue: 'Duration must end on the same day'
                  })
                  : undefined,
              }));
            }}
            placeholder={t('timeEntryForm.placeholders.selectDate', { defaultValue: 'Select date' })}
            disabled={!isEditable}
            clearable={false}
          />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">
            {t('timeEntryForm.labels.startTime', { defaultValue: 'Start Time' })}
          </label>
          <TimePicker
            id={`${id}-start-time-${index}`}
            value={timeInputs[`start-${index}`] || (entry?.start_time ? formatTimeForInput(parseISO(entry.start_time)) : '')}
            onChange={(value) => handleTimeChange('start', value)}
            allowManualInput
            disabled={!isEditable}
            className="w-full"
          />
          {showErrors && validationErrors.startTime && (
            <span className="text-sm text-red-500">{validationErrors.startTime}</span>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">
            {t('timeEntryForm.labels.endTime', { defaultValue: 'End Time' })}
          </label>
          <TimePicker
            id={`${id}-end-time-${index}`}
            value={timeInputs[`end-${index}`] || (entry?.end_time ? formatTimeForInput(parseISO(entry.end_time)) : '')}
            onChange={(value) => handleTimeChange('end', value)}
            allowManualInput
            disabled={!isEditable}
            className="w-full"
          />
          {showErrors && validationErrors.endTime && (
            <span className="text-sm text-red-500">{validationErrors.endTime}</span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          {t('timeEntryForm.labels.duration', { defaultValue: 'Duration' })}
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Input
              id={`${id}-duration-hours-${index}`}
              type="number"
              min="0"
              value={durationHours}
              onChange={(e) => handleDurationChange('hours', e.target.value)}
              disabled={!isEditable}
              containerClassName="w-[5.5rem]"
              className="text-center"
            />
            <span className="text-sm font-medium text-gray-500">
              {t('common.units.hoursShort', { defaultValue: 'h' })}
            </span>
            <Input
              id={`${id}-duration-minutes-${index}`}
              type="number"
              min="0"
              max="59"
              value={durationMinutes}
              onChange={(e) => handleDurationChange('minutes', e.target.value)}
              disabled={!isEditable}
              containerClassName="w-[4.5rem]"
              className="text-center"
            />
            <span className="text-sm font-medium text-gray-500">
              {t('common.units.minutesShort', { defaultValue: 'm' })}
            </span>
          </div>
          <div className="inline-flex h-10 items-center gap-3 px-1">
            <Switch
              id={`${id}-billable-duration-${index}`}
              checked={entry?.billable_duration > 0}
              disabled={!isEditable}
              onCheckedChange={(checked) => {
                if (entry?.start_time && entry?.end_time) {
                  const duration = calculateDuration(
                    parseISO(entry.start_time),
                    parseISO(entry.end_time)
                  );

                  console.log('Toggle billable switch:', { checked, duration });

                  onUpdateEntry(
                    index,
                    markEntryAsDirty(
                      checked
                        ? { ...entry, billable_duration: duration }
                        : { ...entry, billable_duration: 0 }
                    )
                  );
                }
              }}
              className="data-[state=checked]:bg-primary-500"
            />
            <span className="text-sm font-medium text-gray-700">
              {t('timeEntryForm.labels.billable', { defaultValue: 'Billable' })}
            </span>
          </div>
        </div>
        {(showErrors || Boolean(validationErrors.duration)) && validationErrors.duration && (
          <span className="text-sm text-red-500">
            {validationErrors.duration}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700">
          {t('timeEntryForm.labels.notes', { defaultValue: 'Notes' })}
        </label>
        <TextArea
          id={`${id}-notes-${index}`}
          value={entry?.notes || ''}
          onChange={(e) => {
            if (entry) {
              const updatedEntry = markEntryAsDirty({ ...entry, notes: e.target.value });
              onUpdateEntry(index, updatedEntry);
            }
          }}
          placeholder={t('timeEntryForm.placeholders.addNotes', { defaultValue: 'Add notes' })}
          disabled={!isEditable}
          ref={lastNoteInputRef}
          wrapperClassName="mb-0 px-0"
          className="min-h-[7.5rem] text-sm"
        />
      </div>

      {/* Only show save button for multi-entry editing (when onSave is provided) */}
      {isEditable && onSave && (
        <div className="flex justify-end border-t border-gray-200 pt-4">
          <div className="flex flex-col items-end gap-2">
            <Button
              id={`${id}-save-entry-${index}-btn`}
              onClick={handleSave}
              variant="default"
              size="default"
              className="w-32"
              disabled={disableSave}
            >
              {isSaving
                ? t('common.actions.saving', { defaultValue: 'Saving...' })
                : t('common.actions.saveGeneric', { defaultValue: 'Save' })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});

export default TimeEntryEditForm;
