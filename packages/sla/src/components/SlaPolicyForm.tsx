'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  getBusinessHoursSchedules,
  getSlaPolicyUsage,
  updateSlaPolicyBoardAssignments,
  updateSlaPolicyClientAssignments
} from '../actions';
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { getAllBoards } from '@alga-psa/tickets/actions';
import { getAllClients } from '@alga-psa/clients/actions';
import { IPriority } from '@alga-psa/types';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Label } from '@alga-psa/ui/components/Label';
import ClientAvatar from '@alga-psa/ui/components/ClientAvatar';
import { Plus, Trash2, ChevronDown, Search } from 'lucide-react';
import * as Accordion from '@radix-ui/react-accordion';

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

// Format minutes into human-readable time
function formatMinutesDisplay(minutes: number | null): string {
  if (minutes === null) return 'No target';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (remainingHours > 0) return `${days}d ${remainingHours}h`;
  return `${days}d`;
}

// ---------------------------------------------------------------------------
// Dropdown multi-select picker (similar to MultiUserPicker pattern)
// ---------------------------------------------------------------------------
interface MultiSelectPanelItem {
  id: string;
  label: string;
  render?: React.ReactNode;
}

interface MultiSelectPanelProps {
  id: string;
  label: string;
  placeholder?: string;
  searchPlaceholder?: string;
  items: MultiSelectPanelItem[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
}

function MultiSelectPanel({ id, label, placeholder, searchPlaceholder, items, selectedIds, onSelectedIdsChange }: MultiSelectPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [dropdownCoords, setDropdownCoords] = useState({ top: 0, left: 0, width: 250 });

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(i => i.label.toLowerCase().includes(q));
  }, [items, search]);

  const selectedItems = useMemo(() => items.filter(i => selectedIds.includes(i.id)), [items, selectedIds]);

  // Position dropdown
  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setDropdownCoords({
      top: rect.bottom + 2,
      left: rect.left,
      width: Math.max(rect.width, 280),
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, updatePosition]);

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!dropdownRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [isOpen]);

  const handleSelectAll = () => {
    const filteredIds = filtered.map(i => i.id);
    onSelectedIdsChange(Array.from(new Set([...selectedIds, ...filteredIds])));
  };

  const handleDeselectAll = () => {
    const filteredIds = new Set(filtered.map(i => i.id));
    onSelectedIdsChange(selectedIds.filter(id => !filteredIds.has(id)));
  };

  const handleToggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectedIdsChange(selectedIds.filter(sid => sid !== id));
    } else {
      onSelectedIdsChange([...selectedIds, id]);
    }
  };

  const triggerLabel = selectedItems.length === 0
    ? placeholder || 'Select...'
    : `${selectedItems.length} selected`;

  const dropdownContent = (
    <div
      ref={dropdownRef}
      className="fixed z-50"
      style={{ top: dropdownCoords.top, left: dropdownCoords.left, width: dropdownCoords.width }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bg-white dark:bg-[rgb(var(--color-card))] rounded-md shadow-lg border border-gray-200 dark:border-[rgb(var(--color-border-200))] overflow-hidden">
        {/* Search */}
        <div className="p-2 border-b border-gray-200 dark:border-[rgb(var(--color-border-200))]">
          <div className="relative">
            <Input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder || 'Search...'}
              className="pl-8 h-8 text-sm"
              autoComplete="off"
            />
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Select all / Deselect all */}
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-200 dark:border-[rgb(var(--color-border-200))] text-xs text-gray-500">
          <button type="button" onClick={handleSelectAll} className="hover:text-gray-900 underline">
            Select all{search ? ' visible' : ''}
          </button>
          <button type="button" onClick={handleDeselectAll} className="hover:text-gray-900 underline">
            Deselect all{search ? ' visible' : ''}
          </button>
          <span className="ml-auto">{selectedIds.length} selected</span>
        </div>

        {/* Checkbox list */}
        <div
          className="max-h-[280px] overflow-y-auto p-1"
          onWheel={(e) => {
            const el = e.currentTarget;
            const { scrollTop, scrollHeight, clientHeight } = el;
            const atTop = scrollTop === 0 && e.deltaY < 0;
            const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0;
            if (atTop || atBottom) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-500 text-center">
              {search ? 'No results found' : 'No items available'}
            </div>
          ) : (
            filtered.map(item => (
              <div
                key={item.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-[rgb(var(--color-border-100))] ${
                  selectedIds.includes(item.id) ? 'bg-gray-50 dark:bg-[rgb(var(--color-border-50))]' : ''
                }`}
                onClick={() => handleToggle(item.id)}
              >
                <Checkbox
                  id={`msp-${item.id}`}
                  checked={selectedIds.includes(item.id)}
                  onChange={() => handleToggle(item.id)}
                  containerClassName="flex items-center"
                />
                {item.render ?? <span className="text-sm truncate">{item.label}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <Label className="mb-1 block">{label}</Label>
      <Button
        id={id}
        ref={buttonRef}
        type="button"
        variant="outline"
        onClick={() => { setIsOpen(!isOpen); setSearch(''); }}
        className="w-full justify-between min-h-[38px] h-auto"
      >
        <span className={selectedItems.length === 0 ? 'text-gray-500' : ''}>
          {triggerLabel}
        </span>
        <ChevronDown className={`h-4 w-4 text-gray-500 ml-2 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </Button>
      {isOpen && typeof document !== 'undefined' && createPortal(dropdownContent, document.body)}
    </div>
  );
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
  const [allBoards, setAllBoards] = useState<{ board_id: string; name: string }[]>([]);
  const [allClients, setAllClients] = useState<{ client_id: string; client_name: string; logoUrl: string | null }[]>([]);

  // Board/client assignments
  const [selectedBoardIds, setSelectedBoardIds] = useState<string[]>([]);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);

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
      // Load reference data in parallel
      const [schedules, priorityList, boardsList, clientsList] = await Promise.all([
        getBusinessHoursSchedules(),
        getAllPriorities('ticket'),
        getAllBoards(true).then(boards => boards
          .filter((b): b is typeof b & { board_id: string; board_name: string } => !!b.board_id && !!b.board_name)
          .map(b => ({ board_id: b.board_id, name: b.board_name }))),
        getAllClients(false).then(clients => clients.map(c => ({ client_id: c.client_id, client_name: c.client_name, logoUrl: (c as any).logoUrl ?? null })))
      ]);

      setBusinessHoursSchedules(schedules);
      setPriorities(priorityList);
      setAllBoards(boardsList);
      setAllClients(clientsList);

      if (policyId) {
        // Load existing policy and current assignments in parallel
        const [policy, usage] = await Promise.all([
          getSlaPolicyById(policyId),
          getSlaPolicyUsage(policyId)
        ]);
        if (!policy) {
          setError('SLA policy not found');
          return;
        }

        // Populate form fields
        setPolicyName(policy.policy_name);
        setDescription(policy.description || '');
        setIsDefault(policy.is_default);
        setBusinessHoursScheduleId(policy.business_hours_schedule_id || '');

        // Populate board/client assignments
        setSelectedBoardIds(usage.boards.map(b => b.board_id));
        setSelectedClientIds(usage.clients.map(c => c.client_id));

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
    const seenPercents = new Set<number>();
    for (let i = 0; i < thresholds.length; i++) {
      const threshold = thresholds[i];
      if (threshold.threshold_percent < 0 || threshold.threshold_percent > 200) {
        errors[`threshold_percent_${i}`] = 'Must be between 0 and 200';
      }
      if (seenPercents.has(threshold.threshold_percent)) {
        errors[`threshold_percent_${i}`] = 'Duplicate threshold percentage';
      }
      seenPercents.add(threshold.threshold_percent);
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

      // Save board and client assignments
      await Promise.all([
        updateSlaPolicyBoardAssignments(savedPolicy.sla_policy_id, selectedBoardIds),
        updateSlaPolicyClientAssignments(savedPolicy.sla_policy_id, selectedClientIds)
      ]);

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
          {/* Name + Default checkbox */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              id="sla-policy-name"
              label="Policy Name"
              value={policyName}
              onChange={(e) => setPolicyName(e.target.value)}
              placeholder="Enter policy name"
              required
              error={validationErrors.policyName}
            />
            <Checkbox
              id="sla-policy-is-default"
              label="Set as default policy"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              containerClassName="flex items-center gap-2 md:mt-7"
            />
          </div>

          <TextArea
            id="sla-policy-description"
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description of this SLA policy"
            className="max-w-none"
          />

          <CustomSelect
            id="sla-policy-business-hours"
            label="Business Hours Schedule"
            options={businessHoursOptions}
            value={businessHoursScheduleId}
            onValueChange={setBusinessHoursScheduleId}
            placeholder="Select business hours schedule"
            allowClear
          />

          {/* Board & Client assignments - two columns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Board assignment */}
            <MultiSelectPanel
              id="sla-policy-boards"
              label="Assign to Boards"
              searchPlaceholder="Search boards..."
              items={allBoards.map(b => ({ id: b.board_id, label: b.name }))}
              selectedIds={selectedBoardIds}
              onSelectedIdsChange={setSelectedBoardIds}
            />

            {/* Client assignment */}
            <MultiSelectPanel
              id="sla-policy-clients"
              label="Assign to Clients"
              searchPlaceholder="Search clients..."
              items={allClients.map(c => ({
                id: c.client_id,
                label: c.client_name,
                render: (
                  <div className="flex items-center gap-2 min-w-0">
                    <ClientAvatar clientId={c.client_id} clientName={c.client_name} logoUrl={c.logoUrl} size="xs" />
                    <span className="text-sm truncate">{c.client_name}</span>
                  </div>
                )
              }))}
              selectedIds={selectedClientIds}
              onSelectedIdsChange={setSelectedClientIds}
            />
          </div>
        </CardContent>
      </Card>

      {/* Response/Resolution Targets Section */}
      <Card>
        <CardHeader>
          <CardTitle>Response and Resolution Targets</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Set the maximum time allowed to first respond to and fully resolve tickets for each priority level.
          </p>
        </CardHeader>
        <CardContent>
          {validationErrors.targets && (
            <div className="mb-4 text-sm text-red-600">{validationErrors.targets}</div>
          )}

          <Accordion.Root type="multiple" className="w-full space-y-2">
            {targets.map((target) => {
              const hasTargets = target.response_time_minutes !== null || target.resolution_time_minutes !== null;
              return (
                <Accordion.Item
                  key={target.priority_id}
                  value={target.priority_id}
                  className="border border-border rounded-lg overflow-hidden"
                >
                  <Accordion.Header className="flex">
                    <Accordion.Trigger
                      id={`sla-target-trigger-${target.priority_id}`}
                      className="flex flex-1 items-center justify-between p-4 font-medium transition-all hover:bg-muted/50 [&[data-state=open]>svg.chevron]:rotate-180 bg-gray-50"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-medium text-foreground">{target.priority_name}</span>
                        {hasTargets ? (
                          <div className="flex items-center gap-3 text-sm text-muted-foreground">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded text-xs font-medium">
                              Response: {formatMinutesDisplay(target.response_time_minutes)}
                            </span>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-success/10 text-success rounded text-xs font-medium">
                              Resolution: {formatMinutesDisplay(target.resolution_time_minutes)}
                            </span>
                            {target.is_24x7 && (
                              <span className="inline-flex items-center px-2 py-0.5 bg-secondary/10 text-secondary rounded text-xs font-medium">
                                24/7
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Not configured</span>
                        )}
                      </div>
                      <ChevronDown className="chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
                    </Accordion.Trigger>
                  </Accordion.Header>
                  <Accordion.Content className="overflow-hidden data-[state=closed]:hidden">
                    <div className="p-4 border-t border-border space-y-4">
                      <div className="flex justify-end">
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
                      <div>
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
                  </Accordion.Content>
                </Accordion.Item>
              );
            })}
          </Accordion.Root>
        </CardContent>
      </Card>

      {/* Notification Thresholds Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Notification Thresholds</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Configure when and how to notify team members as SLA deadlines approach or are breached.
              </p>
            </div>
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
              No notification thresholds configured. Click &quot;Add Threshold&quot; to create one.
            </div>
          ) : (
            <Accordion.Root type="multiple" className="w-full space-y-2">
              {thresholds.map((threshold, index) => {
                const recipients = [
                  threshold.notify_assignee && 'Assignee',
                  threshold.notify_board_manager && 'Board Mgr',
                  threshold.notify_escalation_manager && 'Escalation Mgr'
                ].filter(Boolean);
                const channels = threshold.channels.map(c => c === 'in_app' ? 'In-App' : 'Email');

                return (
                  <Accordion.Item
                    key={threshold.id}
                    value={threshold.id}
                    className="border border-border rounded-lg overflow-hidden"
                  >
                    <Accordion.Header className="flex">
                      <Accordion.Trigger
                        id={`sla-threshold-trigger-${index}`}
                        className="flex flex-1 items-center justify-between p-4 font-medium transition-all hover:bg-muted/50 [&[data-state=open]>svg.chevron]:rotate-180 bg-gray-50"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                            threshold.notification_type === 'breach'
                              ? 'bg-error/10 text-error'
                              : 'bg-warning/10 text-warning'
                          }`}>
                            {threshold.threshold_percent}% {threshold.notification_type}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {recipients.join(', ') || 'No recipients'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            via {channels.join(', ') || 'none'}
                          </span>
                        </div>
                        <ChevronDown className="chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
                      </Accordion.Trigger>
                    </Accordion.Header>
                    <Accordion.Content className="overflow-hidden data-[state=closed]:hidden">
                      <div className="p-4 border-t border-border space-y-4">
                        <div className="flex justify-end">
                          <Button
                            id={`sla-remove-threshold-${index}`}
                            variant="ghost"
                            size="sm"
                            onClick={() => removeThreshold(threshold.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            Remove
                          </Button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

                        <div>
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
                    </Accordion.Content>
                  </Accordion.Item>
                );
              })}
            </Accordion.Root>
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
