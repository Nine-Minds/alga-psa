'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import SearchableSelect from '@alga-psa/ui/components/SearchableSelect';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import {
  BarChart3,
  Briefcase,
  Bell,
  Calendar,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  FileText,
  Grid3X3,
  List,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Settings2,
  Server,
  Ticket,
  Users,
  User,
  AlertTriangle,
  Zap
} from 'lucide-react';
import {
  createCustomEventAction,
  createWorkflowFromEventAction,
  detachWorkflowTriggerFromEventAction,
  getEventCatalogPermissionsAction,
  getEventMetricsAction,
  getEventSchemaByRefAction,
  listAttachedWorkflowsByEventTypeAction,
  listEventCatalogCategoriesV2Action,
  listEventCatalogWithMetricsAction,
  listSchemaRegistryRefsAction,
  simulateWorkflowEventAction,
  type WorkflowEventCatalogEntryV2
} from '@alga-psa/workflows/actions';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import type { InputMapping } from '@alga-psa/workflows/runtime';
import {
  WorkflowActionInputFixedPicker,
  WORKFLOW_FIXED_PICKER_SUPPORTED_RESOURCES,
  type WorkflowActionInputPickerField,
  type WorkflowPickerActions,
} from './WorkflowActionInputFixedPicker';
import { resolveWorkflowSchemaFieldEditor } from './workflowSchemaFieldEditor';

type ViewMode = 'grid' | 'list';
type SortMode = 'category_name' | 'most_active';

type MetricsState = {
  open: boolean;
  eventType: string | null;
};

type SimulateState = {
  open: boolean;
  eventType: string | null;
  payloadSchemaRef: string | null;
};

type AttachState = {
  creating: boolean;
};

type DefineEventState = {
  open: boolean;
};

const VIEW_MODE_KEY = 'workflow-event-catalog:viewMode';
const CORRELATION_KEY_PREFIX = 'workflow-event-catalog:correlationKey:';

const formatNumber = (value: number | null | undefined) => {
  if (value == null) return '—';
  return new Intl.NumberFormat(undefined, { notation: 'compact' }).format(value);
};

const formatPercent = (value: number | null | undefined) => {
  if (value == null) return '—';
  return `${Math.round(value * 1000) / 10}%`;
};

const formatDurationMs = (value: number | null | undefined) => {
  if (value == null) return '—';
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round((seconds % 60) * 10) / 10;
  return `${minutes}m ${rem}s`;
};

const EventCardSkeleton: React.FC<{ viewMode: ViewMode }> = ({ viewMode }) => {
  if (viewMode === 'list') {
    return (
      <Card className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3 w-44" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-8 w-10 rounded-md" />
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="mt-3 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="space-y-2">
          <Skeleton className="h-5 w-16 mx-auto" />
          <Skeleton className="h-3 w-20 mx-auto" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-5 w-16 mx-auto" />
          <Skeleton className="h-3 w-20 mx-auto" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-5 w-16 mx-auto" />
          <Skeleton className="h-3 w-20 mx-auto" />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Skeleton className="h-9 w-28 rounded-md" />
        <Skeleton className="h-9 w-28 rounded-md" />
        <Skeleton className="h-9 w-10 rounded-md ml-auto" />
      </div>
    </Card>
  );
};

const getEventIcon = (entry: WorkflowEventCatalogEntryV2) => {
  const type = entry.event_type.toLowerCase();
  const category = (entry.category ?? '').toLowerCase();

  if (type.startsWith('email.') || category.includes('email')) return { Icon: Mail, cls: 'bg-blue-500/10 text-blue-600' };
  if (type.startsWith('ticket.') || category.includes('ticket')) return { Icon: Ticket, cls: 'bg-indigo-500/10 text-indigo-600' };
  if (type.startsWith('comment.') || category.includes('comment')) return { Icon: MessageSquare, cls: 'bg-sky-500/10 text-sky-600' };
  if (type.startsWith('invoice.') || type.startsWith('billing.') || category.includes('billing')) return { Icon: CreditCard, cls: 'bg-emerald-500/10 text-emerald-600' };
  if (type.startsWith('client.') || type.startsWith('contact.') || category.includes('client') || category.includes('contact')) return { Icon: Users, cls: 'bg-amber-500/10 text-amber-600' };
  if (type.startsWith('project.') || category.includes('project')) return { Icon: Briefcase, cls: 'bg-purple-500/10 text-purple-600' };
  if (type.startsWith('schedule.') || type.startsWith('calendar.') || category.includes('calendar')) return { Icon: Calendar, cls: 'bg-teal-500/10 text-teal-600' };
  if (type.startsWith('user.') || category.includes('user')) return { Icon: User, cls: 'bg-gray-500/10 text-gray-600' };
  if (type.startsWith('system.') || category.includes('system')) return { Icon: Server, cls: 'bg-gray-500/10 text-gray-600' };
  if (type.startsWith('sla.') || category.includes('sla') || type.includes('breach')) return { Icon: Clock, cls: 'bg-warning/10 text-warning' };
  if (type.includes('error') || category.includes('error') || type.includes('exception')) return { Icon: AlertTriangle, cls: 'bg-destructive/10 text-destructive' };

  return { Icon: Zap, cls: 'bg-purple-500/10 text-purple-600' };
};

const syntaxHighlightJson = (text: string) => {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const json = esc(text);
  // strings: keys vs values, numbers, booleans/null
  // Use inline styles so colors are not dependent on CSS class extraction.
  return json.replace(
    /(\"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\\"])*\"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      if (/^\"/.test(match)) {
        const color = /:$/.test(match) ? '#1d4ed8' : '#047857'; // key blue, value green
        return `<span style="color:${color}">${match}</span>`;
      } else if (/true|false/.test(match)) {
        return `<span style="color:#7c3aed">${match}</span>`;
      } else if (/null/.test(match)) {
        return `<span style="color:#6b7280">${match}</span>`;
      } else {
        return `<span style="color:#b45309">${match}</span>`;
      }
    }
  );
};

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
  $defs?: Record<string, JsonSchema>;
  'x-workflow-picker-kind'?: string;
  'x-workflow-picker-dependencies'?: string[];
  'x-workflow-picker-fixed-value-hint'?: string;
  'x-workflow-picker-allow-dynamic-reference'?: boolean;
  'x-workflow-editor'?: import('@alga-psa/shared/workflow/runtime').WorkflowEditorJsonSchemaMetadata;
};

type ValidationIssue = { path: string; message: string };

const IMPLICIT_SIMULATION_FIELD_KEYS = new Set(['tenantId']);
const UUID_SAMPLE_VALUE = '00000000-0000-4000-8000-000000000001';

const resolveSchemaRef = (schema: JsonSchema | null | undefined, root: JsonSchema | null | undefined): JsonSchema => {
  if (!schema || typeof schema !== 'object') {
    return {};
  }

  if (!schema.$ref?.startsWith('#/')) {
    return schema;
  }

  if (!root || typeof root !== 'object') {
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

const normalizeSchemaType = (schema?: JsonSchema): string | undefined => {
  if (!schema?.type) return undefined;
  if (Array.isArray(schema.type)) {
    return schema.type.find((value) => value !== 'null') ?? schema.type[0];
  }
  return schema.type;
};

const stripImplicitSimulationFields = (payload: Record<string, unknown>): Record<string, unknown> => {
  const next = { ...payload };
  for (const key of IMPLICIT_SIMULATION_FIELD_KEYS) {
    delete next[key];
  }
  return next;
};

const applyImplicitSimulationFields = (
  payload: Record<string, unknown>,
  options: { tenantId?: string | null }
): Record<string, unknown> => {
  const next = stripImplicitSimulationFields(payload);
  if (options.tenantId) {
    next.tenantId = options.tenantId;
  }
  return next;
};

const isImplicitSimulationFieldPath = (path: Array<string | number>): boolean => (
  path.length === 1 && typeof path[0] === 'string' && IMPLICIT_SIMULATION_FIELD_KEYS.has(path[0])
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
  const type = normalizeSchemaType(resolved);
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

const resolveConcreteFieldSchema = (schema: JsonSchema, root: JsonSchema): JsonSchema => {
  const resolved = resolveSchemaRef(schema, root);

  if (resolved.anyOf?.length) {
    const variant = resolved.anyOf.find((candidate) => {
      const candidateResolved = resolveSchemaRef(candidate, root);
      const candidateType = normalizeSchemaType(candidateResolved);
      return candidateType && candidateType !== 'null';
    });
    if (variant) return resolveConcreteFieldSchema(variant, root);
  }

  if (resolved.oneOf?.length) {
    const variant = resolved.oneOf.find((candidate) => {
      const candidateResolved = resolveSchemaRef(candidate, root);
      const candidateType = normalizeSchemaType(candidateResolved);
      return candidateType && candidateType !== 'null';
    });
    if (variant) return resolveConcreteFieldSchema(variant, root);
  }

  return resolved;
};

const SIMULATION_PICKER_FALLBACKS: Record<string, { resource: string; fixedValueHint?: string }> = {
  ticketid: { resource: 'ticket', fixedValueHint: 'Search tickets by number or title' },
  actorcontactid: { resource: 'contact', fixedValueHint: 'Select Contact' },
  contactid: { resource: 'contact', fixedValueHint: 'Select Contact' },
  createdbyuserid: { resource: 'user', fixedValueHint: 'Select User' },
  actoruserid: { resource: 'user', fixedValueHint: 'Select User' },
  clientid: { resource: 'client', fixedValueHint: 'Select Client' },
};

const resolveSimulationPickerField = (
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

  const schemaEditor = resolveWorkflowSchemaFieldEditor(resolveSchemaRef(schema, rootSchema)) ?? resolveWorkflowSchemaFieldEditor(concreteSchema);
  const schemaPickerResource = schemaEditor?.picker?.resource;
  if (schemaEditor?.kind === 'picker' && schemaPickerResource && WORKFLOW_FIXED_PICKER_SUPPORTED_RESOURCES.has(schemaPickerResource)) {
    return {
      name: fieldKey,
      nullable: Array.isArray(schema.type) ? schema.type.includes('null') : false,
      editor: schemaEditor,
    };
  }

  const fallback = SIMULATION_PICKER_FALLBACKS[fieldKey.toLowerCase()];
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

const buildSyntheticValueFromSchema = (schema: JsonSchema, root: JsonSchema, path: Array<string | number> = []): unknown => {
  const resolved = resolveSchemaRef(schema, root);

  if (resolved.examples?.length) return resolved.examples[0];
  if (resolved.example !== undefined) return resolved.example;
  if (resolved.default !== undefined) return resolved.default;
  if (resolved.anyOf?.length) return buildSyntheticValueFromSchema(resolved.anyOf[0], root, path);
  if (resolved.oneOf?.length) return buildSyntheticValueFromSchema(resolved.oneOf[0], root, path);
  if (resolved.enum?.length) return resolved.enum[0];

  const type = normalizeSchemaType(resolved);
  const fieldName = String(path[path.length - 1] ?? '').toLowerCase();

  switch (type) {
    case 'object': {
      const required = new Set(resolved.required ?? []);
      return Object.entries(resolved.properties ?? {}).reduce<Record<string, unknown>>((acc, [key, childSchema]) => {
        const childResolved = resolveSchemaRef(childSchema, root);
        if (
          required.has(key)
          || childResolved.default !== undefined
          || childResolved.example !== undefined
          || childResolved.examples?.length
          || childResolved.enum?.length
        ) {
          acc[key] = buildSyntheticValueFromSchema(childResolved, root, [...path, key]);
        }
        return acc;
      }, {});
    }
    case 'array':
      return resolved.items ? [buildSyntheticValueFromSchema(resolved.items, root, [...path, 0])] : [];
    case 'string':
      if (resolved.format === 'date-time') return new Date().toISOString();
      if (resolved.format === 'date') return new Date().toISOString().slice(0, 10);
      if (resolved.format === 'uuid') return UUID_SAMPLE_VALUE;
      if (fieldName.endsWith('id') || fieldName === 'id') return `${fieldName || 'id'}-sample-123`;
      if (fieldName.includes('email')) return 'sample@example.com';
      if (fieldName.includes('name')) return 'Sample Name';
      if (fieldName.includes('type')) return 'sample';
      return fieldName ? `${fieldName}-sample` : 'sample';
    case 'number':
    case 'integer':
      return 1;
    case 'boolean':
      return true;
    default:
      return null;
  }
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
);

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

    if (resolveSimulationPickerField(childSchema, rootSchema, childPath)) {
      continue;
    }

    if (isObjectRecord(value)) {
      next[key] = pruneSyntheticPickerBackedFields(childSchema, value, rootSchema, childPath);
      continue;
    }

    next[key] = value;
  }

  return next;
};

const buildInitialPayloadFromSchema = (schema: JsonSchema | null): Record<string, unknown> => {
  if (!schema) return {};
  const examples = schema.examples ?? (schema.example !== undefined ? [schema.example] : []);
  const fromExample = examples.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
  if (fromExample) {
    return stripImplicitSimulationFields(fromExample as Record<string, unknown>);
  }
  const synthetic = buildSyntheticValueFromSchema(schema, schema);
  if (synthetic && typeof synthetic === 'object' && !Array.isArray(synthetic)) {
    return stripImplicitSimulationFields(pruneSyntheticPickerBackedFields(schema, synthetic as Record<string, unknown>));
  }
  const fallback = buildDefaultValueFromSchema(schema, schema);
  return fallback && typeof fallback === 'object' && !Array.isArray(fallback)
    ? stripImplicitSimulationFields(fallback as Record<string, unknown>)
    : {};
};

const setDeepValue = (obj: unknown, path: Array<string | number>, nextValue: unknown): unknown => {
  if (path.length === 0) return nextValue;
  const [head, ...rest] = path;
  const next = Array.isArray(obj) ? [...obj] : { ...(obj as Record<string, unknown> | null) };
  const child = (obj as any)?.[head];
  (next as any)[head] = rest.length ? setDeepValue(child, rest, nextValue) : nextValue;
  return next;
};

const pathToKey = (path: Array<string | number>): string =>
  path.reduce<string>((acc, part) => (typeof part === 'number' ? `${acc}[${part}]` : acc ? `${acc}.${part}` : String(part)), '');

const toDateTimeLocalInputValue = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const fromDateTimeLocalInputValue = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
};

const validateAgainstSchema = (schema: JsonSchema, value: unknown, root: JsonSchema, path = ''): ValidationIssue[] => {
  const resolved = resolveSchemaRef(schema, root);
  const type = normalizeSchemaType(resolved);
  const errors: ValidationIssue[] = [];

  if (resolved.enum && value != null && !resolved.enum.includes(value as any)) {
    errors.push({ path, message: 'Value must be one of the allowed options.' });
  }

  if (type === 'object') {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      errors.push({ path, message: 'Expected object.' });
      return errors;
    }
    const objectValue = value as Record<string, unknown>;
    const knownProperties = resolved.properties ?? {};
    const required = new Set(resolved.required ?? []);
    for (const key of required) {
      const current = objectValue[key];
      if (current === undefined || current === null || current === '') {
        errors.push({ path: path ? `${path}.${key}` : key, message: 'Required field missing.' });
      }
    }
    for (const [key, child] of Object.entries(knownProperties)) {
      if (objectValue[key] === undefined) continue;
      errors.push(...validateAgainstSchema(child, objectValue[key], root, path ? `${path}.${key}` : key));
    }
    return errors;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) {
      errors.push({ path, message: 'Expected array.' });
      return errors;
    }
    const items = resolved.items ?? {};
    value.forEach((entry, idx) => {
      errors.push(...validateAgainstSchema(items, entry, root, `${path}[${idx}]`));
    });
    return errors;
  }

  if (type === 'string' && value != null && typeof value !== 'string') errors.push({ path, message: 'Expected string.' });
  if ((type === 'number' || type === 'integer') && value != null && typeof value !== 'number') errors.push({ path, message: 'Expected number.' });
  if (type === 'boolean' && value != null && typeof value !== 'boolean') errors.push({ path, message: 'Expected boolean.' });

  return errors;
};

const SchemaForm: React.FC<{
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  errors: ValidationIssue[];
  pickerActions: WorkflowPickerActions;
}> = ({ schema, value, onChange, errors, pickerActions }) => {
  const renderField = (
    fieldSchema: JsonSchema,
    rootSchema: JsonSchema,
    currentValue: unknown,
    path: Array<string | number>,
    requiredSet: Set<string>
  ): React.ReactNode => {
    if (isImplicitSimulationFieldPath(path)) {
      return null;
    }

    const resolved = resolveSchemaRef(fieldSchema, rootSchema);
    const type = normalizeSchemaType(resolved);
    const fieldKey = path[path.length - 1];
    const label = resolved.title ?? (typeof fieldKey === 'string' ? fieldKey : 'Payload');
    const isRequired = typeof fieldKey === 'string' && requiredSet.has(fieldKey);
    const fieldPath = pathToKey(path);
    const fieldErrors = errors.filter((err) => err.path === fieldPath);
    const pickerField = resolveSimulationPickerField(resolved, rootSchema, path);

    const commonHeader = (
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">
          {label}{isRequired && <span className="text-destructive"> *</span>}
        </label>
      </div>
    );

    if (type === 'object') {
      const required = new Set(resolved.required ?? []);
      return (
        <div className="rounded border border-gray-200 bg-white p-3 space-y-2">
          {commonHeader}
          {resolved.description && <div className="text-[11px] text-gray-500">{resolved.description}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {Object.entries(resolved.properties ?? {}).map(([key, child]) => (
              <div key={`${fieldPath}.${key}`}>
                {renderField(child, rootSchema, (currentValue as any)?.[key], [...path, key], required)}
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (type === 'array') {
      const items = Array.isArray(currentValue) ? currentValue : [];
      return (
        <div className="rounded border border-gray-200 bg-white p-3 space-y-2">
          {commonHeader}
          {resolved.description && <div className="text-[11px] text-gray-500">{resolved.description}</div>}
          {items.map((item, index) => (
            <div key={`${fieldPath}.${index}`} className="flex gap-2 items-start">
              <div className="flex-1">
                {renderField(resolved.items ?? {}, rootSchema, item, [...path, index], new Set())}
              </div>
              <Button
                id={`simulate-form-array-remove-${fieldPath || 'root'}-${index}`}
                variant="outline"
                size="sm"
                onClick={() => {
                  const next = items.filter((_, idx) => idx !== index);
                  onChange(setDeepValue(value, path, next) as Record<string, unknown>);
                }}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            id={`simulate-form-array-add-${fieldPath || 'root'}`}
            variant="outline"
            size="sm"
            onClick={() => {
              const next = [...items, buildDefaultValueFromSchema(resolved.items ?? {}, rootSchema)];
              onChange(setDeepValue(value, path, next) as Record<string, unknown>);
            }}
          >
            Add item
          </Button>
        </div>
      );
    }

    if (pickerField) {
      return (
        <div className="space-y-1 rounded border border-gray-200 bg-white p-3">
          {commonHeader}
          <WorkflowActionInputFixedPicker
            field={pickerField}
            value={typeof currentValue === 'string' ? currentValue : null}
            onChange={(nextValue) => onChange(setDeepValue(value, path, nextValue) as Record<string, unknown>)}
            idPrefix={`simulate-form-${fieldPath || 'root'}`}
            rootInputMapping={value as InputMapping}
            actions={pickerActions}
          />
          {resolved.description && <div className="text-[11px] text-gray-500">{resolved.description}</div>}
          {fieldErrors.map((err) => (
            <div key={`${fieldPath}-${err.message}`} className="text-xs text-destructive">{err.message}</div>
          ))}
        </div>
      );
    }

    if (resolved.enum) {
      return (
        <div className="rounded border border-gray-200 bg-white p-3 space-y-1">
          {commonHeader}
          <CustomSelect
            id={`simulate-form-${fieldPath}`}
            options={resolved.enum.map((entry) => ({ value: String(entry), label: String(entry) }))}
            value={currentValue == null ? '' : String(currentValue)}
            onValueChange={(nextValue) => {
              const actual = resolved.enum?.find((entry) => String(entry) === nextValue);
              onChange(setDeepValue(value, path, actual ?? nextValue) as Record<string, unknown>);
            }}
          />
          {resolved.description && <div className="text-[11px] text-gray-500">{resolved.description}</div>}
        </div>
      );
    }

    if (type === 'boolean') {
      return (
        <div className="rounded border border-gray-200 bg-white p-3 space-y-1">
          {commonHeader}
          <div className="flex items-center gap-2">
            <Switch
              checked={Boolean(currentValue)}
              onCheckedChange={(checked) => onChange(setDeepValue(value, path, checked) as Record<string, unknown>)}
            />
            <span className="text-xs text-gray-500">{Boolean(currentValue) ? 'True' : 'False'}</span>
          </div>
          {resolved.description && <div className="text-[11px] text-gray-500">{resolved.description}</div>}
        </div>
      );
    }

    const inputType = resolved.format === 'date-time' ? 'datetime-local' : resolved.format === 'date' ? 'date' : 'text';
    const renderedValue = (() => {
      if (currentValue == null) return '';
      if (resolved.format === 'date-time' && typeof currentValue === 'string') {
        return toDateTimeLocalInputValue(currentValue);
      }
      return String(currentValue);
    })();

    return (
      <div className="rounded border border-gray-200 bg-white p-3 space-y-1">
        {commonHeader}
        <Input
          id={`simulate-form-${fieldPath}`}
          type={type === 'number' || type === 'integer' ? 'number' : inputType}
          value={renderedValue}
          onChange={(e) => {
            const raw = e.target.value;
            const parsed = raw === ''
              ? null
              : (type === 'number' || type === 'integer'
                ? Number(raw)
                : resolved.format === 'date-time'
                  ? fromDateTimeLocalInputValue(raw)
                  : raw);
            onChange(setDeepValue(value, path, parsed) as Record<string, unknown>);
          }}
        />
        {resolved.description && <div className="text-[11px] text-gray-500">{resolved.description}</div>}
        {fieldErrors.map((err) => (
          <div key={`${fieldPath}-${err.message}`} className="text-xs text-destructive">{err.message}</div>
        ))}
      </div>
    );
  };

  const rootResolved = resolveSchemaRef(schema, schema);
  if (normalizeSchemaType(rootResolved) !== 'object') {
    return (
      <TextArea
        id="simulate-form-json-fallback"
        label="Payload (JSON)"
        value={JSON.stringify(value ?? {}, null, 2)}
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value || '{}'));
          } catch {
            // ignore parse errors
          }
        }}
        className="font-mono text-xs min-h-[220px]"
      />
    );
  }

  const props = rootResolved.properties ?? {};
  const req = new Set(rootResolved.required ?? []);

  return (
    <div className="space-y-2">
      {Object.entries(props).map(([key, child]) => (
        <div key={key}>
          {renderField(child, schema, value?.[key], [key], req)}
        </div>
      ))}
    </div>
  );
};

const EventStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const s = status.toLowerCase();
  const variant =
    s === 'active' ? 'success'
      : s === 'beta' ? 'warning'
        : s === 'draft' ? 'default-muted'
          : 'error';
  const label = s.charAt(0).toUpperCase() + s.slice(1);
  return <Badge variant={variant as any} size="sm">{label}</Badge>;
};

const SourceBadge: React.FC<{ source: 'system' | 'tenant' }> = ({ source }) => (
  <Badge variant={source === 'system' ? 'info' : 'success'} size="sm">
    {source === 'system' ? 'System' : 'Tenant'}
  </Badge>
);

const SchemaBadge: React.FC<{ status: WorkflowEventCatalogEntryV2['payload_schema_ref_status'] }> = ({ status }) => {
  if (status === 'missing') {
    return <Badge variant="default-muted" size="sm">No schema</Badge>;
  }
  if (status === 'unknown') {
    return <Badge variant="error" size="sm">Unknown schema</Badge>;
  }
  return <Badge variant="info" size="sm">Schema</Badge>;
};

const MiniMetric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex flex-col items-center justify-center rounded-md border border-gray-200 bg-white px-3 py-2">
    <div className="text-sm font-semibold text-gray-900">{value}</div>
    <div className="text-[11px] text-gray-500">{label}</div>
  </div>
);

const EventCard: React.FC<{
  entry: WorkflowEventCatalogEntryV2;
  onSelect: () => void;
  onSimulate: () => void;
  onMetrics: () => void;
  onAttach: () => void;
  canManage: boolean;
}> = ({ entry, onSelect, onSimulate, onMetrics, onAttach, canManage }) => {
  const { Icon, cls } = getEventIcon(entry);
  return (
    <Card className="p-4 hover:shadow-sm transition-shadow cursor-pointer" onClick={onSelect}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${cls}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="font-semibold text-gray-900 truncate">{entry.name}</div>
              <EventStatusBadge status={entry.status} />
            </div>
            <div className="text-xs text-gray-500 font-mono truncate">{entry.event_type}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SourceBadge source={entry.source} />
        </div>
      </div>

      <div className="mt-3 text-sm text-gray-600 line-clamp-2">
        {entry.description || '—'}
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <SchemaBadge status={entry.payload_schema_ref_status} />
        <Badge className="text-[10px] bg-gray-100 text-gray-700 border-gray-200">
          {entry.attached_workflows_count} workflows
        </Badge>
        {entry.category && (
          <Badge className="text-[10px] bg-white text-gray-700 border-gray-200">
            {entry.category}
          </Badge>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniMetric label="Executions" value={entry.metrics_7d.executions == null ? '—' : formatNumber(entry.metrics_7d.executions)} />
        <MiniMetric label="Success rate" value={formatPercent(entry.metrics_7d.successRate)} />
        <MiniMetric label="Avg latency" value={formatDurationMs(entry.metrics_7d.avgLatencyMs)} />
      </div>

      <div className="mt-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <Button id={`workflow-event-card-${entry.event_id}-simulate`} variant="outline" size="sm" onClick={onSimulate} disabled={!canManage}>
          <Bell className="h-4 w-4 mr-2" />
          Simulate
        </Button>
        <Button id={`workflow-event-card-${entry.event_id}-metrics`} variant="outline" size="sm" onClick={onMetrics}>
          <BarChart3 className="h-4 w-4 mr-2" />
          Metrics
        </Button>
        <Button id={`workflow-event-card-${entry.event_id}-attach`} size="sm" className="ml-auto" onClick={onAttach} disabled={!canManage} title="Attach (new workflow)">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
};

const SimpleSeriesChart: React.FC<{ series: Array<{ day: string; count: number }> }> = ({ series }) => {
  const max = Math.max(1, ...series.map((s) => s.count));
  return (
    <div className="w-full">
      <div className="flex items-end gap-2 h-28">
        {series.map((p) => (
          <div key={p.day} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full rounded bg-purple-200"
              style={{ height: `${Math.max(6, Math.round((p.count / max) * 100))}%` }}
              title={`${p.day}: ${p.count}`}
            />
            <div className="text-[10px] text-gray-500">{p.day.slice(5)}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function EventsCatalogV2({ pickerActions }: { pickerActions: WorkflowPickerActions }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('');
  const [status, setStatus] = useState<'all' | 'active' | 'beta' | 'draft' | 'deprecated'>('all');
  const [source, setSource] = useState<'all' | 'system' | 'tenant'>('all');
  const [sort, setSort] = useState<SortMode>('category_name');
  const [categories, setCategories] = useState<string[]>([]);
  const [schemaRefs, setSchemaRefs] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<{ canRead: boolean; canManage: boolean; canPublish: boolean; canAdmin: boolean }>({
    canRead: false,
    canManage: false,
    canPublish: false,
    canAdmin: false
  });

  const [events, setEvents] = useState<WorkflowEventCatalogEntryV2[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  const [selectedEvent, setSelectedEvent] = useState<WorkflowEventCatalogEntryV2 | null>(null);
  const [selectedSchemaPreview, setSelectedSchemaPreview] = useState<any | null>(null);
  const [schemaModalOpen, setSchemaModalOpen] = useState(false);
  const [fullSchema, setFullSchema] = useState<any | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);

  const [attachedWorkflows, setAttachedWorkflows] = useState<any[] | null>(null);
  const [attachedLoading, setAttachedLoading] = useState(false);

  const [metricsState, setMetricsState] = useState<MetricsState>({ open: false, eventType: null });
  const [simulateState, setSimulateState] = useState<SimulateState>({ open: false, eventType: null, payloadSchemaRef: null });
  const [attachState, setAttachState] = useState<AttachState>({ creating: false });
  const [defineState, setDefineState] = useState<DefineEventState>({ open: false });

  const perPage = viewMode === 'grid' ? 24 : 50;

  const selectedEventTypeFromQuery = searchParams.get('eventType');
  const didApplyDeepLink = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VIEW_MODE_KEY);
      if (raw === 'grid' || raw === 'list') setViewMode(raw);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {}
  }, [viewMode]);

  const refresh = async (opts?: { preservePage?: boolean }) => {
    const preserve = opts?.preservePage ?? false;
    const nextPage = preserve ? page : 1;
    if (!preserve) setPage(1);
    setIsLoading(true);
    try {
      const offset = (nextPage - 1) * perPage;
      const res = await listEventCatalogWithMetricsAction({
        search: search.trim() || undefined,
        category: category || undefined,
        status,
        source,
        sort,
        limit: perPage,
        offset
      });
      setEvents((res as any).events ?? []);
      setTotal((res as any).total ?? 0);
    } catch (e) {
      handleError(e, 'Failed to load events');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    listEventCatalogCategoriesV2Action()
      .then((res) => setCategories((res as any).categories ?? []))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    listSchemaRegistryRefsAction()
      .then((res) => setSchemaRefs((res as any).refs ?? []))
      .catch(() => setSchemaRefs([]));
  }, []);

  useEffect(() => {
    getEventCatalogPermissionsAction()
      .then((res) => setPermissions(res as any))
      .catch(() => setPermissions({ canRead: false, canManage: false, canPublish: false, canAdmin: false }));
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, perPage, source, status, sort]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const pageStart = (page - 1) * perPage + 1;
  const pageEnd = Math.min(total, page * perPage);

  const handleSelectEvent = async (entry: WorkflowEventCatalogEntryV2) => {
    setSelectedEvent(entry);
    setAttachedWorkflows(null);
    setAttachedLoading(true);
    setSelectedSchemaPreview(null);
    try {
      const res = await listAttachedWorkflowsByEventTypeAction({ eventType: entry.event_type });
      setAttachedWorkflows((res as any).workflows ?? []);
    } catch {
      setAttachedWorkflows([]);
    } finally {
      setAttachedLoading(false);
    }

    if (entry.payload_schema_ref) {
      try {
        const schemaRes = await getEventSchemaByRefAction({ schemaRef: entry.payload_schema_ref });
        setSelectedSchemaPreview((schemaRes as any)?.schema ?? null);
      } catch {
        setSelectedSchemaPreview(null);
      }
    } else if (entry.payload_schema) {
      setSelectedSchemaPreview(entry.payload_schema ?? null);
    }
  };

  useEffect(() => {
    if (!selectedEventTypeFromQuery) return;
    if (didApplyDeepLink.current) return;
    if (events.length === 0) return;
    const match = events.find((e) => e.event_type === selectedEventTypeFromQuery);
    if (!match) return;
    didApplyDeepLink.current = true;
    void handleSelectEvent(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, selectedEventTypeFromQuery]);

  const openFullSchema = async () => {
    if (!selectedEvent) return;
    setSchemaModalOpen(true);
    setSchemaLoading(true);
    try {
      if (selectedEvent.payload_schema_ref) {
        const res = await getEventSchemaByRefAction({ schemaRef: selectedEvent.payload_schema_ref });
        setFullSchema((res as any).schema ?? null);
      } else {
        setFullSchema(selectedEvent.payload_schema ?? null);
      }
    } catch {
      setFullSchema(null);
    } finally {
      setSchemaLoading(false);
    }
  };

  const handleAttachNewWorkflow = async (entry: WorkflowEventCatalogEntryV2) => {
    setAttachState({ creating: true });
    try {
      const created = await createWorkflowFromEventAction({
        eventType: entry.event_type,
        name: `Workflow: ${entry.name}`,
        payloadSchemaRef: entry.payload_schema_ref ?? undefined,
        sourcePayloadSchemaRef: entry.payload_schema_ref ?? undefined
      });
      const workflowId = (created as any)?.workflowId;
      toast.success('Workflow created');
      if (workflowId) {
        router.push(`/msp/workflow-editor/${encodeURIComponent(workflowId)}`);
      }
    } catch (e) {
      handleError(e, 'Failed to create workflow');
    } finally {
      setAttachState({ creating: false });
    }
  };

  const handleDetachWorkflow = async (workflowId: string, eventType: string) => {
    if (!confirm('Detach this workflow from the event? This publishes a new version with the trigger removed.')) return;
    try {
      const res = await detachWorkflowTriggerFromEventAction({ workflowId, eventType });
      if ((res as any)?.ok === false) {
        toast.error('Detach failed (validation errors)');
        return;
      }
      toast.success('Detached');
      await refresh({ preservePage: true });
      if (selectedEvent) {
        await handleSelectEvent(selectedEvent);
      }
    } catch (e) {
      handleError(e, 'Failed to detach');
    }
  };

  const clearFilters = () => {
    setSearch('');
    setCategory('');
    setStatus('all');
    setSource('all');
    setSort('category_name');
    setPage(1);
    refresh();
  };

  const onApplySearch = () => {
    setPage(1);
    refresh();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold text-gray-900">Workflow Event Catalog</div>
          <div className="text-sm text-gray-500">Explore, manage, and design workflows for system events and triggers.</div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            id="workflow-event-catalog-define-custom-event"
            onClick={() => setDefineState({ open: true })}
            variant="default"
            disabled={!permissions.canManage}
            title={!permissions.canManage ? 'Requires workflow:manage permission' : undefined}
          >
            <Plus className="h-4 w-4 mr-2" />
            Define Custom Event
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px]">
            <Input
              id="workflow-event-catalog-search"
              placeholder="Search events (e.g., ticket.create, email.receive)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onApplySearch();
              }}
            />
          </div>

          <SearchableSelect
            id="workflow-event-catalog-category"
            value={category}
            onChange={(v) => setCategory(v)}
            placeholder="All Categories"
            dropdownMode="overlay"
            options={[
              { value: '', label: 'All Categories' },
              ...categories.map((c) => ({ value: c, label: c }))
            ]}
          />

          <SearchableSelect
            id="workflow-event-catalog-status"
            value={status}
            onChange={(v) => setStatus(v as any)}
            placeholder="Status"
            dropdownMode="overlay"
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'active', label: 'Active' },
              { value: 'beta', label: 'Beta' },
              { value: 'draft', label: 'Draft' },
              { value: 'deprecated', label: 'Deprecated' }
            ]}
          />

          <SearchableSelect
            id="workflow-event-catalog-source"
            value={source}
            onChange={(v) => setSource(v as any)}
            placeholder="Source"
            dropdownMode="overlay"
            options={[
              { value: 'all', label: 'All sources' },
              { value: 'system', label: 'System' },
              { value: 'tenant', label: 'Tenant' }
            ]}
          />

          <SearchableSelect
            id="workflow-event-catalog-sort"
            value={sort}
            onChange={(v) => setSort(v as SortMode)}
            placeholder="Sort"
            dropdownMode="overlay"
            options={[
              { value: 'category_name', label: 'Category · Name' },
              { value: 'most_active', label: 'Most active (7d)' }
            ]}
          />

          <div className="flex items-center gap-2 ml-auto">
            <Button id="workflow-event-catalog-apply" variant="outline" size="sm" onClick={onApplySearch}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Apply
            </Button>
            <Button id="workflow-event-catalog-clear" variant="ghost" size="sm" onClick={clearFilters}>
              Clear
            </Button>
            <Button
              id="workflow-event-catalog-view-grid"
              variant={viewMode === 'grid' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('grid')}
              title="Grid view"
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button
              id="workflow-event-catalog-view-list"
              variant={viewMode === 'list' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      {isLoading && (
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4' : 'space-y-3'}>
          {Array.from({ length: viewMode === 'grid' ? 9 : 10 }).map((_, idx) => (
            <EventCardSkeleton key={idx} viewMode={viewMode} />
          ))}
        </div>
      )}

      {!isLoading && events.length === 0 && (
        <Card className="p-8 flex flex-col items-center justify-center text-center">
          <Settings2 className="h-10 w-10 text-gray-400 mb-3" />
          <div className="text-base font-semibold text-gray-900">No events found</div>
          <div className="text-sm text-gray-500 mt-1">Try adjusting your filters.</div>
        </Card>
      )}

      {!isLoading && events.length > 0 && (
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4' : 'space-y-3'}>
          {events.map((entry) => (
            <EventCard
              key={entry.event_id}
              entry={entry}
              onSelect={() => handleSelectEvent(entry)}
              onSimulate={() => setSimulateState({ open: true, eventType: entry.event_type, payloadSchemaRef: entry.payload_schema_ref ?? null })}
              onMetrics={() => setMetricsState({ open: true, eventType: entry.event_type })}
              onAttach={() => handleAttachNewWorkflow(entry)}
              canManage={permissions.canManage}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-gray-500">
        <div>
          Showing {formatNumber(total === 0 ? 0 : pageStart)} to {formatNumber(pageEnd)} of {formatNumber(total)} results
        </div>
        <div className="flex items-center gap-2">
          <Button
            id="workflow-event-catalog-page-prev"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => {
              const next = Math.max(1, page - 1);
              setPage(next);
              refresh({ preservePage: true });
            }}
          >
            Prev
          </Button>
          <div className="text-xs text-gray-600">
            Page {page} / {totalPages}
          </div>
          <Button
            id="workflow-event-catalog-page-next"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => {
              const next = Math.min(totalPages, page + 1);
              setPage(next);
              refresh({ preservePage: true });
            }}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Details Drawer */}
      <Dialog isOpen={!!selectedEvent} onClose={() => setSelectedEvent(null)} title="Event details" className="max-w-4xl">
        <DialogContent>
          {selectedEvent && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold text-gray-900">{selectedEvent.name}</div>
                  <div className="text-xs font-mono text-gray-500">{selectedEvent.event_type}</div>
                  <div className="mt-2 text-sm text-gray-600">{selectedEvent.description ?? '—'}</div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <SourceBadge source={selectedEvent.source} />
                    <EventStatusBadge status={selectedEvent.status} />
                    <SchemaBadge status={selectedEvent.payload_schema_ref_status} />
                    {selectedEvent.category && (
                      <Badge className="text-[10px] bg-white text-gray-700 border-gray-200">{selectedEvent.category}</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    id="workflow-event-details-simulate"
                    variant="outline"
                    size="sm"
                    onClick={() => setSimulateState({ open: true, eventType: selectedEvent.event_type, payloadSchemaRef: selectedEvent.payload_schema_ref ?? null })}
                    disabled={!permissions.canManage}
                  >
                    Simulate
                  </Button>
                  <Button id="workflow-event-details-metrics" variant="outline" size="sm" onClick={() => setMetricsState({ open: true, eventType: selectedEvent.event_type })}>
                    Metrics
                  </Button>
                  <Button id="workflow-event-details-attach" size="sm" onClick={() => handleAttachNewWorkflow(selectedEvent)} disabled={attachState.creating || !permissions.canManage}>
                    Attach
                  </Button>
                </div>
              </div>

              <Card className="p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-800">Schema</div>
                  <div className="flex items-center gap-2">
                    {selectedEvent.payload_schema_ref && (
                      <div className="text-xs font-mono text-gray-500">{selectedEvent.payload_schema_ref}</div>
                    )}
                    <Button id="workflow-event-details-view-full-schema" variant="ghost" size="sm" onClick={openFullSchema}>
                      View full schema
                    </Button>
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-600">
                  {selectedEvent.payload_schema_ref ? 'Schema is managed by the schema registry.' : 'No schemaRef set; event may not be usable as a workflow trigger.'}
                </div>
                {selectedSchemaPreview?.properties && (
                  <div className="mt-3">
                    <div className="text-xs font-semibold text-gray-700 mb-2">Top-level fields</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {Object.entries(selectedSchemaPreview.properties as Record<string, any>).slice(0, 12).map(([key, prop]) => {
                        const required = Array.isArray(selectedSchemaPreview.required) && selectedSchemaPreview.required.includes(key);
                        const type = Array.isArray(prop?.type) ? prop.type[0] : prop?.type;
                        return (
                          <div key={key} className="rounded border border-gray-200 bg-white px-2 py-2">
                            <div className="flex items-center gap-2">
                              <div className="text-xs font-mono text-gray-900 truncate">{key}</div>
                              {required && <Badge variant="error" size="sm">required</Badge>}
                              {type && <Badge className="text-[10px] bg-gray-100 text-gray-700 border-gray-200">{String(type)}</Badge>}
                            </div>
                            {prop?.description && (
                              <div className="mt-1 text-[11px] text-gray-500 line-clamp-2">{String(prop.description)}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {Object.keys(selectedSchemaPreview.properties as Record<string, any>).length > 12 && (
                      <div className="mt-2 text-[11px] text-gray-500">
                        Showing first 12 fields. Use “View full schema” for more.
                      </div>
                    )}
                  </div>
                )}
              </Card>

              <Card className="p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-800">Attached workflows</div>
                  <Badge className="text-[10px] bg-gray-100 text-gray-700 border-gray-200">
                    {selectedEvent.attached_workflows_count}
                  </Badge>
                </div>
                {attachedLoading && <div className="mt-2 text-sm text-gray-500">Loading…</div>}
                {!attachedLoading && attachedWorkflows && attachedWorkflows.length === 0 && (
                  <div className="mt-2 text-sm text-gray-500">No workflows attached.</div>
                )}
                {!attachedLoading && attachedWorkflows && attachedWorkflows.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {attachedWorkflows.map((wf: any) => (
                      <div key={wf.workflow_id} className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-white px-3 py-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-sm font-medium text-gray-900 truncate">{wf.name}</div>
                            <Badge variant="success" size="sm">Published</Badge>
                            {wf.is_system && <Badge variant="info" size="sm">System</Badge>}
                            {wf.is_paused && <Badge variant="warning" size="sm">Paused</Badge>}
                            {!wf.is_visible && <Badge className="text-[10px] bg-gray-100 text-gray-600 border-gray-200">Hidden</Badge>}
                          </div>
                          <div className="text-xs text-gray-500 font-mono truncate">{wf.workflow_id} · v{wf.published_version ?? '—'}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button id={`workflow-event-details-open-workflow-${wf.workflow_id}`} asChild variant="outline" size="sm">
                            <Link href={`/msp/workflow-editor/${encodeURIComponent(wf.workflow_id)}`}>
                              <ExternalLink className="h-4 w-4 mr-2" />
                              Open
                            </Link>
                          </Button>
                          <Button
                            id={`workflow-event-details-detach-workflow-${wf.workflow_id}`}
                            variant="outline"
                            size="sm"
                            onClick={() => handleDetachWorkflow(wf.workflow_id, selectedEvent.event_type)}
                            disabled={!permissions.canPublish || (wf.is_system && !permissions.canAdmin)}
                            title={!permissions.canPublish ? 'Requires workflow:publish permission' : (wf.is_system && !permissions.canAdmin ? 'Requires workflow:admin for system workflows' : undefined)}
                          >
                            Detach
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <div className="flex justify-end">
                <Button id="workflow-event-details-close" variant="ghost" onClick={() => setSelectedEvent(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Full Schema Modal */}
      <Dialog isOpen={schemaModalOpen} onClose={() => setSchemaModalOpen(false)} title="Schema" className="max-w-4xl">
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payload schema</DialogTitle>
          </DialogHeader>
          {schemaLoading && <div className="text-sm text-gray-500">Loading…</div>}
          {!schemaLoading && !fullSchema && <div className="text-sm text-destructive">Schema not available.</div>}
          {!schemaLoading && fullSchema && (
            <div className="max-h-[70vh] overflow-auto">
              <div className="flex justify-end mb-2">
                <Button
                  id="workflow-event-schema-copy"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    try {
                      void navigator.clipboard.writeText(JSON.stringify(fullSchema, null, 2));
                      toast.success('Copied');
                    } catch (error) {
                      handleError(error, 'Copy failed');
                    }
                  }}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy
                </Button>
              </div>
              <pre
                className="text-[11px] leading-relaxed font-mono whitespace-pre break-words rounded border border-gray-200 bg-gray-50 p-3"
                dangerouslySetInnerHTML={{ __html: syntaxHighlightJson(JSON.stringify(fullSchema, null, 2)) }}
              />
            </div>
          )}
          <DialogFooter>
            <Button id="workflow-event-schema-close" variant="ghost" onClick={() => setSchemaModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Metrics Dialog */}
      <MetricsDialog
        open={metricsState.open}
        eventType={metricsState.eventType}
        onClose={() => setMetricsState({ open: false, eventType: null })}
      />

      {/* Simulate Dialog */}
      <SimulateDialog
        open={simulateState.open}
        eventType={simulateState.eventType}
        payloadSchemaRef={simulateState.payloadSchemaRef}
        onClose={() => setSimulateState({ open: false, eventType: null, payloadSchemaRef: null })}
        pickerActions={pickerActions}
      />

      {/* Define Custom Event */}
      <DefineCustomEventDialog
        open={defineState.open}
        schemaRefs={schemaRefs}
        onClose={(didCreate) => {
          setDefineState({ open: false });
          if (didCreate) refresh({ preservePage: true });
        }}
      />
    </div>
  );
}

const MetricsDialog: React.FC<{ open: boolean; eventType: string | null; onClose: () => void }> = ({ open, eventType, onClose }) => {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any | null>(null);
  const [recentOffset, setRecentOffset] = useState(0);
  const recentLimit = 25;

  useEffect(() => {
    if (!open || !eventType) return;
    const now = new Date();
    const fromD = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    setFrom(fromD.toISOString().slice(0, 10));
    setTo(now.toISOString().slice(0, 10));
    setRecentOffset(0);
  }, [eventType, open]);

  const load = async (opts?: { recentOffset?: number }) => {
    if (!eventType) return;
    setLoading(true);
    try {
      const fromIso = from ? new Date(`${from}T00:00:00.000Z`).toISOString() : undefined;
      const toIso = to ? new Date(`${to}T23:59:59.999Z`).toISOString() : undefined;
      const ro = opts?.recentOffset ?? recentOffset;
      const res = await getEventMetricsAction({ eventType, from: fromIso, to: toIso, recentLimit, recentOffset: ro });
      setData(res as any);
    } catch (e) {
      handleError(e, 'Failed to load metrics');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !eventType) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventType]);

  return (
    <Dialog isOpen={open} onClose={onClose} title="Metrics" className="max-w-4xl">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Metrics · {eventType ?? ''}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <div className="text-xs text-gray-500">From</div>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-xs text-gray-500">To</div>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Button id="workflow-event-metrics-refresh" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            {eventType && (
              <Button id="workflow-event-metrics-open-designer" asChild variant="ghost" className="ml-auto">
                <Link href="/msp/workflow-editor">
                  Open workflow editor
                </Link>
              </Button>
            )}
          </div>

          {loading && <div className="text-sm text-gray-500">Loading…</div>}

          {!loading && data && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <MiniMetric label="Total events" value={formatNumber(data.summary?.total ?? null)} />
                <MiniMetric label="Matched" value={formatNumber(data.summary?.matched ?? null)} />
                <MiniMetric label="Unmatched" value={formatNumber(data.summary?.unmatched ?? null)} />
                <MiniMetric label="Errors" value={formatNumber(data.summary?.error ?? null)} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <MiniMetric label="Runs started" value={formatNumber(data.runStats?.total ?? null)} />
                <MiniMetric label="Run success rate" value={formatPercent(data.runStats?.successRate ?? null)} />
                <MiniMetric label="Avg run duration" value={formatDurationMs(data.runStats?.avgDurationMs ?? null)} />
              </div>

              <Card className="p-3">
                <div className="text-sm font-semibold text-gray-800 mb-2">Executions over time</div>
                <SimpleSeriesChart series={data.series ?? []} />
              </Card>

              <Card className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-gray-800">Recent events</div>
                  {eventType && (
                    <Button id="workflow-event-metrics-view-events" asChild variant="ghost" size="sm">
                      <Link href={`/msp/workflow-control?section=events&eventType=${encodeURIComponent(eventType)}`}>
                        View in events
                      </Link>
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  {(data.recent ?? []).map((row: any) => (
                    <div key={row.event_id} className="rounded border border-gray-200 bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs text-gray-500 font-mono truncate">{row.event_id}</div>
                          <div className="text-sm text-gray-700 truncate">
                            {row.status.toUpperCase()} {row.correlation_key ? `· key=${row.correlation_key}` : ''}
                          </div>
                          {row.payload_schema_ref && (
                            <div className="text-[11px] text-gray-500 font-mono truncate">{row.payload_schema_ref}</div>
                          )}
                        </div>
                        {row.matched_run_id && (
                          <Button id={`workflow-event-metrics-open-run-${row.matched_run_id}`} asChild variant="outline" size="sm">
                            <Link href={`/msp/workflows/runs/${encodeURIComponent(row.matched_run_id)}`}>
                              Run
                            </Link>
                          </Button>
                        )}
                      </div>
                      {row.payload && (
                        <div className="mt-2 text-[11px] text-gray-600 font-mono whitespace-pre-wrap break-words">
                          {JSON.stringify(row.payload).slice(0, 220)}{JSON.stringify(row.payload).length > 220 ? '…' : ''}
                        </div>
                      )}
                    </div>
                  ))}
                  {Array.isArray(data.recent) && data.recent.length === 0 && (
                    <div className="text-sm text-gray-500">No events in this range.</div>
                  )}
                </div>
                {typeof data.recentTotal === 'number' && data.recentTotal > recentLimit && (
                  <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                    <div>
                      Showing {Math.min(data.recentTotal, recentOffset + 1)}–{Math.min(data.recentTotal, recentOffset + (data.recent?.length ?? 0))} of {data.recentTotal}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        id="workflow-event-metrics-recent-prev"
                        variant="outline"
                        size="sm"
                        disabled={recentOffset <= 0 || loading}
                        onClick={() => {
                          const next = Math.max(0, recentOffset - recentLimit);
                          setRecentOffset(next);
                          void load({ recentOffset: next });
                        }}
                      >
                        Prev
                      </Button>
                      <Button
                        id="workflow-event-metrics-recent-next"
                        variant="outline"
                        size="sm"
                        disabled={recentOffset + recentLimit >= data.recentTotal || loading}
                        onClick={() => {
                          const next = recentOffset + recentLimit;
                          setRecentOffset(next);
                          void load({ recentOffset: next });
                        }}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            </>
          )}

          {!loading && !data && (
            <div className="text-sm text-gray-500">No data available.</div>
          )}
        </div>
        <DialogFooter>
          <Button id="workflow-event-metrics-close" variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const SimulateDialog: React.FC<{
  open: boolean;
  eventType: string | null;
  payloadSchemaRef: string | null;
  onClose: () => void;
  pickerActions: WorkflowPickerActions;
}> = ({ open, eventType, payloadSchemaRef, onClose, pickerActions }) => {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [schema, setSchema] = useState<any | null>(null);
  const [schemaRefOverride, setSchemaRefOverride] = useState<string>('');
  const [correlationKey, setCorrelationKey] = useState('');
  const [payloadText, setPayloadText] = useState('{}');
  const [formValue, setFormValue] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<ValidationIssue[]>([]);
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [submitError, setSubmitError] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setSubmitError('');
    setErrors([]);
    setSubmitting(false);
    setMode('form');
    setSchemaRefOverride(payloadSchemaRef ?? '');
  }, [open, payloadSchemaRef]);

  useEffect(() => {
    if (!open || !eventType) return;
    const key = `${CORRELATION_KEY_PREFIX}${eventType}`;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored) setCorrelationKey(stored);
    } catch {}
  }, [eventType, open]);

  useEffect(() => {
    if (!open || !eventType) return;
    const ref = schemaRefOverride || payloadSchemaRef;
    void getCurrentUser()
      .then((user) => setCurrentTenantId(user?.tenant ?? null))
      .catch(() => setCurrentTenantId(null));
    if (!ref) {
      setSchema(null);
      return;
    }
    getEventSchemaByRefAction({ schemaRef: ref })
      .then((res) => {
        const s = ((res as any)?.schema ?? null) as JsonSchema | null;
        setSchema(s);
        const defaults = buildInitialPayloadFromSchema(s);
        setFormValue(defaults ?? {});
        setPayloadText(JSON.stringify(defaults ?? {}, null, 2));
      })
      .catch(() => setSchema(null));
  }, [eventType, open, payloadSchemaRef, schemaRefOverride]);

  useEffect(() => {
    if (!open) return;
    if (mode === 'form') {
      try {
        setFormValue(stripImplicitSimulationFields(JSON.parse(payloadText || '{}')) as Record<string, unknown>);
      } catch {
        // keep existing form value
      }
    } else {
      setPayloadText(JSON.stringify(stripImplicitSimulationFields(formValue ?? {}), null, 2));
    }
  }, [mode]);

  useEffect(() => {
    if (!open) return;
    if (!schema) {
      setErrors([]);
      return;
    }
    const value = mode === 'json'
      ? (() => {
        try {
          return JSON.parse(payloadText || '{}');
        } catch {
          return null;
        }
      })()
      : formValue;
    if (value == null) {
      setErrors([{ path: '', message: 'Invalid JSON.' }]);
      return;
    }
    const effectiveValue = applyImplicitSimulationFields(
      isObjectRecord(value) ? value : {},
      { tenantId: currentTenantId }
    );
    setErrors(
      validateAgainstSchema(schema, effectiveValue, schema)
        .filter((error) => !IMPLICIT_SIMULATION_FIELD_KEYS.has(error.path))
    );
  }, [currentTenantId, formValue, mode, open, payloadText, schema]);

  const updateCorrelationKey = (value: string) => {
    setCorrelationKey(value);
    if (!eventType) return;
    try {
      window.localStorage.setItem(`${CORRELATION_KEY_PREFIX}${eventType}`, value);
    } catch {}
  };

  const submit = async () => {
    if (!eventType) return;
    setSubmitting(true);
    setResult(null);
    setSubmitError('');
    try {
      const payload = applyImplicitSimulationFields(
        mode === 'json' ? JSON.parse(payloadText || '{}') : formValue,
        { tenantId: currentTenantId }
      );
      if (schema && errors.length > 0) {
        toast.error('Fix schema validation errors before submitting.');
        setSubmitting(false);
        return;
      }
      const res = await simulateWorkflowEventAction({
        eventName: eventType,
        correlationKey: correlationKey.trim() || undefined,
        payload: payload ?? {},
        payloadSchemaRef: (schemaRefOverride || payloadSchemaRef) || undefined
      });
      setResult(res);
      if ((res as any)?.status === 'error' && (res as any)?.error_message) {
        setSubmitError(String((res as any).error_message));
      }
      toast.success('Event simulated');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to simulate';
      setSubmitError(msg);
      handleError(e, 'Failed to simulate');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog isOpen={open} onClose={onClose} title="Simulate event" className="max-w-4xl">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Simulate · {eventType ?? ''}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              id="simulate-correlation-key"
              label="Correlation key (optional)"
              placeholder="Used to resolve event waits"
              value={correlationKey}
              onChange={(e) => updateCorrelationKey(e.target.value)}
            />
            <Input
              id="simulate-schema-ref"
              label="Event payload schema ref (advanced)"
              placeholder={payloadSchemaRef ?? 'No schemaRef for this event'}
              value={schemaRefOverride}
              onChange={(e) => setSchemaRefOverride(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button id="workflow-event-simulate-mode-form" variant={mode === 'form' ? 'default' : 'outline'} size="sm" onClick={() => setMode('form')} disabled={!schema}>
              Form
            </Button>
            <Button id="workflow-event-simulate-mode-json" variant={mode === 'json' ? 'default' : 'outline'} size="sm" onClick={() => setMode('json')}>
              JSON
            </Button>
            {!schema && (
              <div className="text-xs text-warning">No schema available; form mode disabled.</div>
            )}
          </div>

          {mode === 'json' && (
            <TextArea
              id="simulate-json"
              label="Payload (JSON)"
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              className="font-mono text-xs min-h-[220px]"
            />
          )}

          {mode === 'form' && (
            <div>
              <div className="text-xs font-medium text-gray-700 mb-2">Payload</div>
              <SchemaForm schema={schema} value={formValue ?? {}} onChange={setFormValue} errors={errors} pickerActions={pickerActions} />
            </div>
          )}

          {errors.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <div className="text-sm font-semibold mb-1">Schema validation errors</div>
                <ul className="list-disc pl-4 space-y-1 text-xs">
                  {errors.slice(0, 8).map((err, idx) => (
                    <li key={`${err.path}-${idx}`}>{err.path ? `${err.path}: ` : ''}{err.message}</li>
                  ))}
                </ul>
                {errors.length > 8 && <div className="text-[11px] mt-1">+{errors.length - 8} more</div>}
              </AlertDescription>
            </Alert>
          )}

          {submitError && (
            <Alert variant="destructive">
              <AlertDescription>
                <div className="text-sm font-semibold mb-1">Simulation error</div>
                <div className="text-xs">{submitError}</div>
              </AlertDescription>
            </Alert>
          )}

          {result && (
            <Card className="p-3">
              <div className="text-sm font-semibold text-gray-800 mb-2">Result</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-xs text-gray-500">Status</div>
                  <div className="font-mono">{String((result as any)?.status ?? '—')}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Event ID</div>
                  <div className="font-mono">{String((result as any)?.eventId ?? '—')}</div>
                </div>
              </div>
              {Array.isArray((result as any)?.startedRuns) && (result as any).startedRuns.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="text-xs text-gray-500">Started runs</div>
                  {(result as any).startedRuns.slice(0, 5).map((id: string) => (
                    <div key={id} className="flex items-center justify-between gap-2 rounded border border-gray-200 bg-white px-2 py-1">
                      <div className="font-mono text-xs truncate">{id}</div>
                      <Button id={`workflow-event-simulate-open-run-${id}`} asChild variant="outline" size="sm">
                        <Link href={`/msp/workflows/runs/${encodeURIComponent(id)}`}>Open</Link>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {String((result as any)?.runId ?? '').length > 0 && (
                <div className="mt-2">
                  <div className="text-xs text-gray-500">Resumed run</div>
                  <Button id="workflow-event-simulate-open-resumed-run" asChild variant="outline" size="sm">
                    <Link href={`/msp/workflows/runs/${encodeURIComponent((result as any).runId)}`}>Open resumed run</Link>
                  </Button>
                </div>
              )}
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button id="workflow-event-simulate-close" variant="ghost" onClick={onClose}>Close</Button>
          <Button id="workflow-event-simulate-submit" onClick={submit} disabled={submitting || !eventType}>
            {submitting ? 'Submitting…' : 'Simulate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const DefineCustomEventDialog: React.FC<{ open: boolean; schemaRefs: string[]; onClose: (didCreate: boolean) => void }> = ({ open, schemaRefs, onClose }) => {
  const [eventType, setEventType] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [schemaRef, setSchemaRef] = useState('');
  const [schemaJson, setSchemaJson] = useState('{\n  \"type\": \"object\",\n  \"properties\": {}\n}');
  const [mode, setMode] = useState<'schemaRef' | 'inline'>('schemaRef');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEventType('');
    setName('');
    setCategory('');
    setDescription('');
    setSchemaRef('');
    setMode('schemaRef');
  }, [open]);

  const submit = async () => {
    if (!eventType.trim() || !name.trim()) {
      toast.error('Event type and name are required.');
      return;
    }
    if (mode === 'schemaRef' && !schemaRef.trim()) {
      toast.error('Select a payload schema ref (or use inline schema).');
      return;
    }
    setSubmitting(true);
    try {
      let payloadSchemaJson: any | undefined;
      if (mode === 'inline') {
        try {
          payloadSchemaJson = JSON.parse(schemaJson || '{}');
        } catch (error) {
          handleError(error, 'Payload schema must be valid JSON.');
          setSubmitting(false);
          return;
        }
      }
      const res = await createCustomEventAction({
        eventType: eventType.trim(),
        name: name.trim(),
        category: category.trim() || undefined,
        description: description.trim() || undefined,
        payloadSchemaRef: mode === 'schemaRef' ? (schemaRef.trim() || undefined) : undefined,
        payloadSchemaJson
      });
      toast.success('Custom event created');
      onClose(true);
      return res;
    } catch (e) {
      handleError(e, 'Failed to create event');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog isOpen={open} onClose={() => onClose(false)} title="Define custom event" className="max-w-3xl">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Define Custom Event</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Event type" value={eventType} onChange={(e) => setEventType(e.target.value)} placeholder="e.g. ticket.created" />
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Human-friendly name" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Tickets" />
            <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
          </div>

          <div className="flex items-center gap-2">
            <Button id="workflow-event-custom-event-mode-schema-ref" variant={mode === 'schemaRef' ? 'default' : 'outline'} size="sm" onClick={() => setMode('schemaRef')}>
              Use schema ref
            </Button>
            <Button id="workflow-event-custom-event-mode-inline" variant={mode === 'inline' ? 'default' : 'outline'} size="sm" onClick={() => setMode('inline')}>
              Inline schema (advanced)
            </Button>
          </div>

          {mode === 'schemaRef' && (
            <SearchableSelect
              id="workflow-event-catalog-custom-schema-ref"
              value={schemaRef}
              onChange={(v) => setSchemaRef(v)}
              placeholder="Select payload schema ref"
              dropdownMode="overlay"
              options={[
                { value: '', label: 'Select…' },
                ...schemaRefs.map((ref) => ({ value: ref, label: ref }))
              ]}
            />
          )}

          {mode === 'inline' && (
            <TextArea
              label="Payload schema (JSON)"
              value={schemaJson}
              onChange={(e) => setSchemaJson(e.target.value)}
              className="font-mono text-xs min-h-[220px]"
            />
          )}

          <div className="text-xs text-gray-500">
            Custom events are tenant-scoped and can be used as workflow triggers.
          </div>
        </div>

        <DialogFooter>
          <Button id="workflow-event-custom-event-cancel" variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
          <Button id="workflow-event-custom-event-submit" onClick={submit} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create event'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
