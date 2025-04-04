'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { getEligibleBillingPlansForUI, getCompanyIdForWorkItem } from 'server/src/lib/utils/planDisambiguation';
import { formatISO, parseISO, addMinutes } from 'date-fns';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { Switch } from 'server/src/components/ui/Switch';
import { TimePicker } from 'server/src/components/ui/TimePicker';
import { MinusCircle, XCircle, AlertTriangle, Info } from 'lucide-react';
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
  services,
  taxRegions,
  timeInputs,
  totalDuration,
  onSave,
  onDelete,
  onUpdateEntry,
  onUpdateTimeInputs,
  lastNoteInputRef
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
  },[]);

  const taxRegionOptions = useMemo(() =>
    taxRegions.map((region): { value: string; label: string } => ({
      value: region.name,
      label: region.name
    })),
    []
  );

  const selectedService = useMemo(() =>
    services.find(s => s.id === entry?.service_id),
    [entry?.service_id]
  );

  const [validationErrors, setValidationErrors] = useState<{
    startTime?: string;
    endTime?: string;
    duration?: string;
    service?: string;
    taxRegion?: string;
    billingPlan?: string;
  }>({});

  const [showErrors, setShowErrors] = useState(false);
  // Use a more complete type that includes dates
  const [eligibleBillingPlans, setEligibleBillingPlans] = useState<EligiblePlanUI[]>([]);
  const [showBillingPlanSelector, setShowBillingPlanSelector] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);

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
      newErrors.duration = 'Duration must be greater than 0';
    }

    setValidationErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [entry?.start_time, entry?.end_time]);

  // Get company ID from entry
  useEffect(() => {
    if (entry?.company_id) {
      console.log('Using company ID from entry:', entry.company_id);
      setCompanyId(entry.company_id);
    } else {
      console.log('No company ID in entry, will use default billing plan');
      setCompanyId(null);
    }
  }, [entry?.company_id]);

  // Load eligible billing plans when service or company ID changes
  useEffect(() => {
    const loadEligibleBillingPlans = async () => {
      // Always show the plan selector
      setShowBillingPlanSelector(true);

      if (!entry?.service_id) {
        console.log('No service ID available, cannot load billing plans');
        setEligibleBillingPlans([]);
        return;
      }

      if (!companyId) {
        console.log('No company ID available, using default billing plan');
        setEligibleBillingPlans([]);
        return;
      }

      try {
        // Assume the function returns the necessary fields, cast to our defined type
        // Assume the function returns the necessary fields, cast to our defined type
        const plans = await getEligibleBillingPlansForUI(companyId, entry.service_id) as EligiblePlanUI[];

        // Filter plans based on the entry date being within the plan's active range
        const entryDate = new Date(entry.start_time);
        const filteredPlans = plans.filter(plan => {
          // Ensure start_date is treated as a string before parsing
          const start = new Date(plan.start_date as string);
          // Handle potentially null end_date
          const end = plan.end_date ? new Date(plan.end_date as string) : null;
          return start <= entryDate && (!end || end >= entryDate);
        });

        setEligibleBillingPlans(filteredPlans);

        // If no plan is selected yet, try to set a default
        if (!entry.billing_plan_id) {
          if (plans.length === 1) {
            // If there's only one plan, use it automatically
            const updatedEntry = { ...entry, billing_plan_id: plans[0].company_billing_plan_id };
            onUpdateEntry(index, updatedEntry);
          } else if (plans.length > 1) {
            // Check for bucket plans first
            const bucketPlans = plans.filter(plan => plan.plan_type === 'Bucket');
            if (bucketPlans.length === 1) {
              // If there's only one bucket plan, use it as default
              const updatedEntry = { ...entry, billing_plan_id: bucketPlans[0].company_billing_plan_id };
              onUpdateEntry(index, updatedEntry);
            }
          }
        }
      } catch (error) {
        console.error('Error loading eligible billing plans:', error);
      }
    };

    loadEligibleBillingPlans();
  }, [entry?.service_id, companyId, entry?.billing_plan_id, index, onUpdateEntry, entry]);

  const updateBillableDuration = useCallback((updatedEntry: typeof entry, newDuration: number) => {
    // If entry is billable, update duration. Otherwise keep it at 0
    return {
      ...updatedEntry,
      billable_duration: updatedEntry.billable_duration > 0 ? Math.max(1, newDuration) : 0
    };
  }, []);

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
    onUpdateTimeInputs({ [`${type}-${index}`]: formatTimeForInput(newTime) });

    setValidationErrors({}); // Clear errors on change
    if (showErrors) {
      validateTimes();
    }
  }, [isEditable, entry, index, onUpdateEntry, onUpdateTimeInputs, validateTimes, updateBillableDuration, showErrors]);

  const handleSave = useCallback((index: number) => {
    setShowErrors(true);
    if (!validateTimes()) {
      return;
    }

    // Ensure we have required fields
    if (!entry?.service_id) {
      setValidationErrors(prev => ({
        ...prev,
        service: 'Service is required'
      }));
      return;
    }

    const selectedService = services.find(s => s.id === entry?.service_id);
    if (selectedService?.is_taxable && !entry?.tax_region) {
      setValidationErrors(prev => ({
        ...prev,
        taxRegion: 'Tax region is required for taxable services'
      }));
      return;
    }

    // Validate billing plan selection if multiple plans are available
    if (showBillingPlanSelector && eligibleBillingPlans.length > 1 && !entry?.billing_plan_id) {
      setValidationErrors(prev => ({
        ...prev,
        billingPlan: 'Billing plan is required when multiple plans are available'
      }));
      return;
    }

    // Clear any existing validation errors
    setValidationErrors({});

    // Call parent's onSave with the current entry
    onSave(index);
  }, [onSave, validateTimes]);

  const handleDurationChange = useCallback((type: 'hours' | 'minutes', value: number) => {
    if (!entry) return;
    const hours = type === 'hours' ? value : durationHours;
    const minutes = type === 'minutes' ? value : durationMinutes;

    if (hours < 0 || minutes < 0) return; // Silently ignore negative values

    const startTime = parseISO(entry.start_time);
    const newEndTime = addMinutes(startTime, hours * 60 + minutes);
    const totalMinutes = hours * 60 + minutes;

    const updatedEntry = updateBillableDuration(
      {
        ...entry,
        end_time: formatISO(newEndTime)
      },
      totalMinutes
    );

    onUpdateEntry(index, updatedEntry);
    onUpdateTimeInputs({
      [`end-${index}`]: formatTimeForInput(newEndTime),
    });

    setValidationErrors({}); // Clear errors on change
    if (showErrors) {
      validateTimes();
    }
  }, [entry, index, durationHours, durationMinutes, onUpdateEntry, onUpdateTimeInputs, validateTimes, updateBillableDuration, showErrors]);

  return (
    <div className="border p-4 rounded">
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
          >
            Delete Time Entry
          </Button>
        </div>
      </div>

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
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Tax Region {selectedService?.is_taxable && <span className="text-red-500">*</span>}
            </label>
            <CustomSelect
              value={entry?.tax_region || ''}
              onValueChange={(value) => {
                if (entry) {
                  const updatedEntry = { ...entry, tax_region: value };
                  onUpdateEntry(index, updatedEntry);
                }
              }}
              disabled={!isEditable || !selectedService?.is_taxable}
              className="mt-1 w-full"
              options={taxRegionOptions}
              placeholder="Select a tax region"
            />
            {showErrors && validationErrors.taxRegion && (
              <span className="text-sm text-red-500">{validationErrors.taxRegion}</span>
            )}
          </div>

          {/* Billing Plan Selector with enhanced guidance */}
          {showBillingPlanSelector && (
            <div>
              {eligibleBillingPlans.length > 1 && (
                <div className="p-3 bg-blue-50 border border-blue-100 rounded-md mb-2">
                  <div className="flex items-center">
                    <Info className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" />
                    <p className="text-sm text-blue-700">
                      This service appears in multiple billing plans. Please select which plan to bill against.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-center space-x-1">
                <label className={`block text-sm font-medium ${eligibleBillingPlans.length > 1 ? 'text-blue-700' : 'text-gray-700'}`}>
                  Billing Plan <span className="text-red-500">*</span>
                </label>
                <Tooltip content={
                  <p className="max-w-xs">
                    {!companyId
                      ? "Company information not available. The system will use the default billing plan."
                      : eligibleBillingPlans.length > 1
                        ? "This service appears in multiple billing plans. Please select which plan to use for this time entry. Bucket plans are typically used first until depleted."
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
                      : "Select a billing plan"}
              />

              {eligibleBillingPlans.length > 1 && (
                <div className="mt-1 text-xs text-gray-600">
                  <span className="flex items-center">
                    <AlertTriangle className="h-3 w-3 text-amber-500 mr-1" />
                    Selecting the wrong plan may result in incorrect billing
                  </span>
                </div>
              )}

              {showErrors && validationErrors.billingPlan && (
                <span className="text-sm text-red-500">{validationErrors.billingPlan}</span>
              )}
            </div>
          )}
        </div>

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

                    onUpdateEntry(
                      index,
                      checked
                        ? updateBillableDuration({ ...entry, billable_duration: 1 }, duration)
                        : { ...entry, billable_duration: 0 }
                    );
                  }
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

        <div className="flex justify-end mt-4">
          <div className="flex flex-col items-end gap-2">
            {showErrors && validationErrors.duration && (
              <span className="text-sm text-red-500">
                {validationErrors.duration}
              </span>
            )}
            <Button
              id={`${id}-save-entry-${index}-btn`}
              onClick={() => handleSave(index)}
              variant="default"
              size="default"
              className="w-32"
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default TimeEntryEditForm;
