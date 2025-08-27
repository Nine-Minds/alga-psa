'use client';

import { memo, useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { getEligibleBillingPlansForUI, getCompanyIdForWorkItem } from 'server/src/lib/utils/planDisambiguation';
import { getCompanyById } from 'server/src/lib/actions/company-actions/companyActions';
import { formatISO, parseISO, addMinutes, setHours, setMinutes, setSeconds } from 'date-fns';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { Switch } from 'server/src/components/ui/Switch';
import { TimePicker } from 'server/src/components/ui/TimePicker';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import { MinusCircle, XCircle, Info } from 'lucide-react';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { InfoCircledIcon } from '@radix-ui/react-icons';
import { TimeEntryFormProps } from './types';
import { calculateDuration, formatTimeForInput, parseTimeToDate, getDurationParts } from './utils';
import { ISO8601String } from 'server/src/types/types.d';

// Define the expected structure returned by getEligibleBillingPlansForUI,
// including the date fields needed for filtering.
// Type matching the apparent return structure of getEligibleBillingPlansForUI
interface EligiblePlanUI {
  company_billing_plan_id: string;
  plan_name: string;
  plan_type: string;
  start_date: ISO8601String; // Required for filtering
  end_date?: ISO8601String | null; // Required for filtering
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
  isNewEntry = false
}: TimeEntryFormProps) {
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
  }, []);

  const selectedService = useMemo(() =>
    services.find(s => s.id === entry?.service_id),
    [services, entry?.service_id] // Added services dependency
  );

  const [validationErrors, setValidationErrors] = useState<{
    startTime?: string;
    endTime?: string;
    duration?: string;
    service?: string;
    billingPlan?: string;
  }>({});

  const [showErrors, setShowErrors] = useState(false);
  const [eligibleBillingPlans, setEligibleBillingPlans] = useState<EligiblePlanUI[]>([]);
  const [showBillingPlanSelector, setShowBillingPlanSelector] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const prevServiceIdRef = useRef<string | undefined | null>();
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

    if (startTime >= endTime) {
      newErrors.startTime = 'Start time must be earlier than end time';
      newErrors.endTime = 'End time must be later than start time';
    }

    if (duration <= 0) {
      newErrors.duration = 'Duration must be at least 1 minute';
    } else if (duration < 1) {
      newErrors.duration = 'Minimum duration is 1 minute';
    }

    setValidationErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [entry?.start_time, entry?.end_time]);

  // Get company ID from entry or work item
  useEffect(() => {
    const fetchCompanyId = async () => {
      let resolvedCompanyId: string | null = null;
      if (entry?.company_id) {
        console.log('Using company ID directly from entry:', entry.company_id);
        resolvedCompanyId = entry.company_id;
      } else if (entry?.work_item_id) {
        console.log('Attempting to get company ID from work item:', entry.work_item_id);
        try {
          // Pass tenant ID as the second argument
          resolvedCompanyId = await getCompanyIdForWorkItem(entry.work_item_id, entry.work_item_type);
          console.log('Resolved company ID from work item:', resolvedCompanyId);
        } catch (error) {
          console.error('Error fetching company ID for work item:', error);
          resolvedCompanyId = null;
        }
      } else {
        console.log('No company ID or work item ID in entry.');
        resolvedCompanyId = null;
      }

      if (companyId !== resolvedCompanyId) {
        setCompanyId(resolvedCompanyId);
        console.log('Set companyId state to:', resolvedCompanyId);
      }
    };

    fetchCompanyId();
  }, [entry?.company_id, entry?.work_item_id, companyId]); // Added work_item_id and companyId dependencies

  // Load eligible billing plans and set default tax region when service or company ID changes
  useEffect(() => {
    const loadDataAndSetDefaults = async () => {
      // --- Removed Tax Region / Default Rate Logic ---
      // Tax details are now determined by the backend based on service_id's tax_rate_id
      // --- End Removed Logic ---

      // Always show the plan selector
      setShowBillingPlanSelector(true);

      let companyDetails: any | null = null;
      let currentEligiblePlans: EligiblePlanUI[] = [];

      // 1. Fetch Company Details (if companyId exists) - Still needed for plan logic
      if (companyId) {
        try {
          companyDetails = await getCompanyById(companyId);
          console.log('Fetched company details:', companyDetails);
        } catch (error) {
          console.error('Error fetching company details:', error);
          companyDetails = null; // Ensure it's null on error
        }
      } else {
        console.log('No company ID available, cannot fetch company details.');
      }

      // 2. Load Eligible Billing Plans (dependent on service and company)
      if (!entry?.service_id) {
        console.log('No service ID available, cannot load billing plans');
        setEligibleBillingPlans([]);
      } else if (!companyId) {
        console.log('No company ID available, using default billing plan logic (no specific plans loaded)');
        setEligibleBillingPlans([]);
      } else {
        // Fetch and filter plans only if service and company are known
        try {
          const plans = await getEligibleBillingPlansForUI(companyId, entry.service_id) as EligiblePlanUI[];
          const entryDate = entry.start_time ? new Date(entry.start_time) : new Date(); // Use current date if start_time not set yet

          const filteredPlans = plans.filter(plan => {
            const start = new Date(plan.start_date as string);
            const end = plan.end_date ? new Date(plan.end_date as string) : null;
            // Ensure entryDate is valid before comparison
            return !isNaN(entryDate.getTime()) && start <= entryDate && (!end || end >= entryDate);
          });

          currentEligiblePlans = filteredPlans;
          setEligibleBillingPlans(currentEligiblePlans);
          console.log('Eligible billing plans loaded:', currentEligiblePlans);

          // 3. Set Default Billing Plan (only if plans were loaded)
          const currentBillingPlanId = entry?.billing_plan_id; // Use entry from closure
          if (!currentBillingPlanId && currentEligiblePlans.length > 0) {
            let defaultPlanId: string | null = null;
            if (currentEligiblePlans.length === 1) {
              defaultPlanId = currentEligiblePlans[0].company_billing_plan_id;
              console.log('Setting default billing plan (only one eligible):', defaultPlanId);
            } else {
              const bucketPlans = currentEligiblePlans.filter(plan => plan.plan_type === 'Bucket');
              if (bucketPlans.length === 1) {
                defaultPlanId = bucketPlans[0].company_billing_plan_id;
                console.log('Setting default billing plan (single bucket plan):', defaultPlanId);
              } else {
                console.log('Multiple eligible plans, no single default determined.');
              }
            }

            if (defaultPlanId) {
              const entryWithUpdatedPlan = {
                ...entry, // Includes tax updates already applied
                billing_plan_id: defaultPlanId
              };
              onUpdateEntry(index, entryWithUpdatedPlan);
              // Update the 'entry' variable in this scope
              entry = entryWithUpdatedPlan;
            }
          } else {
            console.log('Billing plan already set or no eligible plans found, skipping default selection.');
          }

        } catch (error) {
          console.error('Error loading eligible billing plans:', error);
          setEligibleBillingPlans([]); // Reset on error
        }
      }

      // 2. Load Eligible Billing Plans (dependent on service and company)
      if (!entry?.service_id) {
        console.log('No service ID available, cannot load billing plans');
        setEligibleBillingPlans([]);
      } else if (!companyId) {
        console.log('No company ID available, using default billing plan logic (no specific plans loaded)');
        setEligibleBillingPlans([]);
      } else {
        // Fetch and filter plans only if service and company are known
        try {
          const plans = await getEligibleBillingPlansForUI(companyId, entry.service_id) as EligiblePlanUI[];
          const entryDate = entry.start_time ? new Date(entry.start_time) : new Date(); // Use current date if start_time not set yet

          const filteredPlans = plans.filter(plan => {
            const start = new Date(plan.start_date as string);
            const end = plan.end_date ? new Date(plan.end_date as string) : null;
            // Ensure entryDate is valid before comparison
            return !isNaN(entryDate.getTime()) && start <= entryDate && (!end || end >= entryDate);
          });

          currentEligiblePlans = filteredPlans;
          setEligibleBillingPlans(currentEligiblePlans);
          console.log('Eligible billing plans loaded:', currentEligiblePlans);

          // 3. Set Default Billing Plan (only if plans were loaded)
          const currentBillingPlanId = entry?.billing_plan_id; // Use entry from closure
          if (!currentBillingPlanId && currentEligiblePlans.length > 0) {
            let defaultPlanId: string | null = null;
            if (currentEligiblePlans.length === 1) {
              defaultPlanId = currentEligiblePlans[0].company_billing_plan_id;
              console.log('Setting default billing plan (only one eligible):', defaultPlanId);
            } else {
              const bucketPlans = currentEligiblePlans.filter(plan => plan.plan_type === 'Bucket');
              if (bucketPlans.length === 1) {
                defaultPlanId = bucketPlans[0].company_billing_plan_id;
                console.log('Setting default billing plan (single bucket plan):', defaultPlanId);
              } else {
                console.log('Multiple eligible plans, no single default determined.');
              }
            }

            if (defaultPlanId) {
              const entryWithUpdatedPlan = {
                ...entry, // Includes tax updates already applied
                billing_plan_id: defaultPlanId
              };
              onUpdateEntry(index, entryWithUpdatedPlan);
              // Update the 'entry' variable in this scope
              entry = entryWithUpdatedPlan;
            }
          } else {
            console.log('Billing plan already set or no eligible plans found, skipping default selection.');
          }

        } catch (error) {
          console.error('Error loading eligible billing plans:', error);
          setEligibleBillingPlans([]); // Reset on error
        }
      }
    }

    // Only run if entry exists
    if (entry) {
      loadDataAndSetDefaults();
    }
  }, [entry?.service_id, companyId, entry?.start_time, entry?.billing_plan_id, index, onUpdateEntry]);

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

  const handleSave = useCallback(() => {
    if (!onSave) return;
    
    setShowErrors(true);
    if (!validateTimes()) {
      return;
    }

    const isAdHoc = entry?.work_item_type === 'ad_hoc';

    // Ensure we have required fields (skip for ad_hoc)
    if (!isAdHoc && !entry?.service_id) {
      setValidationErrors(prev => ({
        ...prev,
        service: 'Service is required'
      }));
      return;
    }

    // Billing plan validation removed - billing plan is no longer required

    // Clear any existing validation errors
    setValidationErrors({});

    // Call parent's onSave with the current entry
    onSave(index);
  }, [onSave, validateTimes, entry?.service_id, entry?.work_item_type, showBillingPlanSelector, eligibleBillingPlans.length, entry?.billing_plan_id, index, setShowErrors]);

  const handleTimeChange = useCallback((type: 'start' | 'end', value: string) => {
    if (!isEditable || !entry) return;

    const currentDate = type === 'start' ? parseISO(entry.start_time) : parseISO(entry.end_time);
    const newTime = parseTimeToDate(value, currentDate);

    const updatedEntry = updateBillableDuration(
      {
        ...entry,
        [type === 'start' ? 'start_time' : 'end_time']: formatISO(newTime)
      },
      calculateDuration(
        type === 'start' ? newTime : parseISO(entry.start_time),
        type === 'end' ? newTime : parseISO(entry.end_time)
      )
    );

    onUpdateEntry(index, updatedEntry);
    onUpdateTimeInputs({
      [`${type}-${index}`]: value
    });

    setValidationErrors({});
    if (showErrors) {
      validateTimes();
    }
  }, [isEditable, entry, index, onUpdateEntry, onUpdateTimeInputs, showErrors, validateTimes]);




  const handleDurationChange = useCallback((type: 'hours' | 'minutes', value: number) => {
    if (!entry) return;
    const hours = type === 'hours' ? value : durationHours;
    const minutes = type === 'minutes' ? value : durationMinutes;

    if (hours < 0 || minutes < 0) return; // Silently ignore negative values

    const startTime = parseISO(entry.start_time);
    const totalMinutes = Math.max(1, hours * 60 + minutes); // Enforce minimum 1 minute
    const newEndTime = addMinutes(startTime, totalMinutes);

    const newBillableDuration = entry.billable_duration === 0 ? 0 : totalMinutes;
    
    const updatedEntry = {
      ...entry,
      end_time: formatISO(newEndTime),
      billable_duration: newBillableDuration
    };

    console.log('Duration change:', { 
      hours, 
      minutes, 
      totalMinutes, 
      oldBillableDuration: entry.billable_duration,
      newBillableDuration
    });

    onUpdateEntry(index, updatedEntry);
    onUpdateTimeInputs({
      [`end-${index}`]: formatTimeForInput(newEndTime),
    });

    setValidationErrors({}); // Clear errors on change
    if (showErrors) {
      validateTimes();
    }
  }, [entry, index, durationHours, durationMinutes, onUpdateEntry, onUpdateTimeInputs, validateTimes, showErrors]);

  return (
    <div className="border p-4 rounded">
      {/* Only show delete button and status for existing entries that have been saved */}
      {(entry?.entry_id && !isNewEntry) && (
        <div className="flex justify-end items-center mb-4">
          <div className="flex items-center">
            {entry?.isDirty && (
              <span className="text-yellow-500 text-sm mr-2">Unsaved changes</span>
            )}
          </div>
          <div className="flex space-x-2">
            <Button
              id={`${id}-delete-entry-${index}-btn`}
              onClick={() => onDelete(index)}
              variant="destructive"
              disabled={!isEditable}
            >
              Delete Time Entry
            </Button>
          </div>
        </div>
      )}

      <div className="border p-4 rounded space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Service <span className="text-red-500">*</span></label>
            <CustomSelect
              value={entry?.service_id || ''}
              onValueChange={(value) => {
                if (entry) {
                  const updatedEntry = { ...entry, service_id: value };
                  onUpdateEntry(index, updatedEntry);
                }
              }}
              disabled={!isEditable}
              className="mt-1 w-full"
              options={serviceOptions}
              placeholder="Select a service"
            />
            {showErrors && validationErrors.service && (
              <span className="text-sm text-red-500">{validationErrors.service}</span>
            )}
          </div>



        </div>

        {/* Billing Plan Selector with enhanced guidance */}
        {showBillingPlanSelector && (
          <div>
            {eligibleBillingPlans.length > 1 && (
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-md mb-2">
                <div className="flex items-center">
                  <Info className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" />
                  <p className="text-sm text-blue-700">
                    This service appears in multiple billing plans. You can optionally select which plan to bill against, or leave it blank to use the default.
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center space-x-1">
              <label className={`block text-sm font-medium ${eligibleBillingPlans.length > 1 ? 'text-blue-700' : 'text-gray-700'}`}>
                Billing Plan <span className="text-gray-400 text-xs">(Optional)</span>
              </label>
              <Tooltip content={
                <p className="max-w-xs">
                  {!companyId
                    ? "Company information not available. The system will use the default billing plan."
                    : eligibleBillingPlans.length > 1
                      ? "This service appears in multiple billing plans. You can optionally select which plan to use for this time entry, or leave it blank to use the default billing plan."
                      : eligibleBillingPlans.length === 1
                        ? `This time entry will be billed under the "${eligibleBillingPlans[0].plan_name}" plan.`
                        : "No eligible billing plans found for this service."}
                </p>
              }>
                <InfoCircledIcon className="h-4 w-4 text-gray-500" />
              </Tooltip>
            </div>

            <CustomSelect
              value={entry?.billing_plan_id || ''}
              onValueChange={(value) => {
                if (entry) {
                  const updatedEntry = { ...entry, billing_plan_id: value };
                  onUpdateEntry(index, updatedEntry);
                }
              }}
              disabled={!isEditable || !companyId || eligibleBillingPlans.length <= 1}
              className={`mt-1 w-full ${eligibleBillingPlans.length > 1 ? 'border-blue-300 focus:border-blue-500 focus:ring-blue-500' : ''}`}
              options={eligibleBillingPlans.map(plan => ({
                value: plan.company_billing_plan_id,
                label: `${plan.plan_name} (${plan.plan_type})` // Now plan_type exists on EligiblePlanUI
              }))}
              placeholder={!companyId
                ? "Using default billing plan"
                : eligibleBillingPlans.length === 0
                  ? "No eligible plans"
                  : eligibleBillingPlans.length === 1
                    ? `Using ${eligibleBillingPlans[0].plan_name}`
                      : "Select a billing plan (optional)"}
              />

            {eligibleBillingPlans.length > 1 && (
              <div className="mt-1 text-xs text-gray-600">
                <span className="flex items-center">
                  <Info className="h-3 w-3 text-blue-500 mr-1" />
                  If no plan is selected, the system will use the default billing plan
                </span>
              </div>
            )}

            {showErrors && validationErrors.billingPlan && (
              <span className="text-sm text-red-500">{validationErrors.billingPlan}</span>
            )}
          </div>
        )}
      </div>

      {isNewEntry && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Date <span className="text-red-500">*</span>
          </label>
          <DatePicker
            value={selectedDate}
            onChange={(newDate) => {
              if (!newDate || !entry) return;
              
              setSelectedDate(newDate);
              
              // Update the entry's start and end times to the new date while preserving the time
              const startTime = parseISO(entry.start_time);
              const endTime = parseISO(entry.end_time);
              
              const newStartTime = setSeconds(
                setMinutes(
                  setHours(newDate, startTime.getHours()), 
                  startTime.getMinutes()
                ), 
                startTime.getSeconds()
              );
              
              const newEndTime = setSeconds(
                setMinutes(
                  setHours(newDate, endTime.getHours()), 
                  endTime.getMinutes()
                ), 
                endTime.getSeconds()
              );
              
              onUpdateEntry(index, {
                ...entry,
                start_time: formatISO(newStartTime),
                end_time: formatISO(newEndTime)
              });
            }}
            placeholder="Select date"
            disabled={!isEditable}
            clearable={false}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">Start Time</label>
          <TimePicker
            id={`${id}-start-time-${index}`}
            value={timeInputs[`start-${index}`] || (entry?.start_time ? formatTimeForInput(parseISO(entry.start_time)) : '')}
            onChange={(value) => handleTimeChange('start', value)}
            disabled={!isEditable}
            className="mt-1"
          />
          {showErrors && validationErrors.startTime && (
            <span className="text-sm text-red-500">{validationErrors.startTime}</span>
          )}
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">End Time</label>
          <TimePicker
            id={`${id}-end-time-${index}`}
            value={timeInputs[`end-${index}`] || (entry?.end_time ? formatTimeForInput(parseISO(entry.end_time)) : '')}
            onChange={(value) => handleTimeChange('end', value)}
            disabled={!isEditable}
            className="mt-1"
          />
          {showErrors && validationErrors.endTime && (
            <span className="text-sm text-red-500">{validationErrors.endTime}</span>
          )}
        </div>
      </div>

      <div className="space-y-2 mt-2">
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
              {entry?.billable_duration > 0 ? 'Billable' : 'Non-billable'}
            </span>
            <Switch
              id='billable-duration'
              checked={entry?.billable_duration > 0}
              onCheckedChange={(checked) => {
                if (entry?.start_time && entry?.end_time) {
                  const duration = calculateDuration(
                    parseISO(entry.start_time),
                    parseISO(entry.end_time)
                  );

                  console.log('Toggle billable switch:', { checked, duration });
                  
                  onUpdateEntry(
                    index,
                    checked
                      ? { ...entry, billable_duration: duration }
                      : { ...entry, billable_duration: 0 }
                  );
                }
              }}
              className="data-[state=checked]:bg-primary-500"
            />
          </div>
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium text-gray-700">Notes</label>
        <Input
          id='notes'
          value={entry?.notes || ''}
          onChange={(e) => {
            if (entry) {
              const updatedEntry = { ...entry, notes: e.target.value };
              onUpdateEntry(index, updatedEntry);
            }
          }}
          placeholder="Notes"
          disabled={!isEditable}
          ref={lastNoteInputRef}
          className="mt-1 w-full"
        />
      </div>

      {/* Only show save button for multi-entry editing (when onSave is provided) */}
      {onSave && (
        <div className="flex justify-end mt-4">
          <div className="flex flex-col items-end gap-2">
            {showErrors && validationErrors.duration && (
              <span className="text-sm text-red-500">
                {validationErrors.duration}
              </span>
            )}
            <Button
              id={`${id}-save-entry-${index}-btn`}
              onClick={handleSave}
              variant="default"
              size="default"
              className="w-32"
            >
              Save
            </Button>
          </div>
        </div>
      )}
      
      {/* Show validation errors without button for single entry forms */}
      {!onSave && showErrors && validationErrors.duration && (
        <div className="flex justify-end mt-4">
          <span className="text-sm text-red-500">
            {validationErrors.duration}
          </span>
        </div>
      )}
    </div>
  );
});

export default TimeEntryEditForm;
