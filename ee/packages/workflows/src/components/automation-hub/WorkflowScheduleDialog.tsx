'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Badge } from '@alga-psa/ui/components/Badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@alga-psa/ui/components/Dialog';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import { TimePicker } from '@alga-psa/ui/components/TimePicker';
import { DateTimePicker } from '@alga-psa/ui/components/DateTimePicker';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  createWorkflowScheduleAction as createWorkflowScheduleActionDefault,
  getWorkflowScheduleAction as getWorkflowScheduleActionDefault,
  getWorkflowSchemaAction,
  listWorkflowScheduleBusinessHoursAction as listWorkflowScheduleBusinessHoursActionDefault,
  listWorkflowDefinitionsPagedAction,
  listWorkflowSchemaRefsAction,
  updateWorkflowScheduleAction as updateWorkflowScheduleActionDefault
} from '@alga-psa/workflows/actions';
import {
  buildCronFromRecurringBuilder,
  DEFAULT_RECURRING_BUILDER_STATE,
  getRecurringBuilderSummary,
  getRecurringBuilderValidationMessage,
  type LocalizedWeekdayOption,
  parseRecurringBuilderFromCron,
  WEEKDAY_OPTIONS,
  type RecurringBuilderState,
} from './workflowScheduleRecurrence';
import WorkflowScheduleTimezonePicker from './WorkflowScheduleTimezonePicker';

type JsonSchema = {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: Array<string | number | boolean | null>;
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  default?: unknown;
  examples?: unknown[];
  example?: unknown;
  format?: string;
  $ref?: string;
  definitions?: Record<string, JsonSchema>;
};

type ValidationError = {
  path: string;
  message: string;
};

type WorkflowOption = {
  workflow_id: string;
  name: string;
  published_version?: number | null;
  payload_schema_mode?: string | null;
  payload_schema_ref?: string | null;
};

type RecurringEditorMode = 'builder' | 'advanced';
type DayTypeFilter = 'any' | 'business' | 'non_business';
type CalendarSource = 'tenant_default' | 'specific';

type BusinessHoursScheduleOption = {
  schedule_id: string;
  schedule_name: string;
  timezone?: string | null;
  is_default?: boolean;
  is_24x7?: boolean;
};

type WorkflowScheduleDialogProps = {
  isOpen: boolean;
  mode: 'create' | 'edit';
  scheduleId?: string | null;
  initialWorkflowId?: string | null;
  onClose: () => void;
  onSaved: () => void;
  scheduleActions?: WorkflowScheduleDialogActions;
};

export type WorkflowScheduleDialogActions = {
  createWorkflowScheduleAction: typeof createWorkflowScheduleActionDefault;
  getWorkflowScheduleAction: typeof getWorkflowScheduleActionDefault;
  listWorkflowScheduleBusinessHoursAction: typeof listWorkflowScheduleBusinessHoursActionDefault;
  updateWorkflowScheduleAction: typeof updateWorkflowScheduleActionDefault;
};

const defaultScheduleActions: WorkflowScheduleDialogActions = {
  createWorkflowScheduleAction: createWorkflowScheduleActionDefault,
  getWorkflowScheduleAction: getWorkflowScheduleActionDefault,
  listWorkflowScheduleBusinessHoursAction: listWorkflowScheduleBusinessHoursActionDefault,
  updateWorkflowScheduleAction: updateWorkflowScheduleActionDefault,
};

const resolveSchemaRef = (schema: JsonSchema, root: JsonSchema): JsonSchema => {
  if (schema.$ref && root?.definitions) {
    const refKey = schema.$ref.replace('#/definitions/', '');
    return root.definitions?.[refKey] ?? schema;
  }
  return schema;
};

const buildDefaultValueFromSchema = (schema: JsonSchema, root: JsonSchema): unknown => {
  const resolved = resolveSchemaRef(schema, root);
  if (resolved.default !== undefined) {
    return resolved.default;
  }
  if (resolved.anyOf?.length) {
    return buildDefaultValueFromSchema(resolved.anyOf[0], root);
  }
  if (resolved.oneOf?.length) {
    return buildDefaultValueFromSchema(resolved.oneOf[0], root);
  }

  const type = Array.isArray(resolved.type) ? resolved.type[0] : resolved.type;
  switch (type) {
    case 'object':
      return Object.keys(resolved.properties ?? {}).reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = buildDefaultValueFromSchema(resolved.properties?.[key] ?? {}, root);
        return acc;
      }, {});
    case 'array':
      return [];
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
};

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

const setValueAtPath = (root: unknown, path: Array<string | number>, value: unknown): unknown => {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const next = Array.isArray(root) ? [...root] : { ...(root as Record<string, unknown> | null) };
  const child = (root as any)?.[head];
  (next as any)[head] = rest.length ? setValueAtPath(child, rest, value) : value;
  return next;
};

const pathToString = (path: Array<string | number>): string =>
  path.reduce<string>(
    (acc, part) => (typeof part === 'number' ? `${acc}[${part}]` : acc ? `${acc}.${part}` : String(part)),
    ''
  );

const validateAgainstSchema = (
  schema: JsonSchema,
  value: unknown,
  root: JsonSchema,
  t: TranslateFn,
  path = ''
): ValidationError[] => {
  const resolved = resolveSchemaRef(schema, root);
  const type = Array.isArray(resolved.type) ? resolved.type[0] : resolved.type;
  const errors: ValidationError[] = [];

  if (resolved.enum && value != null && !resolved.enum.includes(value as any)) {
    errors.push({
      path,
      message: t('schedules.dialog.validation.valueMustBeAllowed', {
        defaultValue: 'Value must be one of the allowed options.',
      })
    });
  }

  if (type === 'object') {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      errors.push({
        path,
        message: t('schedules.dialog.validation.expectedObject', { defaultValue: 'Expected object.' })
      });
      return errors;
    }

    const objectValue = value as Record<string, unknown>;
    const properties = resolved.properties ?? {};
    const required = new Set(resolved.required ?? []);

    for (const key of required) {
      if (objectValue[key] === undefined || objectValue[key] === null || objectValue[key] === '') {
        errors.push({
          path: path ? `${path}.${key}` : key,
          message: t('schedules.dialog.validation.requiredFieldMissing', {
            defaultValue: 'Required field missing.',
          })
        });
      }
    }

    for (const [key, propSchema] of Object.entries(properties)) {
      errors.push(...validateAgainstSchema(propSchema, objectValue[key], root, t, path ? `${path}.${key}` : key));
    }

    if (resolved.additionalProperties === false) {
      const knownKeys = new Set(Object.keys(properties));
      for (const key of Object.keys(objectValue)) {
        if (!knownKeys.has(key)) {
          errors.push({
            path: path ? `${path}.${key}` : key,
            message: t('schedules.dialog.validation.unknownProperty', { defaultValue: 'Unknown property.' })
          });
        }
      }
    }

    return errors;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) {
      errors.push({
        path,
        message: t('schedules.dialog.validation.expectedArray', { defaultValue: 'Expected array.' })
      });
      return errors;
    }

    value.forEach((item, index) => {
      errors.push(...validateAgainstSchema(resolved.items ?? {}, item, root, t, `${path}[${index}]`));
    });
    return errors;
  }

  if (type === 'string' && value != null && typeof value !== 'string') {
    errors.push({
      path,
      message: t('schedules.dialog.validation.expectedString', { defaultValue: 'Expected string.' })
    });
  }
  if ((type === 'number' || type === 'integer') && value != null && typeof value !== 'number') {
    errors.push({
      path,
      message: t('schedules.dialog.validation.expectedNumber', { defaultValue: 'Expected number.' })
    });
  }
  if (type === 'boolean' && value != null && typeof value !== 'boolean') {
    errors.push({
      path,
      message: t('schedules.dialog.validation.expectedBoolean', { defaultValue: 'Expected boolean.' })
    });
  }

  return errors;
};

const parseDate = (iso: string | null | undefined): Date | undefined => {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
};

const buildWorkflowEligibilityMessage = (
  workflow: WorkflowOption | null,
  availableSchemaRefs: ReadonlySet<string> | undefined,
  t: TranslateFn
): string | null => {
  if (!workflow) {
    return t('schedules.dialog.eligibility.chooseWorkflow', {
      defaultValue: 'Choose a workflow before saving.',
    });
  }
  if (!workflow.published_version) {
    return t('schedules.dialog.eligibility.unpublished', {
      defaultValue: 'Schedules can only be created for workflows with a published version.',
    });
  }
  if (String(workflow.payload_schema_mode ?? 'pinned') !== 'pinned') {
    return t('schedules.dialog.eligibility.pinnedOnly', {
      defaultValue: 'Schedules are only supported for workflows with a pinned payload schema.',
    });
  }
  if (!workflow.payload_schema_ref) {
    return t('schedules.dialog.eligibility.noPinnedSchema', {
      defaultValue: 'The selected workflow does not expose a pinned payload schema.',
    });
  }
  if (availableSchemaRefs && !availableSchemaRefs.has(workflow.payload_schema_ref)) {
    return t('schedules.dialog.eligibility.unavailableSchemaRef', {
      defaultValue: 'The selected workflow uses an unavailable payload schema ref: {{schemaRef}}.',
      schemaRef: workflow.payload_schema_ref,
    });
  }
  return null;
};

export default function WorkflowScheduleDialog({
  isOpen,
  mode,
  scheduleId,
  initialWorkflowId,
  onClose,
  onSaved,
  scheduleActions = defaultScheduleActions
}: WorkflowScheduleDialogProps) {
  const { t } = useTranslation('msp/workflows');
  const { formatDate } = useFormatters();
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowOption[]>([]);
  const [availableSchemaRefs, setAvailableSchemaRefs] = useState<Set<string>>(new Set());
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false);
  const [isLoadingSchedule, setIsLoadingSchedule] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(initialWorkflowId ?? '');
  const [scheduleName, setScheduleName] = useState('');
  const [triggerType, setTriggerType] = useState<'schedule' | 'recurring'>('schedule');
  const [runAt, setRunAt] = useState<Date | undefined>(undefined);
  const [cron, setCron] = useState('');
  const [recurringMode, setRecurringMode] = useState<RecurringEditorMode>('builder');
  const [recurringBuilder, setRecurringBuilder] = useState<RecurringBuilderState>(DEFAULT_RECURRING_BUILDER_STATE);
  const [timezone, setTimezone] = useState('UTC');
  const [dayTypeFilter, setDayTypeFilter] = useState<DayTypeFilter>('any');
  const [calendarSource, setCalendarSource] = useState<CalendarSource>('tenant_default');
  const [businessHoursScheduleId, setBusinessHoursScheduleId] = useState<string>('');
  const [businessHoursOptions, setBusinessHoursOptions] = useState<BusinessHoursScheduleOption[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [payloadSchema, setPayloadSchema] = useState<JsonSchema | null>(null);
  const [payloadMode, setPayloadMode] = useState<'form' | 'json'>('form');
  const [payloadText, setPayloadText] = useState('{}');
  const [formValue, setFormValue] = useState<unknown>({});
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [schemaErrors, setSchemaErrors] = useState<ValidationError[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<Array<{ path?: string; message?: string }>>([]);
  const [payloadTouched, setPayloadTouched] = useState(false);
  const localizedWeekdayOptions = useMemo<LocalizedWeekdayOption[]>(
    () => WEEKDAY_OPTIONS.map((weekday) => ({
      ...weekday,
      shortLabel: t(`schedules.recurrence.weekdays.${weekday.value}.short`, {
        defaultValue: weekday.shortLabel,
      }),
      longLabel: t(`schedules.recurrence.weekdays.${weekday.value}.long`, {
        defaultValue: weekday.longLabel,
      }),
    })),
    [t]
  );

  const selectedWorkflow = useMemo(
    () => workflowOptions.find((workflow) => workflow.workflow_id === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflowOptions]
  );
  const workflowEligibilityMessage = useMemo(
    () => buildWorkflowEligibilityMessage(selectedWorkflow, availableSchemaRefs, t),
    [availableSchemaRefs, selectedWorkflow, t]
  );
  const hasTenantDefaultBusinessHours = useMemo(
    () => businessHoursOptions.some((schedule) => Boolean(schedule.is_default)),
    [businessHoursOptions]
  );
  const hasAnyBusinessHoursSchedules = businessHoursOptions.length > 0;
  const calendarSourceOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: 'tenant_default',
        label: hasTenantDefaultBusinessHours
          ? t('schedules.dialog.calendarSource.tenantDefault', {
            defaultValue: 'Tenant default business hours',
          })
          : t('schedules.dialog.calendarSource.tenantDefaultMissing', {
            defaultValue: 'Tenant default business hours (not configured)',
          }),
        disabled: !hasTenantDefaultBusinessHours,
        dropdownHint: !hasTenantDefaultBusinessHours
          ? t('schedules.dialog.calendarSource.tenantDefaultHint', {
            defaultValue: 'Set a tenant default business-hours schedule first, or choose a specific schedule.',
          })
          : undefined
      },
      {
        value: 'specific',
        label: t('schedules.dialog.calendarSource.specific', {
          defaultValue: 'Specific business-hours schedule',
        }),
        disabled: !hasAnyBusinessHoursSchedules,
        dropdownHint: !hasAnyBusinessHoursSchedules
          ? t('schedules.dialog.calendarSource.specificHint', {
            defaultValue: 'Create a business-hours schedule first.',
          })
          : undefined
      }
    ],
    [hasAnyBusinessHoursSchedules, hasTenantDefaultBusinessHours, t]
  );

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const loadWorkflows = async () => {
      setIsLoadingWorkflows(true);
      try {
        const [workflowResult, schemaRefResult, businessHoursResult] = await Promise.all([
          listWorkflowDefinitionsPagedAction({
            page: 1,
            pageSize: 200,
            status: 'all',
            trigger: 'all',
            sortBy: 'name',
            sortDirection: 'asc'
          }),
          listWorkflowSchemaRefsAction(),
          scheduleActions.listWorkflowScheduleBusinessHoursAction()
        ]);
        if (cancelled) return;
        setWorkflowOptions(((workflowResult as { items?: WorkflowOption[] } | null)?.items ?? []) as WorkflowOption[]);
        setAvailableSchemaRefs(new Set(((schemaRefResult as { refs?: string[] } | null)?.refs ?? []) as string[]));
        setBusinessHoursOptions(((businessHoursResult as { items?: BusinessHoursScheduleOption[] } | null)?.items ?? []) as BusinessHoursScheduleOption[]);
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load workflows for schedule dialog', error);
        setWorkflowOptions([]);
        setAvailableSchemaRefs(new Set());
        setBusinessHoursOptions([]);
      } finally {
        if (!cancelled) {
          setIsLoadingWorkflows(false);
        }
      }
    };

    void loadWorkflows();
    return () => {
      cancelled = true;
    };
  }, [isOpen, scheduleActions]);

  useEffect(() => {
    if (!isOpen) return;

    setSubmitError(null);
    setServerIssues([]);

    if (mode === 'edit' && scheduleId) {
      let cancelled = false;
      const loadSchedule = async () => {
        setIsLoadingSchedule(true);
        try {
          const schedule = await scheduleActions.getWorkflowScheduleAction({ scheduleId });
          if (cancelled) return;
          setSelectedWorkflowId(schedule.workflow_id);
          setScheduleName(schedule.name ?? '');
          setTriggerType(schedule.trigger_type);
          setRunAt(parseDate(schedule.run_at));
          setCron(schedule.cron ?? '');
          if (schedule.trigger_type === 'recurring') {
            const parsedRecurringBuilder = parseRecurringBuilderFromCron(schedule.cron ?? '');
            setRecurringBuilder(parsedRecurringBuilder ?? DEFAULT_RECURRING_BUILDER_STATE);
            setRecurringMode(parsedRecurringBuilder ? 'builder' : 'advanced');
          } else {
            setRecurringBuilder(DEFAULT_RECURRING_BUILDER_STATE);
            setRecurringMode('builder');
          }
          setTimezone(schedule.timezone ?? 'UTC');
          const scheduleDayTypeFilter = (schedule.day_type_filter ?? 'any') as DayTypeFilter;
          const scheduleBusinessHoursScheduleId = schedule.business_hours_schedule_id ?? '';
          setDayTypeFilter(scheduleDayTypeFilter);
          setCalendarSource(scheduleBusinessHoursScheduleId ? 'specific' : 'tenant_default');
          setBusinessHoursScheduleId(scheduleBusinessHoursScheduleId);
          setEnabled(Boolean(schedule.enabled));
          const nextPayload = schedule.payload_json ?? {};
          setPayloadText(JSON.stringify(nextPayload, null, 2));
          setFormValue(nextPayload);
          setJsonError(null);
          setPayloadTouched(true);
        } catch (error) {
          if (cancelled) return;
          console.error('Failed to load workflow schedule', error);
          setSubmitError(error instanceof Error ? error.message : t('schedules.dialog.errors.loadScheduleFailed', {
            defaultValue: 'Failed to load schedule.',
          }));
        } finally {
          if (!cancelled) {
            setIsLoadingSchedule(false);
          }
        }
      };

      void loadSchedule();
      return () => {
        cancelled = true;
      };
    }

    setSelectedWorkflowId(initialWorkflowId ?? '');
    setScheduleName('');
    setTriggerType('schedule');
    setRunAt(undefined);
    setCron('');
    setRecurringMode('builder');
    setRecurringBuilder(DEFAULT_RECURRING_BUILDER_STATE);
    setTimezone('UTC');
    setDayTypeFilter('any');
    setCalendarSource('tenant_default');
    setBusinessHoursScheduleId('');
    setEnabled(true);
    setPayloadText('{}');
    setFormValue({});
    setJsonError(null);
    setSchemaErrors([]);
    setPayloadMode('form');
    setPayloadTouched(false);
    setIsLoadingSchedule(false);
    return undefined;
  }, [initialWorkflowId, isOpen, mode, scheduleActions, scheduleId, t]);

  useEffect(() => {
    if (!isOpen || !selectedWorkflow?.payload_schema_ref || workflowEligibilityMessage) {
      setPayloadSchema(null);
      return;
    }

    let cancelled = false;
    const loadSchema = async () => {
      try {
        const result = await getWorkflowSchemaAction({ schemaRef: selectedWorkflow.payload_schema_ref as string });
        if (cancelled) return;
        setPayloadSchema((result?.schema ?? null) as JsonSchema | null);
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load workflow payload schema', error);
        setPayloadSchema(null);
      }
    };

    void loadSchema();
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedWorkflow, workflowEligibilityMessage]);

  useEffect(() => {
    if (!isOpen || !payloadSchema || payloadTouched) return;
    const defaults = buildDefaultValueFromSchema(payloadSchema, payloadSchema);
    setFormValue(defaults ?? {});
    setPayloadText(JSON.stringify(defaults ?? {}, null, 2));
  }, [isOpen, payloadSchema, payloadTouched]);

  useEffect(() => {
    if (!payloadSchema) {
      setSchemaErrors([]);
      return;
    }

    const value = payloadMode === 'json'
      ? (() => {
        try {
          return JSON.parse(payloadText || '{}');
        } catch {
          return null;
        }
      })()
      : formValue;

    setSchemaErrors(validateAgainstSchema(payloadSchema, value ?? {}, payloadSchema, t));
  }, [formValue, payloadMode, payloadSchema, payloadText, t]);

  const workflowPickerOptions = useMemo<SelectOption[]>(
    () => workflowOptions.map((workflow) => {
      const eligibilityMessage = buildWorkflowEligibilityMessage(workflow, availableSchemaRefs, t);
      return {
        value: workflow.workflow_id,
        label: (
          <div className="flex items-center gap-2 overflow-hidden flex-nowrap">
            <span className="font-medium text-gray-900 truncate">{workflow.name}</span>
            <span className="flex-shrink-0">
              {workflow.published_version ? (
                <Badge variant="info" size="sm">v{workflow.published_version}</Badge>
              ) : (
                <Badge variant="warning" size="sm">
                  {t('schedules.dialog.workflow.badges.unpublished', { defaultValue: 'Unpublished' })}
                </Badge>
              )}
            </span>
            {String(workflow.payload_schema_mode ?? 'pinned') !== 'pinned' && (
              <span className="flex-shrink-0">
                <Badge variant="warning" size="sm">
                  {t('schedules.dialog.workflow.badges.inferredSchema', { defaultValue: 'Inferred schema' })}
                </Badge>
              </span>
            )}
          </div>
        ),
        dropdownHint: eligibilityMessage || undefined,
        textValue: workflow.name
      };
    }),
    [availableSchemaRefs, t, workflowOptions]
  );

  const parsePayloadForSubmit = (): Record<string, unknown> | null => {
    try {
      if (payloadMode === 'json') {
        const parsed = JSON.parse(payloadText || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setJsonError(t('schedules.dialog.validation.payloadMustBeObject', {
            defaultValue: 'Schedule payload must be a JSON object.',
          }));
          return null;
        }
        setJsonError(null);
        return parsed as Record<string, unknown>;
      }

      if (!formValue || typeof formValue !== 'object' || Array.isArray(formValue)) {
        setJsonError(t('schedules.dialog.validation.payloadMustBeObject', {
          defaultValue: 'Schedule payload must be a JSON object.',
        }));
        return null;
      }
      setJsonError(null);
      return formValue as Record<string, unknown>;
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : t('schedules.dialog.validation.invalidJson', {
        defaultValue: 'Invalid JSON',
      }));
      return null;
    }
  };

  const canSave = Boolean(
    selectedWorkflowId
    && scheduleName.trim()
    && !workflowEligibilityMessage
    && !jsonError
    && schemaErrors.length === 0
    && (triggerType === 'recurring' || Boolean(runAt))
    && (triggerType === 'schedule' || (timezone.trim() && (recurringMode === 'advanced'
      ? cron.trim()
      : buildCronFromRecurringBuilder(recurringBuilder))))
    && (
      triggerType !== 'recurring'
      || dayTypeFilter === 'any'
      || (calendarSource === 'tenant_default'
        ? hasTenantDefaultBusinessHours
        : Boolean(businessHoursScheduleId))
    )
  );

  const recurringValidationMessage = useMemo(
    () => triggerType !== 'recurring' || recurringMode === 'advanced'
      ? null
      : getRecurringBuilderValidationMessage(recurringBuilder, {
        invalidTimeMessage: t('schedules.recurrence.validation.validTime', {
          defaultValue: 'Choose a valid time.',
        }),
        noWeekdayMessage: t('schedules.recurrence.validation.weekdayRequired', {
          defaultValue: 'Choose at least one weekday.',
        }),
        invalidDayOfMonthMessage: t('schedules.recurrence.validation.dayOfMonthRange', {
          defaultValue: 'Choose a day of month between 1 and 31.',
        }),
      }),
    [recurringBuilder, recurringMode, t, triggerType]
  );

  const effectiveRecurringCron = useMemo(
    () => triggerType !== 'recurring'
      ? ''
      : recurringMode === 'advanced'
        ? cron.trim()
        : (buildCronFromRecurringBuilder(recurringBuilder) ?? ''),
    [cron, recurringBuilder, recurringMode, triggerType]
  );

  const recurringSummary = useMemo(
    () => triggerType !== 'recurring' || recurringMode === 'advanced'
      ? null
      : getRecurringBuilderSummary(recurringBuilder, timezone, {
        weekdayOptions: localizedWeekdayOptions,
        andWord: t('schedules.recurrence.andWord', { defaultValue: 'and' }),
        defaultTimezoneLabel: 'UTC',
        formatTimeLabel: (time) => {
          const [hourRaw, minuteRaw] = time.split(':');
          const hour = Number(hourRaw);
          const minute = Number(minuteRaw);
          if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
            return time;
          }
          return formatDate(new Date(Date.UTC(2000, 0, 1, hour, minute)), {
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'UTC',
          });
        },
        formatDailySummary: ({ timeLabel, timezoneLabel }) => t('schedules.recurrence.summary.daily', {
          defaultValue: 'Runs every day at {{timeLabel}} {{timezoneLabel}}',
          timeLabel,
          timezoneLabel,
        }),
        formatWeeklySummary: ({ weekdayLabels, timeLabel, timezoneLabel }) => t('schedules.recurrence.summary.weekly', {
          defaultValue: 'Runs every {{weekdayLabels}} at {{timeLabel}} {{timezoneLabel}}',
          weekdayLabels,
          timeLabel,
          timezoneLabel,
        }),
        formatMonthlySummary: ({ dayOfMonth, timeLabel, timezoneLabel }) => t('schedules.recurrence.summary.monthly', {
          defaultValue: 'Runs on day {{dayOfMonth}} of each month at {{timeLabel}} {{timezoneLabel}}',
          dayOfMonth,
          timeLabel,
          timezoneLabel,
        }),
      }),
    [formatDate, localizedWeekdayOptions, recurringBuilder, recurringMode, t, timezone, triggerType]
  );

  const unsupportedRecurringCron = useMemo(
    () => triggerType === 'recurring'
      && recurringMode === 'advanced'
      && Boolean(cron.trim())
      && !parseRecurringBuilderFromCron(cron),
    [cron, recurringMode, triggerType]
  );

  const updateFormValue = (updater: (previous: unknown) => unknown) => {
    setPayloadTouched(true);
    setFormValue((previous: unknown) => updater(previous));
  };

  const handlePayloadModeChange = (nextMode: 'form' | 'json') => {
    if (nextMode === payloadMode) {
      return;
    }

    if (nextMode === 'json') {
      setPayloadText(JSON.stringify(formValue ?? {}, null, 2));
      setJsonError(null);
      setPayloadMode('json');
      return;
    }

    try {
      const parsed = JSON.parse(payloadText || '{}');
      setFormValue(parsed);
      setJsonError(null);
      setPayloadMode('form');
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : t('schedules.dialog.validation.invalidJson', {
        defaultValue: 'Invalid JSON',
      }));
    }
  };

  const renderField = (
    schema: JsonSchema,
    value: unknown,
    path: Array<string | number>,
    requiredSet: Set<string>
  ): React.ReactNode => {
    const rootSchema = payloadSchema ?? schema;
    const resolved = resolveSchemaRef(schema, rootSchema);
    const type = Array.isArray(resolved.type) ? resolved.type[0] : resolved.type;
    const fieldKey = path[path.length - 1];
    const label = resolved.title ?? (typeof fieldKey === 'string'
      ? fieldKey
      : t('schedules.dialog.payload.rootLabel', { defaultValue: 'Payload' }));
    const isRequired = typeof fieldKey === 'string' && requiredSet.has(fieldKey);
    const fieldPath = pathToString(path);
    const fieldErrors = schemaErrors.filter((error) => error.path === fieldPath);

    if (type === 'object') {
      const required = new Set(resolved.required ?? []);
      return (
        <div className="space-y-3 rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-3">
          {fieldPath && (
            <div className="text-sm font-medium text-[rgb(var(--color-text-800))]">
              {label}{isRequired ? <span className="text-destructive"> *</span> : null}
            </div>
          )}
          {resolved.description ? (
            <div className="text-xs text-[rgb(var(--color-text-500))]">{resolved.description}</div>
          ) : null}
          {Object.entries(resolved.properties ?? {}).map(([key, childSchema]) => (
            <div key={fieldPath ? `${fieldPath}.${key}` : key}>
              {renderField(childSchema, (value as Record<string, unknown> | null)?.[key], [...path, key], required)}
            </div>
          ))}
          {fieldErrors.map((error) => (
            <div key={`${fieldPath || 'root'}-${error.message}`} className="text-xs text-destructive">
              {error.message}
            </div>
          ))}
        </div>
      );
    }

    if (type === 'array') {
      const items = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-2 rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-[rgb(var(--color-text-800))]">
              {label}{isRequired ? <span className="text-destructive"> *</span> : null}
            </label>
            <Button
              id={`schedule-form-array-add-${fieldPath || 'root'}`}
              variant="outline"
              size="sm"
              onClick={() => {
                const next = [...items, buildDefaultValueFromSchema(resolved.items ?? {}, rootSchema)];
                updateFormValue((previous) => setValueAtPath(previous, path, next));
              }}
            >
              {t('schedules.dialog.payload.actions.addItem', { defaultValue: 'Add item' })}
            </Button>
          </div>
          {items.length === 0 && (
            <div className="text-xs text-[rgb(var(--color-text-500))]">
              {t('schedules.dialog.payload.states.noItems', { defaultValue: 'No items yet.' })}
            </div>
          )}
          {items.map((item, index) => (
            <div key={`${fieldPath}[${index}]`} className="rounded border border-[rgb(var(--color-border-100))] p-2">
              <div className="mb-2 flex justify-end">
                <Button
                  id={`schedule-form-array-remove-${fieldPath || 'root'}-${index}`}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const next = items.filter((_, itemIndex) => itemIndex !== index);
                    updateFormValue((previous) => setValueAtPath(previous, path, next));
                  }}
                >
                  {t('schedules.dialog.payload.actions.removeItem', { defaultValue: 'Remove' })}
                </Button>
              </div>
              {renderField(resolved.items ?? {}, item, [...path, index], new Set())}
            </div>
          ))}
          {fieldErrors.map((error) => (
            <div key={`${fieldPath}-array-${error.message}`} className="text-xs text-destructive">
              {error.message}
            </div>
          ))}
        </div>
      );
    }

    if (resolved.enum) {
      const options: SelectOption[] = resolved.enum.map((entry) => ({
        value: String(entry),
        label: String(entry)
      }));
      return (
        <div className="space-y-1">
          <label className="text-sm font-medium text-[rgb(var(--color-text-800))]">
            {label}{isRequired ? <span className="text-destructive"> *</span> : null}
          </label>
          <CustomSelect
            id={`schedule-form-${fieldPath}`}
            options={options}
            value={value == null ? '' : String(value)}
            onValueChange={(nextValue) => {
              const actual = resolved.enum?.find((entry) => String(entry) === nextValue);
              updateFormValue((previous) => setValueAtPath(previous, path, actual ?? nextValue));
            }}
          />
          {resolved.description ? (
            <div className="text-xs text-[rgb(var(--color-text-500))]">{resolved.description}</div>
          ) : null}
          {fieldErrors.map((error) => (
            <div key={`${fieldPath}-enum-${error.message}`} className="text-xs text-destructive">
              {error.message}
            </div>
          ))}
        </div>
      );
    }

    if (type === 'boolean') {
      return (
        <div className="space-y-1">
          <label className="text-sm font-medium text-[rgb(var(--color-text-800))]">
            {label}{isRequired ? <span className="text-destructive"> *</span> : null}
          </label>
          <div className="flex items-center gap-2">
            <Switch
              aria-label={label}
              checked={Boolean(value)}
              onCheckedChange={(checked) => updateFormValue((previous) => setValueAtPath(previous, path, checked))}
            />
            <span className="text-xs text-[rgb(var(--color-text-500))]">
              {value
                ? t('schedules.dialog.payload.boolean.true', { defaultValue: 'True' })
                : t('schedules.dialog.payload.boolean.false', { defaultValue: 'False' })}
            </span>
          </div>
          {resolved.description ? (
            <div className="text-xs text-[rgb(var(--color-text-500))]">{resolved.description}</div>
          ) : null}
          {fieldErrors.map((error) => (
            <div key={`${fieldPath}-bool-${error.message}`} className="text-xs text-destructive">
              {error.message}
            </div>
          ))}
        </div>
      );
    }

    const inputType = resolved.format === 'date-time'
      ? 'datetime-local'
      : resolved.format === 'date'
        ? 'date'
        : (type === 'number' || type === 'integer' ? 'number' : 'text');

    return (
      <div className="space-y-1">
        <label className="text-sm font-medium text-[rgb(var(--color-text-800))]">
          {label}{isRequired ? <span className="text-destructive"> *</span> : null}
        </label>
        <Input
          id={`schedule-form-${fieldPath}`}
          aria-label={label}
          type={inputType}
          value={value == null ? '' : String(value)}
          onChange={(event) => {
            const raw = event.target.value;
            const parsed = raw === ''
              ? null
              : (type === 'number' || type === 'integer' ? Number(raw) : raw);
            updateFormValue((previous) => setValueAtPath(previous, path, parsed));
          }}
        />
        {resolved.description ? (
          <div className="text-xs text-[rgb(var(--color-text-500))]">{resolved.description}</div>
        ) : null}
        {fieldErrors.map((error) => (
          <div key={`${fieldPath}-input-${error.message}`} className="text-xs text-destructive">
            {error.message}
          </div>
        ))}
      </div>
    );
  };

  const handlePayloadTextChange = (value: string) => {
    setPayloadTouched(true);
    setPayloadText(value);
    try {
      const parsed = JSON.parse(value || '{}');
      setFormValue(parsed);
      setJsonError(null);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : t('schedules.dialog.validation.invalidJson', {
        defaultValue: 'Invalid JSON',
      }));
    }
  };

  const handleSave = async () => {
    const payload = parsePayloadForSubmit();
    if (!payload || !canSave || !selectedWorkflowId) {
      return;
    }

    setSubmitError(null);
    setServerIssues([]);
    setIsSaving(true);
    try {
      const common = {
        workflowId: selectedWorkflowId,
        name: scheduleName.trim(),
        triggerType,
        payload,
        enabled
      } as const;

      const result = mode === 'edit' && scheduleId
        ? await scheduleActions.updateWorkflowScheduleAction({
          scheduleId,
          ...common,
          dayTypeFilter: triggerType === 'recurring' ? dayTypeFilter : 'any',
          businessHoursScheduleId: (
            triggerType === 'recurring'
            && dayTypeFilter !== 'any'
            && calendarSource === 'specific'
          ) ? businessHoursScheduleId : undefined,
          runAt: triggerType === 'schedule' ? runAt?.toISOString() : undefined,
          cron: triggerType === 'recurring' ? effectiveRecurringCron : undefined,
          timezone: triggerType === 'recurring' ? timezone.trim() : undefined
        })
        : await scheduleActions.createWorkflowScheduleAction({
          ...common,
          dayTypeFilter: triggerType === 'recurring' ? dayTypeFilter : 'any',
          businessHoursScheduleId: (
            triggerType === 'recurring'
            && dayTypeFilter !== 'any'
            && calendarSource === 'specific'
          ) ? businessHoursScheduleId : undefined,
          runAt: triggerType === 'schedule' ? runAt?.toISOString() : undefined,
          cron: triggerType === 'recurring' ? effectiveRecurringCron : undefined,
          timezone: triggerType === 'recurring' ? timezone.trim() : undefined
        });

      if ((result as { ok?: boolean }).ok === false) {
        const failure = result as { message?: string; issues?: Array<{ path?: Array<string | number>; message?: string }> };
        setSubmitError(failure.message ?? t('schedules.dialog.errors.saveFailed', {
          defaultValue: 'Failed to save schedule.',
        }));
        setServerIssues((failure.issues ?? []).map((issue) => ({
          path: Array.isArray(issue.path) ? issue.path.join('.') : undefined,
          message: issue.message
        })));
        return;
      }

      onSaved();
      onClose();
    } catch (error) {
      console.error('Failed to save schedule', error);
      setSubmitError(error instanceof Error ? error.message : t('schedules.dialog.errors.saveFailed', {
        defaultValue: 'Failed to save schedule.',
      }));
    } finally {
      setIsSaving(false);
    }
  };

  const dialogBusy = isLoadingWorkflows || isLoadingSchedule;

  const footer = (
    <div className="flex justify-end gap-2">
      <Button id="schedule-dialog-cancel" variant="outline" onClick={onClose} disabled={isSaving}>
        {t('schedules.actions.cancel', { defaultValue: 'Cancel' })}
      </Button>
      <Button
        id="schedule-dialog-save"
        onClick={() => void handleSave()}
        disabled={!canSave || isSaving || dialogBusy}
      >
        {isSaving
          ? t('schedules.actions.saving', { defaultValue: 'Saving…' })
          : mode === 'edit'
            ? t('schedules.actions.saveChanges', { defaultValue: 'Save Changes' })
            : t('schedules.actions.create', { defaultValue: 'Create Schedule' })}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'edit'
        ? t('schedules.dialog.title.edit', { defaultValue: 'Edit Schedule' })
        : t('schedules.dialog.title.create', { defaultValue: 'Create Schedule' })}
      className="max-w-5xl"
      footer={footer}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit'
              ? t('schedules.dialog.title.edit', { defaultValue: 'Edit Schedule' })
              : t('schedules.dialog.title.create', { defaultValue: 'Create Schedule' })}
          </DialogTitle>
          <DialogDescription>
            {t('schedules.dialog.description', {
              defaultValue: 'Configure timing and static payload data for a workflow schedule.',
            })}
          </DialogDescription>
        </DialogHeader>

        {dialogBusy ? (
          <div className="py-8 text-sm text-[rgb(var(--color-text-500))]">
            {t('schedules.dialog.states.loading', { defaultValue: 'Loading schedule details…' })}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <CustomSelect
                id="schedule-dialog-workflow"
                label={t('schedules.dialog.fields.workflow', { defaultValue: 'Workflow' })}
                options={workflowPickerOptions}
                value={selectedWorkflowId}
                onValueChange={(value) => {
                  setSelectedWorkflowId(value);
                  setPayloadTouched(false);
                }}
                placeholder={t('schedules.dialog.fields.workflowPlaceholder', { defaultValue: 'Choose a workflow' })}
              />
              <Input
                id="schedule-dialog-name"
                label={t('schedules.dialog.fields.name', { defaultValue: 'Schedule name' })}
                value={scheduleName}
                onChange={(event) => setScheduleName(event.target.value)}
                placeholder={t('schedules.dialog.fields.namePlaceholder', { defaultValue: 'Month-end AP sync' })}
              />
              <CustomSelect
                id="schedule-dialog-trigger-type"
                label={t('schedules.dialog.fields.triggerType', { defaultValue: 'Trigger type' })}
                value={triggerType}
                onValueChange={(value) => {
                  const nextTriggerType = value as 'schedule' | 'recurring';
                  setTriggerType(nextTriggerType);
                  if (nextTriggerType === 'schedule') {
                    setDayTypeFilter('any');
                    setCalendarSource('tenant_default');
                    setBusinessHoursScheduleId('');
                  }
                  if (nextTriggerType === 'recurring' && !cron.trim()) {
                    setRecurringMode('builder');
                  }
                }}
                options={[
                  {
                    value: 'schedule',
                    label: t('schedules.triggerType.schedule', { defaultValue: 'One-time' })
                  },
                  {
                    value: 'recurring',
                    label: t('schedules.triggerType.recurring', { defaultValue: 'Recurring' })
                  }
                ]}
              />
              <div className="space-y-2">
                <label className="text-sm font-medium text-[rgb(var(--color-text-800))]">
                  {t('schedules.dialog.fields.enabled', { defaultValue: 'Enabled' })}
                </label>
                <div className="flex h-10 items-center gap-2 rounded-lg border border-[rgb(var(--color-border-200))] px-3">
                  <Switch checked={enabled} onCheckedChange={setEnabled} />
                  <span className="text-sm text-[rgb(var(--color-text-600))]">
                    {enabled
                      ? t('schedules.dialog.fields.enabledHelp', {
                        defaultValue: 'Schedule will run when valid.',
                      })
                      : t('schedules.dialog.fields.disabledHelp', {
                        defaultValue: 'Schedule will stay paused until resumed.',
                      })}
                  </span>
                </div>
              </div>
            </div>

            {triggerType === 'schedule' ? (
              <div>
                <label className="text-sm font-medium text-[rgb(var(--color-text-700))]">
                  {t('schedules.dialog.fields.runAt', { defaultValue: 'Run at' })}
                </label>
                <DateTimePicker
                  id="schedule-dialog-run-at"
                  label={t('schedules.dialog.fields.runAt', { defaultValue: 'Run at' })}
                  value={runAt}
                  onChange={setRunAt}
                />
              </div>
            ) : (
              <div className="space-y-4 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background-50))] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-[rgb(var(--color-text-900))]">
                      {t('schedules.dialog.recurring.title', { defaultValue: 'Recurring schedule' })}
                    </div>
                    <div className="text-xs text-[rgb(var(--color-text-500))]">
                      {t('schedules.dialog.recurring.description', {
                        defaultValue: 'Choose a common recurrence pattern. Advanced cron is available for custom schedules.',
                      })}
                    </div>
                  </div>
                  <div className="inline-flex rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-1">
                    <button
                      type="button"
                      id="schedule-dialog-recurring-mode-builder"
                      className={`rounded-md px-3 py-1.5 text-sm ${recurringMode === 'builder'
                        ? 'bg-[rgb(var(--color-primary-500))] text-white'
                        : 'text-[rgb(var(--color-text-600))]'}`}
                      onClick={() => {
                        const parsedRecurringBuilder = parseRecurringBuilderFromCron(cron);
                        if (parsedRecurringBuilder) {
                          setRecurringBuilder(parsedRecurringBuilder);
                        }
                        setRecurringMode('builder');
                      }}
                    >
                      {t('schedules.dialog.recurring.builderMode', { defaultValue: 'Schedule Builder' })}
                    </button>
                    <button
                      type="button"
                      id="schedule-dialog-recurring-mode-advanced"
                      className={`rounded-md px-3 py-1.5 text-sm ${recurringMode === 'advanced'
                        ? 'bg-[rgb(var(--color-primary-500))] text-white'
                        : 'text-[rgb(var(--color-text-600))]'}`}
                      onClick={() => {
                        const nextCron = buildCronFromRecurringBuilder(recurringBuilder);
                        if (nextCron) {
                          setCron(nextCron);
                        }
                        setRecurringMode('advanced');
                      }}
                    >
                      {t('schedules.dialog.recurring.advancedMode', { defaultValue: 'Advanced Cron' })}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <CustomSelect
                    id="schedule-dialog-day-type-filter"
                    label={t('schedules.dialog.fields.runOn', { defaultValue: 'Run on' })}
                    value={dayTypeFilter}
                    onValueChange={(value) => {
                      const nextFilter = value as DayTypeFilter;
                      setDayTypeFilter(nextFilter);
                      if (nextFilter === 'any') {
                        setCalendarSource('tenant_default');
                        setBusinessHoursScheduleId('');
                      }
                    }}
                    options={[
                      {
                        value: 'any',
                        label: t('schedules.dayType.any', { defaultValue: 'Any day' })
                      },
                      {
                        value: 'business',
                        label: t('schedules.dialog.fields.businessDaysOnly', {
                          defaultValue: 'Business days only',
                        })
                      },
                      {
                        value: 'non_business',
                        label: t('schedules.dialog.fields.nonBusinessDaysOnly', {
                          defaultValue: 'Non-business days only',
                        })
                      }
                    ]}
                  />
                  {dayTypeFilter !== 'any' ? (
                    <div className="space-y-2">
                      <CustomSelect
                        id="schedule-dialog-calendar-source"
                        label={t('schedules.dialog.fields.calendarSource', { defaultValue: 'Calendar source' })}
                        value={calendarSource}
                        disabled={!hasTenantDefaultBusinessHours && !hasAnyBusinessHoursSchedules}
                        onValueChange={(value) => {
                          const nextSource = value as CalendarSource;
                          setCalendarSource(nextSource);
                          if (nextSource === 'tenant_default') {
                            setBusinessHoursScheduleId('');
                          }
                        }}
                        options={calendarSourceOptions}
                      />
                      {!hasTenantDefaultBusinessHours && calendarSource === 'tenant_default' ? (
                        <div className="text-xs text-[rgb(var(--color-text-600))]">
                          {t('schedules.dialog.calendarSource.tenantDefaultMissingDescription', {
                            defaultValue: 'No tenant default business-hours schedule is configured yet. Choose a specific business-hours schedule or set a tenant default first.',
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {dayTypeFilter !== 'any' ? (
                  <div className="space-y-3 rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-3">
                    <div className="flex items-start gap-2 text-xs text-[rgb(var(--color-text-600))]">
                      <Info className="mt-0.5 h-4 w-4 text-[rgb(var(--color-primary-500))]" />
                      <span>
                        {t('schedules.dialog.calendarSource.holidaysNote', {
                          defaultValue: 'Holidays are always treated as non-business days.',
                        })}
                      </span>
                    </div>
                    {calendarSource === 'specific' ? (
                      hasAnyBusinessHoursSchedules ? (
                        <CustomSelect
                          id="schedule-dialog-business-hours-schedule"
                          label={t('schedules.dialog.fields.businessHoursSchedule', {
                            defaultValue: 'Business-hours schedule',
                          })}
                          value={businessHoursScheduleId}
                          onValueChange={setBusinessHoursScheduleId}
                          options={businessHoursOptions.map((schedule) => ({
                            value: schedule.schedule_id,
                            label: `${schedule.schedule_name}${schedule.is_default
                              ? t('schedules.dialog.businessHours.defaultSuffix', {
                                defaultValue: ' (Default)',
                              })
                              : ''}`
                          }))}
                          placeholder={t('schedules.dialog.fields.businessHoursSchedulePlaceholder', {
                            defaultValue: 'Choose a business-hours schedule',
                          })}
                        />
                      ) : (
                        <div className="text-xs text-[rgb(var(--color-text-500))]">
                          {t('schedules.dialog.businessHours.noneConfigured', {
                            defaultValue: 'No business-hours schedules are configured yet.',
                          })}
                        </div>
                      )
                    ) : (
                      <div className="text-xs text-[rgb(var(--color-text-500))]">
                        {hasTenantDefaultBusinessHours
                          ? t('schedules.dialog.businessHours.usingTenantDefault', {
                            defaultValue: 'Uses the tenant default business-hours schedule.',
                          })
                          : t('schedules.dialog.businessHours.noTenantDefault', {
                            defaultValue: 'No tenant default business-hours schedule is configured yet.',
                          })}
                      </div>
                    )}
                  </div>
                ) : null}

                {recurringMode === 'builder' ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <CustomSelect
                        id="schedule-dialog-recurring-frequency"
                        label={t('schedules.dialog.fields.frequency', { defaultValue: 'Frequency' })}
                        value={recurringBuilder.frequency}
                        onValueChange={(value) => {
                          setRecurringBuilder((current) => ({
                            ...current,
                            frequency: value as RecurringBuilderState['frequency'],
                          }));
                        }}
                        options={[
                          {
                            value: 'daily',
                            label: t('schedules.recurrence.frequency.daily', { defaultValue: 'Daily' }),
                          },
                          {
                            value: 'weekly',
                            label: t('schedules.recurrence.frequency.weekly', { defaultValue: 'Weekly' }),
                          },
                          {
                            value: 'monthly',
                            label: t('schedules.recurrence.frequency.monthly', { defaultValue: 'Monthly' }),
                          },
                        ]}
                      />
                      <div>
                        <label className="text-sm font-medium text-[rgb(var(--color-text-700))]">
                          {t('schedules.dialog.fields.time', { defaultValue: 'Time' })}
                        </label>
                        <TimePicker
                          id="schedule-dialog-recurring-time"
                          label={t('schedules.dialog.fields.time', { defaultValue: 'Time' })}
                          value={recurringBuilder.time}
                          onChange={(nextTime) => {
                            setRecurringBuilder((current) => ({
                              ...current,
                              time: nextTime,
                            }));
                          }}
                        />
                      </div>
                      {recurringBuilder.frequency === 'monthly' ? (
                        <Input
                          id="schedule-dialog-recurring-day-of-month"
                          label={t('schedules.dialog.fields.dayOfMonth', { defaultValue: 'Day of month' })}
                          type="number"
                          value={recurringBuilder.dayOfMonth}
                          onChange={(event) => {
                            const nextDayOfMonth = event.target.value;
                            setRecurringBuilder((current) => ({
                              ...current,
                              dayOfMonth: nextDayOfMonth,
                            }));
                          }}
                          min="1"
                          max="31"
                        />
                      ) : (
                        <div className="flex items-end text-xs text-[rgb(var(--color-text-500))]">
                          {recurringBuilder.frequency === 'daily'
                            ? t('schedules.dialog.recurring.dailyHelper', {
                              defaultValue: 'Runs every day at the selected time.',
                            })
                            : t('schedules.dialog.recurring.weeklyHelper', {
                              defaultValue: 'Choose one or more weekdays below.',
                            })}
                        </div>
                      )}
                    </div>

                    {recurringBuilder.frequency === 'weekly' && (
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-[rgb(var(--color-text-800))]">
                          {t('schedules.dialog.fields.weekdays', { defaultValue: 'Weekdays' })}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {localizedWeekdayOptions.map((weekday) => {
                            const isSelected = recurringBuilder.weekdays.includes(weekday.value);
                            return (
                              <button
                                key={weekday.value}
                                type="button"
                                id={`schedule-dialog-recurring-weekday-${weekday.value}`}
                                aria-pressed={isSelected}
                                className={`rounded-md border px-3 py-1.5 text-sm ${isSelected
                                  ? 'border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-700))]'
                                  : 'border-[rgb(var(--color-border-200))] bg-white text-[rgb(var(--color-text-700))]'}`}
                                onClick={() => {
                                  setRecurringBuilder((current) => ({
                                    ...current,
                                    weekdays: isSelected
                                      ? current.weekdays.filter((value) => value !== weekday.value)
                                      : [...current.weekdays, weekday.value],
                                  }));
                                }}
                              >
                                {weekday.shortLabel}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {recurringValidationMessage ? (
                      <div className="text-xs text-destructive">{recurringValidationMessage}</div>
                    ) : recurringSummary ? (
                      <div className="rounded-md border border-[rgb(var(--color-border-200))] bg-white px-3 py-2 text-sm text-[rgb(var(--color-text-700))]">
                        <div>{recurringSummary}</div>
                        <div className="mt-1 text-xs text-[rgb(var(--color-text-500))]">
                          {t('schedules.dialog.recurring.cronPreview', {
                            defaultValue: 'Cron: {{cron}}',
                            cron: effectiveRecurringCron,
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {unsupportedRecurringCron && (
                      <Alert variant="warning">
                        <AlertDescription>
                          {t('schedules.dialog.recurring.customCronWarning', {
                            defaultValue: 'This schedule uses a custom cron expression. Keep editing it here, or switch back to the builder to replace it with a common pattern.',
                          })}
                        </AlertDescription>
                      </Alert>
                    )}
                    <Input
                      id="schedule-dialog-cron"
                      label={t('schedules.dialog.fields.cron', { defaultValue: 'Cron' })}
                      value={cron}
                      onChange={(event) => setCron(event.target.value)}
                      placeholder="0 9 * * 1-5"
                    />
                  </div>
                )}

                <WorkflowScheduleTimezonePicker
                  id="schedule-dialog-timezone"
                  label={t('schedules.dialog.fields.timezone', { defaultValue: 'Timezone' })}
                  value={timezone}
                  onValueChange={setTimezone}
                />
              </div>
            )}

            {workflowEligibilityMessage && selectedWorkflowId && (
              <Alert variant="warning">
                <AlertDescription>{workflowEligibilityMessage}</AlertDescription>
              </Alert>
            )}

            <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background-50))] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-[rgb(var(--color-text-900))]">
                    {t('schedules.dialog.payload.title', { defaultValue: 'Payload' })}
                  </div>
                  <div className="text-xs text-[rgb(var(--color-text-500))]">
                    {t('schedules.dialog.payload.description', {
                      defaultValue: 'Author static input that will be passed into each scheduled run.',
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    id="schedule-dialog-mode-form"
                    variant={payloadMode === 'form' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handlePayloadModeChange('form')}
                  >
                    {t('schedules.dialog.payload.mode.form', { defaultValue: 'Form Mode' })}
                  </Button>
                  <Button
                    id="schedule-dialog-mode-json"
                    variant={payloadMode === 'json' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handlePayloadModeChange('json')}
                  >
                    {t('schedules.dialog.payload.mode.json', { defaultValue: 'JSON Mode' })}
                  </Button>
                </div>
              </div>

              {payloadSchema && payloadMode === 'form' ? (
                <div className="space-y-3">
                  {renderField(payloadSchema, formValue, [], new Set(payloadSchema.required ?? []))}
                </div>
              ) : payloadMode === 'json' ? (
                <div>
                  <TextArea
                    id="schedule-dialog-payload-json"
                    value={payloadText}
                    onChange={(event) => handlePayloadTextChange(event.target.value)}
                    rows={14}
                    className={jsonError ? 'border-destructive' : ''}
                  />
                  {jsonError && (
                    <div className="mt-1 text-xs text-destructive">{jsonError}</div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-white p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-full bg-[rgb(var(--color-background-100))] p-1.5 text-[rgb(var(--color-text-500))]">
                      <Info className="h-4 w-4" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-[rgb(var(--color-text-900))]">
                        {t('schedules.dialog.payload.noSchema.title', {
                          defaultValue: 'No payload schema is available for this workflow yet.',
                        })}
                      </div>
                      <div className="text-sm text-[rgb(var(--color-text-600))]">
                        {t('schedules.dialog.payload.noSchema.description', {
                          defaultValue: 'Form fields will appear here once this workflow publishes a pinned payload schema.',
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {schemaErrors.length > 0 && (
                <Alert variant="destructive" className="mt-3">
                  <AlertTitle>
                    {t('schedules.dialog.validation.title', { defaultValue: 'Payload validation errors' })}
                  </AlertTitle>
                  <AlertDescription>
                    <div className="space-y-1 text-xs">
                      {schemaErrors.slice(0, 6).map((error, index) => (
                        <div key={`${error.path}-${index}`}>
                          {error.path || t('schedules.dialog.payload.rootKey', { defaultValue: 'payload' })}: {error.message}
                        </div>
                      ))}
                      {schemaErrors.length > 6 && (
                        <div>
                          {t('schedules.dialog.validation.more', {
                            defaultValue: '+{{count}} more…',
                            count: schemaErrors.length - 6,
                          })}
                        </div>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {submitError && (
              <Alert variant="destructive">
                <AlertTitle>{submitError}</AlertTitle>
                {serverIssues.length > 0 && (
                  <AlertDescription>
                    <div className="space-y-1 text-xs">
                      {serverIssues.map((issue, index) => (
                        <div key={`${issue.path ?? 'payload'}-${index}`}>
                          {(issue.path ?? t('schedules.dialog.payload.rootKey', { defaultValue: 'payload' }))}: {issue.message ?? t('schedules.dialog.validation.invalidValue', {
                            defaultValue: 'Invalid value',
                          })}
                        </div>
                      ))}
                    </div>
                  </AlertDescription>
                )}
              </Alert>
            )}
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
