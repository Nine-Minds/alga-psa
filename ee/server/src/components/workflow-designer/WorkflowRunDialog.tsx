'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import toast from 'react-hot-toast';
import SearchableSelect from '@alga-psa/ui/components/SearchableSelect';
import {
  getWorkflowSchemaAction,
  getLatestWorkflowRunAction,
  listWorkflowSchemaRefsAction,
  listWorkflowDefinitionVersionsAction,
  startWorkflowRunAction
} from '@/lib/actions/workflow-runtime-v2-actions';
import { getEventCatalogEntries, getEventCatalogEntryByEventType } from '@alga-psa/workflows/actions';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import {
  filterEventCatalogEntries,
  getSchemaDiffSummary,
  pickEventTemplates
} from './workflowRunDialogUtils';

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
  triggerEventName?: string | null;
  triggerSourcePayloadSchemaRef?: string | null;
  triggerPayloadMappingProvided?: boolean;
  triggerPayloadMappingRequired?: boolean;
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
type EventCatalogEntry = {
  event_id: string;
  event_type: string;
  name: string;
  description?: string | null;
  category?: string | null;
  payload_schema?: Record<string, any> | null;
  payload_schema_ref?: string | null;
  tenant?: string | null;
};

const RUN_OPTIONS_KEY = (workflowId: string) => `workflow-run-options:${workflowId}`;
const RUN_PRESETS_KEY = (workflowId: string) => `workflow-run-presets:${workflowId}`;
const RUN_EVENT_KEY = (workflowId: string) => `workflow-run-event:${workflowId}`;

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
      },
      providerId: 'provider_123',
      tenantId: 'tenant_123'
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

const pathToString = (path: Array<string | number>): string =>
  path.reduce<string>(
    (acc, part) => (typeof part === 'number' ? `${acc}[${part}]` : acc ? `${acc}.${part}` : String(part)),
    ''
  );

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
  triggerEventName,
  triggerSourcePayloadSchemaRef,
  triggerPayloadMappingProvided = false,
  triggerPayloadMappingRequired = false,
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
  const [eventSchema, setEventSchema] = useState<JsonSchema | null>(null);
  const [eventSchemaRef, setEventSchemaRef] = useState<string | null>(null);
  const [schemaSource, setSchemaSource] = useState<'payload' | 'event' | 'schemaRef'>('payload');
  const [schemaRefs, setSchemaRefs] = useState<string[]>([]);
  const [customSchemaRef, setCustomSchemaRef] = useState<string>('');
  const [customSchema, setCustomSchema] = useState<JsonSchema | null>(null);
  const [runPayloadText, setRunPayloadText] = useState('');
  const [runPayloadError, setRunPayloadError] = useState<string | null>(null);
  const [formValue, setFormValue] = useState<unknown>({});
  const [payloadTouched, setPayloadTouched] = useState(false);
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
  const [eventCatalogEntries, setEventCatalogEntries] = useState<EventCatalogEntry[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [eventSearch, setEventSearch] = useState('');
  const [selectedEventType, setSelectedEventType] = useState<string>('');
  const [schemaWarning, setSchemaWarning] = useState<string | null>(null);
  const [showSchemaDiff, setShowSchemaDiff] = useState(false);

  const activeSchema =
    schemaSource === 'event' && eventSchema
      ? eventSchema
      : schemaSource === 'schemaRef'
        ? customSchema
        : payloadSchema;
  const defaults = useMemo(() => (
    activeSchema ? buildDefaultValueFromSchema(activeSchema, activeSchema) : {}
  ), [activeSchema]);

  const selectedEventEntry = useMemo(
    () => eventCatalogEntries.find((entry) => entry.event_type === selectedEventType) ?? null,
    [eventCatalogEntries, selectedEventType]
  );

  const usingWorkflowTriggerEvent = Boolean(triggerEventName && selectedEventType === triggerEventName);

  const filteredEventEntries = useMemo(() => {
    const filtered = filterEventCatalogEntries(eventCatalogEntries, eventSearch);
    if (!selectedEventType) return filtered;
    if (filtered.some((entry) => entry.event_type === selectedEventType)) return filtered;
    const selected = eventCatalogEntries.find((entry) => entry.event_type === selectedEventType);
    return selected ? [selected, ...filtered] : filtered;
  }, [eventCatalogEntries, eventSearch, selectedEventType]);

  const eventOptions = useMemo<SelectOption[]>(() => (
    filteredEventEntries.map((entry) => {
      const isSystemEntry = !entry.tenant;
      return {
        value: entry.event_type,
        label: (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-900">{entry.name}</span>
              <span className="text-[11px] text-gray-400">{entry.event_type}</span>
              <Badge className={`text-[10px] ${isSystemEntry ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                {isSystemEntry ? 'System' : 'Tenant'}
              </Badge>
            </div>
            {(entry.category || entry.description) && (
              <div className="text-[11px] text-gray-500">
                {entry.category ?? 'Uncategorized'}
                {entry.description ? ` · ${entry.description}` : ''}
              </div>
            )}
          </div>
        ),
        className: 'items-start whitespace-normal'
      };
    })
  ), [filteredEventEntries]);

  const schemaDiffSummary = useMemo(
    () => getSchemaDiffSummary(payloadSchema ?? null, eventSchema ?? null),
    [eventSchema, payloadSchema]
  );

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
    setPayloadTouched(false);
    const storedOptions = window.localStorage.getItem(RUN_OPTIONS_KEY(workflowId));
    if (storedOptions) {
      try {
        const parsed = JSON.parse(storedOptions);
        if (parsed?.payloadText) setRunPayloadText(parsed.payloadText);
        if (parsed?.mode) setMode(parsed.mode);
        if (parsed?.selectedVersion) setSelectedVersion(String(parsed.selectedVersion));
        if (parsed?.schemaSource) setSchemaSource(parsed.schemaSource);
        if (parsed?.customSchemaRef) setCustomSchemaRef(String(parsed.customSchemaRef));
        if (parsed?.eventType) setSelectedEventType(parsed.eventType);
      } catch {}
    } else if (triggerEventName) {
      setSchemaSource('event');
    } else {
      setSchemaSource('payload');
    }
    const storedEvent = window.localStorage.getItem(RUN_EVENT_KEY(workflowId));
    if (storedEvent) {
      setSelectedEventType(storedEvent);
    } else if (triggerEventName) {
      setSelectedEventType(triggerEventName);
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
  }, [isOpen, triggerEventName, workflowId]);

  useEffect(() => {
    if (!isOpen) return;
    listWorkflowSchemaRefsAction()
      .then((result) => setSchemaRefs(((result as { refs?: string[] } | null)?.refs ?? []) as string[]))
      .catch(() => setSchemaRefs([]));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (schemaSource !== 'schemaRef') return;
    if (!customSchemaRef) {
      setCustomSchema(null);
      return;
    }
    getWorkflowSchemaAction({ schemaRef: customSchemaRef })
      .then((result) => setCustomSchema((result?.schema ?? null) as JsonSchema | null))
      .catch(() => setCustomSchema(null));
  }, [customSchemaRef, isOpen, schemaSource]);

  useEffect(() => {
    if (!isOpen || !workflowId || !payloadSchemaRef) return;
    getWorkflowSchemaAction({ schemaRef: payloadSchemaRef })
      .then((result) => setPayloadSchema((result?.schema ?? null) as JsonSchema | null))
      .catch(() => setPayloadSchema(null));
  }, [isOpen, payloadSchemaRef, workflowId]);

  useEffect(() => {
    if (!isOpen) return;
    const loadEvents = async () => {
      setIsLoadingEvents(true);
      try {
        const user = await getCurrentUser();
        if (!user?.tenant) return;
        const entries = await getEventCatalogEntries({ tenant: user.tenant });
        setEventCatalogEntries(entries as EventCatalogEntry[]);
      } catch {
        setEventCatalogEntries([]);
      } finally {
        setIsLoadingEvents(false);
      }
    };
    loadEvents();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !selectedEventType) {
      setEventSchema(null);
      setEventSchemaRef(null);
      return;
    }

    // If we're running against the workflow's configured trigger event, prefer the workflow's
    // effective trigger source schemaRef (catalog or override) over the catalog entry payload_schema.
    if (usingWorkflowTriggerEvent && triggerSourcePayloadSchemaRef) {
      setEventSchemaRef(triggerSourcePayloadSchemaRef);
      getWorkflowSchemaAction({ schemaRef: triggerSourcePayloadSchemaRef })
        .then((result) => setEventSchema((result?.schema ?? null) as JsonSchema | null))
        .catch(() => setEventSchema(null));
      return;
    }

    const entry = eventCatalogEntries.find((item) => item.event_type === selectedEventType);
    const entryRef = (entry as any)?.payload_schema_ref;
    if (typeof entryRef === 'string' && entryRef) {
      setEventSchemaRef(entryRef);
      getWorkflowSchemaAction({ schemaRef: entryRef })
        .then((result) => setEventSchema((result?.schema ?? null) as JsonSchema | null))
        .catch(() => setEventSchema(null));
      return;
    }
    if (entry?.payload_schema) {
      setEventSchemaRef(null);
      setEventSchema(entry.payload_schema as JsonSchema);
      return;
    }
    const loadEntry = async () => {
      try {
        const user = await getCurrentUser();
        if (!user?.tenant) return;
        const fetched = await getEventCatalogEntryByEventType({ eventType: selectedEventType, tenant: user.tenant });
        const fetchedRef = (fetched as any)?.payload_schema_ref;
        if (typeof fetchedRef === 'string' && fetchedRef) {
          setEventSchemaRef(fetchedRef);
          const result = await getWorkflowSchemaAction({ schemaRef: fetchedRef });
          setEventSchema((result?.schema ?? null) as JsonSchema | null);
          return;
        }
        if ((fetched as any)?.payload_schema) {
          setEventSchemaRef(null);
          setEventSchema((fetched as any).payload_schema as JsonSchema);
        }
      } catch {
        setEventSchemaRef(null);
        setEventSchema(null);
      }
    };
    loadEntry();
  }, [eventCatalogEntries, isOpen, selectedEventType, triggerSourcePayloadSchemaRef, usingWorkflowTriggerEvent]);

  const mappingRequiredForSelectedEvent = useMemo(() => {
    if (schemaSource !== 'event') return false;
    if (!eventSchemaRef || !payloadSchemaRef) return false;
    return eventSchemaRef !== payloadSchemaRef;
  }, [eventSchemaRef, payloadSchemaRef, schemaSource]);

  const mappingModeLabel = useMemo(() => {
    if (schemaSource !== 'event') return null;
    if (!eventSchemaRef) return null;
    if (!payloadSchemaRef) return null;
    if (!mappingRequiredForSelectedEvent && !triggerPayloadMappingProvided) return 'Identity mapping (no mapping required)';
    if (triggerPayloadMappingProvided) return mappingRequiredForSelectedEvent ? 'Trigger mapping will be applied' : 'Trigger mapping will be applied (optional)';
    return 'Trigger mapping is required but not configured';
  }, [eventSchemaRef, mappingRequiredForSelectedEvent, payloadSchemaRef, schemaSource, triggerPayloadMappingProvided]);

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
    if (payloadTouched) return;
    const text = JSON.stringify(defaults ?? {}, null, 2);
    setRunPayloadText(text);
    setFormValue(defaults ?? {});
    setRunPayloadError(null);
  }, [defaults, hasLoadedOptions, isOpen, payloadTouched]);

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
    const options = { payloadText: payload, mode, selectedVersion, schemaSource, eventType: selectedEventType, customSchemaRef };
    window.localStorage.setItem(RUN_OPTIONS_KEY(workflowId), JSON.stringify(options));
    if (selectedEventType) {
      window.localStorage.setItem(RUN_EVENT_KEY(workflowId), selectedEventType);
    }
  }, [customSchemaRef, formValue, isOpen, mode, runPayloadText, selectedVersion, workflowId, schemaSource, selectedEventType]);

  useEffect(() => {
    if (!activeSchema) return;
    const value = mode === 'json' ? (() => {
      try {
        return JSON.parse(runPayloadText || '{}');
      } catch {
        return null;
      }
    })() : formValue;
    const errors = validateAgainstSchema(activeSchema, value ?? {}, activeSchema);
    setSchemaErrors(errors);
  }, [activeSchema, formValue, mode, runPayloadText]);

  useEffect(() => {
    if (!isOpen) return;

    if (!payloadSchemaRef) {
      setSchemaWarning(null);
      return;
    }

    if (schemaSource === 'event') {
      if (!eventSchemaRef) {
        setSchemaWarning(null);
        return;
      }

      const refMismatch = eventSchemaRef !== payloadSchemaRef;
      const prefix = !usingWorkflowTriggerEvent && selectedEventType
        ? `Selected event (${selectedEventType}) may not match this workflow's trigger (${triggerEventName ?? 'none'}). `
        : '';

      if (!refMismatch) {
        setSchemaWarning(
          prefix + (triggerPayloadMappingProvided
            ? 'Schema refs match; trigger mapping will be applied (optional).'
            : 'Schema refs match; identity mapping will be used (no mapping required).')
        );
        return;
      }

      setSchemaWarning(
        prefix + (triggerPayloadMappingProvided
          ? `Schema refs differ (${eventSchemaRef} → ${payloadSchemaRef}); trigger mapping will be applied.`
          : `Schema refs differ (${eventSchemaRef} → ${payloadSchemaRef}); trigger mapping is required but not configured.`)
      );
      return;
    }

    if (eventSchemaRef && eventSchemaRef !== payloadSchemaRef) {
      setSchemaWarning('Trigger event schema differs from workflow payload schema. Switch to “Event schema” if you want to enter a trigger event payload.');
      return;
    }

    setSchemaWarning(null);
  }, [
    eventSchemaRef,
    isOpen,
    payloadSchemaRef,
    schemaSource,
    selectedEventType,
    triggerEventName,
    triggerPayloadMappingProvided,
    usingWorkflowTriggerEvent
  ]);

  const handleRunPayloadChange = (value: string) => {
    setRunPayloadText(value);
    setPayloadTouched(true);
    try {
      const parsed = JSON.parse(value);
      setFormValue(parsed);
      setRunPayloadError(null);
    } catch (err) {
      setRunPayloadError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const applyTemplate = (payload: Record<string, unknown>, options: { markTouched?: boolean } = {}) => {
    const markTouched = options.markTouched ?? true;
    const next = JSON.stringify(payload, null, 2);
    setRunPayloadText(next);
    setFormValue(payload);
    setRunPayloadError(null);
    setPayloadTouched(markTouched);
  };

  const handleResetDefaults = () => {
    applyTemplate((defaults ?? {}) as Record<string, unknown>, { markTouched: true });
  };

  const handleCloneLatest = async () => {
    if (!workflowId) return;
    try {
      const result = await getLatestWorkflowRunAction({
        workflowId,
        eventType: selectedEventType || undefined
      });
      const run = (result as { run?: { input_json?: Record<string, unknown> | null } | null } | null)?.run;
      if (!run?.input_json) {
        toast.error('No prior run payload found.');
        return;
      }
      applyTemplate(run.input_json ?? {}, { markTouched: true });
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
    if (schemaSource === 'event' && !eventSchemaRef) {
      toast.error('Selected event does not have a payload schema ref; cannot run with trigger mapping.');
      return;
    }
    if (schemaSource === 'event' && mappingRequiredForSelectedEvent && !triggerPayloadMappingProvided) {
      toast.error('Trigger mapping is required for this event schema but is not configured on the workflow.');
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
        payload,
        eventType: selectedEventType || undefined,
        sourcePayloadSchemaRef: schemaSource === 'event' ? eventSchemaRef ?? undefined : undefined
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

  const updateFormValue = (updater: (prev: unknown) => unknown) => {
    setPayloadTouched(true);
    setFormValue((prev) => updater(prev));
  };

  const renderField = (
    schema: JsonSchema,
    value: unknown,
    path: Array<string | number>,
    requiredSet: Set<string>
  ) => {
    const rootSchema = activeSchema ?? schema;
    const resolved = resolveSchemaRef(schema, rootSchema);
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
            id={`run-form-reset-${fieldPath || 'root'}`}
            variant="ghost"
            size="sm"
            onClick={() => updateFormValue((prev) => setValueAtPath(prev, path, resolved.default))}
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
                id={`run-form-array-remove-${fieldPath || 'root'}-${index}`}
                variant="outline"
                size="sm"
                onClick={() => {
                  const next = items.filter((_, idx) => idx !== index);
                  updateFormValue((prev) => setValueAtPath(prev, path, next));
                }}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            id={`run-form-array-add-${fieldPath || 'root'}`}
            variant="outline"
            size="sm"
            onClick={() => {
              const next = [...items, buildDefaultValueFromSchema(resolved.items ?? {}, rootSchema)];
              updateFormValue((prev) => setValueAtPath(prev, path, next));
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
              updateFormValue((prev) => setValueAtPath(prev, path, actual ?? val));
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
              onCheckedChange={(checked) => updateFormValue((prev) => setValueAtPath(prev, path, checked))}
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
            updateFormValue((prev) => setValueAtPath(prev, path, parsed));
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
    const schema = schemaSource === 'event' ? eventSchema : payloadSchema;
    const examples = schema?.examples ?? (schema?.example ? [schema.example] : []);
    return (examples ?? []).map((entry, index) => ({
      label: `Example ${index + 1}`,
      payload: entry as Record<string, unknown>
    }));
  }, [eventSchema, payloadSchema, schemaSource]);

  const eventTemplateIds = useMemo(
    () => pickEventTemplates({ eventType: selectedEventType, category: selectedEventEntry?.category ?? null }),
    [selectedEventEntry?.category, selectedEventType]
  );
  const eventTemplates = useMemo(
    () => SAMPLE_TEMPLATES.filter((template) => eventTemplateIds.includes(template.id)),
    [eventTemplateIds]
  );
  const generalTemplates = useMemo(
    () => SAMPLE_TEMPLATES.filter((template) => !eventTemplateIds.includes(template.id)),
    [eventTemplateIds]
  );

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Run Workflow" className="max-w-4xl">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Run Workflow{selectedEventType ? ` · ${selectedEventType}` : ''}
          </DialogTitle>
          <DialogDescription>
            Provide a synthetic payload to preview (and run) a workflow.
            {selectedEventEntry?.name ? ` Event: ${selectedEventEntry.name}.` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!publishedVersion && (
            <div className="rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900 space-y-2">
              <div className="font-medium">No published version</div>
              <div className="text-xs text-yellow-800">
                You can preview the payload builder, but you must publish the workflow before starting a run.
              </div>
              {canPublish && onPublishDraft && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    id="run-dialog-publish-draft"
                    size="sm"
                    onClick={() => void onPublishDraft()}
                    disabled={validationStatus === 'error' || isPaused}
                    title={validationStatus === 'error' ? 'Fix validation errors before publishing.' : undefined}
                  >
                    Publish draft
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input id="run-dialog-workflow" label="Workflow" value={workflowName ?? ''} disabled />
            <CustomSelect
              id="run-dialog-version"
              label="Published version"
              options={versionOptions.length ? versionOptions : (publishedVersion ? [{ value: String(publishedVersion), label: `v${publishedVersion}` }] : [])}
              value={selectedVersion || (publishedVersion ? String(publishedVersion) : '')}
              onValueChange={(value) => setSelectedVersion(value)}
              disabled={!publishedVersion}
            />
            <Input id="run-dialog-trigger" label="Trigger" value={triggerLabel ?? 'Manual'} disabled />
            <Input id="run-dialog-status" label="Workflow status" value={isPaused ? 'paused' : 'active'} disabled />
          </div>

          <div className="rounded border border-gray-200 bg-white p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-gray-800">Event catalog</div>
                <div className="text-xs text-gray-500">Pick an event type to seed payload schemas.</div>
              </div>
              {selectedEventType && (
                <Button id="run-dialog-open-event-catalog" asChild variant="ghost" size="sm">
                  <Link href={`/msp/automation-hub?tab=events&eventType=${encodeURIComponent(selectedEventType)}`}>
                    Open event catalog
                  </Link>
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                id="run-dialog-event-search"
                label="Search events"
                value={eventSearch}
                onChange={(event) => setEventSearch(event.target.value)}
                placeholder="Search by name, type, or category"
              />
              <CustomSelect
                id="run-dialog-event-type"
                label="Event type"
                options={eventOptions}
                value={selectedEventType}
                onValueChange={(value) => setSelectedEventType(value)}
                placeholder={isLoadingEvents ? 'Loading events...' : 'Select event type'}
                allowClear
                customStyles={{ item: 'whitespace-normal items-start py-2' }}
              />
            </div>

            {selectedEventEntry && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <Badge className={`text-[10px] ${selectedEventEntry.tenant ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                  {selectedEventEntry.tenant ? 'Tenant event' : 'System event'}
                </Badge>
                <span>{selectedEventEntry.category ?? 'Uncategorized'}</span>
                {selectedEventEntry.description && <span>· {selectedEventEntry.description}</span>}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500">Schema source</span>
              <Button
                id="run-dialog-schema-source-workflow"
                variant={schemaSource === 'payload' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSchemaSource('payload')}
              >
                Workflow schema
              </Button>
              <Button
                id="run-dialog-schema-source-event"
                variant={schemaSource === 'event' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSchemaSource('event')}
                disabled={!eventSchema}
              >
                Event schema
              </Button>
              <Button
                id="run-dialog-schema-source-schema-ref"
                variant={schemaSource === 'schemaRef' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSchemaSource('schemaRef')}
              >
                Schema ref
              </Button>
              {schemaSource === 'event' && !eventSchema && (
                <span className="text-xs text-yellow-700">
                  Event schema not available; using workflow schema instead.
                </span>
              )}
            </div>

            {schemaSource === 'schemaRef' && (
              <div className="mt-2">
                <SearchableSelect
                  id="run-dialog-schema-ref"
                  label="Schema ref"
                  dropdownMode="overlay"
                  placeholder="Select schema…"
                  value={customSchemaRef}
                  onChange={(value) => setCustomSchemaRef(value)}
                  options={schemaRefs.map((ref) => ({ value: ref, label: ref }))}
                  emptyMessage="No schemas found"
                />
                {customSchemaRef && !customSchema && (
                  <div className="mt-2 text-xs text-red-600">Unknown schema ref.</div>
                )}
              </div>
            )}

            {schemaWarning && (
              <div className="rounded border border-yellow-200 bg-yellow-50 p-2 text-xs text-yellow-800 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{schemaWarning}</span>
                  {eventSchema && schemaSource !== 'event' && (
                    <Button
                      id="run-dialog-use-event-schema"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSchemaSource('event');
                        if (eventSchema) {
                          applyTemplate(
                            (buildDefaultValueFromSchema(eventSchema, eventSchema) as Record<string, unknown>) ?? {},
                            { markTouched: false }
                          );
                        }
                      }}
                    >
                      Use event schema
                    </Button>
                  )}
                </div>
                {mappingModeLabel && (
                  <div className="text-[11px] text-yellow-800">
                    {mappingModeLabel}
                  </div>
                )}
                {schemaDiffSummary && (
                  <div className="space-y-1">
                    <Button
                      id="run-dialog-toggle-schema-diff"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowSchemaDiff((prev) => !prev)}
                    >
                      {showSchemaDiff ? 'Hide schema diff' : 'View schema diff'}
                    </Button>
                    {showSchemaDiff && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-gray-600">
                        <div>
                          <div className="font-semibold text-gray-700">Only in event schema</div>
                          <div>{schemaDiffSummary.onlyInEvent.length ? schemaDiffSummary.onlyInEvent.join(', ') : '—'}</div>
                          <div className="mt-2 font-semibold text-gray-700">Required only in event</div>
                          <div>{schemaDiffSummary.requiredOnlyInEvent.length ? schemaDiffSummary.requiredOnlyInEvent.join(', ') : '—'}</div>
                        </div>
                        <div>
                          <div className="font-semibold text-gray-700">Only in workflow schema</div>
                          <div>{schemaDiffSummary.onlyInPayload.length ? schemaDiffSummary.onlyInPayload.join(', ') : '—'}</div>
                          <div className="mt-2 font-semibold text-gray-700">Required only in workflow</div>
                          <div>{schemaDiffSummary.requiredOnlyInPayload.length ? schemaDiffSummary.requiredOnlyInPayload.join(', ') : '—'}</div>
                        </div>
                        {schemaDiffSummary.typeMismatches.length > 0 && (
                          <div className="md:col-span-2">
                            <div className="font-semibold text-gray-700">Type mismatches</div>
                            <div>
                              {schemaDiffSummary.typeMismatches.map((item) => (
                                <div key={item.field}>
                                  {item.field}: event {item.eventType ?? 'unknown'} vs workflow {item.payloadType ?? 'unknown'}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {draftVersion && publishedVersion && draftVersion !== publishedVersion && (
            <div className="rounded border border-yellow-200 bg-yellow-50 p-2 text-xs text-yellow-700 flex items-center justify-between">
              <span>Draft version differs from published (v{publishedVersion}).</span>
              {canPublish && onPublishDraft && (
                <Button id="run-dialog-publish-latest" size="sm" onClick={() => onPublishDraft()}>
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
            <Button id="run-dialog-mode-json" variant={mode === 'json' ? 'default' : 'outline'} size="sm" onClick={() => setMode('json')}>
              JSON Editor
            </Button>
            <Button id="run-dialog-mode-form" variant={mode === 'form' ? 'default' : 'outline'} size="sm" onClick={() => setMode('form')}>
              Form Builder
            </Button>
            <Button id="run-dialog-reset-defaults" variant="outline" size="sm" onClick={handleResetDefaults}>
              Reset to defaults
            </Button>
            <Button id="run-dialog-copy-payload" variant="outline" size="sm" onClick={copyPayload}>
              Copy payload
            </Button>
            <Button id="run-dialog-clone-latest" variant="outline" size="sm" onClick={handleCloneLatest}>
              Clone latest run
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {exampleOptions.map((example) => (
              <Button
                key={example.label}
                id={`run-dialog-example-${example.label.replace(/\s+/g, '-').toLowerCase()}`}
                variant="outline"
                size="sm"
                onClick={() => applyTemplate(example.payload, { markTouched: true })}
              >
                {example.label}
              </Button>
            ))}
          </div>

          {eventTemplates.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-full text-xs text-gray-500">Event templates</div>
              {eventTemplates.map((template) => (
                <Button
                  key={template.id}
                  id={`run-dialog-template-event-${template.id}`}
                  variant="outline"
                  size="sm"
                  onClick={() => applyTemplate(template.payload, { markTouched: true })}
                >
                  {template.label}
                </Button>
              ))}
            </div>
          )}

          {generalTemplates.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-full text-xs text-gray-500">Sample templates</div>
              {generalTemplates.map((template) => (
                <Button
                  key={template.id}
                  id={`run-dialog-template-sample-${template.id}`}
                  variant="outline"
                  size="sm"
                  onClick={() => applyTemplate(template.payload, { markTouched: true })}
                >
                  {template.label}
                </Button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              id="run-dialog-preset-name"
              label="Preset name"
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
              placeholder="e.g. Regression payload"
            />
            <Button id="run-dialog-save-preset" variant="outline" onClick={handleSavePreset} className="self-end">
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
              {activeSchema ? (
                renderField(activeSchema, formValue, [], new Set(activeSchema.required ?? []))
              ) : (
                <div className="text-xs text-gray-500">No schema available to render a form.</div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button id="run-dialog-close" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            id="run-dialog-start-run"
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
