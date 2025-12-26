'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import CustomSelect, { SelectOption } from '@/components/ui/CustomSelect';
import { Switch } from '@/components/ui/Switch';
import toast from 'react-hot-toast';
import {
  getWorkflowSchemaAction,
  getLatestWorkflowRunAction,
  listWorkflowDefinitionVersionsAction,
  startWorkflowRunAction
} from 'server/src/lib/actions/workflow-runtime-v2-actions';

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

type WorkflowRunDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  workflowId: string | null;
  workflowName?: string | null;
  triggerLabel?: string | null;
  payloadSchemaRef?: string | null;
  publishedVersion?: number | null;
  draftVersion?: number | null;
  isSystem?: boolean;
  isPaused?: boolean;
  validationStatus?: string | null;
  concurrencyLimit?: number | null;
  canPublish?: boolean;
  onPublishDraft?: () => Promise<void> | void;
};

type Preset = { name: string; payload: string };

const RUN_OPTIONS_KEY = (workflowId: string) => `workflow-run-options:${workflowId}`;
const RUN_PRESETS_KEY = (workflowId: string) => `workflow-run-presets:${workflowId}`;

const SAMPLE_TEMPLATES: Array<{ id: string; label: string; payload: Record<string, unknown> }> = [
  {
    id: 'email',
    label: 'Inbound Email',
    payload: {
      emailData: {
        id: 'email_123',
        subject: 'Hello!',
        from: { name: 'Jane Doe', email: 'jane@example.com' },
        to: [{ name: 'Support', email: 'support@example.com' }],
        body: { text: 'Sample email body', html: '<p>Sample email body</p>' },
        attachments: []
      }
    }
  },
  {
    id: 'webhook',
    label: 'Webhook Event',
    payload: {
      eventId: 'evt_123',
      eventType: 'customer.created',
      timestamp: new Date().toISOString(),
      payload: { customerId: 'cus_123', email: 'customer@example.com' }
    }
  }
];

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

const pathToString = (path: Array<string | number>) =>
  path.reduce((acc, part) => (typeof part === 'number' ? `${acc}[${part}]` : acc ? `${acc}.${part}` : part), '');

type ValidationError = { path: string; message: string };

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
    const required = new Set(resolved.required ?? []);
    for (const key of required) {
      if ((value as any)[key] === undefined || (value as any)[key] === null || (value as any)[key] === '') {
        errors.push({ path: path ? `${path}.${key}` : key, message: 'Required field missing.' });
      }
    }
    for (const [key, propSchema] of Object.entries(resolved.properties ?? {})) {
      errors.push(...validateAgainstSchema(propSchema, (value as any)[key], root, path ? `${path}.${key}` : key));
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

const WorkflowRunDialog: React.FC<WorkflowRunDialogProps> = ({
  isOpen,
  onClose,
  workflowId,
  workflowName,
  triggerLabel,
  payloadSchemaRef,
  publishedVersion,
  draftVersion,
  isSystem,
  isPaused,
  validationStatus,
  concurrencyLimit,
  canPublish = false,
  onPublishDraft
}) => {
  const [payloadSchema, setPayloadSchema] = useState<JsonSchema | null>(null);
  const [runPayloadText, setRunPayloadText] = useState('');
  const [runPayloadError, setRunPayloadError] = useState<string | null>(null);
  const [formValue, setFormValue] = useState<unknown>({});
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [mode, setMode] = useState<'json' | 'form'>('json');
  const [schemaErrors, setSchemaErrors] = useState<ValidationError[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [confirmSystemRun, setConfirmSystemRun] = useState(false);
  const [versionOptions, setVersionOptions] = useState<SelectOption[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [hasLoadedOptions, setHasLoadedOptions] = useState(false);

  const defaults = useMemo(() => (
    payloadSchema ? buildDefaultValueFromSchema(payloadSchema, payloadSchema) : {}
  ), [payloadSchema]);

  const payloadSize = useMemo(() => {
    const text = mode === 'json' ? runPayloadText : JSON.stringify(formValue ?? {}, null, 2);
    if (typeof TextEncoder === 'undefined') return 0;
    return new TextEncoder().encode(text || '').length;
  }, [formValue, mode, runPayloadText]);

  const payloadWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (payloadSize > 256 * 1024) {
      warnings.push('Payload size exceeds 256KB; runs may be slower.');
    }
    return warnings;
  }, [payloadSize]);

  const canRun = !!workflowId
    && !!publishedVersion
    && validationStatus !== 'error'
    && !isPaused;

  useEffect(() => {
    if (!isOpen || !workflowId) return;
    setHasLoadedOptions(false);
    const storedOptions = window.localStorage.getItem(RUN_OPTIONS_KEY(workflowId));
    if (storedOptions) {
      try {
        const parsed = JSON.parse(storedOptions);
        if (parsed?.payloadText) setRunPayloadText(parsed.payloadText);
        if (parsed?.mode) setMode(parsed.mode);
        if (parsed?.selectedVersion) setSelectedVersion(String(parsed.selectedVersion));
      } catch {}
    }
    const storedPresets = window.localStorage.getItem(RUN_PRESETS_KEY(workflowId));
    if (storedPresets) {
      try {
        setPresets(JSON.parse(storedPresets) as Preset[]);
      } catch {
        setPresets([]);
      }
    }
    setHasLoadedOptions(true);
  }, [isOpen, workflowId]);

  useEffect(() => {
    if (!isOpen || !workflowId || !payloadSchemaRef) return;
    getWorkflowSchemaAction({ schemaRef: payloadSchemaRef })
      .then((result) => setPayloadSchema((result?.schema ?? null) as JsonSchema | null))
      .catch(() => setPayloadSchema(null));
  }, [isOpen, payloadSchemaRef, workflowId]);

  useEffect(() => {
    if (!isOpen || !workflowId) return;
    listWorkflowDefinitionVersionsAction({ workflowId })
      .then((result) => {
        const versions = (result as { versions?: Array<{ version: number }> } | null)?.versions ?? [];
        setVersionOptions(
          versions.map((version) => ({
            value: String(version.version),
            label: `v${version.version}`
          }))
        );
        if (!selectedVersion && publishedVersion) {
          setSelectedVersion(String(publishedVersion));
        }
      })
      .catch(() => setVersionOptions([]));
  }, [isOpen, workflowId, publishedVersion, selectedVersion]);

  useEffect(() => {
    if (!isOpen || !hasLoadedOptions) return;
    if (runPayloadText) return;
    const text = JSON.stringify(defaults ?? {}, null, 2);
    setRunPayloadText(text);
    try {
      setFormValue(JSON.parse(text));
      setRunPayloadError(null);
    } catch (error) {
      setRunPayloadError(error instanceof Error ? error.message : 'Invalid JSON');
    }
  }, [defaults, hasLoadedOptions, isOpen, runPayloadText]);

  useEffect(() => {
    if (!isOpen) return;
    if (mode === 'form') {
      try {
        setFormValue(JSON.parse(runPayloadText || '{}'));
      } catch {
        // keep existing form value
      }
    } else {
      setRunPayloadText(JSON.stringify(formValue ?? {}, null, 2));
    }
  }, [mode]);

  useEffect(() => {
    if (!workflowId || !isOpen) return;
    const payload = mode === 'json' ? runPayloadText : JSON.stringify(formValue ?? {}, null, 2);
    const options = { payloadText: payload, mode, selectedVersion };
    window.localStorage.setItem(RUN_OPTIONS_KEY(workflowId), JSON.stringify(options));
  }, [formValue, isOpen, mode, runPayloadText, selectedVersion, workflowId]);

  useEffect(() => {
    if (!payloadSchema) return;
    const value = mode === 'json' ? (() => {
      try {
        return JSON.parse(runPayloadText || '{}');
      } catch {
        return null;
      }
    })() : formValue;
    const errors = validateAgainstSchema(payloadSchema, value ?? {}, payloadSchema);
    setSchemaErrors(errors);
  }, [formValue, mode, payloadSchema, runPayloadText]);

  const handleRunPayloadChange = (value: string) => {
    setRunPayloadText(value);
    try {
      const parsed = JSON.parse(value);
      setFormValue(parsed);
      setRunPayloadError(null);
    } catch (err) {
      setRunPayloadError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const applyTemplate = (payload: Record<string, unknown>) => {
    const next = JSON.stringify(payload, null, 2);
    setRunPayloadText(next);
    setFormValue(payload);
    setRunPayloadError(null);
  };

  const handleResetDefaults = () => {
    applyTemplate((defaults ?? {}) as Record<string, unknown>);
  };

  const handleCloneLatest = async () => {
    if (!workflowId) return;
    try {
      const result = await getLatestWorkflowRunAction({ workflowId });
      const run = (result as { run?: { input_json?: Record<string, unknown> | null } | null } | null)?.run;
      if (!run?.input_json) {
        toast.error('No prior run payload found.');
        return;
      }
      applyTemplate(run.input_json ?? {});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load latest run');
    }
  };

  const handleSavePreset = () => {
    if (!workflowId || presetName.trim().length === 0) {
      toast.error('Provide a preset name.');
      return;
    }
    const payload = mode === 'json' ? runPayloadText : JSON.stringify(formValue ?? {}, null, 2);
    const next = [...presets.filter((preset) => preset.name !== presetName.trim()), { name: presetName.trim(), payload }];
    setPresets(next);
    window.localStorage.setItem(RUN_PRESETS_KEY(workflowId), JSON.stringify(next));
    setPresetName('');
    toast.success('Preset saved.');
  };

  const handleLoadPreset = (preset: Preset) => {
    setRunPayloadText(preset.payload);
    try {
      setFormValue(JSON.parse(preset.payload));
      setRunPayloadError(null);
    } catch (error) {
      setRunPayloadError(error instanceof Error ? error.message : 'Invalid JSON');
    }
  };

  const handleDeletePreset = (preset: Preset) => {
    if (!workflowId) return;
    const next = presets.filter((item) => item.name !== preset.name);
    setPresets(next);
    window.localStorage.setItem(RUN_PRESETS_KEY(workflowId), JSON.stringify(next));
  };

  const copyPayload = async () => {
    const payload = mode === 'json' ? runPayloadText : JSON.stringify(formValue ?? {}, null, 2);
    await navigator.clipboard.writeText(payload);
    toast.success('Payload copied to clipboard.');
  };

  const handleStartRun = async () => {
    if (!workflowId || !publishedVersion) return;
    if (isSystem && !confirmSystemRun) {
      toast.error('Confirm you want to run this system workflow.');
      return;
    }
    let payload: Record<string, unknown> = {};
    try {
      payload = mode === 'json' ? JSON.parse(runPayloadText || '{}') : (formValue as Record<string, unknown>);
    } catch (err) {
      setRunPayloadError(err instanceof Error ? err.message : 'Invalid JSON');
      return;
    }
    setIsStartingRun(true);
    try {
      const result = await startWorkflowRunAction({
        workflowId,
        workflowVersion: selectedVersion ? Number(selectedVersion) : publishedVersion,
        payload
      });
      const runId = (result as { runId?: string } | undefined)?.runId;
      onClose();
      if (runId) {
        window.location.assign(`/msp/workflows/runs/${runId}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start run');
    } finally {
      setIsStartingRun(false);
    }
  };

  const renderField = (
    schema: JsonSchema,
    value: unknown,
    path: Array<string | number>,
    requiredSet: Set<string>
  ) => {
    const resolved = resolveSchemaRef(schema, payloadSchema ?? schema);
    const type = Array.isArray(resolved.type) ? resolved.type[0] : resolved.type;
    const fieldKey = path[path.length - 1];
    const label = resolved.title ?? (typeof fieldKey === 'string' ? fieldKey : 'Payload');
    const isRequired = typeof fieldKey === 'string' && requiredSet.has(fieldKey);
    const fieldPath = pathToString(path);
    const fieldErrors = schemaErrors.filter((err) => err.path === fieldPath);

    const commonHeader = (
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">
          {label}{isRequired && <span className="text-red-500"> *</span>}
        </label>
        {resolved.default !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFormValue((prev) => setValueAtPath(prev, path, resolved.default))}
          >
            Reset
          </Button>
        )}
      </div>
    );

    if (type === 'object') {
      const required = new Set(resolved.required ?? []);
      const sectionId = fieldPath || 'root';
      const isCollapsed = collapsedSections.has(sectionId);
      return (
        <div className="border border-gray-200 rounded p-3 space-y-3">
          <button
            type="button"
            className="flex items-center justify-between text-sm font-semibold text-gray-800 w-full"
            onClick={() => {
              setCollapsedSections((prev) => {
                const next = new Set(prev);
                if (next.has(sectionId)) {
                  next.delete(sectionId);
                } else {
                  next.add(sectionId);
                }
                return next;
              });
            }}
          >
            <span>{label}</span>
            <span className="text-xs text-gray-400">{isCollapsed ? 'Show' : 'Hide'}</span>
          </button>
          {resolved.description && <div className="text-xs text-gray-500">{resolved.description}</div>}
          {!isCollapsed && (
            <div className="space-y-3">
              {Object.entries(resolved.properties ?? {}).map(([key, propSchema]) => (
                <div key={`${fieldPath}.${key}`}>
                  {renderField(
                    propSchema,
                    (value as any)?.[key],
                    [...path, key],
                    required
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (type === 'array') {
      const items = Array.isArray(value) ? value : [];
      return (
        <div className="border border-gray-200 rounded p-3 space-y-2">
          {commonHeader}
          {resolved.description && <div className="text-xs text-gray-500">{resolved.description}</div>}
          {items.map((item, index) => (
            <div key={`${fieldPath}.${index}`} className="flex gap-2 items-start">
              <div className="flex-1">
                {renderField(resolved.items ?? {}, item, [...path, index], new Set())}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const next = items.filter((_, idx) => idx !== index);
                  setFormValue((prev) => setValueAtPath(prev, path, next));
                }}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const next = [...items, buildDefaultValueFromSchema(resolved.items ?? {}, payloadSchema ?? resolved)];
              setFormValue((prev) => setValueAtPath(prev, path, next));
            }}
          >
            Add item
          </Button>
        </div>
      );
    }

    const description = resolved.description ? (
      <div className="text-xs text-gray-500 mt-1">{resolved.description}</div>
    ) : null;

    if (resolved.enum) {
      const options: SelectOption[] = resolved.enum.map((entry) => ({
        value: String(entry),
        label: String(entry)
      }));
      return (
        <div className="space-y-1">
          {commonHeader}
          <CustomSelect
            id={`run-form-${fieldPath}`}
            options={options}
            value={value == null ? '' : String(value)}
            onValueChange={(val) => {
              const actual = resolved.enum?.find((entry) => String(entry) === val);
              setFormValue((prev) => setValueAtPath(prev, path, actual ?? val));
            }}
          />
          {description}
          {fieldErrors.map((err) => (
            <div key={`${fieldPath}-err`} className="text-xs text-red-600">{err.message}</div>
          ))}
        </div>
      );
    }

    if (type === 'boolean') {
      return (
        <div className="space-y-1">
          {commonHeader}
          <div className="flex items-center gap-2">
            <Switch
              checked={Boolean(value)}
              onCheckedChange={(checked) => setFormValue((prev) => setValueAtPath(prev, path, checked))}
            />
            <span className="text-xs text-gray-500">{Boolean(value) ? 'True' : 'False'}</span>
          </div>
          {description}
          {fieldErrors.map((err) => (
            <div key={`${fieldPath}-err`} className="text-xs text-red-600">{err.message}</div>
          ))}
        </div>
      );
    }

    const inputType = resolved.format === 'date-time' ? 'datetime-local' : resolved.format === 'date' ? 'date' : 'text';
    return (
      <div className="space-y-1">
        {commonHeader}
        <Input
          id={`run-form-${fieldPath}`}
          type={type === 'number' || type === 'integer' ? 'number' : inputType}
          value={value == null ? '' : String(value)}
          onChange={(event) => {
            const raw = event.target.value;
            const parsed = raw === '' ? null : (type === 'number' || type === 'integer' ? Number(raw) : raw);
            setFormValue((prev) => setValueAtPath(prev, path, parsed));
          }}
        />
        {description}
        {fieldErrors.map((err) => (
          <div key={`${fieldPath}-err`} className="text-xs text-red-600">{err.message}</div>
        ))}
      </div>
    );
  };

  const exampleOptions = useMemo(() => {
    const examples = payloadSchema?.examples ?? (payloadSchema?.example ? [payloadSchema.example] : []);
    return (examples ?? []).map((entry, index) => ({
      label: `Example ${index + 1}`,
      payload: entry as Record<string, unknown>
    }));
  }, [payloadSchema]);

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Run Workflow" className="max-w-4xl">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run Workflow</DialogTitle>
          <DialogDescription>
            Provide a synthetic payload for a published workflow version.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input id="run-dialog-workflow" label="Workflow" value={workflowName ?? ''} disabled />
            <CustomSelect
              id="run-dialog-version"
              label="Published version"
              options={versionOptions.length ? versionOptions : (publishedVersion ? [{ value: String(publishedVersion), label: `v${publishedVersion}` }] : [])}
              value={selectedVersion || (publishedVersion ? String(publishedVersion) : '')}
              onValueChange={(value) => setSelectedVersion(value)}
            />
            <Input id="run-dialog-trigger" label="Trigger" value={triggerLabel ?? 'Manual'} disabled />
            <Input id="run-dialog-status" label="Workflow status" value={isPaused ? 'paused' : 'active'} disabled />
          </div>

          {draftVersion && publishedVersion && draftVersion !== publishedVersion && (
            <div className="rounded border border-yellow-200 bg-yellow-50 p-2 text-xs text-yellow-700 flex items-center justify-between">
              <span>Draft version differs from published (v{publishedVersion}).</span>
              {canPublish && onPublishDraft && (
                <Button size="sm" onClick={() => onPublishDraft()}>
                  Publish latest
                </Button>
              )}
            </div>
          )}

          {concurrencyLimit && (
            <div className="rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-700">
              Concurrency limit: {concurrencyLimit} run(s) at a time.
            </div>
          )}

          {isSystem && (
            <div className="rounded border border-orange-200 bg-orange-50 p-2 text-xs text-orange-700 space-y-2">
              <div>This is a system workflow. Running it may affect core automation.</div>
              <div className="flex items-center gap-2">
                <Switch checked={confirmSystemRun} onCheckedChange={setConfirmSystemRun} />
                <span>I understand and want to run it.</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant={mode === 'json' ? 'default' : 'outline'} size="sm" onClick={() => setMode('json')}>
              JSON Editor
            </Button>
            <Button variant={mode === 'form' ? 'default' : 'outline'} size="sm" onClick={() => setMode('form')}>
              Form Builder
            </Button>
            <Button variant="outline" size="sm" onClick={handleResetDefaults}>
              Reset to defaults
            </Button>
            <Button variant="outline" size="sm" onClick={copyPayload}>
              Copy payload
            </Button>
            <Button variant="outline" size="sm" onClick={handleCloneLatest}>
              Clone latest run
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {exampleOptions.map((example) => (
              <Button
                key={example.label}
                variant="outline"
                size="sm"
                onClick={() => applyTemplate(example.payload)}
              >
                {example.label}
              </Button>
            ))}
            {SAMPLE_TEMPLATES.map((template) => (
              <Button
                key={template.id}
                variant="outline"
                size="sm"
                onClick={() => applyTemplate(template.payload)}
              >
                {template.label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              id="run-dialog-preset-name"
              label="Preset name"
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
              placeholder="e.g. Regression payload"
            />
            <Button variant="outline" onClick={handleSavePreset} className="self-end">
              Save preset
            </Button>
          </div>

          {presets.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-gray-500">Saved presets</div>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <Badge key={preset.name} className="bg-gray-100 text-gray-700 flex items-center gap-2">
                    <button type="button" onClick={() => handleLoadPreset(preset)}>{preset.name}</button>
                    <button type="button" onClick={() => handleDeletePreset(preset)}>×</button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="text-xs text-gray-500">
            Payload size: {(payloadSize / 1024).toFixed(1)} KB
          </div>
          {payloadWarnings.map((warning) => (
            <div key={warning} className="text-xs text-yellow-700">{warning}</div>
          ))}

          {schemaErrors.length > 0 && (
            <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 space-y-1">
              <div className="font-semibold">Schema validation errors</div>
              {schemaErrors.slice(0, 6).map((err, index) => (
                <div key={`${err.path}-${index}`}>{err.path || 'payload'}: {err.message}</div>
              ))}
              {schemaErrors.length > 6 && <div>+{schemaErrors.length - 6} more…</div>}
            </div>
          )}

          {mode === 'json' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payload (JSON)</label>
              <TextArea
                id="run-dialog-payload"
                value={runPayloadText}
                onChange={(event) => handleRunPayloadChange(event.target.value)}
                rows={12}
                className={runPayloadError ? 'border-red-500' : ''}
              />
              {runPayloadError && <div className="text-xs text-red-600 mt-1">{runPayloadError}</div>}
            </div>
          ) : (
            <div className="space-y-3">
              {payloadSchema ? (
                renderField(payloadSchema, formValue, [], new Set(payloadSchema.required ?? []))
              ) : (
                <div className="text-xs text-gray-500">No schema available to render a form.</div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={handleStartRun}
            disabled={!canRun || isStartingRun || !!runPayloadError || (isSystem && !confirmSystemRun)}
          >
            {isStartingRun ? 'Starting...' : 'Start Run'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WorkflowRunDialog;
