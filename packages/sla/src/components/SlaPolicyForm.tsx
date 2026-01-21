'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ISlaPolicy,
  ISlaPolicyInput,
  ISlaPolicyTargetInput,
  ISlaNotificationThresholdInput,
  ISlaPolicyWithTargets,
  IBusinessHoursSchedule,
  SlaNotificationType,
  SlaNotificationChannel
} from '../types';
import {
  createSlaPolicy,
  updateSlaPolicy,
  getSlaPolicyById,
  upsertSlaPolicyTargets,
  upsertSlaNotificationThresholds,
  getBusinessHoursSchedules
} from '../actions';
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { IPriority } from '@alga-psa/types';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Label } from '@alga-psa/ui/components/Label';
import { Plus, Trash2 } from 'lucide-react';

interface SlaPolicyFormProps {
  policyId?: string;  // If provided, edit mode
  onSave?: (policy: ISlaPolicy) => void;
  onCancel?: () => void;
}

interface TargetFormData {
  priority_id: string;
  priority_name: string;
  response_time_minutes: number | null;
  resolution_time_minutes: number | null;
  escalation_1_percent: number;
  escalation_2_percent: number;
  escalation_3_percent: number;
  is_24x7: boolean;
}

interface ThresholdFormData {
  id: string; // Local unique ID for React keys
  threshold_percent: number;
  notification_type: SlaNotificationType;
  notify_assignee: boolean;
  notify_board_manager: boolean;
  notify_escalation_manager: boolean;
  channels: SlaNotificationChannel[];
}

// Predefined time options
const RESPONSE_TIME_OPTIONS: SelectOption[] = [
  { value: '', label: 'No target' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
  { value: '240', label: '4 hours' },
  { value: '480', label: '8 hours' },
  { value: 'custom', label: 'Custom...' }
];

const RESOLUTION_TIME_OPTIONS: SelectOption[] = [
  { value: '', label: 'No target' },
  { value: '60', label: '1 hour' },
  { value: '240', label: '4 hours' },
  { value: '480', label: '8 hours' },
  { value: '1440', label: '24 hours (1 day)' },
  { value: '2880', label: '48 hours (2 days)' },
  { value: '4320', label: '72 hours (3 days)' },
  { value: '10080', label: '168 hours (7 days)' },
  { value: 'custom', label: 'Custom...' }
];

const NOTIFICATION_TYPE_OPTIONS: SelectOption[] = [
  { value: 'warning', label: 'Warning' },
  { value: 'breach', label: 'Breach' }
];

// Default escalation percentages
const DEFAULT_ESCALATION_1 = 70;
const DEFAULT_ESCALATION_2 = 90;
const DEFAULT_ESCALATION_3 = 110;

// Generate unique ID for local use
function generateLocalId(): string {
  return `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function SlaPolicyForm({ policyId, onSave, onCancel }: SlaPolicyFormProps) {
  // Loading and error states
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form data
  const [policyName, setPolicyName] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [businessHoursScheduleId, setBusinessHoursScheduleId] = useState<string>('');

  // Reference data
  const [businessHoursSchedules, setBusinessHoursSchedules] = useState<IBusinessHoursSchedule[]>([]);
  const [priorities, setPriorities] = useState<IPriority[]>([]);

  // Targets data
  const [targets, setTargets] = useState<TargetFormData[]>([]);
  const [customResponseInputs, setCustomResponseInputs] = useState<Record<string, boolean>>({});
  const [customResolutionInputs, setCustomResolutionInputs] = useState<Record<string, boolean>>({});

  // Notification thresholds
  const [thresholds, setThresholds] = useState<ThresholdFormData[]>([]);

  // Validation
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const isEditMode = !!policyId;

  // Load reference data and existing policy if editing
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Load business hours and priorities in parallel
      const [schedules, priorityList] = await Promise.all([
        getBusinessHoursSchedules(),
        getAllPriorities('ticket')
      ]);

      setBusinessHoursSchedules(schedules);
      setPriorities(priorityList);

      if (policyId) {
        // Load existing policy for editing
        const policy = await getSlaPolicyById(policyId);
        if (!policy) {
          setError('SLA policy not found');
          return;
        }

        // Populate form fields
        setPolicyName(policy.policy_name);
        setDescription(policy.description || '');
        setIsDefault(policy.is_default);
        setBusinessHoursScheduleId(policy.business_hours_schedule_id || '');

        // Map existing targets to form data
        const targetMap = new Map<string, typeof policy.targets[number]>(
          policy.targets.map(t => [t.priority_id, t])
        );

        const targetFormData: TargetFormData[] = priorityList.map(priority => {
          const existingTarget = targetMap.get(priority.priority_id);
          return {
            priority_id: priority.priority_id,
            priority_name: priority.priority_name,
            response_time_minutes: existingTarget?.response_time_minutes ?? null,
            resolution_time_minutes: existingTarget?.resolution_time_minutes ?? null,
            escalation_1_percent: existingTarget?.escalation_1_percent ?? DEFAULT_ESCALATION_1,
            escalation_2_percent: existingTarget?.escalation_2_percent ?? DEFAULT_ESCALATION_2,
            escalation_3_percent: existingTarget?.escalation_3_percent ?? DEFAULT_ESCALATION_3,
            is_24x7: existingTarget?.is_24x7 ?? false
          };
        });
        setTargets(targetFormData);

        // Check for custom values not in dropdown options
        const customResponse: Record<string, boolean> = {};
        const customResolution: Record<string, boolean> = {};
        targetFormData.forEach(target => {
          if (target.response_time_minutes !== null) {
            const isStandardOption = RESPONSE_TIME_OPTIONS.some(
              opt => opt.value === String(target.response_time_minutes) && opt.value !== 'custom'
            );
            if (!isStandardOption) {
              customResponse[target.priority_id] = true;
            }
          }
          if (target.resolution_time_minutes !== null) {
            const isStandardOption = RESOLUTION_TIME_OPTIONS.some(
              opt => opt.value === String(target.resolution_time_minutes) && opt.value !== 'custom'
            );
            if (!isStandardOption) {
              customResolution[target.priority_id] = true;
            }
          }
        });
        setCustomResponseInputs(customResponse);
        setCustomResolutionInputs(customResolution);

        // Map notification thresholds
        const thresholdFormData: ThresholdFormData[] = (policy.notification_thresholds || []).map(t => ({
          id: t.threshold_id,
          threshold_percent: t.threshold_percent,
          notification_type: t.notification_type,
          notify_assignee: t.notify_assignee,
          notify_board_manager: t.notify_board_manager,
          notify_escalation_manager: t.notify_escalation_manager,
          channels: t.channels
        }));
        setThresholds(thresholdFormData);
      } else {
        // New policy - initialize targets with empty values for all priorities
        const targetFormData: TargetFormData[] = priorityList.map(priority => ({
          priority_id: priority.priority_id,
          priority_name: priority.priority_name,
          response_time_minutes: null,
          resolution_time_minutes: null,
          escalation_1_percent: DEFAULT_ESCALATION_1,
          escalation_2_percent: DEFAULT_ESCALATION_2,
          escalation_3_percent: DEFAULT_ESCALATION_3,
          is_24x7: false
        }));
        setTargets(targetFormData);

        // Initialize with default thresholds
        setThresholds([
          {
            id: generateLocalId(),
            threshold_percent: 50,
            notification_type: 'warning',
            notify_assignee: true,
            notify_board_manager: false,
            notify_escalation_manager: false,
            channels: ['in_app']
          },
          {
            id: generateLocalId(),
            threshold_percent: 75,
            notification_type: 'warning',
            notify_assignee: true,
            notify_board_manager: true,
            notify_escalation_manager: false,
            channels: ['in_app']
          },
          {
            id: generateLocalId(),
            threshold_percent: 90,
            notification_type: 'warning',
            notify_assignee: true,
            notify_board_manager: true,
            notify_escalation_manager: true,
            channels: ['in_app', 'email']
          },
          {
            id: generateLocalId(),
            threshold_percent: 100,
            notification_type: 'breach',
            notify_assignee: true,
            notify_board_manager: true,
            notify_escalation_manager: true,
            channels: ['in_app', 'email']
          }
        ]);
      }
    } catch (err) {
      console.error('Error loading SLA policy data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, [policyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Validation
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!policyName.trim()) {
      errors.policyName = 'Policy name is required';
    }

    // Check if at least one target has values
    const hasAnyTarget = targets.some(
      t => t.response_time_minutes !== null || t.resolution_time_minutes !== null
    );
    if (!hasAnyTarget) {
      errors.targets = 'At least one priority should have a response or resolution time target';
    }

    // Validate escalation percentages
    for (const target of targets) {
      if (target.escalation_1_percent < 0 || target.escalation_1_percent > 200) {
        errors[`escalation_1_${target.priority_id}`] = 'Must be between 0 and 200';
      }
      if (target.escalation_2_percent < 0 || target.escalation_2_percent > 200) {
        errors[`escalation_2_${target.priority_id}`] = 'Must be between 0 and 200';
      }
      if (target.escalation_3_percent < 0 || target.escalation_3_percent > 200) {
        errors[`escalation_3_${target.priority_id}`] = 'Must be between 0 and 200';
      }
    }

    // Validate thresholds
    for (let i = 0; i < thresholds.length; i++) {
      const threshold = thresholds[i];
      if (threshold.threshold_percent < 0 || threshold.threshold_percent > 200) {
        errors[`threshold_percent_${i}`] = 'Must be between 0 and 200';
      }
      if (threshold.channels.length === 0) {
        errors[`threshold_channels_${i}`] = 'At least one channel is required';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      // Prepare policy input
      const policyInput: ISlaPolicyInput = {
        policy_name: policyName.trim(),
        description: description.trim() || undefined,
        is_default: isDefault,
        business_hours_schedule_id: businessHoursScheduleId || undefined
      };

      let savedPolicy: ISlaPolicy;

      if (isEditMode && policyId) {
        // Update existing policy
        savedPolicy = await updateSlaPolicy(policyId, policyInput);
      } else {
        // Create new policy (without seeding default thresholds since we'll set our own)
        savedPolicy = await createSlaPolicy(policyInput, false);
      }

      // Prepare and save targets
      const targetInputs: ISlaPolicyTargetInput[] = targets
        .filter(t => t.response_time_minutes !== null || t.resolution_time_minutes !== null)
        .map(t => ({
          priority_id: t.priority_id,
          response_time_minutes: t.response_time_minutes ?? undefined,
          resolution_time_minutes: t.resolution_time_minutes ?? undefined,
          escalation_1_percent: t.escalation_1_percent,
          escalation_2_percent: t.escalation_2_percent,
          escalation_3_percent: t.escalation_3_percent,
          is_24x7: t.is_24x7
        }));

      if (targetInputs.length > 0) {
        await upsertSlaPolicyTargets(savedPolicy.sla_policy_id, targetInputs);
      }

      // Prepare and save notification thresholds
      const thresholdInputs: ISlaNotificationThresholdInput[] = thresholds.map(t => ({
        threshold_percent: t.threshold_percent,
        notification_type: t.notification_type,
        notify_assignee: t.notify_assignee,
        notify_board_manager: t.notify_board_manager,
        notify_escalation_manager: t.notify_escalation_manager,
        channels: t.channels
      }));

      await upsertSlaNotificationThresholds(savedPolicy.sla_policy_id, thresholdInputs);

      // Notify parent
      onSave?.(savedPolicy);
    } catch (err) {
      console.error('Error saving SLA policy:', err);
      setError(err instanceof Error ? err.message : 'Failed to save SLA policy');
    } finally {
      setIsSaving(false);
    }
  };

  // Target handlers
  const handleTargetChange = (priorityId: string, field: keyof TargetFormData, value: unknown) => {
    setTargets(prev => prev.map(target => {
      if (target.priority_id !== priorityId) return target;
      return { ...target, [field]: value };
    }));
  };

  const handleResponseTimeSelect = (priorityId: string, value: string) => {
    if (value === 'custom') {
      setCustomResponseInputs(prev => ({ ...prev, [priorityId]: true }));
    } else {
      setCustomResponseInputs(prev => ({ ...prev, [priorityId]: false }));
      handleTargetChange(priorityId, 'response_time_minutes', value === '' ? null : parseInt(value, 10));
    }
  };

  const handleResolutionTimeSelect = (priorityId: string, value: string) => {
    if (value === 'custom') {
      setCustomResolutionInputs(prev => ({ ...prev, [priorityId]: true }));
    } else {
      setCustomResolutionInputs(prev => ({ ...prev, [priorityId]: false }));
      handleTargetChange(priorityId, 'resolution_time_minutes', value === '' ? null : parseInt(value, 10));
    }
  };

  // Threshold handlers
  const addThreshold = () => {
    setThresholds(prev => [
      ...prev,
      {
        id: generateLocalId(),
        threshold_percent: 50,
        notification_type: 'warning',
        notify_assignee: true,
        notify_board_manager: false,
        notify_escalation_manager: false,
        channels: ['in_app']
      }
    ]);
  };

  const removeThreshold = (id: string) => {
    setThresholds(prev => prev.filter(t => t.id !== id));
  };

  const handleThresholdChange = (id: string, field: keyof ThresholdFormData, value: unknown) => {
    setThresholds(prev => prev.map(threshold => {
      if (threshold.id !== id) return threshold;
      return { ...threshold, [field]: value };
    }));
  };

  const toggleThresholdChannel = (id: string, channel: SlaNotificationChannel) => {
    setThresholds(prev => prev.map(threshold => {
      if (threshold.id !== id) return threshold;
      const hasChannel = threshold.channels.includes(channel);
      return {
        ...threshold,
        channels: hasChannel
          ? threshold.channels.filter(c => c !== channel)
          : [...threshold.channels, channel]
      };
    }));
  };

  // Business hours options for dropdown
  const businessHoursOptions: SelectOption[] = [
    { value: '', label: 'No business hours (24/7)' },
    ...businessHoursSchedules.map(schedule => ({
      value: schedule.schedule_id,
      label: schedule.schedule_name + (schedule.is_24x7 ? ' (24/7)' : '')
    }))
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
          {error}
        </div>
      )}

      {/* Basic Info Section */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Input
              id="sla-policy-name"
              label="Policy Name"
              value={policyName}
              onChange={(e) => setPolicyName(e.target.value)}
              placeholder="Enter policy name"
              required
              error={validationErrors.policyName}
            />
          </div>

          <div>
            <TextArea
              id="sla-policy-description"
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description of this SLA policy"
            />
          </div>

          <div className="flex items-center gap-4">
            <Checkbox
              id="sla-policy-is-default"
              label="Set as default policy"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
          </div>

          <div>
            <CustomSelect
              id="sla-policy-business-hours"
              label="Business Hours Schedule"
              options={businessHoursOptions}
              value={businessHoursScheduleId}
              onValueChange={setBusinessHoursScheduleId}
              placeholder="Select business hours schedule"
              allowClear
            />
          </div>
        </CardContent>
      </Card>

      {/* Response/Resolution Targets Section */}
      <Card>
        <CardHeader>
          <CardTitle>Response and Resolution Targets</CardTitle>
        </CardHeader>
        <CardContent>
          {validationErrors.targets && (
            <div className="mb-4 text-sm text-red-600">{validationErrors.targets}</div>
          )}

          <div className="space-y-6">
            {targets.map((target) => (
              <div
                key={target.priority_id}
                className="border border-gray-200 rounded-lg p-4 bg-gray-50"
              >
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-medium text-gray-900">{target.priority_name}</h4>
                  <Checkbox
                    id={`sla-target-24x7-${target.priority_id}`}
                    label="24/7 (ignore business hours)"
                    checked={target.is_24x7}
                    onChange={(e) => handleTargetChange(target.priority_id, 'is_24x7', e.target.checked)}
                    containerClassName="mb-0"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Response Time */}
                  <div>
                    <Label className="mb-1 block">Response Time</Label>
                    {customResponseInputs[target.priority_id] ? (
                      <div className="flex items-center gap-2">
                        <Input
                          id={`sla-target-response-custom-${target.priority_id}`}
                          type="number"
                          min={1}
                          value={target.response_time_minutes ?? ''}
                          onChange={(e) => handleTargetChange(
                            target.priority_id,
                            'response_time_minutes',
                            e.target.value === '' ? null : parseInt(e.target.value, 10)
                          )}
                          placeholder="Minutes"
                          className="w-32"
                        />
                        <span className="text-sm text-gray-500">minutes</span>
                        <Button
                          id={`sla-target-response-preset-${target.priority_id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => setCustomResponseInputs(prev => ({ ...prev, [target.priority_id]: false }))}
                        >
                          Use preset
                        </Button>
                      </div>
                    ) : (
                      <CustomSelect
                        id={`sla-target-response-${target.priority_id}`}
                        options={RESPONSE_TIME_OPTIONS}
                        value={target.response_time_minutes === null ? '' : String(target.response_time_minutes)}
                        onValueChange={(value) => handleResponseTimeSelect(target.priority_id, value)}
                        placeholder="Select response time"
                      />
                    )}
                  </div>

                  {/* Resolution Time */}
                  <div>
                    <Label className="mb-1 block">Resolution Time</Label>
                    {customResolutionInputs[target.priority_id] ? (
                      <div className="flex items-center gap-2">
                        <Input
                          id={`sla-target-resolution-custom-${target.priority_id}`}
                          type="number"
                          min={1}
                          value={target.resolution_time_minutes ?? ''}
                          onChange={(e) => handleTargetChange(
                            target.priority_id,
                            'resolution_time_minutes',
                            e.target.value === '' ? null : parseInt(e.target.value, 10)
                          )}
                          placeholder="Minutes"
                          className="w-32"
                        />
                        <span className="text-sm text-gray-500">minutes</span>
                        <Button
                          id={`sla-target-resolution-preset-${target.priority_id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => setCustomResolutionInputs(prev => ({ ...prev, [target.priority_id]: false }))}
                        >
                          Use preset
                        </Button>
                      </div>
                    ) : (
                      <CustomSelect
                        id={`sla-target-resolution-${target.priority_id}`}
                        options={RESOLUTION_TIME_OPTIONS}
                        value={target.resolution_time_minutes === null ? '' : String(target.resolution_time_minutes)}
                        onValueChange={(value) => handleResolutionTimeSelect(target.priority_id, value)}
                        placeholder="Select resolution time"
                      />
                    )}
                  </div>
                </div>

                {/* Escalation Percentages */}
                <div className="mt-4">
                  <Label className="mb-2 block text-sm text-gray-600">Escalation Thresholds (% of time elapsed)</Label>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Input
                        id={`sla-target-escalation-1-${target.priority_id}`}
                        type="number"
                        min={0}
                        max={200}
                        value={target.escalation_1_percent}
                        onChange={(e) => handleTargetChange(
                          target.priority_id,
                          'escalation_1_percent',
                          parseInt(e.target.value, 10) || 0
                        )}
                        label="Level 1 (%)"
                        error={validationErrors[`escalation_1_${target.priority_id}`]}
                      />
                    </div>
                    <div>
                      <Input
                        id={`sla-target-escalation-2-${target.priority_id}`}
                        type="number"
                        min={0}
                        max={200}
                        value={target.escalation_2_percent}
                        onChange={(e) => handleTargetChange(
                          target.priority_id,
                          'escalation_2_percent',
                          parseInt(e.target.value, 10) || 0
                        )}
                        label="Level 2 (%)"
                        error={validationErrors[`escalation_2_${target.priority_id}`]}
                      />
                    </div>
                    <div>
                      <Input
                        id={`sla-target-escalation-3-${target.priority_id}`}
                        type="number"
                        min={0}
                        max={200}
                        value={target.escalation_3_percent}
                        onChange={(e) => handleTargetChange(
                          target.priority_id,
                          'escalation_3_percent',
                          parseInt(e.target.value, 10) || 0
                        )}
                        label="Level 3 (%)"
                        error={validationErrors[`escalation_3_${target.priority_id}`]}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Notification Thresholds Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Notification Thresholds</CardTitle>
            <Button
              id="sla-add-threshold"
              variant="outline"
              size="sm"
              onClick={addThreshold}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Threshold
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {thresholds.length === 0 ? (
            <div className="text-center text-gray-500 py-4">
              No notification thresholds configured. Click "Add Threshold" to create one.
            </div>
          ) : (
            <div className="space-y-4">
              {thresholds.map((threshold, index) => (
                <div
                  key={threshold.id}
                  className="border border-gray-200 rounded-lg p-4 bg-gray-50"
                >
                  <div className="flex items-start justify-between mb-4">
                    <h4 className="font-medium text-gray-900">Threshold {index + 1}</h4>
                    <Button
                      id={`sla-remove-threshold-${index}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => removeThreshold(threshold.id)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <Input
                        id={`sla-threshold-percent-${index}`}
                        type="number"
                        min={0}
                        max={200}
                        value={threshold.threshold_percent}
                        onChange={(e) => handleThresholdChange(
                          threshold.id,
                          'threshold_percent',
                          parseInt(e.target.value, 10) || 0
                        )}
                        label="Threshold (%)"
                        error={validationErrors[`threshold_percent_${index}`]}
                      />
                    </div>
                    <div>
                      <CustomSelect
                        id={`sla-threshold-type-${index}`}
                        label="Notification Type"
                        options={NOTIFICATION_TYPE_OPTIONS}
                        value={threshold.notification_type}
                        onValueChange={(value) => handleThresholdChange(
                          threshold.id,
                          'notification_type',
                          value as SlaNotificationType
                        )}
                      />
                    </div>
                  </div>

                  <div className="mb-4">
                    <Label className="mb-2 block text-sm text-gray-600">Recipients</Label>
                    <div className="flex flex-wrap gap-4">
                      <Checkbox
                        id={`sla-threshold-notify-assignee-${index}`}
                        label="Assignee"
                        checked={threshold.notify_assignee}
                        onChange={(e) => handleThresholdChange(
                          threshold.id,
                          'notify_assignee',
                          e.target.checked
                        )}
                        containerClassName="mb-0"
                      />
                      <Checkbox
                        id={`sla-threshold-notify-board-manager-${index}`}
                        label="Board Manager"
                        checked={threshold.notify_board_manager}
                        onChange={(e) => handleThresholdChange(
                          threshold.id,
                          'notify_board_manager',
                          e.target.checked
                        )}
                        containerClassName="mb-0"
                      />
                      <Checkbox
                        id={`sla-threshold-notify-escalation-manager-${index}`}
                        label="Escalation Manager"
                        checked={threshold.notify_escalation_manager}
                        onChange={(e) => handleThresholdChange(
                          threshold.id,
                          'notify_escalation_manager',
                          e.target.checked
                        )}
                        containerClassName="mb-0"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="mb-2 block text-sm text-gray-600">
                      Notification Channels
                      {validationErrors[`threshold_channels_${index}`] && (
                        <span className="text-red-600 ml-2">{validationErrors[`threshold_channels_${index}`]}</span>
                      )}
                    </Label>
                    <div className="flex gap-4">
                      <Checkbox
                        id={`sla-threshold-channel-in-app-${index}`}
                        label="In-App"
                        checked={threshold.channels.includes('in_app')}
                        onChange={() => toggleThresholdChannel(threshold.id, 'in_app')}
                        containerClassName="mb-0"
                      />
                      <Checkbox
                        id={`sla-threshold-channel-email-${index}`}
                        label="Email"
                        checked={threshold.channels.includes('email')}
                        onChange={() => toggleThresholdChannel(threshold.id, 'email')}
                        containerClassName="mb-0"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Form Actions */}
      <div className="flex justify-end gap-3">
        <Button
          id="sla-policy-cancel"
          variant="outline"
          onClick={onCancel}
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button
          id="sla-policy-save"
          onClick={handleSubmit}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : isEditMode ? 'Save Changes' : 'Create Policy'}
        </Button>
      </div>
    </div>
  );
}

export default SlaPolicyForm;
