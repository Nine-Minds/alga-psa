'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Badge } from '@alga-psa/ui/components/Badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@alga-psa/ui/components/Dialog';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import {
  createWorkflowScheduleAction,
  getWorkflowScheduleAction,
  getWorkflowSchemaAction,
  listWorkflowDefinitionsPagedAction,
  listWorkflowSchemaRefsAction,
  updateWorkflowScheduleAction
} from '@alga-psa/workflows/actions';
import {
  buildCronFromRecurringBuilder,
  DEFAULT_RECURRING_BUILDER_STATE,
  getRecurringBuilderSummary,
  getRecurringBuilderValidationMessage,
  parseRecurringBuilderFromCron,
  WEEKDAY_OPTIONS,
  type RecurringBuilderState,
} from './workflowScheduleRecurrence';

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

type WorkflowScheduleDialogProps = {
  isOpen: boolean;
  mode: 'create' | 'edit';
  scheduleId?: string | null;
  initialWorkflowId?: string | null;
  onClose: () => void;
  onSaved: () => void;
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

const validateAgainstSchema = (schema: JsonSchema, value: unknown, root: JsonSchema, path = ''): ValidationError[] => {
  const resolved = resolveSchemaRef(schema, root);
  const type = Array.isArray(resolved.type) ? resolved.type[0] : resolved.type;
  const errors: ValidationError[] = [];

  if (resolved.enum && value != null && !resolved.enum.includes(value as any)) {
    errors.push({ path, message: 'Value must be one of the allowed options.' });
  }

  if (type === 'object') {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      errors.push({ path, message: 'Expected object.' });
      return errors;
    }

    const objectValue = value as Record<string, unknown>;
    const properties = resolved.properties ?? {};
    const required = new Set(resolved.required ?? []);

    for (const key of required) {
      if (objectValue[key] === undefined || objectValue[key] === null || objectValue[key] === '') {
        errors.push({ path: path ? `${path}.${key}` : key, message: 'Required field missing.' });
      }
    }

    for (const [key, propSchema] of Object.entries(properties)) {
      errors.push(...validateAgainstSchema(propSchema, objectValue[key], root, path ? `${path}.${key}` : key));
    }

    if (resolved.additionalProperties === false) {
      const knownKeys = new Set(Object.keys(properties));
      for (const key of Object.keys(objectValue)) {
        if (!knownKeys.has(key)) {
          errors.push({ path: path ? `${path}.${key}` : key, message: 'Unknown property.' });
        }
      }
    }

    return errors;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) {
      errors.push({ path, message: 'Expected array.' });
      return errors;
    }

    value.forEach((item, index) => {
      errors.push(...validateAgainstSchema(resolved.items ?? {}, item, root, `${path}[${index}]`));
    });
    return errors;
  }

  if (type === 'string' && value != null && typeof value !== 'string') {
    errors.push({ path, message: 'Expected string.' });
  }
  if ((type === 'number' || type === 'integer') && value != null && typeof value !== 'number') {
    errors.push({ path, message: 'Expected number.' });
  }
  if (type === 'boolean' && value != null && typeof value !== 'boolean') {
    errors.push({ path, message: 'Expected boolean.' });
  }

  return errors;
};

const toDatetimeLocalValue = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toIsoString = (value: string): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
};

const buildWorkflowEligibilityMessage = (
  workflow: WorkflowOption | null,
  availableSchemaRefs?: ReadonlySet<string>
): string | null => {
  if (!workflow) return 'Choose a workflow before saving.';
  if (!workflow.published_version) {
    return 'Schedules can only be created for workflows with a published version.';
  }
  if (String(workflow.payload_schema_mode ?? 'pinned') !== 'pinned') {
    return 'Schedules are only supported for workflows with a pinned payload schema.';
  }
  if (!workflow.payload_schema_ref) {
    return 'The selected workflow does not expose a pinned payload schema.';
  }
  if (availableSchemaRefs && !availableSchemaRefs.has(workflow.payload_schema_ref)) {
    return `The selected workflow uses an unavailable payload schema ref: ${workflow.payload_schema_ref}.`;
  }
  return null;
};

export default function WorkflowScheduleDialog({
  isOpen,
  mode,
  scheduleId,
  initialWorkflowId,
  onClose,
  onSaved
}: WorkflowScheduleDialogProps) {
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowOption[]>([]);
  const [availableSchemaRefs, setAvailableSchemaRefs] = useState<Set<string>>(new Set());
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false);
  const [isLoadingSchedule, setIsLoadingSchedule] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(initialWorkflowId ?? '');
  const [scheduleName, setScheduleName] = useState('');
  const [triggerType, setTriggerType] = useState<'schedule' | 'recurring'>('schedule');
  const [runAt, setRunAt] = useState('');
  const [cron, setCron] = useState('');
  const [recurringMode, setRecurringMode] = useState<RecurringEditorMode>('builder');
  const [recurringBuilder, setRecurringBuilder] = useState<RecurringBuilderState>(DEFAULT_RECURRING_BUILDER_STATE);
  const [timezone, setTimezone] = useState('UTC');
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

  const selectedWorkflow = useMemo(
    () => workflowOptions.find((workflow) => workflow.workflow_id === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflowOptions]
  );
  const workflowEligibilityMessage = useMemo(
    () => buildWorkflowEligibilityMessage(selectedWorkflow, availableSchemaRefs),
    [availableSchemaRefs, selectedWorkflow]
  );

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const loadWorkflows = async () => {
      setIsLoadingWorkflows(true);
      try {
        const [workflowResult, schemaRefResult] = await Promise.all([
          listWorkflowDefinitionsPagedAction({
            page: 1,
            pageSize: 200,
            status: 'all',
            trigger: 'all',
            sortBy: 'name',
            sortDirection: 'asc'
          }),
          listWorkflowSchemaRefsAction()
        ]);
        if (cancelled) return;
        setWorkflowOptions(((workflowResult as { items?: WorkflowOption[] } | null)?.items ?? []) as WorkflowOption[]);
        setAvailableSchemaRefs(new Set(((schemaRefResult as { refs?: string[] } | null)?.refs ?? []) as string[]));
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load workflows for schedule dialog', error);
        setWorkflowOptions([]);
        setAvailableSchemaRefs(new Set());
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
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    setSubmitError(null);
    setServerIssues([]);

    if (mode === 'edit' && scheduleId) {
      let cancelled = false;
      const loadSchedule = async () => {
        setIsLoadingSchedule(true);
        try {
          const schedule = await getWorkflowScheduleAction({ scheduleId });
          if (cancelled) return;
          setSelectedWorkflowId(schedule.workflow_id);
          setScheduleName(schedule.name ?? '');
          setTriggerType(schedule.trigger_type);
          setRunAt(toDatetimeLocalValue(schedule.run_at));
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
          setEnabled(Boolean(schedule.enabled));
          const nextPayload = schedule.payload_json ?? {};
          setPayloadText(JSON.stringify(nextPayload, null, 2));
          setFormValue(nextPayload);
          setJsonError(null);
          setPayloadTouched(true);
        } catch (error) {
          if (cancelled) return;
          console.error('Failed to load workflow schedule', error);
          setSubmitError(error instanceof Error ? error.message : 'Failed to load schedule.');
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
    setRunAt('');
    setCron('');
    setRecurringMode('builder');
    setRecurringBuilder(DEFAULT_RECURRING_BUILDER_STATE);
    setTimezone('UTC');
    setEnabled(true);
    setPayloadText('{}');
    setFormValue({});
    setJsonError(null);
    setSchemaErrors([]);
    setPayloadMode('form');
    setPayloadTouched(false);
    setIsLoadingSchedule(false);
    return undefined;
  }, [initialWorkflowId, isOpen, mode, scheduleId]);

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

    setSchemaErrors(validateAgainstSchema(payloadSchema, value ?? {}, payloadSchema));
  }, [formValue, payloadMode, payloadSchema, payloadText]);

  const workflowPickerOptions = useMemo<SelectOption[]>(
    () => workflowOptions.map((workflow) => {
      const eligibilityMessage = buildWorkflowEligibilityMessage(workflow, availableSchemaRefs);
      return {
        value: workflow.workflow_id,
        label: (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900">{workflow.name}</span>
              {workflow.published_version ? (
                <Badge variant="info" size="sm">v{workflow.published_version}</Badge>
              ) : (
                <Badge variant="warning" size="sm">Unpublished</Badge>
              )}
              {String(workflow.payload_schema_mode ?? 'pinned') !== 'pinned' && (
                <Badge variant="warning" size="sm">Inferred schema</Badge>
              )}
            </div>
            {eligibilityMessage && (
              <div className="text-[11px] text-gray-500">{eligibilityMessage}</div>
            )}
          </div>
        ),
        textValue: workflow.name
      };
    }),
    [availableSchemaRefs, workflowOptions]
  );

  const parsePayloadForSubmit = (): Record<string, unknown> | null => {
    try {
      if (payloadMode === 'json') {
        const parsed = JSON.parse(payloadText || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setJsonError('Schedule payload must be a JSON object.');
          return null;
        }
        setJsonError(null);
        return parsed as Record<string, unknown>;
      }

      if (!formValue || typeof formValue !== 'object' || Array.isArray(formValue)) {
        setJsonError('Schedule payload must be a JSON object.');
        return null;
      }
      setJsonError(null);
      return formValue as Record<string, unknown>;
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : 'Invalid JSON');
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
  );

  const recurringValidationMessage = useMemo(
    () => triggerType !== 'recurring' || recurringMode === 'advanced'
      ? null
      : getRecurringBuilderValidationMessage(recurringBuilder),
    [recurringBuilder, recurringMode, triggerType]
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
      : getRecurringBuilderSummary(recurringBuilder, timezone),
    [recurringBuilder, recurringMode, timezone, triggerType]
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
      setJsonError(error instanceof Error ? error.message : 'Invalid JSON');
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
    const label = resolved.title ?? (typeof fieldKey === 'string' ? fieldKey : 'Payload');
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
              Add item
            </Button>
          </div>
          {items.length === 0 && (
            <div className="text-xs text-[rgb(var(--color-text-500))]">No items yet.</div>
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
                  Remove
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
            <span className="text-xs text-[rgb(var(--color-text-500))]">{value ? 'True' : 'False'}</span>
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
      setJsonError(error instanceof Error ? error.message : 'Invalid JSON');
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
        ? await updateWorkflowScheduleAction({
          scheduleId,
          ...common,
          runAt: triggerType === 'schedule' ? toIsoString(runAt) : undefined,
          cron: triggerType === 'recurring' ? effectiveRecurringCron : undefined,
          timezone: triggerType === 'recurring' ? timezone.trim() : undefined
        })
        : await createWorkflowScheduleAction({
          ...common,
          runAt: triggerType === 'schedule' ? toIsoString(runAt) : undefined,
          cron: triggerType === 'recurring' ? effectiveRecurringCron : undefined,
          timezone: triggerType === 'recurring' ? timezone.trim() : undefined
        });

      if ((result as { ok?: boolean }).ok === false) {
        const failure = result as { message?: string; issues?: Array<{ path?: Array<string | number>; message?: string }> };
        setSubmitError(failure.message ?? 'Failed to save schedule.');
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
      setSubmitError(error instanceof Error ? error.message : 'Failed to save schedule.');
    } finally {
      setIsSaving(false);
    }
  };

  const dialogBusy = isLoadingWorkflows || isLoadingSchedule;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'edit' ? 'Edit Schedule' : 'Create Schedule'}
      className="max-w-5xl"
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'Edit Schedule' : 'Create Schedule'}</DialogTitle>
          <DialogDescription>
            Configure timing and static payload data for a workflow schedule.
          </DialogDescription>
        </DialogHeader>

        {dialogBusy ? (
          <div className="py-8 text-sm text-[rgb(var(--color-text-500))]">Loading schedule details…</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <CustomSelect
                id="schedule-dialog-workflow"
                label="Workflow"
                options={workflowPickerOptions}
                value={selectedWorkflowId}
                onValueChange={(value) => {
                  setSelectedWorkflowId(value);
                  setPayloadTouched(false);
                }}
                placeholder="Choose a workflow"
              />
              <Input
                id="schedule-dialog-name"
                label="Schedule name"
                value={scheduleName}
                onChange={(event) => setScheduleName(event.target.value)}
                placeholder="Month-end AP sync"
              />
              <CustomSelect
                id="schedule-dialog-trigger-type"
                label="Trigger type"
                value={triggerType}
                onValueChange={(value) => {
                  const nextTriggerType = value as 'schedule' | 'recurring';
                  setTriggerType(nextTriggerType);
                  if (nextTriggerType === 'recurring' && !cron.trim()) {
                    setRecurringMode('builder');
                  }
                }}
                options={[
                  { value: 'schedule', label: 'One-time' },
                  { value: 'recurring', label: 'Recurring' }
                ]}
              />
              <div className="space-y-2">
                <label className="text-sm font-medium text-[rgb(var(--color-text-800))]">Enabled</label>
                <div className="flex h-10 items-center gap-2 rounded-lg border border-[rgb(var(--color-border-200))] px-3">
                  <Switch checked={enabled} onCheckedChange={setEnabled} />
                  <span className="text-sm text-[rgb(var(--color-text-600))]">
                    {enabled ? 'Schedule will run when valid.' : 'Schedule will stay paused until resumed.'}
                  </span>
                </div>
              </div>
            </div>

            {triggerType === 'schedule' ? (
              <Input
                id="schedule-dialog-run-at"
                label="Run at"
                type="datetime-local"
                value={runAt}
                onChange={(event) => setRunAt(event.target.value)}
              />
            ) : (
              <div className="space-y-4 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background-50))] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-[rgb(var(--color-text-900))]">Recurring schedule</div>
                    <div className="text-xs text-[rgb(var(--color-text-500))]">
                      Choose a common recurrence pattern. Advanced cron is available for custom schedules.
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
                      Schedule Builder
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
                      Advanced Cron
                    </button>
                  </div>
                </div>

                {recurringMode === 'builder' ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <CustomSelect
                        id="schedule-dialog-recurring-frequency"
                        label="Frequency"
                        value={recurringBuilder.frequency}
                        onValueChange={(value) => {
                          setRecurringBuilder((current) => ({
                            ...current,
                            frequency: value as RecurringBuilderState['frequency'],
                          }));
                        }}
                        options={[
                          { value: 'daily', label: 'Daily' },
                          { value: 'weekly', label: 'Weekly' },
                          { value: 'monthly', label: 'Monthly' },
                        ]}
                      />
                      <Input
                        id="schedule-dialog-recurring-time"
                        label="Time"
                        type="time"
                        value={recurringBuilder.time}
                        onChange={(event) => {
                          const nextTime = event.target.value;
                          setRecurringBuilder((current) => ({
                            ...current,
                            time: nextTime,
                          }));
                        }}
                      />
                      {recurringBuilder.frequency === 'monthly' ? (
                        <Input
                          id="schedule-dialog-recurring-day-of-month"
                          label="Day of month"
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
                            ? 'Runs every day at the selected time.'
                            : 'Choose one or more weekdays below.'}
                        </div>
                      )}
                    </div>

                    {recurringBuilder.frequency === 'weekly' && (
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-[rgb(var(--color-text-800))]">Weekdays</div>
                        <div className="flex flex-wrap gap-2">
                          {WEEKDAY_OPTIONS.map((weekday) => {
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
                          Cron: {effectiveRecurringCron}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {unsupportedRecurringCron && (
                      <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                        This schedule uses a custom cron expression. Keep editing it here, or switch back to the builder to replace it with a common pattern.
                      </div>
                    )}
                    <Input
                      id="schedule-dialog-cron"
                      label="Cron"
                      value={cron}
                      onChange={(event) => setCron(event.target.value)}
                      placeholder="0 9 * * 1-5"
                    />
                  </div>
                )}

                <Input
                  id="schedule-dialog-timezone"
                  label="Timezone"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  placeholder="America/New_York"
                />
              </div>
            )}

            {workflowEligibilityMessage && selectedWorkflowId && (
              <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning-foreground">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{workflowEligibilityMessage}</span>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background-50))] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-[rgb(var(--color-text-900))]">Payload</div>
                  <div className="text-xs text-[rgb(var(--color-text-500))]">
                    Author static input that will be passed into each scheduled run.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    id="schedule-dialog-mode-form"
                    variant={payloadMode === 'form' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handlePayloadModeChange('form')}
                  >
                    Form Mode
                  </Button>
                  <Button
                    id="schedule-dialog-mode-json"
                    variant={payloadMode === 'json' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handlePayloadModeChange('json')}
                  >
                    JSON Mode
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
                <div className="rounded border border-warning/30 bg-warning/10 p-3 text-sm text-warning-foreground">
                  No payload schema is available for this workflow yet.
                </div>
              )}

              {schemaErrors.length > 0 && (
                <div className="mt-3 rounded border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  <div className="font-semibold">Payload validation errors</div>
                  {schemaErrors.slice(0, 6).map((error, index) => (
                    <div key={`${error.path}-${index}`}>{error.path || 'payload'}: {error.message}</div>
                  ))}
                  {schemaErrors.length > 6 && (
                    <div>+{schemaErrors.length - 6} more…</div>
                  )}
                </div>
              )}
            </div>

            {submitError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <div className="font-medium">{submitError}</div>
                {serverIssues.length > 0 && (
                  <div className="mt-2 space-y-1 text-xs">
                    {serverIssues.map((issue, index) => (
                      <div key={`${issue.path ?? 'payload'}-${index}`}>
                        {(issue.path ?? 'payload')}: {issue.message ?? 'Invalid value'}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <div className="mt-6 flex justify-end gap-2">
            <Button id="schedule-dialog-cancel" variant="outline" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              id="schedule-dialog-save"
              onClick={() => void handleSave()}
              disabled={!canSave || isSaving || dialogBusy}
            >
              {isSaving ? 'Saving…' : mode === 'edit' ? 'Save Changes' : 'Create Schedule'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
