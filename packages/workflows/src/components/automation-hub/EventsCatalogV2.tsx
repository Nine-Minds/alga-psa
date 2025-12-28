'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Badge } from 'server/src/components/ui/Badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from 'server/src/components/ui/Dialog';
import { TextArea } from 'server/src/components/ui/TextArea';
import SearchableSelect from 'server/src/components/ui/SearchableSelect';
import { toast } from 'react-hot-toast';
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
} from 'server/src/lib/actions/workflow-event-catalog-v2-actions';

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

const getEventIcon = (entry: WorkflowEventCatalogEntryV2) => {
  const type = entry.event_type.toLowerCase();
  const category = (entry.category ?? '').toLowerCase();

  if (type.startsWith('email.') || category.includes('email')) return { Icon: Mail, cls: 'bg-blue-50 text-blue-700' };
  if (type.startsWith('ticket.') || category.includes('ticket')) return { Icon: Ticket, cls: 'bg-indigo-50 text-indigo-700' };
  if (type.startsWith('comment.') || category.includes('comment')) return { Icon: MessageSquare, cls: 'bg-sky-50 text-sky-700' };
  if (type.startsWith('invoice.') || type.startsWith('billing.') || category.includes('billing')) return { Icon: CreditCard, cls: 'bg-emerald-50 text-emerald-700' };
  if (type.startsWith('client.') || type.startsWith('contact.') || category.includes('client') || category.includes('contact')) return { Icon: Users, cls: 'bg-amber-50 text-amber-800' };
  if (type.startsWith('project.') || category.includes('project')) return { Icon: Briefcase, cls: 'bg-purple-50 text-purple-700' };
  if (type.startsWith('schedule.') || type.startsWith('calendar.') || category.includes('calendar')) return { Icon: Calendar, cls: 'bg-teal-50 text-teal-700' };
  if (type.startsWith('user.') || category.includes('user')) return { Icon: User, cls: 'bg-gray-100 text-gray-700' };
  if (type.startsWith('system.') || category.includes('system')) return { Icon: Server, cls: 'bg-gray-100 text-gray-700' };
  if (type.startsWith('sla.') || category.includes('sla') || type.includes('breach')) return { Icon: Clock, cls: 'bg-yellow-50 text-yellow-800' };
  if (type.includes('error') || category.includes('error') || type.includes('exception')) return { Icon: AlertTriangle, cls: 'bg-red-50 text-red-700' };

  return { Icon: Zap, cls: 'bg-purple-50 text-purple-700' };
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

const buildDefaultValueFromSchema = (schema: any, root: any): unknown => {
  if (!schema) return {};
  const resolveRef = (s: any): any => {
    if (s?.$ref && root?.definitions) {
      const refKey = String(s.$ref).replace('#/definitions/', '');
      return root.definitions?.[refKey] ?? s;
    }
    if (s?.$ref && root?.$defs) {
      const refKey = String(s.$ref).replace('#/$defs/', '');
      return root.$defs?.[refKey] ?? s;
    }
    return s;
  };
  const resolved = resolveRef(schema);
  if (resolved?.default !== undefined) return resolved.default;
  const type = Array.isArray(resolved?.type) ? resolved.type[0] : resolved?.type;
  if (type === 'object') {
    const props = resolved?.properties ?? {};
    const out: Record<string, unknown> = {};
    Object.keys(props).forEach((k) => {
      out[k] = buildDefaultValueFromSchema(props[k], root);
    });
    return out;
  }
  if (type === 'array') return [];
  if (type === 'string') return '';
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'boolean') return false;
  return null;
};

const validateAgainstSchema = (schema: any, value: any, root: any, path = ''): Array<{ path: string; message: string }> => {
  const resolveRef = (s: any): any => {
    if (s?.$ref && root?.definitions) {
      const refKey = String(s.$ref).replace('#/definitions/', '');
      return root.definitions?.[refKey] ?? s;
    }
    if (s?.$ref && root?.$defs) {
      const refKey = String(s.$ref).replace('#/$defs/', '');
      return root.$defs?.[refKey] ?? s;
    }
    return s;
  };
  const resolved = resolveRef(schema);
  const type = Array.isArray(resolved?.type) ? resolved.type[0] : resolved?.type;
  const errors: Array<{ path: string; message: string }> = [];

  if (type === 'object') {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      errors.push({ path, message: 'Expected object.' });
      return errors;
    }
    const required = new Set<string>(resolved?.required ?? []);
    for (const key of required) {
      const v = value?.[key];
      if (v === undefined || v === null || v === '') {
        errors.push({ path: path ? `${path}.${key}` : key, message: 'Required field missing.' });
      }
    }
    for (const [key, child] of Object.entries(resolved?.properties ?? {})) {
      errors.push(...validateAgainstSchema(child, value?.[key], root, path ? `${path}.${key}` : key));
    }
    return errors;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) {
      errors.push({ path, message: 'Expected array.' });
      return errors;
    }
    const items = resolved?.items ?? {};
    value.forEach((entry: any, idx: number) => {
      errors.push(...validateAgainstSchema(items, entry, root, `${path}[${idx}]`));
    });
    return errors;
  }

  if (type === 'string' && value != null && typeof value !== 'string') errors.push({ path, message: 'Expected string.' });
  if ((type === 'number' || type === 'integer') && value != null && typeof value !== 'number') errors.push({ path, message: 'Expected number.' });
  if (type === 'boolean' && value != null && typeof value !== 'boolean') errors.push({ path, message: 'Expected boolean.' });

  return errors;
};

const setDeepValue = (obj: any, path: Array<string | number>, nextValue: any): any => {
  if (path.length === 0) return nextValue;
  const [head, ...rest] = path;
  if (typeof head === 'number') {
    const arr = Array.isArray(obj) ? [...obj] : [];
    arr[head] = setDeepValue(arr[head], rest, nextValue);
    return arr;
  }
  const out = obj && typeof obj === 'object' && !Array.isArray(obj) ? { ...obj } : {};
  out[head] = setDeepValue(out[head], rest, nextValue);
  return out;
};

const pathToKey = (path: Array<string | number>) =>
  path
    .map((p) => (typeof p === 'number' ? `[${p}]` : p))
    .join('.')
    .replace(/\.\[/g, '[');

const JsonEditorField: React.FC<{
  id: string;
  label: React.ReactNode;
  description?: string | null;
  value: unknown;
  onChangeParsed: (next: any) => void;
  minHeight?: number;
}> = ({ id, label, description, value, onChangeParsed, minHeight = 120 }) => {
  const [text, setText] = useState<string>(() => JSON.stringify(value ?? null, null, 2));
  const [parseError, setParseError] = useState<string>('');

  useEffect(() => {
    setText(JSON.stringify(value ?? null, null, 2));
    setParseError('');
  }, [id]); // reset when field identity changes

  return (
    <div className="rounded border border-gray-200 bg-white p-3">
      <div className="flex items-center gap-2">{label}</div>
      {description && <div className="mt-1 text-[11px] text-gray-500">{description}</div>}
      <TextArea
        id={id}
        value={text}
        onChange={(e) => {
          const nextText = e.target.value;
          setText(nextText);
          try {
            const parsed = JSON.parse(nextText || 'null');
            setParseError('');
            onChangeParsed(parsed);
          } catch {
            setParseError('Invalid JSON.');
          }
        }}
        className="font-mono text-xs mt-2"
        style={{ minHeight }}
      />
      {parseError && <div className="mt-1 text-[11px] text-red-700">{parseError}</div>}
    </div>
  );
};

const SchemaForm: React.FC<{
  schema: any;
  value: any;
  onChange: (next: any) => void;
  maxDepth?: number;
}> = ({ schema, value, onChange, maxDepth = 4 }) => {
  const resolveRef = (s: any): any => {
    if (s?.$ref && schema?.definitions) {
      const refKey = String(s.$ref).replace('#/definitions/', '');
      return schema.definitions?.[refKey] ?? s;
    }
    if (s?.$ref && schema?.$defs) {
      const refKey = String(s.$ref).replace('#/$defs/', '');
      return schema.$defs?.[refKey] ?? s;
    }
    return s;
  };

  const renderField = (fieldSchema: any, path: Array<string | number>, label: string, required: boolean, depth: number) => {
    const resolved = resolveRef(fieldSchema);
    const type = Array.isArray(resolved?.type) ? resolved.type[0] : resolved?.type;
    const description = typeof resolved?.description === 'string' ? resolved.description : null;
    const current = path.reduce((acc, key) => (acc == null ? undefined : acc[key as any]), value);
    const pathKey = pathToKey(path);

    const header = (
      <div className="flex items-center gap-2">
        <div className="text-xs font-medium text-gray-800">{label}</div>
        {required && <Badge className="text-[10px] bg-red-50 text-red-700 border-red-200">required</Badge>}
        {type && <Badge className="text-[10px] bg-gray-100 text-gray-700 border-gray-200">{String(type)}</Badge>}
      </div>
    );

    if (depth >= maxDepth) {
      return (
        <JsonEditorField
          id={`schema-form-${pathKey}`}
          label={header}
          description={description || 'Max depth reached; edit as JSON.'}
          value={current ?? null}
          onChangeParsed={(next) => onChange(setDeepValue(value, path, next))}
          minHeight={140}
        />
      );
    }

    if (type === 'object') {
      const props = resolved?.properties ?? {};
      const req = new Set<string>(resolved?.required ?? []);
      return (
        <div className="rounded border border-gray-200 bg-white p-3 space-y-2">
          {header}
          {description && <div className="text-[11px] text-gray-500">{description}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {Object.entries(props).map(([k, child]) => renderField(child, [...path, k], k, req.has(k), depth + 1))}
          </div>
        </div>
      );
    }

    if (type === 'array') {
      return (
        <JsonEditorField
          id={`schema-form-${pathKey}`}
          label={header}
          description={description}
          value={current ?? []}
          onChangeParsed={(next) => onChange(setDeepValue(value, path, next))}
          minHeight={140}
        />
      );
    }

    if (type === 'boolean') {
      return (
        <div className="rounded border border-gray-200 bg-white p-3">
          {header}
          {description && <div className="text-[11px] text-gray-500 mt-1">{description}</div>}
          <label className="mt-2 inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={Boolean(current)}
              onChange={(e) => onChange(setDeepValue(value, path, e.target.checked))}
            />
            {label}
          </label>
        </div>
      );
    }

    if (type === 'number' || type === 'integer') {
      return (
        <div className="rounded border border-gray-200 bg-white p-3">
          {header}
          {description && <div className="text-[11px] text-gray-500 mt-1">{description}</div>}
          <Input
            type="number"
            value={current ?? 0}
            onChange={(e) => {
              const next = e.target.value === '' ? null : Number(e.target.value);
              onChange(setDeepValue(value, path, Number.isNaN(next) ? null : next));
            }}
          />
        </div>
      );
    }

    // default string
    return (
      <div className="rounded border border-gray-200 bg-white p-3">
        {header}
        {description && <div className="text-[11px] text-gray-500 mt-1">{description}</div>}
        <Input
          value={current ?? ''}
          onChange={(e) => onChange(setDeepValue(value, path, e.target.value))}
        />
      </div>
    );
  };

  const rootResolved = resolveRef(schema);
  if ((Array.isArray(rootResolved?.type) ? rootResolved.type[0] : rootResolved?.type) !== 'object') {
    return (
      <TextArea
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

  const props = rootResolved?.properties ?? {};
  const req = new Set<string>(rootResolved?.required ?? []);

  return (
    <div className="space-y-2">
      {Object.entries(props).map(([k, child]) => (
        <div key={k}>
          {renderField(child, [k], k, req.has(k), 0)}
        </div>
      ))}
    </div>
  );
};

const EventStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const s = status.toLowerCase();
  const cls =
    s === 'active' ? 'bg-green-50 text-green-700 border-green-200'
      : s === 'beta' ? 'bg-yellow-50 text-yellow-800 border-yellow-200'
        : s === 'draft' ? 'bg-gray-100 text-gray-700 border-gray-200'
          : 'bg-red-50 text-red-700 border-red-200';
  const label = s.charAt(0).toUpperCase() + s.slice(1);
  return <Badge className={`${cls} text-[10px]`}>{label}</Badge>;
};

const SourceBadge: React.FC<{ source: 'system' | 'tenant' }> = ({ source }) => (
  <Badge className={`text-[10px] ${source === 'system' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
    {source === 'system' ? 'System' : 'Tenant'}
  </Badge>
);

const SchemaBadge: React.FC<{ status: WorkflowEventCatalogEntryV2['payload_schema_ref_status'] }> = ({ status }) => {
  if (status === 'missing') {
    return <Badge className="text-[10px] bg-gray-100 text-gray-600 border-gray-200">No schema</Badge>;
  }
  if (status === 'unknown') {
    return <Badge className="text-[10px] bg-red-50 text-red-700 border-red-200">Unknown schema</Badge>;
  }
  return <Badge className="text-[10px] bg-sky-50 text-sky-700 border-sky-200">Schema</Badge>;
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

export default function EventsCatalogV2() {
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
      toast.error(e instanceof Error ? e.message : 'Failed to load events');
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
        router.push(`/msp/automation-hub?tab=designer&workflowId=${encodeURIComponent(workflowId)}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create workflow');
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
      toast.error(e instanceof Error ? e.message : 'Failed to detach');
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
        <div className="text-sm text-gray-500">Loading events…</div>
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
                              {required && <Badge className="text-[10px] bg-red-50 text-red-700 border-red-200">required</Badge>}
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
                            <Badge className="text-[10px] bg-green-50 text-green-700 border-green-200">Published</Badge>
                            {wf.is_system && <Badge className="text-[10px] bg-purple-50 text-purple-700 border-purple-200">System</Badge>}
                            {wf.is_paused && <Badge className="text-[10px] bg-yellow-50 text-yellow-700 border-yellow-200">Paused</Badge>}
                            {!wf.is_visible && <Badge className="text-[10px] bg-gray-100 text-gray-600 border-gray-200">Hidden</Badge>}
                          </div>
                          <div className="text-xs text-gray-500 font-mono truncate">{wf.workflow_id} · v{wf.published_version ?? '—'}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button id={`workflow-event-details-open-workflow-${wf.workflow_id}`} asChild variant="outline" size="sm">
                            <Link href={`/msp/automation-hub?tab=designer&workflowId=${encodeURIComponent(wf.workflow_id)}`}>
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
          {!schemaLoading && !fullSchema && <div className="text-sm text-red-600">Schema not available.</div>}
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
                    } catch {
                      toast.error('Copy failed');
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
      toast.error(e instanceof Error ? e.message : 'Failed to load metrics');
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
                <Link href={`/msp/automation-hub?tab=designer`}>
                  Open designer
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
                      <Link href={`/msp/workflows?tab=events&eventType=${encodeURIComponent(eventType)}`}>
                        View in workflow events
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
}> = ({ open, eventType, payloadSchemaRef, onClose }) => {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [schema, setSchema] = useState<any | null>(null);
  const [schemaRefOverride, setSchemaRefOverride] = useState<string>('');
  const [correlationKey, setCorrelationKey] = useState('');
  const [payloadText, setPayloadText] = useState('{}');
  const [formValue, setFormValue] = useState<any>({});
  const [errors, setErrors] = useState<Array<{ path: string; message: string }>>([]);
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
    if (!ref) {
      setSchema(null);
      return;
    }
    getEventSchemaByRefAction({ schemaRef: ref })
      .then((res) => {
        const s = (res as any)?.schema ?? null;
        setSchema(s);
        const defaults = s ? buildDefaultValueFromSchema(s, s) : {};
        setFormValue(defaults ?? {});
        setPayloadText(JSON.stringify(defaults ?? {}, null, 2));
      })
      .catch(() => setSchema(null));
  }, [eventType, open, payloadSchemaRef, schemaRefOverride]);

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
    setErrors(validateAgainstSchema(schema, value ?? {}, schema));
  }, [formValue, mode, open, payloadText, schema]);

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
      const payload = mode === 'json' ? JSON.parse(payloadText || '{}') : formValue;
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
      toast.error(msg);
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
              <div className="text-xs text-yellow-700">No schema available; form mode disabled.</div>
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
              <SchemaForm schema={schema} value={formValue ?? {}} onChange={setFormValue} />
            </div>
          )}

          {errors.length > 0 && (
            <Card className="p-3 border border-red-200 bg-red-50">
              <div className="text-sm font-semibold text-red-800 mb-1">Schema validation errors</div>
              <ul className="list-disc pl-4 space-y-1 text-xs text-red-800">
                {errors.slice(0, 8).map((err, idx) => (
                  <li key={`${err.path}-${idx}`}>{err.path ? `${err.path}: ` : ''}{err.message}</li>
                ))}
              </ul>
              {errors.length > 8 && <div className="text-[11px] text-red-700 mt-1">+{errors.length - 8} more</div>}
            </Card>
          )}

          {submitError && (
            <Card className="p-3 border border-red-200 bg-red-50">
              <div className="text-sm font-semibold text-red-800 mb-1">Simulation error</div>
              <div className="text-xs text-red-800">{submitError}</div>
            </Card>
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
        } catch {
          toast.error('Payload schema must be valid JSON.');
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
      toast.error(e instanceof Error ? e.message : 'Failed to create event');
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
