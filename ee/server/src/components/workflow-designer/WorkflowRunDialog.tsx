'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { DateTimePicker } from '@alga-psa/ui/components/DateTimePicker';
import { dateFromString, dateTimeFromString, dateToString } from '@alga-psa/ui/lib/dateInput';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Dialog, DialogContent, DialogDescription } from '@alga-psa/ui/components/Dialog';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { mapWorkflowServerError } from './workflowServerErrors';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import toast from 'react-hot-toast';
import SearchableSelect from '@alga-psa/ui/components/SearchableSelect';
import {
  getWorkflowSchemaAction,
  getLatestWorkflowRunAction,
  listWorkflowSchemaRefsAction,
  listWorkflowDefinitionVersionsAction,
  startWorkflowRunAction
} from '@alga-psa/workflows/actions';
import { getEventCatalogEntries, getEventCatalogEntryByEventType } from '@alga-psa/workflows/actions';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import type { InputMapping } from '@alga-psa/workflows/runtime';
import {
  filterEventCatalogEntries,
  getSchemaDiffSummary,
  pickEventTemplates,
  buildWorkflowRunHref,
  describeWorkflowRunLaunchFailure,
  humanizeRunDialogFieldLabel,
  applyDerivedClientScope,
  buildBlankPayloadFromSchema,
  getRunDialogDateFormat,
  type WorkflowRunStartFailure
} from './workflowRunDialogUtils';
import {
  buildRecordFill,
  collectChangedPayloadPaths,
  isPayloadPathEdited,
  listRecordFillTargets,
  payloadPathKey,
  type RecordFillField,
} from './workflowRunRecordFill';
import { WORKFLOW_RUN_RECORD_SOURCES } from './workflowRunRecordResolvers';
import {
  DATE_TRIGGER_TIMING_FIELDS,
  applyDateTriggerTiming,
  describeDateTriggerPayloadField,
  getDateTriggerRecordKind,
  localTodayIsoDate,
  type RunDialogDateTrigger,
} from './workflowRunDateTrigger';
import {
  buildWorkflowRunDraftFormKey,
  clearWorkflowRunDraft,
  readWorkflowRunDraft,
  saveWorkflowRunDraft,
} from './workflowRunDraftStore';
import { getTicketById } from '@alga-psa/tickets/actions/ticketActions';
import {
  WorkflowActionInputFixedPicker,
  WORKFLOW_FIXED_PICKER_SUPPORTED_RESOURCES,
  type WorkflowActionInputPickerField,
} from './WorkflowActionInputFixedPicker';
import { resolveWorkflowSchemaFieldEditor } from './workflowSchemaFieldEditor';
import { DATE_TRIGGER_OCCURRENCE_RULES, type WorkflowPayloadIssue } from '@alga-psa/workflows/authoring';
import {
  describeRunPayloadValidationFailure,
  describeWorkflowPayloadIssue,
  labelRunPayloadPath,
  pruneEmptyOptionalRunPayloadFields,
  validateRunPayloadAgainstSchema,
} from './workflowRunPayloadIssues';

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
  'x-workflow-picker-kind'?: string;
  'x-workflow-picker-dependencies'?: string[];
  'x-workflow-picker-fixed-value-hint'?: string;
  'x-workflow-picker-allow-dynamic-reference'?: boolean;
  'x-workflow-editor'?: import('@alga-psa/shared/workflow/runtime').WorkflowEditorJsonSchemaMetadata;
};

type WorkflowRunDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  workflowId: string | null;
  workflowName?: string | null;
  /** What starts this workflow when it isn't run by hand, e.g. "Contract end date, 30 days before". */
  triggerLabel?: string | null;
  /** The workflow's date trigger, when it has one: test payloads derive their dates from it. */
  dateTrigger?: RunDialogDateTrigger | null;
  triggerEventName?: string | null;
  triggerSourcePayloadSchemaRef?: string | null;
  triggerPayloadMappingProvided?: boolean;
  triggerPayloadMappingRequired?: boolean;
  payloadSchemaRef?: string | null;
  publishedVersion?: number | null;
  draftVersion?: number | null;
  isSystem?: boolean;
  isPaused?: boolean;
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
  if (!schema.$ref?.startsWith('#/')) {
    return schema;
  }

  const segments = schema.$ref
    .slice(2)
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));

  let current: unknown = root;
  for (const segment of segments) {
    if (!current || typeof current !== 'object') {
      return schema;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current && typeof current === 'object' ? (current as JsonSchema) : schema;
};

const IMPLICIT_RUN_CONTEXT_FIELD_KEYS = new Set(['tenantId']);

const schemaDeclaresTopLevelProperty = (
  schema: JsonSchema | null | undefined,
  propertyName: string,
  root: JsonSchema | null | undefined = schema
): boolean => {
  if (!schema || !root) return false;

  const resolved = resolveSchemaRef(schema, root);
  if (resolved.properties && Object.prototype.hasOwnProperty.call(resolved.properties, propertyName)) {
    return true;
  }

  const variants = [...(resolved.anyOf ?? []), ...(resolved.oneOf ?? [])];
  return variants.some((variant) => schemaDeclaresTopLevelProperty(variant, propertyName, root));
};

const shouldInjectImplicitTenantId = (schema: JsonSchema | null | undefined, tenantId?: string | null): boolean => (
  Boolean(tenantId && schemaDeclaresTopLevelProperty(schema, 'tenantId'))
);

const stripImplicitRunContextFields = (payload: Record<string, unknown>): Record<string, unknown> => {
  const next = { ...payload };
  for (const key of IMPLICIT_RUN_CONTEXT_FIELD_KEYS) {
    delete next[key];
  }
  return next;
};

const applyImplicitRunContextFields = (
  payload: Record<string, unknown>,
  options: { tenantId?: string | null; schema?: JsonSchema | null }
): Record<string, unknown> => {
  const next = stripImplicitRunContextFields(payload);
  if (options.tenantId && shouldInjectImplicitTenantId(options.schema, options.tenantId)) {
    next.tenantId = options.tenantId;
  }
  return next;
};

/** A random UUID for a test payload's synthetic ids (message, event, correlation ids). */
const generateTestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Older browsers: RFC 4122 version 4 from Math.random (fine for test data).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
};

const isImplicitRunContextFieldPath = (path: Array<string | number>): boolean => (
  path.length === 1 && typeof path[0] === 'string' && IMPLICIT_RUN_CONTEXT_FIELD_KEYS.has(path[0])
);

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

const buildSyntheticValueFromSchema = (schema: JsonSchema, root: JsonSchema, path: Array<string | number> = []): unknown => {
  const resolved = resolveSchemaRef(schema, root);

  if (resolved.examples?.length) {
    return resolved.examples[0];
  }
  if (resolved.example !== undefined) {
    return resolved.example;
  }
  if (resolved.default !== undefined) {
    return resolved.default;
  }
  if (resolved.anyOf?.length) {
    return buildSyntheticValueFromSchema(resolved.anyOf[0], root, path);
  }
  if (resolved.oneOf?.length) {
    return buildSyntheticValueFromSchema(resolved.oneOf[0], root, path);
  }
  if (resolved.enum?.length) {
    return resolved.enum[0];
  }

  const type = Array.isArray(resolved.type) ? resolved.type[0] : resolved.type;
  const fieldName = String(path[path.length - 1] ?? '').toLowerCase();

  switch (type) {
    case 'object': {
      const required = new Set(resolved.required ?? []);
      return Object.entries(resolved.properties ?? {}).reduce<Record<string, unknown>>((acc, [key, childSchema]) => {
        if (required.has(key) || childSchema.default !== undefined || childSchema.example !== undefined || childSchema.examples?.length || childSchema.enum?.length) {
          const childValue = buildSyntheticValueFromSchema(childSchema, root, [...path, key]);
          if (childValue !== undefined) acc[key] = childValue;
        }
        return acc;
      }, {});
    }
    case 'array': {
      if (!resolved.items) return [];
      const item = buildSyntheticValueFromSchema(resolved.items, root, [...path, 0]);
      return item === undefined ? [] : [item];
    }
    case 'string': {
      if (resolved.format === 'date-time') return new Date().toISOString();
      if (resolved.format === 'date') return new Date().toISOString().slice(0, 10);
      if (resolved.format === 'uuid') {
        // A made-up id would never match a real record; leave the field for the user to fill.
        return undefined;
      }
      if (fieldName.endsWith('id') || fieldName === 'id') {
        return undefined;
      }
      if (fieldName.includes('email')) return 'sample@example.com';
      if (fieldName.includes('name')) return 'Sample Name';
      if (fieldName.includes('type')) return 'sample';
      return fieldName ? `${fieldName}-sample` : 'sample';
    }
    case 'number':
    case 'integer':
      return 1;
    case 'boolean':
      return true;
    default:
      return null;
  }
};

export const buildInitialPayloadFromSchema = (schema: JsonSchema | null): Record<string, unknown> => {
  if (!schema) return {};
  const examples = schema.examples ?? (schema.example !== undefined ? [schema.example] : []);
  const fromExample = examples.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
  if (fromExample) {
    return fromExample as Record<string, unknown>;
  }
  const synthetic = buildSyntheticValueFromSchema(schema, schema);
  if (synthetic && typeof synthetic === 'object' && !Array.isArray(synthetic)) {
    return pruneSyntheticPickerBackedFields(schema, synthetic as Record<string, unknown>);
  }
  const fallback = buildDefaultValueFromSchema(schema, schema);
  return fallback && typeof fallback === 'object' && !Array.isArray(fallback)
    ? fallback as Record<string, unknown>
    : {};
};

const setValueAtPath = (root: unknown, path: Array<string | number>, value: unknown): unknown => {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const next = Array.isArray(root) ? [...root] : { ...(root as Record<string, unknown> | null) };
  const child = (root as any)?.[head];
  (next as any)[head] = rest.length ? setValueAtPath(child, rest, value) : value;
  return next;
};

const getValueAtPath = (root: unknown, path: Array<string | number>): unknown =>
  path.reduce<unknown>((acc, part) => {
    if (acc == null) return undefined;
    return (acc as any)[part];
  }, root);

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const pathToString = (path: Array<string | number>): string =>
  path.reduce<string>(
    (acc, part) => (typeof part === 'number' ? `${acc}[${part}]` : acc ? `${acc}.${part}` : String(part)),
    ''
  );

type ValidationError = { path: string; message: string };

const normalizeSchemaType = (schema?: JsonSchema): string | undefined => {
  if (!schema?.type) return undefined;
  if (Array.isArray(schema.type)) {
    return schema.type.find((value) => value !== 'null') ?? schema.type[0];
  }
  return schema.type;
};

const WORKFLOW_RUN_DIALOG_PICKER_FALLBACKS: Record<string, { resource: string; fixedValueHint?: string }> = {
  ticketid: { resource: 'ticket', fixedValueHint: 'Search tickets by number or title' },
  actorcontactid: { resource: 'contact', fixedValueHint: 'Select Contact' },
  contactid: { resource: 'contact', fixedValueHint: 'Select Contact' },
  createdbyuserid: { resource: 'user', fixedValueHint: 'Select User' },
  actoruserid: { resource: 'user', fixedValueHint: 'Select User' },
  clientid: { resource: 'client', fixedValueHint: 'Select Client' },
};

const resolveConcreteFieldSchema = (schema: JsonSchema, root: JsonSchema): JsonSchema => {
  const resolved = resolveSchemaRef(schema, root);

  if (resolved.anyOf?.length) {
    const variant = resolved.anyOf.find((candidate) => {
      const candidateResolved = resolveSchemaRef(candidate, root);
      const candidateType = normalizeSchemaType(candidateResolved);
      return candidateType && candidateType !== 'null';
    });
    if (variant) {
      return resolveConcreteFieldSchema(variant, root);
    }
  }

  if (resolved.oneOf?.length) {
    const variant = resolved.oneOf.find((candidate) => {
      const candidateResolved = resolveSchemaRef(candidate, root);
      const candidateType = normalizeSchemaType(candidateResolved);
      return candidateType && candidateType !== 'null';
    });
    if (variant) {
      return resolveConcreteFieldSchema(variant, root);
    }
  }

  return resolved;
};

const resolveRunDialogPickerField = (
  schema: JsonSchema,
  rootSchema: JsonSchema,
  path: Array<string | number>
): WorkflowActionInputPickerField | null => {
  const fieldKey = path[path.length - 1];
  if (typeof fieldKey !== 'string') {
    return null;
  }

  const concreteSchema = resolveConcreteFieldSchema(schema, rootSchema);
  if (normalizeSchemaType(concreteSchema) !== 'string') {
    return null;
  }

  // Preferred path: annotate the schema itself with x-workflow-editor / x-workflow-picker-kind
  // so the properties dialog and run dialog light up the same picker without adding UI-only logic here.
  const schemaEditor = resolveWorkflowSchemaFieldEditor(resolveSchemaRef(schema, rootSchema)) ?? resolveWorkflowSchemaFieldEditor(concreteSchema);
  const schemaPickerResource = schemaEditor?.picker?.resource;
  if (schemaEditor?.kind === 'picker' && schemaPickerResource && WORKFLOW_FIXED_PICKER_SUPPORTED_RESOURCES.has(schemaPickerResource)) {
    return {
      name: fieldKey,
      nullable: Array.isArray(schema.type) ? schema.type.includes('null') : false,
      editor: schemaEditor,
    };
  }

  // Keep fallback inference intentionally narrow. If a new schema should always render a picker,
  // prefer adding schema metadata at the source rather than growing this name-based map indefinitely.
  const fallback = WORKFLOW_RUN_DIALOG_PICKER_FALLBACKS[fieldKey.toLowerCase()];
  if (!fallback || !WORKFLOW_FIXED_PICKER_SUPPORTED_RESOURCES.has(fallback.resource)) {
    return null;
  }

  return {
    name: fieldKey,
    nullable: Array.isArray(schema.type) ? schema.type.includes('null') : false,
    editor: {
      kind: 'picker',
      fixedValueHint: fallback.fixedValueHint,
      picker: {
        resource: fallback.resource,
      },
    },
  };
};

const pruneSyntheticPickerBackedFields = (
  schema: JsonSchema,
  payload: Record<string, unknown>,
  rootSchema: JsonSchema = schema,
  path: Array<string | number> = []
): Record<string, unknown> => {
  const resolved = resolveSchemaRef(schema, rootSchema);
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    const childPath = [...path, key];
    const childSchema = resolved.properties?.[key];
    if (!childSchema) {
      next[key] = value;
      continue;
    }

    // Synthetic defaults should not pretend we know actual entity identifiers.
    // If a field should render a picker by default, prefer leaving it blank so the user picks a real record.
    if (resolveRunDialogPickerField(childSchema, rootSchema, childPath)) {
      continue;
    }

    if (isObjectRecord(value)) {
      next[key] = pruneSyntheticPickerBackedFields(childSchema, value, rootSchema, childPath);
      continue;
    }

    if (Array.isArray(value)) {
      next[key] = value;
      continue;
    }

    next[key] = value;
  }

  return next;
};


const CollapsibleSection: React.FC<{
  title: string;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}> = ({ title, defaultCollapsed = true, children }) => {
  const [isOpen, setIsOpen] = useState(!defaultCollapsed);
  return (
    <div className="rounded border border-gray-200 dark:border-[rgb(var(--color-border-200))] overflow-hidden">
      <button
        type="button"
        className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:hover:bg-[rgb(var(--color-border-100))] transition-colors"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span>{title}</span>
        <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>
      {isOpen && <div className="px-3 pb-3 space-y-3">{children}</div>}
    </div>
  );
};

const WorkflowRunDialog: React.FC<WorkflowRunDialogProps> = ({
  isOpen,
  onClose,
  workflowId,
  workflowName,
  triggerLabel,
  dateTrigger = null,
  triggerEventName,
  triggerSourcePayloadSchemaRef,
  triggerPayloadMappingProvided = false,
  triggerPayloadMappingRequired = false,
  payloadSchemaRef,
  publishedVersion,
  draftVersion,
  isSystem,
  isPaused,
  concurrencyLimit,
  canPublish = false,
  onPublishDraft
}) => {
  const { t } = useTranslation('msp/workflows');
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
  // Payload fields the user changed by hand. Everything else (samples, templates, record fills)
  // may be replaced when a real record is picked.
  const editedPathsRef = useRef<Set<string>>(new Set());
  const markEditedPaths = (previous: unknown, next: unknown) => {
    for (const path of collectChangedPayloadPaths(previous, next)) {
      editedPathsRef.current.add(payloadPathKey(path));
    }
  };
  const [payloadTouched, setPayloadTouched] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [runStartFailure, setRunStartFailure] = useState<WorkflowRunStartFailure | null>(null);
  // Field problems the server reported for the payload last sent; cleared once the payload changes.
  const [serverPayloadIssues, setServerPayloadIssues] = useState<WorkflowPayloadIssue[]>([]);
  // The schema-generated form is the default; the JSON editor is for pasting or fine-tuning.
  const [mode, setMode] = useState<'json' | 'form'>('form');
  const [schemaErrors, setSchemaErrors] = useState<ValidationError[]>([]);
  const [showValidationSummary, setShowValidationSummary] = useState(false);
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(null);
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
  // Field problems show once the person has touched a field (typed or left it) or tried to start the
  // run, never on a form they haven't used yet.
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [blurredPaths, setBlurredPaths] = useState<Set<string>>(() => new Set());
  // Payload restored from the last time this dialog was used for this workflow.
  const [restoredDraft, setRestoredDraft] = useState(false);
  // Per picked record field: payload fields the record promised but had no value for.
  const [recordFillGaps, setRecordFillGaps] = useState<Record<string, { fields: string[]; neverFires: boolean }>>({});
  const today = useMemo(() => localTodayIsoDate(), [isOpen]);
  const emptyValueLabel = t('runDialog.common.emptyValue', { defaultValue: '—' });
  const invalidJsonLabel = t('runDialog.validation.invalidJson', { defaultValue: 'Invalid JSON' });

  const activeSchema =
    schemaSource === 'event' && eventSchema
      ? eventSchema
      : schemaSource === 'schemaRef'
        ? customSchema
        : payloadSchema;
  const defaults = useMemo(() => (
    activeSchema ? buildDefaultValueFromSchema(activeSchema, activeSchema) : {}
  ), [activeSchema]);

  // The date trigger applies when the form is its payload (it has the timing fields).
  const activeDateTrigger = useMemo(() => {
    if (!dateTrigger || !activeSchema) return null;
    const properties = resolveSchemaRef(activeSchema, activeSchema).properties ?? {};
    return DATE_TRIGGER_TIMING_FIELDS.every((key) => key in properties) ? dateTrigger : null;
  }, [activeSchema, dateTrigger]);
  // occursOn, offsetDays and fireDate as the scheduler would set them, without overwriting what the
  // person typed; `record` is a record just picked in the form.
  const withDateTriggerTiming = (value: unknown, record?: Record<string, unknown> | null): unknown => {
    if (!activeDateTrigger) return value;
    return applyDateTriggerTiming(value, {
      trigger: activeDateTrigger,
      record,
      today,
      canOverwrite: (key) => !isPayloadPathEdited(editedPathsRef.current, [key]),
    });
  };
  const draftFormKey = buildWorkflowRunDraftFormKey(
    schemaSource,
    schemaSource === 'event' ? eventSchemaRef : schemaSource === 'schemaRef' ? customSchemaRef : payloadSchemaRef,
    schemaSource === 'event' ? selectedEventType : null
  );
  const canShowFieldErrors = (path: Array<string | number>): boolean =>
    submitAttempted || blurredPaths.has(pathToString(path)) || isPayloadPathEdited(editedPathsRef.current, path);

  // The form's own label for a payload field ("Ticket › Message"), so problems name what people see.
  const labelForPayloadPath = (path: Array<string | number>): string => {
    if (!path.length) return t('runDialog.payload.payloadLabel', { defaultValue: 'Payload' });
    return labelRunPayloadPath(
      path,
      (key, parentPath) => {
        let parent: JsonSchema | undefined = activeSchema ? resolveSchemaRef(activeSchema, activeSchema) : undefined;
        for (const segment of parentPath) {
          if (!parent) break;
          const next: JsonSchema | undefined = typeof segment === 'number' ? parent.items : parent.properties?.[segment];
          parent = next && activeSchema ? resolveConcreteFieldSchema(next, activeSchema) : undefined;
        }
        const property = parent?.properties?.[key];
        const title = property && activeSchema ? resolveSchemaRef(property, activeSchema).title : undefined;
        return title ?? t(`runDialog.fieldLabels.${key}`, { defaultValue: humanizeRunDialogFieldLabel(key) });
      },
      (position) => t('runDialog.issues.item', { defaultValue: 'item {{position}}', position })
    );
  };

  // Problems the form can show, keyed by the form's field paths; tenant context is filled in for
  // the user, so it never needs fixing.
  const toFieldErrors = (issues: WorkflowPayloadIssue[]): ValidationError[] =>
    issues
      .filter((issue) => !isImplicitRunContextFieldPath(issue.path))
      .map((issue) => ({
        path: pathToString(issue.path),
        message: describeWorkflowPayloadIssue(t, issue, labelForPayloadPath(issue.path)),
      }));

  // The ticket chosen in the form (any top-level ticket picker), and its client, which narrows
  // client-scoped pickers such as contacts.
  const selectedTicketId = useMemo(() => {
    if (!activeSchema || !isObjectRecord(formValue)) return null;
    const properties = resolveSchemaRef(activeSchema, activeSchema).properties ?? {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      const picker = resolveRunDialogPickerField(propertySchema, activeSchema, [key]);
      const kind = picker?.editor?.picker?.resource ?? picker?.picker?.kind;
      const candidate = formValue[key];
      if (kind === 'ticket' && typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return null;
  }, [activeSchema, formValue]);
  const [selectedTicketClientId, setSelectedTicketClientId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedTicketId) {
      setSelectedTicketClientId(null);
      return;
    }
    let active = true;
    getTicketById(selectedTicketId)
      .then((ticket) => {
        if (!active) return;
        const clientId = (ticket as { client_id?: string | null } | null)?.client_id ?? null;
        setSelectedTicketClientId(clientId);
      })
      .catch((error) => {
        if (!active) return;
        console.error('Failed to load the selected ticket for the run form:', error);
        setSelectedTicketClientId(null);
      });
    return () => {
      active = false;
    };
  }, [selectedTicketId]);

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
              <Badge className={`text-[10px] ${isSystemEntry ? 'bg-blue-500/15 text-blue-600' : 'bg-emerald-500/15 text-emerald-600'}`}>
                {isSystemEntry
                  ? t('runDialog.eventCatalog.systemBadge', { defaultValue: 'System' })
                  : t('runDialog.eventCatalog.tenantBadge', { defaultValue: 'Tenant' })}
              </Badge>
            </div>
            {(entry.category || entry.description) && (
              <div className="text-[11px] text-gray-500">
                {entry.category ?? t('runDialog.eventCatalog.uncategorized', { defaultValue: 'Uncategorized' })}
                {entry.description ? ` · ${entry.description}` : ''}
              </div>
            )}
          </div>
        ),
        className: 'items-start whitespace-normal'
      };
    })
  ), [filteredEventEntries, t]);

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
      warnings.push(t('runDialog.payload.largePayloadWarning', {
        defaultValue: 'Payload size exceeds 256KB; runs may be slower.',
      }));
    }
    return warnings;
  }, [payloadSize, t]);

  const canRun = !!workflowId
    && !!publishedVersion
    && !isPaused;

  useEffect(() => {
    if (!isOpen || !workflowId) return;
    setHasLoadedOptions(false);
    setPayloadTouched(false);
    setSubmitAttempted(false);
    setBlurredPaths(new Set());
    setRestoredDraft(false);
    setRecordFillGaps({});
    const storedOptions = window.localStorage.getItem(RUN_OPTIONS_KEY(workflowId));
    if (storedOptions) {
      try {
        const parsed = JSON.parse(storedOptions);
        // The payload itself is kept as a per-workflow draft (workflowRunDraftStore).
        if (parsed?.mode) setMode(parsed.mode);
        if (parsed?.selectedVersion) setSelectedVersion(String(parsed.selectedVersion));
        if (parsed?.schemaSource) setSchemaSource(parsed.schemaSource);
        if (parsed?.customSchemaRef) setCustomSchemaRef(String(parsed.customSchemaRef));
        if (parsed?.eventType) setSelectedEventType(parsed.eventType);
      } catch {}
    } else if (triggerEventName) {
      setSchemaSource('event');
      setMode('form');
    } else {
      setSchemaSource('payload');
      setMode('form');
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
    if (!isOpen) setRunStartFailure(null);
  }, [isOpen]);

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
        setCurrentTenantId(user?.tenant ?? null);
        if (!user?.tenant) return;
        const entries = await getEventCatalogEntries();
        setEventCatalogEntries(entries as EventCatalogEntry[]);
      } catch {
        setCurrentTenantId(null);
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
        const fetched = await getEventCatalogEntryByEventType(selectedEventType);
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
    if (!mappingRequiredForSelectedEvent && !triggerPayloadMappingProvided) {
      return t('runDialog.schema.mapping.identityOptional', {
        defaultValue: 'Identity mapping (no mapping required)',
      });
    }
    if (triggerPayloadMappingProvided) {
      return mappingRequiredForSelectedEvent
        ? t('runDialog.schema.mapping.willApply', {
            defaultValue: 'Trigger mapping will be applied',
          })
        : t('runDialog.schema.mapping.willApplyOptional', {
            defaultValue: 'Trigger mapping will be applied (optional)',
          });
    }
    return t('runDialog.schema.mapping.requiredMissing', {
      defaultValue: 'Trigger mapping is required but not configured',
    });
  }, [eventSchemaRef, mappingRequiredForSelectedEvent, payloadSchemaRef, schemaSource, t, triggerPayloadMappingProvided]);

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
    // The payload left here last time (closing never discards it) comes back as it was.
    const draft = workflowId && activeSchema ? readWorkflowRunDraft(workflowId, draftFormKey) : null;
    if (draft) {
      editedPathsRef.current = new Set(draft.editedPaths);
      setRunPayloadText(JSON.stringify(draft.payload ?? {}, null, 2));
      setFormValue(draft.payload ?? {});
      setRunPayloadError(null);
      setShowValidationSummary(false);
      setPayloadTouched(true);
      setRestoredDraft(true);
      return;
    }
    editedPathsRef.current = new Set();
    const initialPayload = withDateTriggerTiming(stripImplicitRunContextFields(schemaSource === 'event' && activeSchema
      ? buildInitialPayloadFromSchema(activeSchema)
      : buildBlankPayloadFromSchema(activeSchema ? resolveSchemaRef(activeSchema, activeSchema) : null)));
    const text = JSON.stringify(initialPayload ?? {}, null, 2);
    setRunPayloadText(text);
    setFormValue(initialPayload ?? {});
    setRunPayloadError(null);
    setShowValidationSummary(false);
  // withDateTriggerTiming only reads activeDateTrigger and today.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDateTrigger, activeSchema, defaults, draftFormKey, hasLoadedOptions, isOpen, payloadTouched, schemaSource, workflowId]);

  // Keep the draft as it changes, so closing the dialog never loses it.
  useEffect(() => {
    if (!isOpen || !workflowId || !payloadTouched || !activeSchema) return;
    let payload: unknown = formValue;
    if (mode === 'json') {
      try {
        payload = JSON.parse(runPayloadText || '{}');
      } catch {
        return;
      }
    }
    saveWorkflowRunDraft(workflowId, {
      formKey: draftFormKey,
      payload,
      editedPaths: Array.from(editedPathsRef.current),
    });
  }, [activeSchema, draftFormKey, formValue, isOpen, mode, payloadTouched, runPayloadText, workflowId]);

  const handleStartOver = () => {
    if (workflowId) clearWorkflowRunDraft(workflowId);
    editedPathsRef.current = new Set();
    setRestoredDraft(false);
    setSubmitAttempted(false);
    setBlurredPaths(new Set());
    setRecordFillGaps({});
    setServerPayloadIssues([]);
    setRunStartFailure(null);
    // An untouched payload is rebuilt from the schema (and the trigger's dates).
    setPayloadTouched(false);
  };

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
    const options = { mode, selectedVersion, schemaSource, eventType: selectedEventType, customSchemaRef };
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
    const effectiveValue = applyImplicitRunContextFields(
      isObjectRecord(value) ? value : {},
      { tenantId: currentTenantId, schema: activeSchema }
    );
    const issues = validateRunPayloadAgainstSchema(
      activeSchema,
      pruneEmptyOptionalRunPayloadFields(activeSchema, effectiveValue),
      activeSchema
    );
    setSchemaErrors(toFieldErrors(issues));
  // toFieldErrors only reads activeSchema and t.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSchema, currentTenantId, formValue, mode, runPayloadText]);

  // A changed payload is checked again from scratch.
  useEffect(() => {
    setServerPayloadIssues([]);
  }, [formValue, runPayloadText, activeSchema]);

  // Client checks plus what the server reported, one message per field.
  const displayedSchemaErrors = useMemo(() => {
    if (!serverPayloadIssues.length) return schemaErrors;
    const serverErrors = toFieldErrors(serverPayloadIssues);
    const seen = new Set(schemaErrors.map((error) => error.path));
    return [...schemaErrors, ...serverErrors.filter((error) => !seen.has(error.path))];
  // toFieldErrors only reads activeSchema and t.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaErrors, serverPayloadIssues]);

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
        ? t('runDialog.schema.selectedEventWarningPrefix', {
            defaultValue: 'Selected event ({{selectedEventType}}) may not match this workflow\'s trigger ({{triggerEventName}}). ',
            selectedEventType,
            triggerEventName: triggerEventName ?? 'none',
          })
        : '';

      if (!refMismatch) {
        setSchemaWarning(
          prefix + (triggerPayloadMappingProvided
            ? t('runDialog.schema.matchOptional', {
                defaultValue: 'Schema refs match; trigger mapping will be applied (optional).',
              })
            : t('runDialog.schema.matchIdentity', {
                defaultValue: 'Schema refs match; identity mapping will be used (no mapping required).',
              }))
        );
        return;
      }

      setSchemaWarning(
        prefix + (triggerPayloadMappingProvided
          ? t('runDialog.schema.diffWillApply', {
              defaultValue: 'Schema refs differ ({{eventSchemaRef}} → {{payloadSchemaRef}}); trigger mapping will be applied.',
              eventSchemaRef,
              payloadSchemaRef,
            })
          : t('runDialog.schema.diffRequiredMissing', {
              defaultValue: 'Schema refs differ ({{eventSchemaRef}} → {{payloadSchemaRef}}); trigger mapping is required but not configured.',
              eventSchemaRef,
              payloadSchemaRef,
            }))
      );
      return;
    }

    if (eventSchemaRef && eventSchemaRef !== payloadSchemaRef) {
      setSchemaWarning(t('runDialog.schema.triggerEventDiffers', {
        defaultValue: 'Trigger event schema differs from workflow payload schema. Switch to "Event schema" if you want to enter a trigger event payload.',
      }));
      return;
    }

    setSchemaWarning(null);
  }, [
    eventSchemaRef,
    isOpen,
    payloadSchemaRef,
    schemaSource,
    selectedEventType,
    t,
    triggerEventName,
    triggerPayloadMappingProvided,
    usingWorkflowTriggerEvent
  ]);

  const handleRunPayloadChange = (value: string) => {
    setRunPayloadText(value);
    setPayloadTouched(true);
    setShowValidationSummary(true);
    try {
      const parsed = JSON.parse(value);
      markEditedPaths(formValue, parsed);
      setFormValue(parsed);
      setRunPayloadError(null);
    } catch (err) {
      setRunPayloadError(err instanceof Error ? err.message : invalidJsonLabel);
    }
  };

  const applyTemplate = (payload: Record<string, unknown>, options: { markTouched?: boolean } = {}) => {
    const markTouched = options.markTouched ?? true;
    // Template and cloned values are starting points; a record pick may replace them.
    editedPathsRef.current = new Set();
    const sanitizedPayload = stripImplicitRunContextFields(payload);
    const next = JSON.stringify(sanitizedPayload, null, 2);
    setRunPayloadText(next);
    setFormValue(sanitizedPayload);
    setRunPayloadError(null);
    setPayloadTouched(markTouched);
    setShowValidationSummary(markTouched);
  };

  const handleResetDefaults = () => {
    const resetPayload = schemaSource === 'event' && activeSchema
      ? buildInitialPayloadFromSchema(activeSchema)
      : ((defaults ?? {}) as Record<string, unknown>);
    applyTemplate(resetPayload, { markTouched: true });
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
        toast.error(t('runDialog.toasts.noPriorPayload', { defaultValue: 'No prior run payload found.' }));
        return;
      }
      applyTemplate(run.input_json ?? {}, { markTouched: true });
    } catch (error) {
      toast.error(mapWorkflowServerError(t, error, t('runDialog.toasts.loadLatestRunFailed', {
        defaultValue: 'Failed to load latest run',
      })));
    }
  };

  const handleSavePreset = () => {
    if (!workflowId || presetName.trim().length === 0) {
      toast.error(t('runDialog.toasts.providePresetName', { defaultValue: 'Provide a preset name.' }));
      return;
    }
    const payload = mode === 'json' ? runPayloadText : JSON.stringify(formValue ?? {}, null, 2);
    const next = [...presets.filter((preset) => preset.name !== presetName.trim()), { name: presetName.trim(), payload }];
    setPresets(next);
    window.localStorage.setItem(RUN_PRESETS_KEY(workflowId), JSON.stringify(next));
    setPresetName('');
    toast.success(t('runDialog.toasts.presetSaved', { defaultValue: 'Preset saved.' }));
  };

  const handleLoadPreset = (preset: Preset) => {
    try {
      applyTemplate(JSON.parse(preset.payload) as Record<string, unknown>, { markTouched: true });
      setRunPayloadError(null);
    } catch (error) {
      setRunPayloadError(error instanceof Error ? error.message : invalidJsonLabel);
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
    toast.success(t('runDialog.toasts.payloadCopied', { defaultValue: 'Payload copied to clipboard.' }));
  };

  const handleStartRun = async () => {
    if (!workflowId || !publishedVersion) return;
    if (isSystem && !confirmSystemRun) {
      toast.error(t('runDialog.toasts.confirmSystemRun', {
        defaultValue: 'Confirm you want to run this system workflow.',
      }));
      return;
    }
    if (schemaSource === 'event' && !eventSchemaRef) {
      toast.error(t('runDialog.toasts.eventMissingSchemaRef', {
        defaultValue: 'Selected event does not have a payload schema ref; cannot run with trigger mapping.',
      }));
      return;
    }
    if (schemaSource === 'event' && mappingRequiredForSelectedEvent && !triggerPayloadMappingProvided) {
      toast.error(t('runDialog.toasts.triggerMappingMissing', {
        defaultValue: 'Trigger mapping is required for this event schema but is not configured on the workflow.',
      }));
      return;
    }
    let payload: Record<string, unknown> = {};
    try {
      payload = applyImplicitRunContextFields(
        mode === 'json' ? JSON.parse(runPayloadText || '{}') : (formValue as Record<string, unknown>),
        { tenantId: currentTenantId, schema: activeSchema }
      );
      // Optional fields left empty are left out rather than sent as "".
      if (activeSchema) payload = pruneEmptyOptionalRunPayloadFields(activeSchema, payload);
    } catch (err) {
      setRunPayloadError(err instanceof Error ? err.message : invalidJsonLabel);
      return;
    }
    setShowValidationSummary(true);
    setSubmitAttempted(true);
    setIsStartingRun(true);
    setRunStartFailure(null);
    try {
      const result = await startWorkflowRunAction({
        workflowId,
        workflowVersion: selectedVersion ? Number(selectedVersion) : publishedVersion,
        payload,
        eventType: selectedEventType || undefined,
        sourcePayloadSchemaRef: schemaSource === 'event' ? eventSchemaRef ?? undefined : undefined,
        reportPayloadIssues: true
      });
      if (!result?.runId) {
        throw new Error('The server did not return a run id for the started run.');
      }
      if (result.payloadValidation) {
        // Say which fields to fix, and show each problem next to its field.
        setServerPayloadIssues(result.payloadValidation.appliesTo === 'input' ? result.payloadValidation.issues : []);
        setRunStartFailure(describeRunPayloadValidationFailure(
          t,
          result.payloadValidation,
          labelForPayloadPath,
          result.runId
        ));
        return;
      }
      if (result.launchFailure) {
        // The run exists (marked failed) but never started. Keep the dialog open so the
        // payload can be retried, and link to the failed run.
        setRunStartFailure(describeWorkflowRunLaunchFailure(t, result.launchFailure, result.runId));
        return;
      }
      const runHref = buildWorkflowRunHref(result.runId);
      toast.success(() => (
        <span id="run-dialog-started-toast" className="flex items-center gap-2">
          <span>{t('runDialog.toasts.runStarted', { defaultValue: 'Run started.' })}</span>
          <Link
            id="run-dialog-started-view-run"
            href={runHref}
            className="font-medium text-[rgb(var(--color-primary-600))] underline underline-offset-2"
          >
            {t('runDialog.actions.viewRun', { defaultValue: 'View run' })}
          </Link>
        </span>
      ), { duration: 8000 });
      onClose();
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : null;
      const message = mapWorkflowServerError(t, error, t('runDialog.toasts.startRunFailed', {
        defaultValue: 'Failed to start run',
      }));
      setRunStartFailure({
        runId: null,
        title: t('runDialog.startFailure.genericTitle', { defaultValue: 'The run did not start' }),
        description: message,
        technicalDetail: rawMessage && rawMessage !== message ? rawMessage : null,
      });
    } finally {
      setIsStartingRun(false);
    }
  };

  const updateFormValue = (updater: (prev: unknown) => unknown) => {
    setPayloadTouched(true);
    setShowValidationSummary(true);
    setFormValue((prev: unknown) => {
      const next = updater(prev);
      markEditedPaths(prev, next);
      // Dates that follow from the edit (fire date from occurs-on and the offset) follow it.
      return withDateTriggerTiming(next);
    });
  };

  // Payload fields beside `path` (same object), described for record fill.
  const getSiblingFillFields = (path: Array<string | number>): RecordFillField[] => {
    if (!activeSchema) return [];
    let parent: JsonSchema = resolveSchemaRef(activeSchema, activeSchema);
    for (const segment of path.slice(0, -1)) {
      const next = typeof segment === 'string' ? parent.properties?.[segment] : parent.items;
      if (!next) return [];
      parent = resolveConcreteFieldSchema(next, activeSchema);
    }
    return Object.entries(parent.properties ?? {}).map(([key, childSchema]) => {
      const picker = resolveRunDialogPickerField(childSchema, activeSchema, [...path.slice(0, -1), key]);
      return {
        key,
        pickerKind: picker?.editor?.picker?.resource ?? picker?.picker?.kind,
        isDateOnly: getRunDialogDateFormat(resolveConcreteFieldSchema(childSchema, activeSchema)) === 'date',
      };
    });
  };

  // "Fill from a real record": a picked contract, ticket, or client fills the empty fields beside it
  // (client, names, dates, assignee) from that record.
  const fillFromRecord = async (kind: string, recordId: string, path: Array<string | number>) => {
    const source = WORKFLOW_RUN_RECORD_SOURCES[kind];
    if (!source) return;
    try {
      const record = await source.resolve(recordId);
      if (!record) return;
      const pickedKey = String(path[path.length - 1]);
      const parentPath = path.slice(0, -1);
      const siblings = getSiblingFillFields(path);
      // The record this date trigger is about (its contract, client or asset) sets the run's dates.
      const setsTriggerDates = Boolean(
        activeDateTrigger && parentPath.length === 0 && kind === getDateTriggerRecordKind(activeDateTrigger)
      );
      // Fields the pick promised to fill that this record has no value for, said next to the picker.
      const promised = listRecordFillTargets(source, pickedKey, siblings);
      const available = buildRecordFill(record, pickedKey, siblings, {}, () => true, source.kindFields);
      const missing = promised.filter((key) => available[key] === undefined);
      setRecordFillGaps((current) => ({
        ...current,
        [payloadPathKey(path)]: {
          fields: missing,
          neverFires: setsTriggerDates && !DATE_TRIGGER_OCCURRENCE_RULES[activeDateTrigger!.source].fromRecord(record, today),
        },
      }));
      setFormValue((prev: unknown) => {
        const parentValue = parentPath.length ? getValueAtPath(prev, parentPath) : prev;
        const currentValues = isObjectRecord(parentValue) ? parentValue : {};
        if (currentValues[pickedKey] !== recordId) return prev;
        // Sample, template, and earlier record values may be replaced; values the user typed may not.
        const fill = buildRecordFill(
          record,
          pickedKey,
          siblings,
          currentValues,
          (key) => !isPayloadPathEdited(editedPathsRef.current, [...parentPath, key]),
          source.kindFields
        );
        let next = prev;
        for (const [key, fillValue] of Object.entries(fill)) {
          next = setValueAtPath(next, [...parentPath, key], fillValue);
        }
        return setsTriggerDates ? withDateTriggerTiming(next, record) : withDateTriggerTiming(next);
      });
    } catch (error) {
      console.error('Failed to fill the run payload from the picked record:', error);
    }
  };

  // One line per top-level record picker, naming exactly the fields a pick fills.
  const recordFillHints = useMemo(() => {
    if (!activeSchema) return [];
    const properties = resolveSchemaRef(activeSchema, activeSchema).properties ?? {};
    const labelFor = (key: string): string => {
      const propertySchema = properties[key];
      const title = propertySchema ? resolveSchemaRef(propertySchema, activeSchema).title : undefined;
      return title ?? t(`runDialog.fieldLabels.${key}`, { defaultValue: humanizeRunDialogFieldLabel(key) });
    };
    return Object.entries(properties).flatMap(([key, propertySchema]) => {
      const picker = resolveRunDialogPickerField(propertySchema, activeSchema, [key]);
      const kind = picker?.editor?.picker?.resource ?? picker?.picker?.kind;
      const source = kind ? WORKFLOW_RUN_RECORD_SOURCES[kind] : undefined;
      if (!source) return [];
      const targets = listRecordFillTargets(source, key, getSiblingFillFields([key]));
      // The trigger's record also sets the run's dates.
      const dateTargets = activeDateTrigger && kind === getDateTriggerRecordKind(activeDateTrigger)
        ? DATE_TRIGGER_TIMING_FIELDS.filter((timingKey) => timingKey !== 'offsetDays' && !targets.includes(timingKey))
        : [];
      const allTargets = [...targets, ...dateTargets];
      return allTargets.length ? [{ key, field: labelFor(key), targets: allTargets.map(labelFor) }] : [];
    });
    // getSiblingFillFields only reads activeSchema.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDateTrigger, activeSchema, t]);

  // Each field remembers being left (blur), so its problems show from then on. Nested fields stop the
  // event so a parent group isn't marked by its children.
  const renderField = (
    schema: JsonSchema,
    value: unknown,
    path: Array<string | number>,
    requiredSet: Set<string>
  ): React.ReactNode => {
    const content = renderFieldContent(schema, value, path, requiredSet);
    if (!content) return content;
    const fieldPath = pathToString(path);
    return (
      <div
        onBlur={(event) => {
          event.stopPropagation();
          if (!blurredPaths.has(fieldPath)) {
            setBlurredPaths((current) => new Set(current).add(fieldPath));
          }
        }}
      >
        {content}
      </div>
    );
  };

  const renderFieldContent = (
    schema: JsonSchema,
    value: unknown,
    path: Array<string | number>,
    requiredSet: Set<string>
  ) => {
    const rootSchema = activeSchema ?? schema;
    const resolved = resolveSchemaRef(schema, rootSchema);
    const type = Array.isArray(resolved.type) ? resolved.type[0] : resolved.type;
    const fieldKey = path[path.length - 1];
    const label = resolved.title ?? (typeof fieldKey === 'string'
      ? t(`runDialog.fieldLabels.${fieldKey}`, { defaultValue: humanizeRunDialogFieldLabel(fieldKey) })
      : t('runDialog.payload.payloadLabel', { defaultValue: 'Payload' }));
    const isRequired = typeof fieldKey === 'string' && requiredSet.has(fieldKey);
    const fieldPath = pathToString(path);
    if (isImplicitRunContextFieldPath(path)) {
      return null;
    }

    const fieldErrors = canShowFieldErrors(path)
      ? displayedSchemaErrors.filter((err) => err.path === fieldPath)
      : [];
    const pickerField = resolveRunDialogPickerField(resolved, rootSchema, path);

    const commonHeader = (
      <div className="flex items-center justify-between">
        <label
          className="text-sm font-medium text-gray-700"
          htmlFor={`run-form-${fieldPath}`}
          title={typeof fieldKey === 'string' && fieldKey !== label ? fieldKey : undefined}
        >
          {label}{isRequired && <span className="text-destructive"> *</span>}
        </label>
        {resolved.default !== undefined && (
          <Button
            id={`run-form-reset-${fieldPath || 'root'}`}
            variant="ghost"
            size="sm"
            onClick={() => updateFormValue((prev) => setValueAtPath(prev, path, resolved.default))}
          >
            {t('runDialog.actions.reset', { defaultValue: 'Reset' })}
          </Button>
        )}
      </div>
    );

    if (type === 'object') {
      const required = new Set(resolved.required ?? []);
      const sectionId = fieldPath || 'root';
      const isCollapsed = collapsedSections.has(sectionId);
      const objectValue = isObjectRecord(value) ? value : {};
      const knownProperties = resolved.properties ?? {};
      const knownPropertyEntries = Object.entries(knownProperties);
      const knownPropertyKeys = new Set(Object.keys(knownProperties));
      const hasAdditionalProperties = resolved.additionalProperties !== undefined && resolved.additionalProperties !== false;
      const additionalValueSchema = hasAdditionalProperties && typeof resolved.additionalProperties === 'object'
        ? resolveSchemaRef(resolved.additionalProperties, rootSchema)
        : {};
      const additionalValueRequired = new Set(additionalValueSchema.required ?? []);
      const dynamicEntries = Object.entries(objectValue).filter(([key]) => !knownPropertyKeys.has(key));
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
            <span className="text-xs text-gray-400">
              {isCollapsed
                ? t('runDialog.actions.show', { defaultValue: 'Show' })
                : t('runDialog.actions.hide', { defaultValue: 'Hide' })}
            </span>
          </button>
          {resolved.description && <div className="text-xs text-gray-500">{resolved.description}</div>}
          {fieldErrors.map((err) => (
            <div key={`${fieldPath || 'root'}-err`} className="text-xs text-destructive">{err.message}</div>
          ))}
          {!isCollapsed && (
            <div className="space-y-3">
              {knownPropertyEntries.map(([key, propSchema]) => (
                <div key={`${fieldPath}.${key}`}>
                  {renderField(
                    propSchema,
                    (value as any)?.[key],
                    [...path, key],
                    required
                  )}
                </div>
              ))}
              {hasAdditionalProperties && (
                <div className="rounded border border-gray-100 bg-gray-50 p-2 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-medium text-gray-700">
                      {t('runDialog.form.mapEntriesTitle', { defaultValue: 'Map entries' })}
                    </div>
                    <Button
                      id={`run-form-object-add-${fieldPath || 'root'}`}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const input = window.prompt(
                          t('runDialog.form.mapEntriesPrompt', { defaultValue: 'Enter field key/path' })
                        );
                        const nextKey = (input ?? '').trim();
                        if (!nextKey) return;
                        if (knownPropertyKeys.has(nextKey) || dynamicEntries.some(([key]) => key === nextKey)) {
                          toast.error(t('runDialog.toasts.mapEntryExists', {
                            defaultValue: 'That key already exists.',
                          }));
                          return;
                        }
                        const defaultDynamicValue = hasAdditionalProperties && typeof resolved.additionalProperties === 'object'
                          ? buildDefaultValueFromSchema(resolved.additionalProperties, rootSchema)
                          : null;
                        updateFormValue((prev) => {
                          const current = getValueAtPath(prev, path);
                          const nextObject = isObjectRecord(current) ? { ...current } : {};
                          nextObject[nextKey] = defaultDynamicValue;
                          return setValueAtPath(prev, path, nextObject);
                        });
                      }}
                    >
                      {t('runDialog.actions.addField', { defaultValue: 'Add field' })}
                    </Button>
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {t('runDialog.form.mapEntriesDescription', {
                      defaultValue: 'For map-style objects, add keys and set each value.',
                    })}
                  </div>
                  {dynamicEntries.length === 0 && (
                    <div className="text-xs text-gray-500">
                      {t('runDialog.form.mapEntriesEmpty', { defaultValue: 'No map entries added.' })}
                    </div>
                  )}
                  {dynamicEntries.map(([entryKey, entryValue]) => (
                    <div key={`${fieldPath}.dynamic.${entryKey}`} className="rounded border border-gray-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] p-2 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-xs bg-gray-100 px-1 py-0.5 rounded break-all">{entryKey}</code>
                        <Button
                          id={`run-form-object-remove-${fieldPath || 'root'}-${entryKey}`}
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            updateFormValue((prev) => {
                              const current = getValueAtPath(prev, path);
                              if (!isObjectRecord(current)) return prev;
                              const nextObject = { ...current };
                              delete nextObject[entryKey];
                              return setValueAtPath(prev, path, nextObject);
                            });
                          }}
                        >
                          {t('runDialog.actions.remove', { defaultValue: 'Remove' })}
                        </Button>
                      </div>
                      {renderField(additionalValueSchema, entryValue, [...path, entryKey], additionalValueRequired)}
                    </div>
                  ))}
                </div>
              )}
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
                {t('runDialog.actions.remove', { defaultValue: 'Remove' })}
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
            {t('runDialog.actions.addItem', { defaultValue: 'Add item' })}
          </Button>
        </div>
      );
    }

    // The trigger's own dates get a plain explanation instead of the schema's format note.
    const dateTriggerHelp = activeDateTrigger && path.length === 1 && typeof fieldKey === 'string'
      ? describeDateTriggerPayloadField(t, fieldKey, activeDateTrigger)
      : null;
    const descriptionText = dateTriggerHelp ?? resolved.description;
    const description = descriptionText ? (
      <div id={`run-form-${fieldPath}-help`} className="text-xs text-gray-500 mt-1">{descriptionText}</div>
    ) : null;
    const fillGap = recordFillGaps[payloadPathKey(path)];

    if (pickerField) {
      // A ticket picked elsewhere in the form narrows client-scoped pickers (contacts, locations).
      const scoped = applyDerivedClientScope(
        pickerField,
        isObjectRecord(formValue) ? formValue : {},
        selectedTicketClientId
      );
      return (
        <div className="space-y-1">
          {commonHeader}
          <WorkflowActionInputFixedPicker
            field={scoped.field}
            value={typeof value === 'string' ? value : null}
            onChange={(nextValue) => {
              updateFormValue((prev) => setValueAtPath(prev, path, nextValue));
              const kind = scoped.field.editor?.picker?.resource ?? scoped.field.picker?.kind;
              if (nextValue && kind) void fillFromRecord(kind, nextValue, path);
            }}
            idPrefix={`run-form-${fieldPath || 'root'}`}
            rootInputMapping={scoped.rootInputMapping as InputMapping}
            hideLabel
          />
          {description}
          {fillGap && (fillGap.neverFires || fillGap.fields.length > 0) && (
            <div id={`run-form-${fieldPath}-fill-gap`} className="text-xs text-amber-700 dark:text-amber-400">
              {fillGap.fields.length > 0 && t('runDialog.form.recordFillGap', {
                defaultValue: 'The picked record has no {{fields}}, so that stays empty.',
                fields: fillGap.fields.map((key) => t(`runDialog.fieldLabels.${key}`, { defaultValue: humanizeRunDialogFieldLabel(key) })).join(', '),
              })}
              {fillGap.neverFires && ` ${t('runDialog.form.recordNeverFires', {
                defaultValue: 'This trigger never runs for this record: it has no date to run on. Pick another, or enter the dates yourself.',
              })}`}
            </div>
          )}
          {fieldErrors.map((err) => (
            <div key={`${fieldPath}-err`} className="text-xs text-destructive">{err.message}</div>
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
            <div key={`${fieldPath}-err`} className="text-xs text-destructive">{err.message}</div>
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
            <span className="text-xs text-gray-500">
              {Boolean(value)
                ? t('runDialog.form.booleanTrue', { defaultValue: 'True' })
                : t('runDialog.form.booleanFalse', { defaultValue: 'False' })}
            </span>
          </div>
          {description}
          {fieldErrors.map((err) => (
            <div key={`${fieldPath}-err`} className="text-xs text-destructive">{err.message}</div>
          ))}
        </div>
      );
    }

    const isNumeric = type === 'number' || type === 'integer';
    const dateFormat = !isNumeric ? getRunDialogDateFormat(resolveConcreteFieldSchema(resolved, rootSchema)) : null;

    if (dateFormat) {
      const rawValue = typeof value === 'string' ? value : '';
      const commit = (next: Date | undefined) => {
        const serialized = !next
          ? null
          : dateFormat === 'date-time' ? next.toISOString() : dateToString(next);
        updateFormValue((prev) => setValueAtPath(prev, path, serialized));
      };

      return (
        <div className="space-y-1">
          {commonHeader}
          {dateFormat === 'date-time' ? (
            <DateTimePicker
              id={`run-form-${fieldPath}`}
              label={label}
              required={isRequired}
              clearable
              value={dateTimeFromString(rawValue)}
              onChange={commit}
            />
          ) : (
            <DatePicker
              id={`run-form-${fieldPath}`}
              label={label}
              required={isRequired}
              clearable
              value={dateFromString(rawValue)}
              onChange={commit}
            />
          )}
          {description}
          {fieldErrors.map((err) => (
            <div key={`${fieldPath}-err`} className="text-xs text-destructive">{err.message}</div>
          ))}
        </div>
      );
    }

    // An id with no picker and nothing to fill it from (a message or event id) can be any UUID for
    // a test run; offer one instead of asking people to make one up.
    const isSyntheticId = !isNumeric && resolveConcreteFieldSchema(schema, rootSchema).format === 'uuid';
    return (
      <div className="space-y-1">
        {commonHeader}
        <div className="flex items-center gap-2">
          <Input
            id={`run-form-${fieldPath}`}
            type={isNumeric ? 'number' : 'text'}
            value={value == null ? '' : String(value)}
            placeholder={isSyntheticId
              ? t('runDialog.payload.uuidPlaceholder', { defaultValue: 'An id (UUID), e.g. 3f2c1a5e-0b7d-4c1e-9a2f-6d8e4b1c7a90' })
              : undefined}
            onChange={(event) => {
              const raw = event.target.value;
              const parsed = raw === '' ? null : (isNumeric ? Number(raw) : raw);
              updateFormValue((prev) => setValueAtPath(prev, path, parsed));
            }}
          />
          {isSyntheticId && (
            <Button
              id={`run-form-generate-id-${fieldPath}`}
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => updateFormValue((prev) => setValueAtPath(prev, path, generateTestId()))}
            >
              {t('runDialog.payload.generateTestId', { defaultValue: 'Generate test id' })}
            </Button>
          )}
        </div>
        {description}
        {fieldErrors.map((err) => (
          <div key={`${fieldPath}-err`} className="text-xs text-destructive">{err.message}</div>
        ))}
      </div>
    );
  };

  const exampleOptions = useMemo(() => {
    const schema = schemaSource === 'event' ? eventSchema : payloadSchema;
    const examples = schema?.examples ?? (schema?.example ? [schema.example] : []);
    return (examples ?? []).map((entry, index) => ({
      label: t('runDialog.templates.exampleLabel', {
        defaultValue: 'Example {{count}}',
        count: index + 1,
      }),
      payload: entry as Record<string, unknown>
    }));
  }, [eventSchema, payloadSchema, schemaSource, t]);

  const eventTemplateIds = useMemo(
    () => pickEventTemplates({ eventType: selectedEventType, category: selectedEventEntry?.category ?? null }),
    [selectedEventEntry?.category, selectedEventType]
  );
  const eventTemplates = useMemo(
    () => SAMPLE_TEMPLATES.filter((template) => eventTemplateIds.includes(template.id)),
    [eventTemplateIds]
  );
  // The built-in samples (inbound email, webhook) only make sense when no schema describes the
  // payload; with a schema they'd fill fields the workflow doesn't have.
  const generalTemplates = useMemo(
    () => (activeSchema ? [] : SAMPLE_TEMPLATES.filter((template) => !eventTemplateIds.includes(template.id))),
    [activeSchema, eventTemplateIds]
  );
  const segmentedButtonClass = (active: boolean) =>
    active
      ? 'border-[rgb(var(--color-primary-600))] bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))]'
      : 'border-[rgb(var(--color-border-300))] bg-white text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-border-100))]';
  const utilityButtonClass =
    'border-[rgb(var(--color-border-300))] bg-white text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-border-100))]';

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('runDialog.title', { defaultValue: 'Run Workflow' })}
      className="max-w-4xl"
      footer={(
        <div className="space-y-3">
          {runStartFailure && (
            <Alert id="run-dialog-start-failure" variant="destructive">
              <AlertTitle>{runStartFailure.title}</AlertTitle>
              <AlertDescription>
                <p>{runStartFailure.description}</p>
                {runStartFailure.runId && (
                  <Link
                    id="run-dialog-start-failure-view-run"
                    href={buildWorkflowRunHref(runStartFailure.runId)}
                    className="mt-1 inline-block font-medium text-[rgb(var(--color-primary-600))] underline underline-offset-2"
                  >
                    {t('runDialog.actions.viewFailedRun', { defaultValue: 'View failed run' })}
                  </Link>
                )}
                {runStartFailure.technicalDetail && (
                  <details className="mt-2 text-xs text-[rgb(var(--color-text-600))]">
                    <summary id="run-dialog-start-failure-details" className="cursor-pointer select-none">
                      {t('runDialog.startFailure.technicalDetails', { defaultValue: 'Technical details' })}
                    </summary>
                    <code className="mt-1 block whitespace-pre-wrap break-all font-mono">
                      {runStartFailure.technicalDetail}
                    </code>
                  </details>
                )}
              </AlertDescription>
            </Alert>
          )}
          <div className="flex items-center justify-end gap-2">
          {isStartingRun && (
            <span
              id="run-dialog-start-progress"
              role="status"
              aria-live="polite"
              className="mr-auto text-xs text-[rgb(var(--color-text-500))]"
            >
              {t('runDialog.startProgress', { defaultValue: 'Connecting to the workflow engine…' })}
            </span>
          )}
          <Button id="run-dialog-close" variant="outline" onClick={onClose}>
            {t('runDialog.actions.close', { defaultValue: 'Close' })}
          </Button>
          <Button
            id="run-dialog-start-run"
            onClick={handleStartRun}
            disabled={!canRun || isStartingRun || !!runPayloadError || (isSystem && !confirmSystemRun)}
          >
            {isStartingRun
              ? t('runDialog.actions.starting', { defaultValue: 'Starting...' })
              : runStartFailure
                ? t('runDialog.actions.tryAgain', { defaultValue: 'Try again' })
                : t('runDialog.actions.startRun', { defaultValue: 'Start Run' })}
          </Button>
          </div>
        </div>
      )}
    >
      <DialogContent>
        <DialogDescription>
          {t('runDialog.description', {
            defaultValue: 'Provide a synthetic payload to preview (and run) a workflow.',
          })}
          {selectedEventEntry?.name
            ? ` ${t('runDialog.descriptionEvent', {
                defaultValue: 'Event: {{name}}.',
                name: selectedEventEntry.name,
              })}`
            : ''}
        </DialogDescription>

        <div className="space-y-4">
          {!publishedVersion && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 shadow-sm space-y-2">
              <div className="font-semibold">
                {t('runDialog.noPublishedVersion.title', { defaultValue: 'No published version' })}
              </div>
              <div className="text-xs text-amber-900">
                {t('runDialog.noPublishedVersion.description', {
                  defaultValue: 'You can preview the payload builder, but you must publish the workflow before starting a run.',
                })}
              </div>
              {canPublish && onPublishDraft && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    id="run-dialog-publish-draft"
                    size="sm"
                    className="border-[rgb(var(--color-primary-600))] bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))]"
                    onClick={() => void onPublishDraft()}
                    disabled={isPaused}
                  >
                    {t('runDialog.actions.publishDraft', { defaultValue: 'Publish draft' })}
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              id="run-dialog-workflow"
              label={t('runDialog.fields.workflowLabel', { defaultValue: 'Workflow' })}
              value={workflowName ?? ''}
              disabled
            />
            <CustomSelect
              id="run-dialog-version"
              label={t('runDialog.fields.publishedVersionLabel', { defaultValue: 'Published version' })}
              options={versionOptions.length ? versionOptions : (publishedVersion ? [{ value: String(publishedVersion), label: `v${publishedVersion}` }] : [])}
              value={selectedVersion || (publishedVersion ? String(publishedVersion) : '')}
              onValueChange={(value) => setSelectedVersion(value)}
              disabled={!publishedVersion}
            />
            <Input
              id="run-dialog-run-source"
              label={t('runDialog.fields.runSourceLabel', { defaultValue: 'Run source' })}
              value={t('runDialog.fields.runSourceManualTest', { defaultValue: 'Manual test' })}
              disabled
            />
            <Input
              id="run-dialog-trigger"
              label={t('runDialog.fields.workflowTriggerLabel', { defaultValue: 'Workflow trigger' })}
              value={triggerLabel ?? t('runDialog.fields.noTrigger', { defaultValue: 'None (runs only when started by hand)' })}
              disabled
            />
            <Input
              id="run-dialog-status"
              label={t('runDialog.fields.workflowStatusLabel', { defaultValue: 'Workflow status' })}
              value={isPaused
                ? t('runDialog.fields.statusPaused', { defaultValue: 'paused' })
                : t('runDialog.fields.statusActive', { defaultValue: 'active' })}
              disabled
            />
          </div>

          <CollapsibleSection title={t('runDialog.sections.schemaAndEvents', { defaultValue: 'Schema & Events' })}>
          <div className="rounded border border-gray-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-gray-800">
                  {t('runDialog.eventCatalog.title', { defaultValue: 'Event catalog' })}
                </div>
                <div className="text-xs text-gray-500">
                  {t('runDialog.eventCatalog.description', {
                    defaultValue: 'Pick an event type to seed payload schemas.',
                  })}
                </div>
              </div>
              {selectedEventType && (
                <Button id="run-dialog-open-event-catalog" asChild variant="ghost" size="sm">
                  <Link href={`/msp/workflow-control?section=events&eventType=${encodeURIComponent(selectedEventType)}`}>
                    {t('runDialog.actions.openEventCatalog', { defaultValue: 'Open event catalog' })}
                  </Link>
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                id="run-dialog-event-search"
                label={t('runDialog.eventCatalog.searchLabel', { defaultValue: 'Search events' })}
                value={eventSearch}
                onChange={(event) => setEventSearch(event.target.value)}
                placeholder={t('runDialog.eventCatalog.searchPlaceholder', {
                  defaultValue: 'Search by name, type, or category',
                })}
              />
              <CustomSelect
                id="run-dialog-event-type"
                label={t('runDialog.eventCatalog.eventTypeLabel', { defaultValue: 'Event type' })}
                options={eventOptions}
                value={selectedEventType}
                onValueChange={(value) => setSelectedEventType(value)}
                placeholder={isLoadingEvents
                  ? t('runDialog.eventCatalog.loadingEvents', { defaultValue: 'Loading events...' })
                  : t('runDialog.eventCatalog.selectEventType', { defaultValue: 'Select event type' })}
                allowClear
                customStyles={{ item: 'whitespace-normal items-start py-2' }}
              />
            </div>

            {selectedEventEntry && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <Badge className={`text-[10px] ${selectedEventEntry.tenant ? 'bg-emerald-500/15 text-emerald-600' : 'bg-blue-500/15 text-blue-600'}`}>
                  {selectedEventEntry.tenant
                    ? t('runDialog.eventCatalog.tenantEvent', { defaultValue: 'Tenant event' })
                    : t('runDialog.eventCatalog.systemEvent', { defaultValue: 'System event' })}
                </Badge>
                <span>{selectedEventEntry.category ?? t('runDialog.eventCatalog.uncategorized', { defaultValue: 'Uncategorized' })}</span>
                {selectedEventEntry.description && <span>· {selectedEventEntry.description}</span>}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500">
                {t('runDialog.schema.sourceLabel', { defaultValue: 'Schema source' })}
              </span>
              <Button
                id="run-dialog-schema-source-workflow"
                variant={schemaSource === 'payload' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSchemaSource('payload')}
              >
                {t('runDialog.schema.workflowSchema', { defaultValue: 'Workflow schema' })}
              </Button>
              <Button
                id="run-dialog-schema-source-event"
                variant={schemaSource === 'event' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSchemaSource('event')}
                disabled={!eventSchema}
              >
                {t('runDialog.schema.eventSchema', { defaultValue: 'Event schema' })}
              </Button>
              <Button
                id="run-dialog-schema-source-schema-ref"
                variant={schemaSource === 'schemaRef' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSchemaSource('schemaRef')}
              >
                {t('runDialog.schema.schemaRef', { defaultValue: 'Schema ref' })}
              </Button>
              {schemaSource === 'event' && !eventSchema && (
                <span className="text-xs text-yellow-700">
                  {t('runDialog.schema.eventUnavailable', {
                    defaultValue: 'Event schema not available; using workflow schema instead.',
                  })}
                </span>
              )}
            </div>

            {schemaSource === 'schemaRef' && (
              <div className="mt-2">
                <SearchableSelect
                  id="run-dialog-schema-ref"
                  label={t('runDialog.schema.schemaRefLabel', { defaultValue: 'Schema ref' })}
                  dropdownMode="overlay"
                  placeholder={t('runDialog.schema.selectSchema', { defaultValue: 'Select schema…' })}
                  value={customSchemaRef}
                  onChange={(value) => setCustomSchemaRef(value)}
                  options={schemaRefs.map((ref) => ({ value: ref, label: ref }))}
                  emptyMessage={t('runDialog.schema.noSchemasFound', { defaultValue: 'No schemas found' })}
                />
                {customSchemaRef && !customSchema && (
                  <div className="mt-2 text-xs text-destructive">
                    {t('runDialog.schema.unknownSchemaRef', { defaultValue: 'Unknown schema ref.' })}
                  </div>
                )}
              </div>
            )}

            {schemaWarning && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 shadow-sm space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{schemaWarning}</span>
                  {eventSchema && schemaSource !== 'event' && (
                    <Button
                      id="run-dialog-use-event-schema"
                      variant="outline"
                      size="sm"
                      className={utilityButtonClass}
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
                      {t('runDialog.schema.useEventSchema', { defaultValue: 'Use event schema' })}
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
                      {showSchemaDiff
                        ? t('runDialog.schema.hideSchemaDiff', { defaultValue: 'Hide schema diff' })
                        : t('runDialog.schema.viewSchemaDiff', { defaultValue: 'View schema diff' })}
                    </Button>
                    {showSchemaDiff && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-gray-600">
                        <div>
                          <div className="font-semibold text-gray-700">{t('runDialog.schema.onlyInEvent', { defaultValue: 'Only in event schema' })}</div>
                          <div>{schemaDiffSummary.onlyInEvent.length ? schemaDiffSummary.onlyInEvent.join(', ') : emptyValueLabel}</div>
                          <div className="mt-2 font-semibold text-gray-700">{t('runDialog.schema.requiredOnlyInEvent', { defaultValue: 'Required only in event' })}</div>
                          <div>{schemaDiffSummary.requiredOnlyInEvent.length ? schemaDiffSummary.requiredOnlyInEvent.join(', ') : emptyValueLabel}</div>
                        </div>
                        <div>
                          <div className="font-semibold text-gray-700">{t('runDialog.schema.onlyInWorkflow', { defaultValue: 'Only in workflow schema' })}</div>
                          <div>{schemaDiffSummary.onlyInPayload.length ? schemaDiffSummary.onlyInPayload.join(', ') : emptyValueLabel}</div>
                          <div className="mt-2 font-semibold text-gray-700">{t('runDialog.schema.requiredOnlyInWorkflow', { defaultValue: 'Required only in workflow' })}</div>
                          <div>{schemaDiffSummary.requiredOnlyInPayload.length ? schemaDiffSummary.requiredOnlyInPayload.join(', ') : emptyValueLabel}</div>
                        </div>
                        {schemaDiffSummary.typeMismatches.length > 0 && (
                          <div className="md:col-span-2">
                            <div className="font-semibold text-gray-700">{t('runDialog.schema.typeMismatches', { defaultValue: 'Type mismatches' })}</div>
                            <div>
                              {schemaDiffSummary.typeMismatches.map((item) => (
                                <div key={item.field}>
                                  {t('runDialog.schema.typeMismatchLine', {
                                    defaultValue: '{{field}}: event {{eventType}} vs workflow {{payloadType}}',
                                    field: item.field,
                                    eventType: item.eventType ?? 'unknown',
                                    payloadType: item.payloadType ?? 'unknown',
                                  })}
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
          </CollapsibleSection>

          {draftVersion && publishedVersion && draftVersion !== publishedVersion + 1 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 shadow-sm flex items-center justify-between gap-3">
              <span className="font-medium">
                {t('runDialog.draftWarning', {
                  defaultValue: 'Draft version differs from published (v{{version}}).',
                  version: publishedVersion,
                })}
              </span>
              {canPublish && onPublishDraft && (
                <Button
                  id="run-dialog-publish-latest"
                  size="sm"
                  className="border-[rgb(var(--color-primary-600))] bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))]"
                  onClick={() => onPublishDraft()}
                >
                  {t('runDialog.actions.publishLatest', { defaultValue: 'Publish latest' })}
                </Button>
              )}
            </div>
          )}

          {concurrencyLimit && (
            <div className="rounded border border-blue-500/30 bg-blue-500/10 p-2 text-xs text-blue-600">
              {t('runDialog.concurrencyLimit', {
                defaultValue: 'Concurrency limit: {{count}} run(s) at a time.',
                count: concurrencyLimit,
              })}
            </div>
          )}

          {isSystem && (
            <div className="rounded border border-orange-200 bg-orange-50 p-2 text-xs text-orange-700 space-y-2">
              <div>{t('runDialog.systemWorkflowWarning', {
                defaultValue: 'This is a system workflow. Running it may affect core automation.',
              })}</div>
              <div className="flex items-center gap-2">
                <Switch checked={confirmSystemRun} onCheckedChange={setConfirmSystemRun} />
                <span>{t('runDialog.systemWorkflowConfirm', {
                  defaultValue: 'I understand and want to run it.',
                })}</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              id="run-dialog-mode-json"
              variant={mode === 'json' ? 'default' : 'outline'}
              size="sm"
              className={segmentedButtonClass(mode === 'json')}
              onClick={() => setMode('json')}
            >
              {t('runDialog.actions.jsonEditor', { defaultValue: 'JSON Editor' })}
            </Button>
            <Button
              id="run-dialog-mode-form"
              variant={mode === 'form' ? 'default' : 'outline'}
              size="sm"
              className={segmentedButtonClass(mode === 'form')}
              onClick={() => setMode('form')}
            >
              {t('runDialog.actions.formBuilder', { defaultValue: 'Form Builder' })}
            </Button>
          </div>

          <CollapsibleSection title={t('runDialog.sections.payloadTools', { defaultValue: 'Payload Tools' })} defaultCollapsed={true}>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                id="run-dialog-reset-defaults"
                variant="outline"
                size="sm"
                className={utilityButtonClass}
                onClick={handleResetDefaults}
              >
                {t('runDialog.actions.resetToDefaults', { defaultValue: 'Reset to defaults' })}
              </Button>
              <Button
                id="run-dialog-copy-payload"
                variant="outline"
                size="sm"
                className={utilityButtonClass}
                onClick={copyPayload}
              >
                {t('runDialog.actions.copyPayload', { defaultValue: 'Copy payload' })}
              </Button>
              <Button
                id="run-dialog-clone-latest"
                variant="outline"
                size="sm"
                className={utilityButtonClass}
                onClick={handleCloneLatest}
              >
                {t('runDialog.actions.cloneLatestRun', { defaultValue: 'Clone latest run' })}
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
              <div className="w-full text-xs text-gray-500">
                {t('runDialog.templates.eventTemplates', { defaultValue: 'Event templates' })}
              </div>
              {eventTemplates.map((template) => (
                <Button
                  key={template.id}
                  id={`run-dialog-template-event-${template.id}`}
                  variant="outline"
                  size="sm"
                  onClick={() => applyTemplate(template.payload, { markTouched: true })}
                >
                  {template.id === 'email'
                    ? t('runDialog.templates.emailTemplate', { defaultValue: 'Inbound Email' })
                    : template.id === 'webhook'
                      ? t('runDialog.templates.webhookTemplate', { defaultValue: 'Webhook Event' })
                      : template.label}
                </Button>
              ))}
            </div>
          )}

          {generalTemplates.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-full text-xs text-gray-500">
                {t('runDialog.templates.sampleTemplates', { defaultValue: 'Sample templates' })}
              </div>
              {generalTemplates.map((template) => (
                <Button
                  key={template.id}
                  id={`run-dialog-template-sample-${template.id}`}
                  variant="outline"
                  size="sm"
                  onClick={() => applyTemplate(template.payload, { markTouched: true })}
                >
                  {template.id === 'email'
                    ? t('runDialog.templates.emailTemplate', { defaultValue: 'Inbound Email' })
                    : template.id === 'webhook'
                      ? t('runDialog.templates.webhookTemplate', { defaultValue: 'Webhook Event' })
                      : template.label}
                </Button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              id="run-dialog-preset-name"
              label={t('runDialog.presets.presetNameLabel', { defaultValue: 'Preset name' })}
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
              placeholder={t('runDialog.presets.presetNamePlaceholder', {
                defaultValue: 'e.g. Regression payload',
              })}
            />
            <Button id="run-dialog-save-preset" variant="outline" onClick={handleSavePreset} className="self-end">
              {t('runDialog.actions.savePreset', { defaultValue: 'Save preset' })}
            </Button>
          </div>

          {presets.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-gray-500">
                {t('runDialog.presets.savedPresets', { defaultValue: 'Saved presets' })}
              </div>
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
          </CollapsibleSection>

          <div className="text-xs text-gray-500">
            {t('runDialog.payload.payloadSize', {
              defaultValue: 'Payload size: {{size}} KB',
              size: (payloadSize / 1024).toFixed(1),
            })}
          </div>
          {payloadWarnings.map((warning) => (
            <div key={warning} className="text-xs text-yellow-700">{warning}</div>
          ))}

          {submitAttempted && displayedSchemaErrors.length > 0 && (
            <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive space-y-1">
              <div className="font-semibold">
                {t('runDialog.validation.summaryTitle', {
                  defaultValue: 'Some fields need attention before this run can start',
                })}
              </div>
              <div>
                {t('runDialog.validation.summaryDescription', {
                  defaultValue: 'Fix the fields below, switch to Form Builder, or use a sample payload button.',
                })}
              </div>
              {displayedSchemaErrors.slice(0, 6).map((err, index) => (
                <div key={`${err.path}-${index}`}>{err.message}</div>
              ))}
              {displayedSchemaErrors.length > 6 && (
                <div>
                  {t('runDialog.validation.moreErrors', {
                    defaultValue: '+{{count}} more…',
                    count: displayedSchemaErrors.length - 6,
                  })}
                </div>
              )}
            </div>
          )}

          {payloadTouched && (
            <div id="run-dialog-draft" className="flex flex-wrap items-center justify-between gap-2 text-xs text-[rgb(var(--color-text-500))]">
              <span>
                {restoredDraft
                  ? t('runDialog.draft.restored', { defaultValue: 'Your last test payload for this workflow is back. It stays here until you start over.' })
                  : t('runDialog.draft.kept', { defaultValue: 'This payload is kept if you close the dialog.' })}
              </span>
              <Button id="run-dialog-start-over" type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleStartOver}>
                {t('runDialog.draft.startOver', { defaultValue: 'Start over' })}
              </Button>
            </div>
          )}

          {mode === 'json' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('runDialog.payload.payloadJsonLabel', { defaultValue: 'Payload (JSON)' })}
              </label>
              <TextArea
                id="run-dialog-payload"
                value={runPayloadText}
                onChange={(event) => handleRunPayloadChange(event.target.value)}
                rows={12}
                className={runPayloadError ? 'border-destructive' : ''}
              />
              {runPayloadError && <div className="text-xs text-destructive mt-1">{runPayloadError}</div>}
            </div>
          ) : (
            <div className="space-y-3">
              {activeSchema && recordFillHints.length > 0 && (
                <div id="run-dialog-record-fill-hint" className="space-y-0.5 text-xs text-[rgb(var(--color-text-500))]">
                  {recordFillHints.map((hint) => (
                    <p key={hint.key} id={`run-dialog-record-fill-hint-${hint.key}`}>
                      {t('runDialog.form.recordFillHintField', {
                        field: hint.field,
                        targets: hint.targets.join(', '),
                        defaultValue: 'Pick a real record in {{field}} and these fields fill in from it when empty: {{targets}}.',
                      })}
                    </p>
                  ))}
                  <p>
                    {t('runDialog.form.recordFillKeepsTyped', {
                      defaultValue: 'Values you typed yourself are kept; fields the record has no value for stay as they are.',
                    })}
                  </p>
                </div>
              )}
              {activeSchema ? (
                renderField(activeSchema, formValue, [], new Set(activeSchema.required ?? []))
              ) : (
                <div className="text-xs text-gray-500">
                  {t('runDialog.form.noSchema', { defaultValue: 'No schema available to render a form.' })}
                </div>
              )}
            </div>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
};

export default WorkflowRunDialog;
