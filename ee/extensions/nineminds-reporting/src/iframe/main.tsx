import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button,
  Input,
  CustomSelect,
  Card,
  Badge,
  DataTable,
  Text,
  Alert,
  ConfirmDialog,
  Spinner,
  LoadingIndicator,
  type Column,
  type SelectOption,
} from '@alga-psa/ui-kit';

// ============================================================================
// Theme Bridge - Receives theme from host app and applies CSS variables
// ============================================================================

/**
 * Apply theme variables to the document root
 */
function applyTheme(vars: Record<string, string>) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  Object.entries(vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}

/**
 * Get the parent origin for postMessage
 */
function getParentOrigin(): string {
  const params = new URLSearchParams(window.location.search);
  const parentOrigin = params.get('parentOrigin');
  if (parentOrigin) return parentOrigin;

  if (document.referrer) {
    try {
      return new URL(document.referrer).origin;
    } catch {
      // Invalid referrer
    }
  }
  return '*';
}

/**
 * Send ready message to parent and set up theme listener
 */
function initializeThemeBridge() {
  const parentOrigin = getParentOrigin();

  // Listen for theme messages from parent
  const handleMessage = (ev: MessageEvent) => {
    const data = ev.data;
    if (!data || typeof data !== 'object') return;

    // Check for Alga envelope format with theme message
    if (data.alga === true && data.version === '1' && data.type === 'theme') {
      console.log('[Extension] Received theme from host:', data.payload);
      applyTheme(data.payload || {});
    }
  };

  window.addEventListener('message', handleMessage);

  // Send ready message to parent so it knows to send theme
  window.parent.postMessage(
    { alga: true, version: '1', type: 'ready' },
    parentOrigin
  );

  console.log('[Extension] Sent ready message to parent:', parentOrigin);

  return () => window.removeEventListener('message', handleMessage);
}

// Initialize theme bridge on load
if (typeof window !== 'undefined') {
  initializeThemeBridge();
}

// ============================================================================
// Extension Proxy Bridge - Calls WASM handler via ext-proxy
// ============================================================================

const ENVELOPE_VERSION = '1';

/**
 * IframeBridge for calling the extension's WASM handler via postMessage.
 * The host's iframeBridge handles 'apiproxy' messages and forwards them to ext-proxy.
 */
class IframeBridge {
  private listeners: Map<string, (data: any) => void> = new Map();
  private parentOrigin: string;

  constructor() {
    this.parentOrigin = getParentOrigin();

    // Listen for responses from host
    window.addEventListener('message', (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.alga !== true || data.version !== ENVELOPE_VERSION) return;

      // Handle apiproxy responses
      if (data.type === 'apiproxy_response' && data.request_id) {
        const listener = this.listeners.get(data.request_id);
        if (listener) {
          this.listeners.delete(data.request_id);
          listener(data);
        }
      }
    });
  }

  /**
   * Call the extension's WASM handler via the proxy.
   * The route is relative to the extension's handler (e.g., '/reports', '/schema').
   */
  async callProxy<T>(route: string, payload?: Uint8Array | null): Promise<T> {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();

      // Set up listener for response
      const timeoutId = setTimeout(() => {
        this.listeners.delete(requestId);
        reject(new Error('Proxy request timed out'));
      }, 30000);

      this.listeners.set(requestId, (data) => {
        clearTimeout(timeoutId);
        if (data.payload?.error) {
          reject(new Error(data.payload.error));
        } else if (data.payload?.body) {
          // Decode base64 response body
          try {
            const binaryString = atob(data.payload.body);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const text = new TextDecoder().decode(bytes);
            resolve(JSON.parse(text));
          } catch (e) {
            reject(new Error('Failed to decode proxy response'));
          }
        } else {
          resolve(data.payload as T);
        }
      });

      // Encode payload to base64 if present
      let bodyBase64: string | undefined;
      if (payload) {
        let binaryString = '';
        for (let i = 0; i < payload.length; i++) {
          binaryString += String.fromCharCode(payload[i]);
        }
        bodyBase64 = btoa(binaryString);
      }

      // Send apiproxy message to host
      window.parent.postMessage(
        {
          alga: true,
          version: ENVELOPE_VERSION,
          type: 'apiproxy',
          request_id: requestId,
          payload: { route, body: bodyBase64 },
        },
        this.parentOrigin
      );
    });
  }
}

// Initialize bridge
const bridge = new IframeBridge();

/**
 * Map internal API paths to WASM handler routes.
 * e.g., '/api/v1/platform-reports' -> '/reports'
 *       '/api/v1/platform-reports/schema' -> '/schema'
 */
function mapApiPathToHandlerRoute(path: string): string {
  // Remove the /api/v1/platform-reports prefix if present
  const prefix = '/api/v1/platform-reports';
  if (path.startsWith(prefix)) {
    const suffix = path.slice(prefix.length);
    if (suffix === '' || suffix === '/') {
      return '/reports';
    }
    if (suffix === '/schema') {
      return '/schema';
    }
    if (suffix === '/access') {
      return '/access';
    }
    if (suffix === '/audit' || suffix.startsWith('/audit?')) {
      return suffix; // Keep audit path as-is
    }
    // For report-specific routes like /report-id, /report-id/execute
    return `/reports${suffix}`;
  }
  // Return as-is if it doesn't match the expected prefix
  return path;
}

/**
 * Call the WASM handler via the extension proxy.
 * This is the proper pattern: UI -> postMessage -> iframeBridge -> ext-proxy -> Runner -> WASM handler
 *
 * Since the iframeBridge always uses POST, we encode the intended action in the body.
 * The handler uses the __action field to determine the operation for paths that support
 * multiple operations (like /reports/:id which can be GET, PUT, or DELETE).
 */
async function proxyApiCall<T>(
  route: string,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  // Map the internal API path to the WASM handler route
  const handlerRoute = mapApiPathToHandlerRoute(route);
  const method = options?.method?.toUpperCase() || 'GET';

  // Build the body with __action field for non-GET methods
  let bodyData: Record<string, unknown> | undefined;

  if (options?.body && typeof options.body === 'object') {
    bodyData = { ...(options.body as Record<string, unknown>) };
  }

  // Add __action field for methods that need disambiguation
  if (method === 'DELETE') {
    bodyData = bodyData || {};
    bodyData.__action = 'delete';
  } else if (method === 'PUT') {
    bodyData = bodyData || {};
    bodyData.__action = 'update';
  } else if (method === 'POST' && handlerRoute === '/reports') {
    bodyData = bodyData || {};
    bodyData.__action = 'create';
  }

  // Encode body if present
  let payload: Uint8Array | undefined;
  if (bodyData) {
    const bodyJson = JSON.stringify(bodyData);
    payload = new TextEncoder().encode(bodyJson);
  }

  console.log('[Extension] Calling proxy:', { route, handlerRoute, method, hasBody: !!payload });

  try {
    const result = await bridge.callProxy<T>(handlerRoute, payload);
    console.log('[Extension] Proxy response:', result);
    return result;
  } catch (error) {
    console.error('[Extension] Proxy call failed:', error);
    throw error;
  }
}

// ============================================================================
// Types
// ============================================================================

// Types
interface PlatformReport {
  report_id: string;
  name: string;
  description: string | null;
  category: string | null;
  report_definition: ReportDefinition;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ReportDefinition {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  version?: string;
  metrics: MetricDefinition[];
  permissions?: {
    roles?: string[];
    resources?: string[];
  };
}

interface MetricDefinition {
  id: string;
  name: string;
  type: 'count' | 'sum' | 'avg' | 'query';
  query: QueryDefinition;
}

interface QueryDefinition {
  table: string;
  fields: string[];
  filters?: FilterDefinition[];
  joins?: JoinDefinition[];
  groupBy?: string[];
  orderBy?: OrderByDefinition[];
  limit?: number;
}

interface FilterDefinition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in';
  value: unknown;
}

interface OrderByDefinition {
  field: string;
  direction: 'asc' | 'desc';
}

type JoinType = 'inner' | 'left' | 'right' | 'full';

interface JoinCondition {
  left: string;
  right: string;
  operator?: string;
}

interface JoinDefinition {
  type: JoinType;
  table: string;
  on: JoinCondition[];
}

interface ApiResponse<T> {
  success: boolean;
  error?: string;
  data?: T;
}

// Audit log types - matches extension_audit_logs table
interface AuditLogEntry {
  log_id: string;
  tenant: string;
  event_type: string;
  user_id: string | null;
  user_email: string | null;
  resource_type: 'report' | 'tenant' | 'user' | 'subscription' | null;
  resource_id: string | null;
  resource_name: string | null;
  workflow_id: string | null;
  status: 'pending' | 'completed' | 'failed' | 'running' | null;
  error_message: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

// Get host origin from referrer (the main app that embeds this iframe)
function getHostOrigin(): string {
  // Priority: URL param > referrer > current origin
  const params = new URLSearchParams(window.location.search);
  const hostParam = params.get('host');
  if (hostParam) {
    return hostParam;
  }

  // Use referrer (the page that embedded this iframe)
  if (document.referrer) {
    try {
      const referrerUrl = new URL(document.referrer);
      return referrerUrl.origin;
    } catch {
      // Invalid referrer URL
    }
  }

  // Fallback to current origin (won't work for cross-origin iframes)
  return window.location.origin;
}

// API client that calls the platform API through the internal proxy
// Uses postMessage to avoid CORS issues with cross-origin iframes
async function callExtensionApi<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const route = `/api/v1/platform-reports${path}`;

  try {
    // Parse body from options if present
    let body: any = undefined;
    if (options.body && typeof options.body === 'string') {
      try {
        body = JSON.parse(options.body);
      } catch {
        body = options.body;
      }
    }

    const result = await proxyApiCall<any>(route, {
      method: options.method as string || 'GET',
      body,
    });

    // Normalize response format
    if (result && typeof result === 'object') {
      if ('success' in result) {
        return result as ApiResponse<T>;
      }
      // If response has 'data' field, it's already the expected format
      if ('data' in result) {
        return { success: true, data: result.data as T };
      }
      return { success: true, data: result as T };
    }
    return { success: true, data: result as T };
  } catch (error) {
    console.error('API call failed:', error);
    return { success: false, error: String(error) };
  }
}

// ============================================================================
// Dynamic Schema - Fetched from server (blocklist-filtered)
// ============================================================================

interface TableSchema {
  name: string;
  columns: string[];
}

interface SchemaResponse {
  tables: TableSchema[];
}

// Schema cache to avoid refetching
let schemaCache: TableSchema[] | null = null;
let schemaPromise: Promise<TableSchema[]> | null = null;

/**
 * Fetch available tables and columns from the server.
 * The server filters the schema using a blocklist for security.
 * Uses the internal proxy to avoid CORS issues.
 */
async function fetchSchema(): Promise<TableSchema[]> {
  if (schemaCache) {
    return schemaCache;
  }

  if (schemaPromise) {
    return schemaPromise;
  }

  schemaPromise = (async () => {
    try {
      const result = await proxyApiCall<any>('/api/v1/platform-reports/schema');

      // Handle the response format from proxy
      const data = result?.data || result;
      if (data?.tables) {
        schemaCache = data.tables;
        return data.tables as TableSchema[];
      }

      if (result?.success === false) {
        console.error('[Schema] Failed to fetch:', result.error);
        return [];
      }

      console.error('[Schema] Unexpected response format:', result);
      return [];
    } catch (error) {
      console.error('[Schema] Fetch error:', error);
      return [];
    }
  })();

  return schemaPromise!;
}

/**
 * Hook to load and use the dynamic schema
 */
function useSchema() {
  const [tables, setTables] = useState<TableSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSchema()
      .then(schema => {
        setTables(schema);
        setLoading(false);
      })
      .catch(err => {
        setError(String(err));
        setLoading(false);
      });
  }, []);

  const getTableColumns = useCallback((tableName: string): string[] => {
    const table = tables.find(t => t.name === tableName);
    return table?.columns || [];
  }, [tables]);

  const tableOptions: SelectOption[] = tables.map(t => ({
    value: t.name,
    label: t.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  }));

  return { tables, tableOptions, getTableColumns, loading, error };
}

/**
 * Hook to load existing categories from reports
 */
function useCategories() {
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCategories() {
      try {
        const result = await callExtensionApi<PlatformReport[]>('');
        if (result.success && result.data) {
          // Extract distinct non-empty categories using Set for deduplication
          const allCategories = result.data
            .map(r => r.category)
            .filter((c): c is string => !!c && c.trim() !== '');
          const distinctCategories = Array.from(new Set(allCategories)).sort();
          setCategories(distinctCategories);
        }
      } catch (error) {
        console.error('[Categories] Fetch error:', error);
      }
      setLoading(false);
    }
    fetchCategories();
  }, []);

  return { categories, loading };
}

/**
 * Category selector component - allows selecting existing or adding new
 */
function CategorySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { categories, loading } = useCategories();
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  // Check if current value is a custom one (not in the list)
  const isCustomValue = value && !categories.includes(value);

  const handleSelectChange = (selected: string) => {
    if (selected === '__new__') {
      setIsAddingNew(true);
      setNewCategory('');
    } else if (selected === '__none__') {
      setIsAddingNew(false);
      onChange('');  // Convert __none__ back to empty string
    } else {
      setIsAddingNew(false);
      onChange(selected);
    }
  };

  const handleNewCategoryConfirm = () => {
    if (newCategory.trim()) {
      onChange(newCategory.trim());
      setIsAddingNew(false);
    }
  };

  const handleNewCategoryCancel = () => {
    setIsAddingNew(false);
    setNewCategory('');
  };

  if (loading) {
    return <LoadingIndicator size="sm" text="Loading categories..." />;
  }

  if (isAddingNew) {
    return (
      <div style={{ display: 'flex', gap: '8px' }}>
        <Input
          type="text"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          placeholder="Enter new category name..."
          style={{ flex: 1 }}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleNewCategoryConfirm();
            } else if (e.key === 'Escape') {
              handleNewCategoryCancel();
            }
          }}
        />
        <Button type="button" variant="primary" onClick={handleNewCategoryConfirm} disabled={!newCategory.trim()}>
          Add
        </Button>
        <Button type="button" variant="ghost" onClick={handleNewCategoryCancel}>
          Cancel
        </Button>
      </div>
    );
  }

  // Build options: existing categories + "Add new..."
  const options: SelectOption[] = [
    { value: '__none__', label: 'No category' },
    ...categories.map(c => ({ value: c, label: c })),
    // If current value is custom (not in list), add it as an option
    ...(isCustomValue ? [{ value: value, label: `${value} (custom)` }] : []),
    { value: '__new__', label: '+ Add new category...' },
  ];

  return (
    <CustomSelect
      options={options}
      value={value || '__none__'}
      onValueChange={handleSelectChange}
      placeholder="Select or add category..."
    />
  );
}

const OPERATORS = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'like', label: 'LIKE' },
];

// Result rendering types
interface ReportResult {
  reportId: string;
  reportName: string;
  executedAt: string;
  parameters: Record<string, unknown>;
  metrics: Record<string, unknown[]>;
  metadata: {
    version: string;
    category: string;
    executionTime: number;
    cacheHit: boolean;
  };
}

// Stat Card for single-value metrics (counts, sums, etc.)
function StatCard({ title, value, subtitle }: { title: string; value: string | number; subtitle?: string }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, var(--alga-primary) 0%, var(--alga-primary-light) 100%)',
      color: 'var(--alga-primary-foreground)',
      borderRadius: '12px',
      padding: '20px',
      minWidth: '200px',
    }}>
      <div style={{ fontSize: '0.875rem', opacity: 0.9, marginBottom: '4px' }}>{title}</div>
      <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{value}</div>
      {subtitle && <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '4px' }}>{subtitle}</div>}
    </div>
  );
}

// Table for displaying metric rows with search and sorting
function ResultsTable({ data, title }: { data: unknown[]; title: string }) {
  const [search, setSearch] = useState('');

  if (!Array.isArray(data) || data.length === 0) {
    return (
      <Card>
        <h4 style={{ marginTop: 0 }}>{title}</h4>
        <Text tone="muted">No data returned</Text>
      </Card>
    );
  }

  // Get columns from first row
  const firstRow = data[0] as Record<string, unknown>;
  const columnKeys = Object.keys(firstRow);

  // Format column header
  const formatHeader = (col: string): string => {
    return col
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  };

  // Format cell value for display
  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return value.toLocaleString();
    if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T/)) {
      return new Date(value).toLocaleString();
    }
    return String(value);
  };

  // Filter data by search term
  const filteredData = search
    ? data.filter(row => {
        const rowStr = Object.values(row as Record<string, unknown>)
          .map(v => String(v ?? '').toLowerCase())
          .join(' ');
        return rowStr.includes(search.toLowerCase());
      })
    : data;

  // Build columns for DataTable
  const columns: Column<Record<string, unknown>>[] = columnKeys.map(key => ({
    key: key as keyof Record<string, unknown> & string,
    header: formatHeader(key),
    render: (row: Record<string, unknown>) => (
      <span>{formatValue(row[key])}</span>
    ),
  }));

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h4 style={{ margin: 0 }}>{title}</h4>
        <Input
          type="text"
          placeholder="Search results..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '250px' }}
        />
      </div>
      <DataTable
        columns={columns}
        data={filteredData as Record<string, unknown>[]}
        paginate
        defaultPageSize={10}
      />
    </Card>
  );
}

// Bar chart for grouped count data
function SimpleBarChart({ data, labelKey, valueKey, title }: {
  data: unknown[];
  labelKey: string;
  valueKey: string;
  title: string;
}) {
  if (!Array.isArray(data) || data.length === 0) return null;

  const maxValue = Math.max(...data.map(d => Number((d as Record<string, unknown>)[valueKey]) || 0));

  return (
    <Card>
      <h4 style={{ marginTop: 0 }}>{title}</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {data.map((item, idx) => {
          const label = String((item as Record<string, unknown>)[labelKey] || `Item ${idx + 1}`);
          const value = Number((item as Record<string, unknown>)[valueKey]) || 0;
          const percentage = maxValue > 0 ? (value / maxValue) * 100 : 0;

          return (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '120px', fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {label}
              </div>
              <div style={{ flex: 1, background: 'var(--alga-border)', borderRadius: '4px', height: '24px', overflow: 'hidden' }}>
                <div style={{
                  width: `${percentage}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, var(--alga-primary) 0%, var(--alga-secondary) 100%)',
                  borderRadius: '4px',
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <div style={{ width: '60px', textAlign: 'right', fontWeight: 'bold' }}>
                {value.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// Intelligent results renderer
function ResultsRenderer({ results }: { results: ReportResult }) {
  const { metrics, metadata, parameters, executedAt } = results;

  // Detect if data is a single count result
  const isSingleCount = (data: unknown[]): boolean => {
    if (data.length !== 1) return false;
    const row = data[0] as Record<string, unknown>;
    const keys = Object.keys(row);
    return keys.length === 1 && (keys[0] === 'count' || keys[0].endsWith('_count'));
  };

  // Detect if data is grouped counts (for bar chart)
  const isGroupedCounts = (data: unknown[]): { labelKey: string; valueKey: string } | null => {
    if (data.length === 0) return null;
    const row = data[0] as Record<string, unknown>;
    const keys = Object.keys(row);
    if (keys.length !== 2) return null;
    const countKey = keys.find(k => k === 'count' || k.endsWith('_count'));
    if (!countKey) return null;
    const labelKey = keys.find(k => k !== countKey);
    if (!labelKey) return null;
    return { labelKey, valueKey: countKey };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Execution metadata */}
      <Card style={{ background: 'var(--alga-muted)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--alga-muted-fg)' }}>Executed At</div>
            <div style={{ fontWeight: 500 }}>{new Date(executedAt).toLocaleString()}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--alga-muted-fg)' }}>Execution Time</div>
            <div style={{ fontWeight: 500 }}>{metadata.executionTime}ms</div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--alga-muted-fg)' }}>Category</div>
            <div style={{ fontWeight: 500 }}>{metadata.category || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--alga-muted-fg)' }}>Cache</div>
            <div style={{ fontWeight: 500 }}>{metadata.cacheHit ? 'Hit' : 'Miss'}</div>
          </div>
        </div>
      </Card>

      {/* Render each metric */}
      {Object.entries(metrics).map(([metricId, data]) => {
        // Handle error objects
        if (data && typeof data === 'object' && 'error' in data && (data as Record<string, unknown>).error === true) {
          const errorData = data as unknown as { error: boolean; message: string; metricName: string };
          return (
            <Card key={metricId} style={{ background: 'var(--alga-danger-50)', borderColor: 'var(--alga-danger)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <span style={{ fontSize: '1.5rem' }}>⚠️</span>
                <div>
                  <Text style={{ fontWeight: 600, color: 'var(--alga-danger)' }}>
                    Error in metric: {errorData.metricName || metricId}
                  </Text>
                  <Text tone="muted" style={{ display: 'block', marginTop: '4px', fontSize: '0.875rem' }}>
                    {errorData.message}
                  </Text>
                  <Text tone="muted" style={{ display: 'block', marginTop: '8px', fontSize: '0.75rem' }}>
                    Tip: Check that all non-aggregated columns are included in GROUP BY, or use aggregate functions like COUNT(), SUM(), etc.
                  </Text>
                </div>
              </div>
            </Card>
          );
        }

        if (!Array.isArray(data)) return null;

        // Single count value → StatCard
        if (isSingleCount(data)) {
          const row = data[0] as Record<string, unknown>;
          const countKey = Object.keys(row)[0];
          return (
            <StatCard
              key={metricId}
              title={metricId.replace(/_/g, ' ').replace(/metric /i, '')}
              value={Number(row[countKey]).toLocaleString()}
              subtitle="Total count"
            />
          );
        }

        // Grouped counts → Bar chart + Table
        const grouped = isGroupedCounts(data);
        if (grouped && data.length <= 20) {
          return (
            <div key={metricId} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <SimpleBarChart
                data={data}
                labelKey={grouped.labelKey}
                valueKey={grouped.valueKey}
                title={`${metricId.replace(/_/g, ' ')} (Chart)`}
              />
              <ResultsTable data={data} title={`${metricId.replace(/_/g, ' ')} (Data)`} />
            </div>
          );
        }

        // Default → Table
        return <ResultsTable key={metricId} data={data} title={metricId.replace(/_/g, ' ')} />;
      })}

      {/* Raw JSON toggle */}
      <details style={{ marginTop: '8px' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--alga-muted-fg)', fontSize: '0.875rem' }}>
          View Raw JSON
        </summary>
        <pre style={{ marginTop: '8px', fontSize: '0.75rem' }}>
          {JSON.stringify(results, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// Components
function ReportsList() {
  const [reports, setReports] = useState<PlatformReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<PlatformReport | null>(null);

  useEffect(() => {
    fetchReports();
  }, []);

  async function fetchReports() {
    setLoading(true);
    setError(null);
    const result = await callExtensionApi<PlatformReport[]>('');
    if (result.success && result.data) {
      setReports(result.data);
    } else {
      setError(result.error || 'Failed to fetch reports');
    }
    setLoading(false);
  }

  if (loading) {
    return <LoadingIndicator size="sm" text="Loading reports..." />;
  }

  if (error) {
    return (
      <div>
        <Alert tone="danger">{error}</Alert>
        <Button style={{ marginTop: '16px' }} onClick={fetchReports}>
          Retry
        </Button>
      </div>
    );
  }

  if (selectedReport) {
    return (
      <ReportDetail
        report={selectedReport}
        onBack={() => setSelectedReport(null)}
        onRefresh={fetchReports}
      />
    );
  }

  const columns: Column<PlatformReport>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <div>
          <strong>{row.name}</strong>
          {row.description && (
            <div style={{ fontSize: '0.75rem', color: 'var(--alga-muted-fg)' }}>
              {row.description}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (row) => row.category ? (
        <Badge tone="info">{row.category}</Badge>
      ) : null,
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (row) => (
        <Badge tone={row.is_active ? 'success' : 'warning'}>
          {row.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      render: (row) => (
        <Text tone="muted" style={{ fontSize: '0.875rem' }}>
          {new Date(row.created_at).toLocaleDateString()}
        </Text>
      ),
    },
    {
      key: 'report_id',
      header: 'Actions',
      sortable: false,
      render: (row) => (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setSelectedReport(row)}
        >
          View Details
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0 }}>Platform Reports</h2>
        <Button variant="secondary" onClick={fetchReports}>
          Refresh
        </Button>
      </div>

      {reports.length === 0 ? (
        <Card>
          <Text tone="muted">
            No reports found. Create your first report using the "Create Report" tab.
          </Text>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={reports}
          paginate
          defaultPageSize={10}
          initialSortKey="created_at"
        />
      )}
    </div>
  );
}

function ReportDetail({
  report,
  onBack,
  onRefresh,
}: {
  report: PlatformReport;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const [executing, setExecuting] = useState(false);
  const [results, setResults] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // If editing, render the EditReport component
  if (isEditing) {
    return (
      <EditReport
        report={report}
        onBack={() => setIsEditing(false)}
        onSave={onRefresh}
      />
    );
  }

  const handleExecute = async () => {
    setExecuting(true);
    setError(null);
    setResults(null);

    const result = await callExtensionApi<ReportResult>(`/${report.report_id}/execute`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    if (result.success && result.data) {
      setResults(result.data);
    } else {
      setError(result.error || 'Failed to execute report');
    }
    setExecuting(false);
  };

  const handleDeleteConfirmed = async () => {
    const result = await callExtensionApi(`/${report.report_id}`, {
      method: 'DELETE',
    });

    if (result.success) {
      onRefresh();
      onBack();
    } else {
      setError(result.error || 'Failed to delete report');
    }
    setShowDeleteConfirm(false);
  };

  return (
    <div>
      <Button
        variant="ghost"
        style={{ marginBottom: '20px' }}
        onClick={onBack}
      >
        ← Back to Reports
      </Button>

      <Card>
        <h2 style={{ marginTop: 0 }}>{report.name}</h2>
        {report.description && (
          <Text tone="muted" style={{ display: 'block', marginBottom: '12px' }}>{report.description}</Text>
        )}

        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          {report.category && (
            <Badge tone="info">{report.category}</Badge>
          )}
          <Badge tone={report.is_active ? 'success' : 'warning'}>
            {report.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>

        <Text tone="muted" style={{ display: 'block', fontSize: '0.875rem', marginBottom: '20px' }}>
          <div>Created: {new Date(report.created_at).toLocaleString()}</div>
          <div>Updated: {new Date(report.updated_at).toLocaleString()}</div>
        </Text>

        <h3>Report Definition</h3>
        <pre style={{
          background: 'var(--alga-muted)',
          color: 'var(--alga-fg)',
          padding: '12px',
          borderRadius: 'var(--alga-radius)',
          overflow: 'auto',
          fontSize: '0.8125rem',
          lineHeight: '1.5',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        }}>
          {JSON.stringify(report.report_definition, null, 2)}
        </pre>

        <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
          <Button
            onClick={handleExecute}
            disabled={executing}
          >
            {executing ? 'Executing...' : 'Execute Report'}
          </Button>
          <Button variant="secondary" onClick={() => setIsEditing(true)}>
            Edit Report
          </Button>
          <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
            Delete Report
          </Button>
        </div>

        {/* Delete Confirmation Dialog */}
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title="Delete Report"
          message="Are you sure you want to delete this report? This action cannot be undone."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      </Card>

      {error && <Alert tone="danger" style={{ marginTop: '16px' }}>{error}</Alert>}

      {results && (
        <div style={{ marginTop: '16px' }}>
          <h3>Results</h3>
          <ResultsRenderer results={results} />
        </div>
      )}
    </div>
  );
}

// Shared textarea style to match Input component
const textareaStyle: React.CSSProperties = {
  borderRadius: 'var(--alga-radius)',
  border: '1px solid var(--alga-border)',
  background: 'var(--alga-bg)',
  color: 'var(--alga-fg)',
  padding: '8px 10px',
  fontSize: 14,
  lineHeight: '20px',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};


// Metric type options for Select
const METRIC_TYPE_OPTIONS: SelectOption[] = [
  { value: 'count', label: 'Count' },
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'query', label: 'Custom Query' },
];

// Operator options for Select
const OPERATOR_OPTIONS: SelectOption[] = OPERATORS.map(op => ({ value: op.value, label: op.label }));

// Join type options for Select
const JOIN_TYPE_OPTIONS: SelectOption[] = [
  { value: 'inner', label: 'INNER JOIN' },
  { value: 'left', label: 'LEFT JOIN' },
  { value: 'right', label: 'RIGHT JOIN' },
  { value: 'full', label: 'FULL JOIN' },
];

function CreateReport() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [metrics, setMetrics] = useState<MetricDefinition[]>([]);
  const [creating, setCreating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track which metrics are in "raw SQL" mode
  const [rawSqlMode, setRawSqlMode] = useState<{ [key: string]: boolean }>({});
  const [rawSqlText, setRawSqlText] = useState<{ [key: string]: string }>({});

  // Use dynamic schema from server
  const { tables, tableOptions, getTableColumns, loading: schemaLoading } = useSchema();

  const addMetric = () => {
    // Use first available table, or empty string if schema not loaded yet
    const defaultTable = tables.length > 0 ? tables[0].name : '';
    setMetrics([
      ...metrics,
      {
        id: `metric_${Date.now()}`,
        name: '',
        type: 'count',
        query: {
          table: defaultTable,
          fields: ['COUNT(*) as count'],
          filters: [],
          groupBy: [],
        },
      },
    ]);
  };

  const updateMetric = (index: number, updates: Partial<MetricDefinition>) => {
    const newMetrics = [...metrics];
    newMetrics[index] = { ...newMetrics[index], ...updates };
    setMetrics(newMetrics);
  };

  const updateQuery = (index: number, updates: Partial<QueryDefinition>) => {
    const newMetrics = [...metrics];
    newMetrics[index] = {
      ...newMetrics[index],
      query: { ...newMetrics[index].query, ...updates },
    };
    setMetrics(newMetrics);
  };

  const removeMetric = (index: number) => {
    setMetrics(metrics.filter((_, i) => i !== index));
  };

  const addFilter = (metricIndex: number) => {
    const newMetrics = [...metrics];
    const filters = [...(newMetrics[metricIndex].query.filters || [])];
    filters.push({ field: '', operator: 'eq', value: '' });
    newMetrics[metricIndex].query.filters = filters;
    setMetrics(newMetrics);
  };

  const updateFilter = (metricIndex: number, filterIndex: number, updates: Partial<FilterDefinition>) => {
    const newMetrics = [...metrics];
    const filters = [...(newMetrics[metricIndex].query.filters || [])];
    filters[filterIndex] = { ...filters[filterIndex], ...updates };
    newMetrics[metricIndex].query.filters = filters;
    setMetrics(newMetrics);
  };

  const removeFilter = (metricIndex: number, filterIndex: number) => {
    const newMetrics = [...metrics];
    newMetrics[metricIndex].query.filters = (newMetrics[metricIndex].query.filters || [])
      .filter((_, i) => i !== filterIndex);
    setMetrics(newMetrics);
  };

  const addJoin = (metricIndex: number) => {
    const newMetrics = [...metrics];
    const joins = [...(newMetrics[metricIndex].query.joins || [])];
    const defaultTable = tables.length > 0 ? tables[0].name : '';
    joins.push({
      type: 'left',
      table: defaultTable,
      on: [{ left: '', right: '' }],
    });
    newMetrics[metricIndex].query.joins = joins;
    setMetrics(newMetrics);
  };

  const updateJoin = (metricIndex: number, joinIndex: number, updates: Partial<JoinDefinition>) => {
    const newMetrics = [...metrics];
    const joins = [...(newMetrics[metricIndex].query.joins || [])];
    joins[joinIndex] = { ...joins[joinIndex], ...updates };
    newMetrics[metricIndex].query.joins = joins;
    setMetrics(newMetrics);
  };

  const updateJoinCondition = (
    metricIndex: number,
    joinIndex: number,
    conditionIndex: number,
    updates: Partial<JoinCondition>
  ) => {
    const newMetrics = [...metrics];
    const joins = [...(newMetrics[metricIndex].query.joins || [])];
    const conditions = [...joins[joinIndex].on];
    conditions[conditionIndex] = { ...conditions[conditionIndex], ...updates };
    joins[joinIndex] = { ...joins[joinIndex], on: conditions };
    newMetrics[metricIndex].query.joins = joins;
    setMetrics(newMetrics);
  };

  const addJoinCondition = (metricIndex: number, joinIndex: number) => {
    const newMetrics = [...metrics];
    const joins = [...(newMetrics[metricIndex].query.joins || [])];
    joins[joinIndex] = {
      ...joins[joinIndex],
      on: [...joins[joinIndex].on, { left: '', right: '' }],
    };
    newMetrics[metricIndex].query.joins = joins;
    setMetrics(newMetrics);
  };

  const removeJoinCondition = (metricIndex: number, joinIndex: number, conditionIndex: number) => {
    const newMetrics = [...metrics];
    const joins = [...(newMetrics[metricIndex].query.joins || [])];
    joins[joinIndex] = {
      ...joins[joinIndex],
      on: joins[joinIndex].on.filter((_, i) => i !== conditionIndex),
    };
    newMetrics[metricIndex].query.joins = joins;
    setMetrics(newMetrics);
  };

  const removeJoin = (metricIndex: number, joinIndex: number) => {
    const newMetrics = [...metrics];
    newMetrics[metricIndex].query.joins = (newMetrics[metricIndex].query.joins || [])
      .filter((_, i) => i !== joinIndex);
    setMetrics(newMetrics);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setSuccess(false);

    if (!name.trim()) {
      setError('Report name is required');
      setCreating(false);
      return;
    }

    if (metrics.length === 0) {
      setError('At least one metric is required');
      setCreating(false);
      return;
    }

    const reportDefinition: ReportDefinition = {
      id: `report_${Date.now()}`,
      name: name,
      description: description,
      category: category,
      version: '1.0.0',
      metrics: metrics,
    };

    const result = await callExtensionApi('', {
      method: 'POST',
      body: JSON.stringify({
        name,
        description: description || null,
        category: category || null,
        report_definition: reportDefinition,
      }),
    });

    if (result.success) {
      setSuccess(true);
      setName('');
      setDescription('');
      setCategory('');
      setMetrics([]);
    } else {
      setError(result.error || 'Failed to create report');
    }
    setCreating(false);
  };

  // Get all field options from base table + all joined tables (for filters)
  const getAllFieldOptions = (metric: MetricDefinition): SelectOption[] => {
    const options: SelectOption[] = [];

    // Base table columns
    if (metric.query.table) {
      getTableColumns(metric.query.table).forEach(col => {
        options.push({ value: col, label: col });
      });
    }

    // Joined table columns (with table prefix)
    (metric.query.joins || []).forEach(join => {
      if (join.table) {
        getTableColumns(join.table).forEach(col => {
          const fullCol = `${join.table}.${col}`;
          options.push({ value: fullCol, label: fullCol });
        });
      }
    });

    return options;
  };

  // Get all columns from base table AND all joined tables
  const getAllMetricColumns = (metric: MetricDefinition): { table: string; columns: string[] }[] => {
    const result: { table: string; columns: string[] }[] = [];

    // Base table columns
    if (metric.query.table) {
      result.push({
        table: metric.query.table,
        columns: getTableColumns(metric.query.table),
      });
    }

    // Joined table columns
    (metric.query.joins || []).forEach(join => {
      if (join.table) {
        result.push({
          table: join.table,
          columns: getTableColumns(join.table),
        });
      }
    });

    return result;
  };

  // State for table search filter
  const [tableSearch, setTableSearch] = useState('');

  // Filtered table options based on search
  const filteredTableOptions = tableOptions.filter(opt =>
    opt.label.toLowerCase().includes(tableSearch.toLowerCase())
  );

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Create New Report</h2>

      <form onSubmit={handleSubmit}>
        <Card style={{ marginBottom: '16px' }}>
          <h3 style={{ marginTop: 0 }}>Basic Information</h3>

          <div style={{ marginBottom: '16px' }}>
            <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Report Name *</Text>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Tenant User Summary"
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Description</Text>
            <textarea
              style={{ ...textareaStyle, resize: 'vertical' }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this report shows..."
              rows={3}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Category</Text>
            <CategorySelect value={category} onChange={setCategory} />
          </div>
        </Card>

        <Card style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>Metrics</h3>
            <Button type="button" variant="secondary" onClick={addMetric}>
              + Add Metric
            </Button>
          </div>

          {metrics.length === 0 ? (
            <Text tone="muted">
              No metrics added yet. Click "Add Metric" to define what data this report should query.
            </Text>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {metrics.map((metric, index) => (
                <Card
                  key={metric.id}
                  style={{ background: 'var(--alga-card-bg)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <strong>Metric {index + 1}</strong>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => removeMetric(index)}
                    >
                      Remove
                    </Button>
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Metric Name</Text>
                    <Input
                      type="text"
                      value={metric.name}
                      onChange={(e) => updateMetric(index, { name: e.target.value })}
                      placeholder="e.g., Active Users Count"
                      style={{ width: '100%' }}
                    />
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Metric Type</Text>
                    <CustomSelect
                      options={METRIC_TYPE_OPTIONS}
                      value={metric.type}
                      onValueChange={(value) => updateMetric(index, { type: value as 'count' | 'sum' | 'avg' | 'query' })}
                    />
                  </div>

                  {/* Mode Toggle: Builder vs Raw SQL */}
                  <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <Text style={{ fontWeight: 500, fontSize: '0.875rem' }}>Mode:</Text>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <Button
                        type="button"
                        variant={!rawSqlMode[metric.id] ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setRawSqlMode(prev => ({ ...prev, [metric.id]: false }))}
                      >
                        Builder
                      </Button>
                      <Button
                        type="button"
                        variant={rawSqlMode[metric.id] ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => {
                          setRawSqlMode(prev => ({ ...prev, [metric.id]: true }));
                          // Initialize raw SQL from current query if not set
                          if (!rawSqlText[metric.id]) {
                            const fields = metric.query.fields.join(', ') || '*';
                            const from = metric.query.table || 'table_name';
                            let sql = `SELECT ${fields}\nFROM ${from}`;
                            if ((metric.query.joins || []).length > 0) {
                              metric.query.joins!.forEach(j => {
                                const joinType = j.type.toUpperCase();
                                const onClauses = j.on.map(c => `${c.left} = ${c.right}`).join(' AND ');
                                sql += `\n${joinType} JOIN ${j.table} ON ${onClauses}`;
                              });
                            }
                            if ((metric.query.filters || []).length > 0) {
                              const whereClause = metric.query.filters!.map(f => `${f.field} ${f.operator} '${f.value}'`).join(' AND ');
                              sql += `\nWHERE ${whereClause}`;
                            }
                            if ((metric.query.groupBy || []).length > 0) {
                              sql += `\nGROUP BY ${metric.query.groupBy!.join(', ')}`;
                            }
                            setRawSqlText(prev => ({ ...prev, [metric.id]: sql }));
                          }
                        }}
                      >
                        Raw SQL
                      </Button>
                    </div>
                    <Text tone="muted" style={{ fontSize: '0.7rem', marginLeft: '8px' }}>
                      {rawSqlMode[metric.id] ? 'Write SQL directly' : 'Point-and-click query builder'}
                    </Text>
                  </div>

                  {rawSqlMode[metric.id] ? (
                    /* Raw SQL Mode */
                    <div style={{ marginBottom: '16px' }}>
                      <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>SQL Query</Text>
                      <textarea
                        value={rawSqlText[metric.id] || ''}
                        onChange={(e) => {
                          setRawSqlText(prev => ({ ...prev, [metric.id]: e.target.value }));
                          // Store raw SQL in the query as a custom field
                          updateQuery(index, {
                            table: 'raw_sql',
                            fields: [e.target.value],
                          });
                        }}
                        placeholder="SELECT column1, column2&#10;FROM table_name&#10;WHERE condition&#10;GROUP BY column1"
                        style={{
                          width: '100%',
                          minHeight: '200px',
                          fontFamily: 'monospace',
                          fontSize: '0.875rem',
                          padding: '12px',
                          border: '1px solid var(--alga-border)',
                          borderRadius: 'var(--alga-radius)',
                          background: '#1f2937',
                          color: '#f9fafb',
                          resize: 'vertical',
                        }}
                      />
                      <Text tone="muted" style={{ display: 'block', fontSize: '0.7rem', marginTop: '4px' }}>
                        Write your SQL query. Only SELECT statements are allowed. Blocked tables and columns will be rejected.
                      </Text>
                    </div>
                  ) : (
                    /* Builder Mode */
                    <>
                  <div style={{ marginBottom: '16px' }}>
                    <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Table</Text>
                    <Input
                      type="text"
                      placeholder="Search tables..."
                      value={tableSearch}
                      onChange={(e) => setTableSearch(e.target.value)}
                      style={{ marginBottom: '6px' }}
                    />
                    <CustomSelect
                      options={filteredTableOptions}
                      value={metric.query.table}
                      onValueChange={(value) => updateQuery(index, { table: value, fields: ['COUNT(*) as count'] })}
                      disabled={schemaLoading}
                    />
                    {schemaLoading && (
                      <LoadingIndicator size="xs" text="Loading available tables..." style={{ marginTop: '4px' }} />
                    )}
                    {!schemaLoading && filteredTableOptions.length === 0 && tableSearch && (
                      <Text tone="muted" style={{ display: 'block', fontSize: '0.75rem', marginTop: '4px' }}>
                        No tables match "{tableSearch}"
                      </Text>
                    )}
                  </div>

                  {/* Joins Section */}
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <Text style={{ fontWeight: 500 }}>Joins</Text>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => addJoin(index)}
                      >
                        + Add Join
                      </Button>
                    </div>

                    {(metric.query.joins || []).length === 0 ? (
                      <Text tone="muted" style={{ fontSize: '0.75rem' }}>
                        No joins. Add a join to query data from multiple tables.
                      </Text>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {(metric.query.joins || []).map((join, joinIndex) => (
                          <Card key={joinIndex} style={{ background: 'var(--alga-muted)', padding: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <Badge tone="info">Join {joinIndex + 1}</Badge>
                              <Button
                                type="button"
                                variant="danger"
                                size="sm"
                                onClick={() => removeJoin(index, joinIndex)}
                              >
                                Remove
                              </Button>
                            </div>

                            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                              <div style={{ flex: 1 }}>
                                <Text style={{ display: 'block', fontSize: '0.75rem', marginBottom: '4px' }}>Join Type</Text>
                                <CustomSelect
                                  options={JOIN_TYPE_OPTIONS}
                                  value={join.type}
                                  onValueChange={(value) => updateJoin(index, joinIndex, { type: value as JoinType })}
                                />
                              </div>
                              <div style={{ flex: 2 }}>
                                <Text style={{ display: 'block', fontSize: '0.75rem', marginBottom: '4px' }}>Join Table</Text>
                                <CustomSelect
                                  options={tableOptions}
                                  value={join.table}
                                  onValueChange={(value) => updateJoin(index, joinIndex, { table: value })}
                                />
                              </div>
                            </div>

                            <div style={{ marginBottom: '8px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                <Text style={{ fontSize: '0.75rem' }}>ON Conditions</Text>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => addJoinCondition(index, joinIndex)}
                                  style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                                >
                                  + Add
                                </Button>
                              </div>

                              {join.on.map((condition, conditionIndex) => (
                                <div
                                  key={conditionIndex}
                                  style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '4px' }}
                                >
                                  <Input
                                    type="text"
                                    value={condition.left}
                                    onChange={(e) => updateJoinCondition(index, joinIndex, conditionIndex, { left: e.target.value })}
                                    placeholder={`${metric.query.table}.column`}
                                    style={{ flex: 1, fontSize: '0.8125rem' }}
                                  />
                                  <Text style={{ fontSize: '0.75rem', color: 'var(--alga-muted-fg)' }}>=</Text>
                                  <Input
                                    type="text"
                                    value={condition.right}
                                    onChange={(e) => updateJoinCondition(index, joinIndex, conditionIndex, { right: e.target.value })}
                                    placeholder={`${join.table}.column`}
                                    style={{ flex: 1, fontSize: '0.8125rem' }}
                                  />
                                  {join.on.length > 1 && (
                                    <Button
                                      type="button"
                                      variant="danger"
                                      size="sm"
                                      onClick={() => removeJoinCondition(index, joinIndex, conditionIndex)}
                                      style={{ padding: '2px 6px', fontSize: '0.75rem' }}
                                    >
                                      X
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>

                            <Text tone="muted" style={{ display: 'block', fontSize: '0.7rem' }}>
                              Available in {join.table}: {getTableColumns(join.table).slice(0, 5).join(', ')}
                              {getTableColumns(join.table).length > 5 && '...'}
                            </Text>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Fields</Text>

                    {/* Selected fields as removable chips */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px', minHeight: '32px', padding: '8px', background: 'var(--alga-bg)', border: '1px solid var(--alga-border)', borderRadius: 'var(--alga-radius)' }}>
                      {metric.query.fields.length === 0 ? (
                        <Text tone="muted" style={{ fontSize: '0.75rem' }}>No fields selected. Click columns below to add.</Text>
                      ) : (
                        metric.query.fields.map((field, fieldIndex) => (
                          <Badge
                            key={fieldIndex}
                            tone="info"
                            style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            onClick={() => updateQuery(index, { fields: metric.query.fields.filter((_, i) => i !== fieldIndex) })}
                          >
                            {field}
                            <span style={{ marginLeft: '4px', fontWeight: 'bold' }}>×</span>
                          </Badge>
                        ))
                      )}
                    </div>

                    {/* Available columns - click to add (from ALL tables including joins) */}
                    <Text tone="muted" style={{ display: 'block', fontSize: '0.75rem', marginBottom: '4px' }}>
                      Click to add column:
                    </Text>
                    {getAllMetricColumns(metric).map(({ table, columns }) => (
                      <div key={table} style={{ marginBottom: '8px' }}>
                        <Text style={{ display: 'block', fontSize: '0.7rem', fontWeight: 500, color: 'var(--alga-primary)', marginBottom: '4px' }}>
                          {table}:
                        </Text>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {columns.map((col) => {
                            const fullCol = `${table}.${col}`;
                            const isSelected = metric.query.fields.includes(col) || metric.query.fields.includes(fullCol);
                            return (
                              <Button
                                key={col}
                                type="button"
                                variant="secondary"
                                size="sm"
                                style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                                onClick={() => {
                                  if (!isSelected) {
                                    // Use table.column format for joined tables, just column for base table
                                    const colName = table === metric.query.table ? col : fullCol;
                                    updateQuery(index, { fields: [...metric.query.fields, colName] });
                                  }
                                }}
                                disabled={isSelected}
                              >
                                {col}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    ))}

                    {/* Custom expression input */}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <Input
                        type="text"
                        id={`custom-field-${index}`}
                        placeholder="Custom: COUNT(*) as count, SUM(amount), etc."
                        style={{ flex: 1 }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const input = e.target as HTMLInputElement;
                            const value = input.value.trim();
                            if (value && !metric.query.fields.includes(value)) {
                              updateQuery(index, { fields: [...metric.query.fields, value] });
                              input.value = '';
                            }
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          const input = document.getElementById(`custom-field-${index}`) as HTMLInputElement;
                          if (input) {
                            const value = input.value.trim();
                            if (value && !metric.query.fields.includes(value)) {
                              updateQuery(index, { fields: [...metric.query.fields, value] });
                              input.value = '';
                            }
                          }
                        }}
                      >
                        Add
                      </Button>
                    </div>
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Group By</Text>

                    {/* Selected group by fields as removable chips */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px', minHeight: '28px', padding: '6px', background: 'var(--alga-bg)', border: '1px solid var(--alga-border)', borderRadius: 'var(--alga-radius)' }}>
                      {(metric.query.groupBy || []).length === 0 ? (
                        <Text tone="muted" style={{ fontSize: '0.75rem' }}>No grouping. Click columns below to add.</Text>
                      ) : (
                        (metric.query.groupBy || []).map((field, fieldIndex) => (
                          <Badge
                            key={fieldIndex}
                            tone="info"
                            style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            onClick={() => updateQuery(index, { groupBy: (metric.query.groupBy || []).filter((_, i) => i !== fieldIndex) })}
                          >
                            {field}
                            <span style={{ marginLeft: '4px', fontWeight: 'bold' }}>×</span>
                          </Badge>
                        ))
                      )}
                    </div>

                    {/* Available columns - click to add (from ALL tables including joins) */}
                    {getAllMetricColumns(metric).map(({ table, columns }) => (
                      <div key={table} style={{ marginBottom: '8px' }}>
                        <Text style={{ display: 'block', fontSize: '0.7rem', fontWeight: 500, color: 'var(--alga-primary)', marginBottom: '4px' }}>
                          {table}:
                        </Text>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {columns.map((col) => {
                            const fullCol = `${table}.${col}`;
                            const currentGroupBy = metric.query.groupBy || [];
                            const isSelected = currentGroupBy.includes(col) || currentGroupBy.includes(fullCol);
                            return (
                              <Button
                                key={col}
                                type="button"
                                variant="secondary"
                                size="sm"
                                style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                                onClick={() => {
                                  if (!isSelected) {
                                    const colName = table === metric.query.table ? col : fullCol;
                                    updateQuery(index, { groupBy: [...currentGroupBy, colName] });
                                  }
                                }}
                                disabled={isSelected}
                              >
                                {col}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <Text style={{ fontWeight: 500 }}>Filters</Text>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => addFilter(index)}
                      >
                        + Add Filter
                      </Button>
                    </div>

                    {(metric.query.filters || []).map((filter, filterIndex) => (
                      <div
                        key={filterIndex}
                        style={{
                          display: 'flex',
                          gap: '8px',
                          marginBottom: '8px',
                          alignItems: 'center',
                        }}
                      >
                        <CustomSelect
                          options={getAllFieldOptions(metric)}
                          placeholder="Select field..."
                          value={filter.field}
                          onValueChange={(value) => updateFilter(index, filterIndex, { field: value })}
                          style={{ flex: 1 }}
                        />
                        <CustomSelect
                          options={OPERATOR_OPTIONS}
                          value={filter.operator}
                          onValueChange={(value) => updateFilter(index, filterIndex, { operator: value as FilterDefinition['operator'] })}
                          style={{ width: '100px' }}
                        />
                        <Input
                          type="text"
                          value={String(filter.value)}
                          onChange={(e) => updateFilter(index, filterIndex, { value: e.target.value })}
                          placeholder="Value"
                          style={{ flex: 1 }}
                        />
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() => removeFilter(index, filterIndex)}
                        >
                          X
                        </Button>
                      </div>
                    ))}
                  </div>
                    </>
                  )}
                </Card>
              ))}
            </div>
          )}
        </Card>

        {error && <Alert tone="danger" style={{ marginBottom: '16px' }}>{error}</Alert>}

        {success && (
          <Alert tone="info" style={{ marginBottom: '16px' }}>
            Report created successfully! View it in the "Reports" tab.
          </Alert>
        )}

        <Button type="submit" disabled={creating}>
          {creating ? 'Creating...' : 'Create Report'}
        </Button>
      </form>
    </div>
  );
}

function ExecuteReport() {
  const [reports, setReports] = useState<PlatformReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState('');
  const [parameters, setParameters] = useState('{}');
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [results, setResults] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showParamsHelp, setShowParamsHelp] = useState(false);

  useEffect(() => {
    async function fetchReports() {
      setLoading(true);
      const result = await callExtensionApi<PlatformReport[]>('');
      if (result.success && result.data) {
        setReports(result.data);
      }
      setLoading(false);
    }
    fetchReports();
  }, []);

  const selectedReport = reports.find(r => r.report_id === selectedReportId);

  // Build report options for Select
  const reportOptions: SelectOption[] = reports.map(report => ({
    value: report.report_id,
    label: `${report.name}${report.category ? ` (${report.category})` : ''}`,
  }));

  const handleExecute = async () => {
    if (!selectedReportId) {
      setError('Please select a report');
      return;
    }

    setExecuting(true);
    setError(null);
    setResults(null);

    let parsedParams = {};
    try {
      parsedParams = JSON.parse(parameters);
    } catch {
      setError('Invalid JSON in parameters');
      setExecuting(false);
      return;
    }

    const result = await callExtensionApi<ReportResult>(`/${selectedReportId}/execute`, {
      method: 'POST',
      body: JSON.stringify(parsedParams),
    });

    if (result.success && result.data) {
      setResults(result.data);
    } else {
      setError(result.error || 'Failed to execute report');
    }
    setExecuting(false);
  };

  if (loading) {
    return <LoadingIndicator size="sm" text="Loading reports..." />;
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Execute Report</h2>

      <Card>
        <div style={{ marginBottom: '16px' }}>
          <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Select Report</Text>
          <CustomSelect
            options={reportOptions}
            placeholder="Choose a report..."
            value={selectedReportId}
            onValueChange={(value) => {
              setSelectedReportId(value);
              setResults(null);
              setError(null);
            }}
          />
        </div>

        {selectedReport && (
          <Card style={{
            background: 'var(--alga-primary-50)',
            borderColor: 'var(--alga-primary-100)',
            marginBottom: '16px',
            fontSize: '0.875rem',
          }}>
            <strong>{selectedReport.name}</strong>
            {selectedReport.description && (
              <Text tone="muted" style={{ display: 'block', marginTop: '4px' }}>
                {selectedReport.description}
              </Text>
            )}
            <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {selectedReport.category && (
                <Badge tone="info">{selectedReport.category}</Badge>
              )}
              <Badge tone="success">
                {selectedReport.report_definition.metrics?.length || 0} metric(s)
              </Badge>
            </div>
          </Card>
        )}

        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <Text style={{ fontWeight: 500 }}>Parameters (JSON)</Text>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowParamsHelp(!showParamsHelp)}
              style={{ fontSize: '0.75rem' }}
            >
              {showParamsHelp ? 'Hide Help' : 'What are parameters?'}
            </Button>
          </div>

          {showParamsHelp && (
            <Card style={{
              background: 'var(--alga-card-bg)',
              marginBottom: '12px',
              fontSize: '0.8rem',
            }}>
              <div style={{ marginBottom: '12px' }}>
                <strong>How Parameters Work</strong>
                <p style={{ margin: '8px 0' }}>
                  In your report filters, use <code style={{ background: 'var(--alga-muted)', padding: '2px 6px', borderRadius: '4px' }}>{'{{param_name}}'}</code> as the value.
                  Then pass the actual value here when executing.
                </p>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong>Example: Report with status filter</strong>
                <div style={{ background: 'var(--alga-muted)', padding: '8px', borderRadius: '4px', marginTop: '4px', fontSize: '0.75rem' }}>
                  <div>Filter in report: <code>status</code> <code>eq</code> <code>{'{{status_filter}}'}</code></div>
                  <div style={{ marginTop: '4px' }}>Parameters to pass: <code>{`{"status_filter": "active"}`}</code></div>
                </div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong>Example: Date range filter</strong>
                <div style={{ background: 'var(--alga-muted)', padding: '8px', borderRadius: '4px', marginTop: '4px', fontSize: '0.75rem' }}>
                  <div>Filter 1: <code>created_at</code> <code>gte</code> <code>{'{{start_date}}'}</code></div>
                  <div>Filter 2: <code>created_at</code> <code>lte</code> <code>{'{{end_date}}'}</code></div>
                  <div style={{ marginTop: '4px' }}>Parameters: <code>{`{"start_date": "2025-01-01", "end_date": "2025-12-31"}`}</code></div>
                </div>
              </div>

              <div>
                <strong>Built-in Parameters (always available)</strong>
                <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px', fontSize: '0.75rem' }}>
                  <li><code>{'{{start_of_month}}'}</code> - First day of current month</li>
                  <li><code>{'{{end_of_month}}'}</code> - First day of next month</li>
                  <li><code>{'{{start_of_year}}'}</code> - January 1st of current year</li>
                  <li><code>{'{{end_of_year}}'}</code> - January 1st of next year</li>
                  <li><code>{'{{current_date}}'}</code> - Current timestamp</li>
                </ul>
              </div>
            </Card>
          )}

          <textarea
            style={{ ...textareaStyle, fontFamily: 'monospace', resize: 'vertical', fontSize: '0.875rem' }}
            value={parameters}
            onChange={(e) => setParameters(e.target.value)}
            rows={3}
            placeholder='{}'
          />
          <Text tone="muted" style={{ display: 'block', fontSize: '0.75rem', marginTop: '4px' }}>
            Leave empty <code>{'{}'}</code> to use default parameters
          </Text>
        </div>

        <Button
          onClick={handleExecute}
          disabled={executing || !selectedReportId}
          style={{ minWidth: '150px' }}
        >
          {executing ? (
            <><Spinner size="button" variant="inverted" style={{ marginRight: '8px' }} /> Executing...</>
          ) : 'Execute Report'}
        </Button>
      </Card>

      {error && <Alert tone="danger" style={{ marginTop: '16px' }}>{error}</Alert>}

      {results && (
        <div style={{ marginTop: '16px' }}>
          <h3>Results</h3>
          <ResultsRenderer results={results} />
        </div>
      )}
    </div>
  );
}

// Audit event type options for Select
const AUDIT_EVENT_TYPE_OPTIONS: SelectOption[] = [
  { value: '__all__', label: 'All Events' },
  { value: 'report.list', label: 'Report List' },
  { value: 'report.view', label: 'Report View' },
  { value: 'report.create', label: 'Report Create' },
  { value: 'report.update', label: 'Report Update' },
  { value: 'report.delete', label: 'Report Delete' },
  { value: 'report.execute', label: 'Report Execute' },
  { value: 'schema.view', label: 'Schema View' },
  { value: 'extension.access', label: 'Extension Access' },
  { value: 'tenant.list', label: 'Tenant List' },
  { value: 'tenant.view', label: 'Tenant View' },
  { value: 'tenant.create', label: 'Tenant Create' },
  { value: 'tenant.resend_email', label: 'Resend Email' },
  { value: 'tenant.cancel_subscription', label: 'Cancel Subscription' },
];

// ============================================================================
// Action Menu Component
// ============================================================================

interface ActionMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  icon?: React.ReactNode;
}

interface ActionMenuProps {
  items: ActionMenuItem[];
  disabled?: boolean;
  loading?: boolean;
}

function ActionMenu({ items, disabled, loading }: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-block' }}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled || loading}
        style={{ minWidth: '80px' }}
      >
        {loading ? (
          <><Spinner size="button" style={{ marginRight: '4px' }} /> Working...</>
        ) : (
          <>Actions ▾</>
        )}
      </Button>
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '4px',
            backgroundColor: 'var(--alga-bg, #fff)',
            border: '1px solid var(--alga-border)',
            borderRadius: 'var(--alga-radius, 6px)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            zIndex: 1000,
            minWidth: '160px',
            overflow: 'hidden',
          }}
        >
          {items.map((item, index) => (
            <button
              key={index}
              onClick={() => {
                setIsOpen(false);
                item.onClick();
              }}
              disabled={item.disabled}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '8px 12px',
                border: 'none',
                backgroundColor: 'transparent',
                color: item.danger ? 'var(--alga-danger, #dc2626)' : 'var(--alga-fg)',
                fontSize: '0.875rem',
                textAlign: 'left',
                cursor: item.disabled ? 'not-allowed' : 'pointer',
                opacity: item.disabled ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!item.disabled) {
                  e.currentTarget.style.backgroundColor = 'var(--alga-hover, #f3f4f6)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {item.icon && <span style={{ width: '16px', display: 'flex', alignItems: 'center' }}>{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Tenant Management Types and API
// ============================================================================

interface Tenant {
  tenant: string;
  client_name: string;
  email: string | null;
  portal_domain: string | null;
  subscription_status: string | null;
  created_at: string;
}

interface PendingDeletion {
  deletion_id: string;
  tenant: string;
  tenant_name: string | null;
  trigger_source: string;
  status: string;
  workflow_id: string;
  stats_snapshot: {
    userCount: number;
    activeUserCount: number;
    licenseCount: number;
    ticketCount: number;
    openTicketCount: number;
    invoiceCount: number;
    projectCount: number;
    documentCount: number;
    companyCount: number;
    contactCount: number;
    collectedAt: string;
  } | null;
  confirmation_type: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  deletion_scheduled_for: string | null;
  days_remaining: number | null;
  live_state: {
    step: string;
    status: string;
  } | null;
  created_at: string;
  updated_at: string;
}

type ConfirmationType = 'immediate' | '30_days' | '90_days';

interface TenantManagementResponse<T> {
  success: boolean;
  error?: string;
  data?: T;
  message?: string;
  workflowId?: string;
  tenantId?: string;
  adminUserId?: string;
  email?: string;
  tenantName?: string;
}

// API client for tenant management endpoints
// Uses the internal proxy to avoid CORS issues
async function callTenantManagementApi<T>(
  path: string,
  options: RequestInit = {}
): Promise<TenantManagementResponse<T>> {
  const route = `/api/v1/tenant-management${path}`;

  try {
    // Parse body from options if present
    let body: any = undefined;
    if (options.body && typeof options.body === 'string') {
      try {
        body = JSON.parse(options.body);
      } catch {
        body = options.body;
      }
    }

    const result = await proxyApiCall<any>(route, {
      method: options.method as string || 'GET',
      body,
    });

    // Normalize response format
    if (result && typeof result === 'object') {
      if ('success' in result) {
        return result as TenantManagementResponse<T>;
      }
      if ('data' in result) {
        return { success: true, data: result.data as T };
      }
      return { success: true, data: result as T };
    }
    return { success: true, data: result as T };
  } catch (error) {
    console.error('Tenant Management API call failed:', error);
    return { success: false, error: String(error) };
  }
}

// ============================================================================
// Tenant Management View
// ============================================================================

// Confirmation dialog state type
interface ConfirmAction {
  message: string;
  onConfirm: () => void;
}

function TenantManagementView() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [pendingDeletions, setPendingDeletions] = useState<PendingDeletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [createForm, setCreateForm] = useState({
    companyName: '',
    firstName: '',
    lastName: '',
    email: '',
    licenseCount: 5,
  });
  // Deletion dialog state
  const [showDeletionDialog, setShowDeletionDialog] = useState(false);
  const [selectedTenantForDeletion, setSelectedTenantForDeletion] = useState<Tenant | null>(null);
  const [deletionReason, setDeletionReason] = useState('');
  // Confirm deletion dialog state
  const [showConfirmDeletionDialog, setShowConfirmDeletionDialog] = useState(false);
  const [selectedPendingDeletion, setSelectedPendingDeletion] = useState<PendingDeletion | null>(null);
  const [confirmationType, setConfirmationType] = useState<ConfirmationType>('90_days');
  // Rollback dialog state
  const [showRollbackDialog, setShowRollbackDialog] = useState(false);
  const [rollbackReason, setRollbackReason] = useState('');
  // Export dialog state
  const [showExportResultDialog, setShowExportResultDialog] = useState(false);
  const [exportResult, setExportResult] = useState<{
    status: 'in_progress' | 'completed';
    tenantName: string;
    workflowId?: string;
    downloadUrl?: string;
    urlExpiresAt?: string;
    tableCount?: number;
    recordCount?: number;
    fileSizeBytes?: number;
    message?: string;
  } | null>(null);
  const [exportPollingInterval, setExportPollingInterval] = useState<NodeJS.Timeout | null>(null);

  // Fetch tenants
  const fetchTenants = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await callTenantManagementApi<Tenant[]>('/tenants');
    if (result.success && result.data) {
      setTenants(result.data);
    } else {
      setError(result.error || 'Failed to fetch tenants');
    }
    setLoading(false);
  }, []);

  // Fetch tenant management audit logs (via proxy)
  const fetchAuditLogs = useCallback(async () => {
    try {
      const result = await proxyApiCall<any>(
        '/api/v1/tenant-management/audit?eventTypePrefix=tenant.&limit=50'
      );
      // Handle proxy response format
      const data = result?.data || result;
      if (data && Array.isArray(data)) {
        setAuditLogs(data);
      } else if (result?.success && result?.data) {
        setAuditLogs(result.data);
      }
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    }
  }, []);

  // Fetch pending deletions
  const fetchPendingDeletions = useCallback(async () => {
    try {
      const result = await callTenantManagementApi<PendingDeletion[]>('/pending-deletions');
      if (result.success && result.data) {
        setPendingDeletions(result.data);
      }
    } catch (err) {
      console.error('Failed to fetch pending deletions:', err);
    }
  }, []);

  useEffect(() => {
    fetchTenants();
    fetchAuditLogs();
    fetchPendingDeletions();
  }, [fetchTenants, fetchAuditLogs, fetchPendingDeletions]);

  // Handle resend welcome email
  const handleResendWelcomeEmail = (tenantId: string, tenantName: string) => {
    setConfirmAction({
      message: `Send new welcome email with reset password to admin of "${tenantName}"?`,
      onConfirm: async () => {
        setConfirmAction(null);
        setActionInProgress(tenantId);
        try {
          const result = await callTenantManagementApi<void>('/resend-welcome-email', {
            method: 'POST',
            body: JSON.stringify({ tenantId }),
          });

          if (result.success) {
            setStatusMessage({ type: 'success', text: result.message || `Welcome email sent` });
            fetchAuditLogs();
          } else {
            setStatusMessage({ type: 'error', text: `Failed: ${result.error}` });
          }
        } catch (err) {
          setStatusMessage({ type: 'error', text: `Error: ${err}` });
        } finally {
          setActionInProgress(null);
        }
      },
    });
  };

  // Handle create tenant
  const handleCreateTenant = () => {
    const { companyName, firstName, lastName, email, licenseCount } = createForm;

    if (!companyName.trim() || !firstName.trim() || !lastName.trim() || !email.trim()) {
      setStatusMessage({ type: 'error', text: 'Please fill in all required fields' });
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setStatusMessage({ type: 'error', text: 'Please enter a valid email address' });
      return;
    }

    setConfirmAction({
      message: `Create tenant "${companyName}" with admin user ${email}?`,
      onConfirm: async () => {
        setConfirmAction(null);
        setActionInProgress('create');
        try {
          const result = await callTenantManagementApi<void>('/create-tenant', {
            method: 'POST',
            body: JSON.stringify({
              companyName: companyName.trim(),
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              email: email.trim(),
              licenseCount,
            }),
          });

          if (result.success) {
            setStatusMessage({ type: 'success', text: result.message || `Tenant "${companyName}" created successfully` });
            setShowCreateForm(false);
            setCreateForm({
              companyName: '',
              firstName: '',
              lastName: '',
              email: '',
              licenseCount: 5,
            });
            fetchTenants();
            fetchAuditLogs();
          } else {
            setStatusMessage({ type: 'error', text: `Failed: ${result.error}` });
          }
        } catch (err) {
          setStatusMessage({ type: 'error', text: `Error: ${err}` });
        } finally {
          setActionInProgress(null);
        }
      },
    });
  };

  // Handle start tenant deletion
  const handleStartDeletion = async () => {
    if (!selectedTenantForDeletion) return;

    setActionInProgress(selectedTenantForDeletion.tenant);
    try {
      const result = await callTenantManagementApi<void>('/start-deletion', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: selectedTenantForDeletion.tenant,
          reason: deletionReason.trim() || 'Manual deletion from extension',
          triggerSource: 'admin_extension',
        }),
      });

      if (result.success) {
        setStatusMessage({
          type: 'success',
          text: `Deletion workflow started for "${selectedTenantForDeletion.client_name}". Workflow ID: ${result.workflowId}`,
        });
        setShowDeletionDialog(false);
        setSelectedTenantForDeletion(null);
        setDeletionReason('');
        fetchTenants();
        fetchAuditLogs();
        fetchPendingDeletions();
      } else {
        setStatusMessage({ type: 'error', text: `Failed to start deletion: ${result.error}` });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: `Error: ${err}` });
    } finally {
      setActionInProgress(null);
    }
  };

  // Handle confirm tenant deletion
  const handleConfirmDeletion = async () => {
    if (!selectedPendingDeletion) return;

    setActionInProgress(selectedPendingDeletion.deletion_id);
    try {
      const result = await callTenantManagementApi<void>('/confirm-deletion', {
        method: 'POST',
        body: JSON.stringify({
          workflowId: selectedPendingDeletion.workflow_id,
          confirmationType: confirmationType,
        }),
      });

      if (result.success) {
        const delayText = confirmationType === 'immediate' ? 'immediately' :
          confirmationType === '30_days' ? 'in 30 days' : 'in 90 days';
        setStatusMessage({
          type: 'success',
          text: `Deletion confirmed for "${selectedPendingDeletion.tenant_name}". Data will be deleted ${delayText}.`,
        });
        setShowConfirmDeletionDialog(false);
        setSelectedPendingDeletion(null);
        setConfirmationType('90_days');
        fetchPendingDeletions();
        fetchAuditLogs();
      } else {
        setStatusMessage({ type: 'error', text: `Failed to confirm deletion: ${result.error}` });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: `Error: ${err}` });
    } finally {
      setActionInProgress(null);
    }
  };

  // Handle rollback tenant deletion
  const handleRollbackDeletion = async () => {
    if (!selectedPendingDeletion) return;

    setActionInProgress(selectedPendingDeletion.deletion_id);
    try {
      const result = await callTenantManagementApi<void>('/rollback-deletion', {
        method: 'POST',
        body: JSON.stringify({
          workflowId: selectedPendingDeletion.workflow_id,
          reason: rollbackReason.trim() || 'Rolled back from extension',
        }),
      });

      if (result.success) {
        setStatusMessage({
          type: 'success',
          text: `Deletion rolled back for "${selectedPendingDeletion.tenant_name}". Users have been reactivated.`,
        });
        setShowRollbackDialog(false);
        setSelectedPendingDeletion(null);
        setRollbackReason('');
        fetchTenants();
        fetchPendingDeletions();
        fetchAuditLogs();
      } else {
        setStatusMessage({ type: 'error', text: `Failed to rollback deletion: ${result.error}` });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: `Error: ${err}` });
    } finally {
      setActionInProgress(null);
    }
  };

  // Poll for export status
  const pollExportStatus = async (workflowId: string, tenantName: string) => {
    try {
      const result = await callTenantManagementApi<{
        status: 'pending' | 'in_progress' | 'completed' | 'failed';
        workflowId: string;
        downloadUrl?: string;
        urlExpiresAt?: string;
        tableCount?: number;
        recordCount?: number;
        fileSizeBytes?: number;
        error?: string;
      }>(`/export-status?workflowId=${encodeURIComponent(workflowId)}`);

      if (result.success && result.data) {
        if (result.data.status === 'completed') {
          // Stop polling
          if (exportPollingInterval) {
            clearInterval(exportPollingInterval);
            setExportPollingInterval(null);
          }
          // Update result with completed data
          setExportResult({
            status: 'completed',
            tenantName,
            workflowId,
            downloadUrl: result.data.downloadUrl,
            urlExpiresAt: result.data.urlExpiresAt,
            tableCount: result.data.tableCount,
            recordCount: result.data.recordCount,
            fileSizeBytes: result.data.fileSizeBytes,
          });
          fetchAuditLogs();
        } else if (result.data.status === 'failed') {
          // Stop polling
          if (exportPollingInterval) {
            clearInterval(exportPollingInterval);
            setExportPollingInterval(null);
          }
          setShowExportResultDialog(false);
          setExportResult(null);
          setStatusMessage({ type: 'error', text: `Export failed: ${result.data.error || 'Unknown error'}` });
        }
        // If still in progress, continue polling
      }
    } catch (err) {
      console.error('Error polling export status:', err);
    }
  };

  // Handle export tenant data
  const handleExportTenant = async (tenant: Tenant) => {
    setActionInProgress(tenant.tenant);
    try {
      const result = await callTenantManagementApi<{
        status: 'in_progress' | 'completed';
        workflowId?: string;
        exportId?: string;
        tenantName: string;
        downloadUrl?: string;
        urlExpiresAt?: string;
        tableCount?: number;
        recordCount?: number;
        fileSizeBytes?: number;
        message?: string;
      }>('/export-tenant', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: tenant.tenant,
          reason: 'Manual export from extension',
        }),
      });

      if (result.success && result.data) {
        const data = result.data;

        if (data.status === 'completed') {
          // Export completed immediately
          setExportResult({
            status: 'completed',
            tenantName: data.tenantName || tenant.client_name,
            workflowId: data.workflowId,
            downloadUrl: data.downloadUrl,
            urlExpiresAt: data.urlExpiresAt,
            tableCount: data.tableCount,
            recordCount: data.recordCount,
            fileSizeBytes: data.fileSizeBytes,
          });
          setShowExportResultDialog(true);
          fetchAuditLogs();
        } else if (data.status === 'in_progress' && data.workflowId) {
          // Export is in progress, show dialog and start polling
          setExportResult({
            status: 'in_progress',
            tenantName: data.tenantName || tenant.client_name,
            workflowId: data.workflowId,
            message: data.message || 'Export in progress...',
          });
          setShowExportResultDialog(true);

          // Start polling every 2 seconds
          const interval = setInterval(() => {
            pollExportStatus(data.workflowId!, data.tenantName || tenant.client_name);
          }, 2000);
          setExportPollingInterval(interval);
        } else {
          setStatusMessage({ type: 'error', text: `Unexpected response: ${JSON.stringify(data)}` });
        }
      } else {
        setStatusMessage({ type: 'error', text: `Export failed: ${result.error}` });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: `Error: ${err}` });
    } finally {
      setActionInProgress(null);
    }
  };

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (exportPollingInterval) {
        clearInterval(exportPollingInterval);
      }
    };
  }, [exportPollingInterval]);

  // Check if tenant has a pending deletion
  const hasPendingDeletion = (tenantId: string): boolean => {
    return pendingDeletions.some(
      d => d.tenant === tenantId && !['completed', 'rolled_back'].includes(d.status)
    );
  };

  const getStatusBadgeTone = (status: string | null): 'success' | 'warning' | 'info' | 'danger' => {
    if (!status) return 'info';
    if (status === 'active') return 'success';
    if (status === 'canceled' || status === 'cancelled') return 'danger';
    if (status === 'past_due' || status === 'unpaid') return 'warning';
    return 'info';
  };

  const getDeletionStatusBadgeTone = (status: string): 'success' | 'warning' | 'info' | 'danger' => {
    if (status === 'completed') return 'success';
    if (status === 'rolled_back') return 'info';
    if (status === 'awaiting_confirmation' || status === 'pending_deletion') return 'warning';
    if (status === 'deleting') return 'danger';
    return 'info';
  };

  const getAuditStatusBadgeTone = (status: string | null): 'success' | 'warning' | 'info' | 'danger' => {
    if (!status) return 'info';
    if (status === 'completed') return 'success';
    if (status === 'failed') return 'danger';
    if (status === 'pending' || status === 'running') return 'warning';
    return 'info';
  };

  const tenantColumns: Column<Tenant>[] = [
    {
      key: 'client_name',
      header: 'Tenant Name',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{row.client_name}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--alga-muted-fg)' }}>
            {row.tenant.slice(0, 8)}...
          </div>
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Admin Email',
      render: (row) => (
        <Text style={{ fontSize: '0.875rem' }}>
          {row.email || '—'}
        </Text>
      ),
    },
    {
      key: 'subscription_status',
      header: 'Status',
      render: (row) => (
        <Badge tone={getStatusBadgeTone(row.subscription_status)}>
          {row.subscription_status || 'No subscription'}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      render: (row) => (
        <Text tone="muted" style={{ fontSize: '0.875rem' }}>
          {new Date(row.created_at).toLocaleDateString()}
        </Text>
      ),
    },
    {
      key: 'tenant',
      header: 'Actions',
      sortable: false,
      render: (row) => {
        const isPending = hasPendingDeletion(row.tenant);
        const menuItems: ActionMenuItem[] = [
          {
            label: 'Resend Welcome Email',
            onClick: () => handleResendWelcomeEmail(row.tenant, row.client_name),
          },
          {
            label: 'Export Data',
            onClick: () => handleExportTenant(row),
          },
          {
            label: isPending ? 'Deletion in Progress...' : 'Delete Tenant',
            onClick: () => {
              setSelectedTenantForDeletion(row);
              setShowDeletionDialog(true);
            },
            disabled: isPending,
            danger: !isPending,
          },
        ];

        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ActionMenu
              items={menuItems}
              loading={actionInProgress === row.tenant}
            />
            {isPending && (
              <Badge tone="warning" style={{ fontSize: '0.7rem' }}>
                Deleting
              </Badge>
            )}
          </div>
        );
      },
    },
  ];

  const auditColumns: Column<AuditLogEntry>[] = [
    {
      key: 'created_at',
      header: 'Time',
      width: '20%',
      render: (row) => (
        <Text style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
          {new Date(row.created_at).toLocaleString()}
        </Text>
      ),
    },
    {
      key: 'event_type',
      header: 'Event',
      width: '15%',
      render: (row) => {
        const getTone = (type: string): 'success' | 'warning' | 'info' | 'danger' => {
          if (type.includes('create')) return 'success';
          if (type.includes('delete') || type.includes('cancel')) return 'danger';
          return 'info';
        };
        return (
          <Badge tone={getTone(row.event_type)}>
            {row.event_type.replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </Badge>
        );
      },
    },
    {
      key: 'user_email',
      header: 'User',
      width: '25%',
      render: (row) => (
        <Text style={{ fontSize: '0.8125rem', wordBreak: 'break-word' }}>
          {row.user_email || 'System'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '15%',
      render: (row) => row.status ? (
        <Badge tone={getAuditStatusBadgeTone(row.status)}>
          {row.status}
        </Badge>
      ) : null,
    },
    {
      key: 'resource_name',
      header: 'Target',
      width: '25%',
      render: (row) => (
        <Text style={{ fontSize: '0.8125rem', wordBreak: 'break-word' }}>
          {row.resource_name || row.resource_id?.slice(0, 8) || '—'}
        </Text>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0 }}>Tenant Management</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="secondary" onClick={() => { fetchTenants(); fetchAuditLogs(); fetchPendingDeletions(); }} disabled={loading}>
            {loading ? <><Spinner size="button" style={{ marginRight: '6px' }} /> Loading...</> : 'Refresh'}
          </Button>
          <Button onClick={() => setShowCreateForm(true)}>
            Create Tenant
          </Button>
        </div>
      </div>

      {error && <Alert tone="danger" style={{ marginBottom: '16px' }}>{error}</Alert>}

      {/* Status Message */}
      {statusMessage && (
        <Alert
          tone={statusMessage.type === 'success' ? 'success' : 'danger'}
          style={{ marginBottom: '16px' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{statusMessage.text}</span>
            <Button variant="ghost" size="sm" onClick={() => setStatusMessage(null)}>✕</Button>
          </div>
        </Alert>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!confirmAction}
        title="Confirm Action"
        message={confirmAction?.message || ''}
        onConfirm={() => confirmAction?.onConfirm()}
        onCancel={() => setConfirmAction(null)}
      />

      {/* Create Tenant Form */}
      {showCreateForm && (
        <Card style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>Create New Tenant</h3>
            <Button variant="ghost" size="sm" onClick={() => setShowCreateForm(false)}>✕</Button>
          </div>

          <div style={{ display: 'grid', gap: '16px' }}>
            <div>
              <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Company Name *</Text>
              <Input
                type="text"
                value={createForm.companyName}
                onChange={(e) => setCreateForm({ ...createForm, companyName: e.target.value })}
                placeholder="Acme Inc."
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Admin First Name *</Text>
                <Input
                  type="text"
                  value={createForm.firstName}
                  onChange={(e) => setCreateForm({ ...createForm, firstName: e.target.value })}
                  placeholder="John"
                />
              </div>
              <div>
                <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Admin Last Name *</Text>
                <Input
                  type="text"
                  value={createForm.lastName}
                  onChange={(e) => setCreateForm({ ...createForm, lastName: e.target.value })}
                  placeholder="Doe"
                />
              </div>
            </div>

            <div>
              <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Admin Email *</Text>
              <Input
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                placeholder="admin@company.com"
              />
            </div>

            <div>
              <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Licensed Users</Text>
              <Input
                type="number"
                min={1}
                value={createForm.licenseCount}
                onChange={(e) => setCreateForm({ ...createForm, licenseCount: parseInt(e.target.value) || 5 })}
              />
              <Text tone="muted" style={{ fontSize: '0.75rem', marginTop: '4px' }}>
                Number of licensed users for the tenant
              </Text>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <Button variant="secondary" onClick={() => setShowCreateForm(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateTenant}
                disabled={actionInProgress === 'create'}
              >
                {actionInProgress === 'create' ? 'Creating...' : 'Create Tenant'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Tenants List */}
      <Card style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0 }}>Tenants</h3>
          <div style={{ width: '300px' }}>
            <Input
              type="text"
              placeholder="Search tenants..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        {loading ? (
          <LoadingIndicator size="sm" text="Loading tenants..." />
        ) : tenants.length === 0 ? (
          <Text tone="muted">No tenants found.</Text>
        ) : (
          <>
            {(() => {
              const filteredTenants = searchQuery.trim()
                ? tenants.filter(t => {
                    const query = searchQuery.toLowerCase();
                    return t.client_name.toLowerCase().includes(query) ||
                      t.tenant.toLowerCase().includes(query) ||
                      (t.email && t.email.toLowerCase().includes(query));
                  })
                : tenants;

              return filteredTenants.length === 0 ? (
                <Text tone="muted">No tenants match "{searchQuery}"</Text>
              ) : (
                <DataTable
                  columns={tenantColumns}
                  data={filteredTenants}
                  paginate
                  defaultPageSize={10}
                  initialSortKey="client_name"
                />
              );
            })()}
          </>
        )}
      </Card>

      {/* Pending Deletions Section */}
      {pendingDeletions.length > 0 && (
        <Card style={{ marginBottom: '20px' }}>
          <h3 style={{ marginTop: 0, marginBottom: '16px', color: 'var(--alga-warning)' }}>
            Pending Deletions ({pendingDeletions.filter(d => !['completed', 'rolled_back'].includes(d.status)).length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {pendingDeletions
              .filter(d => !['completed', 'rolled_back'].includes(d.status))
              .map((deletion) => (
                <div
                  key={deletion.deletion_id}
                  style={{
                    padding: '12px',
                    border: '1px solid var(--alga-border)',
                    borderRadius: '8px',
                    backgroundColor: 'var(--alga-surface)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div>
                      <Text style={{ fontWeight: 600 }}>{deletion.tenant_name || deletion.tenant}</Text>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                        <Badge tone={getDeletionStatusBadgeTone(deletion.status)}>
                          {deletion.status.replace(/_/g, ' ')}
                        </Badge>
                        <Badge tone="info">
                          {deletion.trigger_source === 'stripe_webhook' ? 'Stripe' : 'Manual'}
                        </Badge>
                        {deletion.days_remaining !== null && (
                          <Badge tone={deletion.days_remaining <= 7 ? 'danger' : 'warning'}>
                            {deletion.days_remaining} days remaining
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {deletion.status === 'awaiting_confirmation' && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            setSelectedPendingDeletion(deletion);
                            setShowConfirmDeletionDialog(true);
                          }}
                          disabled={actionInProgress === deletion.deletion_id}
                        >
                          Confirm
                        </Button>
                      )}
                      {['awaiting_confirmation', 'pending_deletion'].includes(deletion.status) && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setSelectedPendingDeletion(deletion);
                            setShowRollbackDialog(true);
                          }}
                          disabled={actionInProgress === deletion.deletion_id}
                        >
                          Rollback
                        </Button>
                      )}
                    </div>
                  </div>
                  {deletion.stats_snapshot && (
                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '0.8125rem', color: 'var(--alga-muted-fg)' }}>
                      <span>Users: {deletion.stats_snapshot.userCount} ({deletion.stats_snapshot.activeUserCount} active)</span>
                      <span>Tickets: {deletion.stats_snapshot.ticketCount} ({deletion.stats_snapshot.openTicketCount} open)</span>
                      <span>Invoices: {deletion.stats_snapshot.invoiceCount}</span>
                      <span>Projects: {deletion.stats_snapshot.projectCount}</span>
                    </div>
                  )}
                  <Text tone="muted" style={{ fontSize: '0.75rem', marginTop: '8px' }}>
                    Started: {new Date(deletion.created_at).toLocaleString()}
                    {deletion.confirmed_at && ` | Confirmed: ${new Date(deletion.confirmed_at).toLocaleString()}`}
                  </Text>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Start Deletion Dialog */}
      <ConfirmDialog
        isOpen={showDeletionDialog}
        title="Start Tenant Deletion"
        message={`Are you sure you want to start the deletion process for "${selectedTenantForDeletion?.client_name}"? This will:\n\n• Deactivate all users\n• Cancel Stripe subscription (if active)\n• Tag the client as "Canceled"\n\nThe tenant will not be deleted immediately - you'll need to confirm the deletion timing.`}
        onConfirm={handleStartDeletion}
        onCancel={() => {
          setShowDeletionDialog(false);
          setSelectedTenantForDeletion(null);
          setDeletionReason('');
        }}
        confirmText={actionInProgress === selectedTenantForDeletion?.tenant ? 'Starting...' : 'Start Deletion'}
        confirmDisabled={actionInProgress === selectedTenantForDeletion?.tenant}
      >
        <div style={{ marginTop: '12px' }}>
          <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Reason (optional)</Text>
          <Input
            type="text"
            value={deletionReason}
            onChange={(e) => setDeletionReason(e.target.value)}
            placeholder="e.g., Customer requested cancellation"
          />
        </div>
      </ConfirmDialog>

      {/* Confirm Deletion Timing Dialog */}
      <ConfirmDialog
        isOpen={showConfirmDeletionDialog}
        title="Confirm Deletion Timing"
        message={`Choose when to permanently delete all data for "${selectedPendingDeletion?.tenant_name}".`}
        onConfirm={handleConfirmDeletion}
        onCancel={() => {
          setShowConfirmDeletionDialog(false);
          setSelectedPendingDeletion(null);
          setConfirmationType('90_days');
        }}
        confirmText={actionInProgress === selectedPendingDeletion?.deletion_id ? 'Confirming...' : 'Confirm Deletion'}
        confirmDisabled={actionInProgress === selectedPendingDeletion?.deletion_id}
      >
        <div style={{ marginTop: '12px' }}>
          <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Deletion Timing</Text>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="confirmationType"
                value="90_days"
                checked={confirmationType === '90_days'}
                onChange={() => setConfirmationType('90_days')}
              />
              <span>90 days (recommended for data retention compliance)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="confirmationType"
                value="30_days"
                checked={confirmationType === '30_days'}
                onChange={() => setConfirmationType('30_days')}
              />
              <span>30 days</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--alga-danger)' }}>
              <input
                type="radio"
                name="confirmationType"
                value="immediate"
                checked={confirmationType === 'immediate'}
                onChange={() => setConfirmationType('immediate')}
              />
              <span>Immediately (irreversible!)</span>
            </label>
          </div>
          {selectedPendingDeletion?.stats_snapshot && (
            <Alert tone="warning" style={{ marginTop: '12px' }}>
              <Text style={{ fontWeight: 500 }}>Data to be deleted:</Text>
              <ul style={{ margin: '8px 0 0', paddingLeft: '20px' }}>
                <li>{selectedPendingDeletion.stats_snapshot.userCount} users</li>
                <li>{selectedPendingDeletion.stats_snapshot.ticketCount} tickets</li>
                <li>{selectedPendingDeletion.stats_snapshot.invoiceCount} invoices</li>
                <li>{selectedPendingDeletion.stats_snapshot.projectCount} projects</li>
                <li>{selectedPendingDeletion.stats_snapshot.documentCount} documents</li>
              </ul>
            </Alert>
          )}
        </div>
      </ConfirmDialog>

      {/* Rollback Deletion Dialog */}
      <ConfirmDialog
        isOpen={showRollbackDialog}
        title="Rollback Deletion"
        message={`Are you sure you want to rollback the deletion for "${selectedPendingDeletion?.tenant_name}"? This will:\n\n• Reactivate all users\n• Remove the "Canceled" tag\n• Cancel the scheduled deletion`}
        onConfirm={handleRollbackDeletion}
        onCancel={() => {
          setShowRollbackDialog(false);
          setSelectedPendingDeletion(null);
          setRollbackReason('');
        }}
        confirmText={actionInProgress === selectedPendingDeletion?.deletion_id ? 'Rolling back...' : 'Rollback'}
        confirmDisabled={actionInProgress === selectedPendingDeletion?.deletion_id}
      >
        <div style={{ marginTop: '12px' }}>
          <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Reason (optional)</Text>
          <Input
            type="text"
            value={rollbackReason}
            onChange={(e) => setRollbackReason(e.target.value)}
            placeholder="e.g., Customer renewed subscription"
          />
        </div>
      </ConfirmDialog>

      {/* Export Result Dialog */}
      <ConfirmDialog
        isOpen={showExportResultDialog}
        title={exportResult?.status === 'in_progress' ? 'Export In Progress' : 'Export Complete'}
        message={exportResult ? (
          exportResult.status === 'in_progress'
            ? `Exporting data for "${exportResult.tenantName}"...`
            : `Successfully exported data for "${exportResult.tenantName}".`
        ) : ''}
        onConfirm={() => {
          if (exportResult?.status === 'completed' && exportResult?.downloadUrl) {
            window.open(exportResult.downloadUrl, '_blank');
          }
          if (exportResult?.status === 'completed') {
            setShowExportResultDialog(false);
            setExportResult(null);
          }
        }}
        onCancel={() => {
          // Stop polling if in progress
          if (exportPollingInterval) {
            clearInterval(exportPollingInterval);
            setExportPollingInterval(null);
          }
          setShowExportResultDialog(false);
          setExportResult(null);
        }}
        confirmText={exportResult?.status === 'in_progress' ? 'Please wait...' : 'Download'}
        cancelLabel="Close"
        confirmDisabled={exportResult?.status === 'in_progress'}
      >
        {exportResult && exportResult.status === 'in_progress' && (
          <div style={{ marginTop: '12px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
            }}>
              <Spinner size="sm" />
            </div>
            <Alert tone="info">
              Large exports may take a few minutes. You can close this dialog and check the audit log for status.
            </Alert>
          </div>
        )}
        {exportResult && exportResult.status === 'completed' && (
          <div style={{ marginTop: '12px' }}>
            <div style={{
              backgroundColor: 'var(--alga-surface)',
              border: '1px solid var(--alga-border)',
              borderRadius: '8px',
              padding: '12px',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.875rem' }}>
                <div>
                  <Text tone="muted">Tables:</Text>
                  <Text style={{ fontWeight: 500 }}>{exportResult.tableCount ?? '-'}</Text>
                </div>
                <div>
                  <Text tone="muted">Records:</Text>
                  <Text style={{ fontWeight: 500 }}>{exportResult.recordCount?.toLocaleString() ?? '-'}</Text>
                </div>
                <div>
                  <Text tone="muted">File Size:</Text>
                  <Text style={{ fontWeight: 500 }}>{exportResult.fileSizeBytes ? ((exportResult.fileSizeBytes / 1024 / 1024).toFixed(2) + ' MB') : '-'}</Text>
                </div>
                <div>
                  <Text tone="muted">Expires:</Text>
                  <Text style={{ fontWeight: 500 }}>{exportResult.urlExpiresAt ? new Date(exportResult.urlExpiresAt).toLocaleTimeString() : '-'}</Text>
                </div>
              </div>
            </div>
            <Alert tone="info" style={{ marginTop: '12px' }}>
              The download link expires in 1 hour. Click "Download" to save the export file.
            </Alert>
          </div>
        )}
      </ConfirmDialog>

      {/* Recent Actions (Audit Log) */}
      <Card>
        <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Recent Actions</h3>
        {auditLogs.length === 0 ? (
          <Text tone="muted">No recent tenant management actions.</Text>
        ) : (
          <DataTable
            columns={auditColumns}
            data={auditLogs}
            paginate
            defaultPageSize={5}
          />
        )}
      </Card>
    </div>
  );
}

function AuditLogs() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventTypeFilter, setEventTypeFilter] = useState('__all__');
  const [resourceIdFilter, setResourceIdFilter] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (eventTypeFilter && eventTypeFilter !== '__all__') params.set('eventType', eventTypeFilter);
    if (resourceIdFilter) params.set('resourceId', resourceIdFilter);
    // Fetch up to 500 logs, let DataTable handle pagination display
    params.set('limit', '500');

    const queryString = params.toString();
    const path = queryString ? `/audit?${queryString}` : '/audit';

    console.log('[AuditLogs] Fetching from path:', path);
    const result = await callExtensionApi<AuditLogEntry[]>(path);
    console.log('[AuditLogs] API result:', result);

    if (result.success && result.data) {
      console.log('[AuditLogs] Setting logs:', result.data.length, 'entries');
      setLogs(result.data);
    } else {
      console.error('[AuditLogs] Error:', result.error);
      setError(result.error || 'Failed to fetch audit logs');
    }
    setLoading(false);
  }, [eventTypeFilter, resourceIdFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const formatEventType = (type: string): string => {
    return type
      .replace(/\./g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  };

  const getEventBadgeTone = (type: string): 'success' | 'warning' | 'info' | 'danger' => {
    if (type.includes('create')) return 'success';
    if (type.includes('delete')) return 'danger';
    if (type.includes('update')) return 'warning';
    return 'info';
  };

  const columns: Column<AuditLogEntry>[] = [
    {
      key: 'created_at',
      header: 'Time',
      width: '15%',
      render: (row) => (
        <Text style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
          {new Date(row.created_at).toLocaleString()}
        </Text>
      ),
    },
    {
      key: 'event_type',
      header: 'Event',
      width: '12%',
      render: (row) => (
        <Badge tone={getEventBadgeTone(row.event_type)}>
          {formatEventType(row.event_type)}
        </Badge>
      ),
    },
    {
      key: 'user_email',
      header: 'User',
      width: '20%',
      render: (row) => (
        <div>
          {row.user_email ? (
            <>
              <div style={{ fontWeight: 500, wordBreak: 'break-word' }}>{row.user_email}</div>
              {row.user_id && (
                <div style={{ fontSize: '0.75rem', color: 'var(--alga-muted-fg)' }}>
                  {row.user_id.slice(0, 8)}...
                </div>
              )}
            </>
          ) : (
            <Text tone="muted">System</Text>
          )}
        </div>
      ),
    },
    {
      key: 'resource_name',
      header: 'Resource',
      width: '18%',
      render: (row) => row.resource_name ? (
        <div>
          <div style={{ fontWeight: 500, wordBreak: 'break-word' }}>{row.resource_name}</div>
          <div style={{ display: 'flex', gap: '8px', fontSize: '0.75rem', color: 'var(--alga-muted-fg)' }}>
            {row.resource_type && <span>{row.resource_type}</span>}
            {row.resource_id && <span>{row.resource_id.slice(0, 8)}...</span>}
          </div>
        </div>
      ) : (
        <Text tone="muted">—</Text>
      ),
    },
    {
      key: 'details',
      header: 'Details',
      width: '25%',
      render: (row) => row.details ? (
        <details style={{ fontSize: '0.8125rem' }}>
          <summary style={{
            cursor: 'pointer',
            color: 'var(--alga-primary-foreground)',
            fontWeight: 500,
            padding: '6px 10px',
            background: 'var(--alga-primary)',
            borderRadius: 'var(--alga-radius, 8px)',
            display: 'inline-block',
            fontSize: '12px',
          }}>
            View
          </summary>
          <pre style={{
            marginTop: '8px',
            fontSize: '0.75rem',
            background: 'var(--alga-bg)',
            color: 'var(--alga-fg)',
            padding: '12px',
            borderRadius: 'var(--alga-radius, 6px)',
            overflow: 'auto',
            maxHeight: '200px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            border: '1px solid var(--alga-border)',
          }}>
            {JSON.stringify(row.details, null, 2)}
          </pre>
        </details>
      ) : (
        <Text tone="muted">—</Text>
      ),
    },
    {
      key: 'ip_address',
      header: 'IP',
      width: '10%',
      render: (row) => (
        <Text tone="muted" style={{ fontSize: '0.75rem' }}>
          {row.ip_address || '—'}
        </Text>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0 }}>Audit Logs</h2>
        <Button variant="secondary" onClick={fetchLogs} disabled={loading}>
          {loading ? <><Spinner size="button" style={{ marginRight: '6px' }} /> Loading...</> : 'Refresh'}
        </Button>
      </div>

      <Card style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: '200px' }}>
            <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Event Type</Text>
            <CustomSelect
              options={AUDIT_EVENT_TYPE_OPTIONS}
              value={eventTypeFilter}
              onValueChange={setEventTypeFilter}
            />
          </div>
          <div style={{ minWidth: '200px' }}>
            <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Resource ID</Text>
            <Input
              type="text"
              value={resourceIdFilter}
              onChange={(e) => setResourceIdFilter(e.target.value)}
              placeholder="Filter by resource ID..."
            />
          </div>
        </div>
      </Card>

      {error && <Alert tone="danger" style={{ marginBottom: '16px' }}>{error}</Alert>}

      {loading ? (
        <LoadingIndicator size="sm" text="Loading audit logs..." />
      ) : logs.length === 0 ? (
        <Card>
          <Text tone="muted">
            No audit logs found. Activity will be recorded here when reports are accessed.
          </Text>
        </Card>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={logs}
            paginate
            defaultPageSize={25}
            pageSizeOptions={[25, 50, 100, 200]}
            initialSortKey="created_at"
            initialSortDir="desc"
          />
          <Text tone="muted" style={{ display: 'block', marginTop: '8px', fontSize: '0.75rem' }}>
            Total: {logs.length} log entries (use page size selector below to show more per page)
          </Text>
        </>
      )}
    </div>
  );
}

// Edit Report component
function EditReport({
  report,
  onBack,
  onSave,
}: {
  report: PlatformReport;
  onBack: () => void;
  onSave: () => void;
}) {
  const [name, setName] = useState(report.name);
  const [description, setDescription] = useState(report.description || '');
  const [category, setCategory] = useState(report.category || '');
  const [isActive, setIsActive] = useState(report.is_active);
  const [metrics, setMetrics] = useState<MetricDefinition[]>(
    report.report_definition.metrics || []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use dynamic schema from server
  const { tables, tableOptions, getTableColumns, loading: schemaLoading } = useSchema();

  // Track which metrics are in "raw SQL" mode
  const [rawSqlMode, setRawSqlMode] = useState<{ [key: string]: boolean }>({});
  const [rawSqlText, setRawSqlText] = useState<{ [key: string]: string }>({});
  // Table search filter
  const [tableSearch, setTableSearch] = useState('');

  // Filtered table options based on search
  const filteredTableOptions = tableOptions.filter(opt =>
    opt.label.toLowerCase().includes(tableSearch.toLowerCase())
  );

  const updateMetric = (index: number, updates: Partial<MetricDefinition>) => {
    const newMetrics = [...metrics];
    newMetrics[index] = { ...newMetrics[index], ...updates };
    setMetrics(newMetrics);
  };

  const updateQuery = (index: number, updates: Partial<QueryDefinition>) => {
    const newMetrics = [...metrics];
    newMetrics[index] = {
      ...newMetrics[index],
      query: { ...newMetrics[index].query, ...updates },
    };
    setMetrics(newMetrics);
  };

  const removeMetric = (index: number) => {
    setMetrics(metrics.filter((_, i) => i !== index));
  };

  const addMetric = () => {
    const defaultTable = tables.length > 0 ? tables[0].name : '';
    setMetrics([
      ...metrics,
      {
        id: `metric_${Date.now()}`,
        name: '',
        type: 'count',
        query: {
          table: defaultTable,
          fields: ['COUNT(*) as count'],
          filters: [],
          groupBy: [],
        },
      },
    ]);
  };

  const addFilter = (metricIndex: number) => {
    const newMetrics = [...metrics];
    const filters = [...(newMetrics[metricIndex].query.filters || [])];
    filters.push({ field: '', operator: 'eq', value: '' });
    newMetrics[metricIndex].query.filters = filters;
    setMetrics(newMetrics);
  };

  const updateFilter = (metricIndex: number, filterIndex: number, updates: Partial<FilterDefinition>) => {
    const newMetrics = [...metrics];
    const filters = [...(newMetrics[metricIndex].query.filters || [])];
    filters[filterIndex] = { ...filters[filterIndex], ...updates };
    newMetrics[metricIndex].query.filters = filters;
    setMetrics(newMetrics);
  };

  const removeFilter = (metricIndex: number, filterIndex: number) => {
    const newMetrics = [...metrics];
    newMetrics[metricIndex].query.filters = (newMetrics[metricIndex].query.filters || [])
      .filter((_, i) => i !== filterIndex);
    setMetrics(newMetrics);
  };

  const addJoin = (metricIndex: number) => {
    const newMetrics = [...metrics];
    const joins = [...(newMetrics[metricIndex].query.joins || [])];
    const defaultTable = tables.length > 0 ? tables[0].name : '';
    joins.push({
      type: 'left',
      table: defaultTable,
      on: [{ left: '', right: '' }],
    });
    newMetrics[metricIndex].query.joins = joins;
    setMetrics(newMetrics);
  };

  const updateJoin = (metricIndex: number, joinIndex: number, updates: Partial<JoinDefinition>) => {
    const newMetrics = [...metrics];
    const joins = [...(newMetrics[metricIndex].query.joins || [])];
    joins[joinIndex] = { ...joins[joinIndex], ...updates };
    newMetrics[metricIndex].query.joins = joins;
    setMetrics(newMetrics);
  };

  const updateJoinCondition = (
    metricIndex: number,
    joinIndex: number,
    conditionIndex: number,
    updates: Partial<JoinCondition>
  ) => {
    const newMetrics = [...metrics];
    const joins = [...(newMetrics[metricIndex].query.joins || [])];
    const conditions = [...joins[joinIndex].on];
    conditions[conditionIndex] = { ...conditions[conditionIndex], ...updates };
    joins[joinIndex] = { ...joins[joinIndex], on: conditions };
    newMetrics[metricIndex].query.joins = joins;
    setMetrics(newMetrics);
  };

  const addJoinCondition = (metricIndex: number, joinIndex: number) => {
    const newMetrics = [...metrics];
    const joins = [...(newMetrics[metricIndex].query.joins || [])];
    joins[joinIndex] = {
      ...joins[joinIndex],
      on: [...joins[joinIndex].on, { left: '', right: '' }],
    };
    newMetrics[metricIndex].query.joins = joins;
    setMetrics(newMetrics);
  };

  const removeJoinCondition = (metricIndex: number, joinIndex: number, conditionIndex: number) => {
    const newMetrics = [...metrics];
    const joins = [...(newMetrics[metricIndex].query.joins || [])];
    joins[joinIndex] = {
      ...joins[joinIndex],
      on: joins[joinIndex].on.filter((_, i) => i !== conditionIndex),
    };
    newMetrics[metricIndex].query.joins = joins;
    setMetrics(newMetrics);
  };

  const removeJoin = (metricIndex: number, joinIndex: number) => {
    const newMetrics = [...metrics];
    newMetrics[metricIndex].query.joins = (newMetrics[metricIndex].query.joins || [])
      .filter((_, i) => i !== joinIndex);
    setMetrics(newMetrics);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    if (!name.trim()) {
      setError('Report name is required');
      setSaving(false);
      return;
    }

    const updatedDefinition: ReportDefinition = {
      ...report.report_definition,
      name,
      description,
      category,
      metrics,
    };

    const result = await callExtensionApi(`/${report.report_id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name,
        description: description || null,
        category: category || null,
        is_active: isActive,
        report_definition: updatedDefinition,
      }),
    });

    if (result.success) {
      onSave();
      onBack();
    } else {
      setError(result.error || 'Failed to update report');
    }
    setSaving(false);
  };

  // Get all field options from base table + all joined tables (for filters)
  const getAllFieldOptions = (metric: MetricDefinition): SelectOption[] => {
    const options: SelectOption[] = [];

    // Base table columns
    if (metric.query.table) {
      getTableColumns(metric.query.table).forEach(col => {
        options.push({ value: col, label: col });
      });
    }

    // Joined table columns (with table prefix)
    (metric.query.joins || []).forEach(join => {
      if (join.table) {
        getTableColumns(join.table).forEach(col => {
          const fullCol = `${join.table}.${col}`;
          options.push({ value: fullCol, label: fullCol });
        });
      }
    });

    return options;
  };

  // Get all columns from base table AND all joined tables
  const getAllMetricColumns = (metric: MetricDefinition): { table: string; columns: string[] }[] => {
    const result: { table: string; columns: string[] }[] = [];

    // Base table columns
    if (metric.query.table) {
      result.push({
        table: metric.query.table,
        columns: getTableColumns(metric.query.table),
      });
    }

    // Joined table columns
    (metric.query.joins || []).forEach(join => {
      if (join.table) {
        result.push({
          table: join.table,
          columns: getTableColumns(join.table),
        });
      }
    });

    return result;
  };

  return (
    <div>
      <Button
        variant="ghost"
        style={{ marginBottom: '20px' }}
        onClick={onBack}
      >
        ← Back to Report
      </Button>

      <h2 style={{ marginTop: 0 }}>Edit Report</h2>

      <Card style={{ marginBottom: '16px' }}>
        <h3 style={{ marginTop: 0 }}>Basic Information</h3>

        <div style={{ marginBottom: '16px' }}>
          <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Report Name *</Text>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Tenant User Summary"
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Description</Text>
          <textarea
            style={{ ...textareaStyle, resize: 'vertical' }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what this report shows..."
            rows={3}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Category</Text>
          <CategorySelect value={category} onChange={setCategory} />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <Text style={{ fontWeight: 500 }}>Active</Text>
          </label>
          <Text tone="muted" style={{ display: 'block', fontSize: '0.75rem', marginTop: '4px' }}>
            Inactive reports cannot be executed
          </Text>
        </div>
      </Card>

      <Card style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0 }}>Metrics</h3>
          <Button type="button" variant="secondary" onClick={addMetric}>
            + Add Metric
          </Button>
        </div>

        {metrics.length === 0 ? (
          <Text tone="muted">
            No metrics defined. Click "Add Metric" to add one.
          </Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {metrics.map((metric, index) => (
              <Card
                key={metric.id}
                style={{ background: 'var(--alga-card-bg)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <strong>Metric {index + 1}</strong>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => removeMetric(index)}
                  >
                    Remove
                  </Button>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Metric Name</Text>
                  <Input
                    type="text"
                    value={metric.name}
                    onChange={(e) => updateMetric(index, { name: e.target.value })}
                    placeholder="e.g., Active Users Count"
                    style={{ width: '100%' }}
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Metric Type</Text>
                  <CustomSelect
                    options={METRIC_TYPE_OPTIONS}
                    value={metric.type}
                    onValueChange={(value) => updateMetric(index, { type: value as 'count' | 'sum' | 'avg' | 'query' })}
                  />
                </div>

                {/* Mode Toggle: Builder vs Raw SQL */}
                <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <Text style={{ fontWeight: 500, fontSize: '0.875rem' }}>Mode:</Text>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <Button
                      type="button"
                      variant={!rawSqlMode[metric.id] ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => setRawSqlMode(prev => ({ ...prev, [metric.id]: false }))}
                    >
                      Builder
                    </Button>
                    <Button
                      type="button"
                      variant={rawSqlMode[metric.id] ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => {
                        setRawSqlMode(prev => ({ ...prev, [metric.id]: true }));
                        // Initialize raw SQL from current query if not set
                        if (!rawSqlText[metric.id]) {
                          const fields = metric.query.fields.join(', ') || '*';
                          const from = metric.query.table || 'table_name';
                          let sql = `SELECT ${fields}\nFROM ${from}`;
                          if ((metric.query.joins || []).length > 0) {
                            metric.query.joins!.forEach(j => {
                              const joinType = j.type.toUpperCase();
                              const onClauses = j.on.map(c => `${c.left} = ${c.right}`).join(' AND ');
                              sql += `\n${joinType} JOIN ${j.table} ON ${onClauses}`;
                            });
                          }
                          if ((metric.query.filters || []).length > 0) {
                            const whereClause = metric.query.filters!.map(f => `${f.field} ${f.operator} '${f.value}'`).join(' AND ');
                            sql += `\nWHERE ${whereClause}`;
                          }
                          if ((metric.query.groupBy || []).length > 0) {
                            sql += `\nGROUP BY ${metric.query.groupBy!.join(', ')}`;
                          }
                          setRawSqlText(prev => ({ ...prev, [metric.id]: sql }));
                        }
                      }}
                    >
                      Raw SQL
                    </Button>
                  </div>
                  <Text tone="muted" style={{ fontSize: '0.7rem', marginLeft: '8px' }}>
                    {rawSqlMode[metric.id] ? 'Write SQL directly' : 'Point-and-click query builder'}
                  </Text>
                </div>

                {rawSqlMode[metric.id] ? (
                  /* Raw SQL Mode */
                  <div style={{ marginBottom: '16px' }}>
                    <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>SQL Query</Text>
                    <textarea
                      value={rawSqlText[metric.id] || ''}
                      onChange={(e) => {
                        setRawSqlText(prev => ({ ...prev, [metric.id]: e.target.value }));
                        // Store raw SQL in the query as a custom field
                        updateQuery(index, {
                          table: 'raw_sql',
                          fields: [e.target.value],
                        });
                      }}
                      placeholder="SELECT column1, column2&#10;FROM table_name&#10;WHERE condition&#10;GROUP BY column1"
                      style={{
                        width: '100%',
                        minHeight: '200px',
                        fontFamily: 'monospace',
                        fontSize: '0.875rem',
                        padding: '12px',
                        border: '1px solid var(--alga-border)',
                        borderRadius: 'var(--alga-radius)',
                        background: '#1f2937',
                        color: '#f9fafb',
                        resize: 'vertical',
                      }}
                    />
                    <Text tone="muted" style={{ display: 'block', fontSize: '0.7rem', marginTop: '4px' }}>
                      Write your SQL query. Only SELECT statements are allowed. Blocked tables and columns will be rejected.
                    </Text>
                  </div>
                ) : (
                  /* Builder Mode */
                  <>
                <div style={{ marginBottom: '16px' }}>
                  <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Table</Text>
                  <Input
                    type="text"
                    placeholder="Search tables..."
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    style={{ marginBottom: '6px' }}
                  />
                  <CustomSelect
                    options={filteredTableOptions}
                    value={metric.query.table}
                    onValueChange={(value) => updateQuery(index, { table: value, fields: ['COUNT(*) as count'] })}
                    disabled={schemaLoading}
                  />
                  {schemaLoading && (
                    <LoadingIndicator size="xs" text="Loading available tables..." style={{ marginTop: '4px' }} />
                  )}
                  {!schemaLoading && filteredTableOptions.length === 0 && tableSearch && (
                    <Text tone="muted" style={{ display: 'block', fontSize: '0.75rem', marginTop: '4px' }}>
                      No tables match "{tableSearch}"
                    </Text>
                  )}
                </div>

                {/* Joins Section */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <Text style={{ fontWeight: 500 }}>Joins</Text>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => addJoin(index)}
                    >
                      + Add Join
                    </Button>
                  </div>

                  {(metric.query.joins || []).length === 0 ? (
                    <Text tone="muted" style={{ fontSize: '0.75rem' }}>
                      No joins. Add a join to query data from multiple tables.
                    </Text>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {(metric.query.joins || []).map((join, joinIndex) => (
                        <Card key={joinIndex} style={{ background: 'var(--alga-muted)', padding: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <Badge tone="info">Join {joinIndex + 1}</Badge>
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              onClick={() => removeJoin(index, joinIndex)}
                            >
                              Remove
                            </Button>
                          </div>

                          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                            <div style={{ flex: 1 }}>
                              <Text style={{ display: 'block', fontSize: '0.75rem', marginBottom: '4px' }}>Join Type</Text>
                              <CustomSelect
                                options={JOIN_TYPE_OPTIONS}
                                value={join.type}
                                onValueChange={(value) => updateJoin(index, joinIndex, { type: value as JoinType })}
                              />
                            </div>
                            <div style={{ flex: 2 }}>
                              <Text style={{ display: 'block', fontSize: '0.75rem', marginBottom: '4px' }}>Join Table</Text>
                              <CustomSelect
                                options={tableOptions}
                                value={join.table}
                                onValueChange={(value) => updateJoin(index, joinIndex, { table: value })}
                              />
                            </div>
                          </div>

                          <div style={{ marginBottom: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                              <Text style={{ fontSize: '0.75rem' }}>ON Conditions</Text>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => addJoinCondition(index, joinIndex)}
                                style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                              >
                                + Add
                              </Button>
                            </div>

                            {join.on.map((condition, conditionIndex) => (
                              <div
                                key={conditionIndex}
                                style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '4px' }}
                              >
                                <Input
                                  type="text"
                                  value={condition.left}
                                  onChange={(e) => updateJoinCondition(index, joinIndex, conditionIndex, { left: e.target.value })}
                                  placeholder={`${metric.query.table}.column`}
                                  style={{ flex: 1, fontSize: '0.8125rem' }}
                                />
                                <Text style={{ fontSize: '0.75rem', color: 'var(--alga-muted-fg)' }}>=</Text>
                                <Input
                                  type="text"
                                  value={condition.right}
                                  onChange={(e) => updateJoinCondition(index, joinIndex, conditionIndex, { right: e.target.value })}
                                  placeholder={`${join.table}.column`}
                                  style={{ flex: 1, fontSize: '0.8125rem' }}
                                />
                                {join.on.length > 1 && (
                                  <Button
                                    type="button"
                                    variant="danger"
                                    size="sm"
                                    onClick={() => removeJoinCondition(index, joinIndex, conditionIndex)}
                                    style={{ padding: '2px 6px', fontSize: '0.75rem' }}
                                  >
                                    X
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>

                          <Text tone="muted" style={{ display: 'block', fontSize: '0.7rem' }}>
                            Available in {join.table}: {getTableColumns(join.table).slice(0, 5).join(', ')}
                            {getTableColumns(join.table).length > 5 && '...'}
                          </Text>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Fields</Text>

                  {/* Selected fields as removable chips */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px', minHeight: '32px', padding: '8px', background: 'var(--alga-bg)', border: '1px solid var(--alga-border)', borderRadius: 'var(--alga-radius)' }}>
                    {metric.query.fields.length === 0 ? (
                      <Text tone="muted" style={{ fontSize: '0.75rem' }}>No fields selected. Click columns below to add.</Text>
                    ) : (
                      metric.query.fields.map((field, fieldIndex) => (
                        <Badge
                          key={fieldIndex}
                          tone="info"
                          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          onClick={() => updateQuery(index, { fields: metric.query.fields.filter((_, i) => i !== fieldIndex) })}
                        >
                          {field}
                          <span style={{ marginLeft: '4px', fontWeight: 'bold' }}>×</span>
                        </Badge>
                      ))
                    )}
                  </div>

                  {/* Available columns - click to add (from ALL tables including joins) */}
                  <Text tone="muted" style={{ display: 'block', fontSize: '0.75rem', marginBottom: '4px' }}>
                    Click to add column:
                  </Text>
                  {getAllMetricColumns(metric).map(({ table, columns }) => (
                    <div key={table} style={{ marginBottom: '8px' }}>
                      <Text style={{ display: 'block', fontSize: '0.7rem', fontWeight: 500, color: 'var(--alga-primary)', marginBottom: '4px' }}>
                        {table}:
                      </Text>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {columns.map((col) => {
                          const fullCol = `${table}.${col}`;
                          const isSelected = metric.query.fields.includes(col) || metric.query.fields.includes(fullCol);
                          return (
                            <Button
                              key={col}
                              type="button"
                              variant="secondary"
                              size="sm"
                              style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                              onClick={() => {
                                if (!isSelected) {
                                  // Use table.column format for joined tables, just column for base table
                                  const colName = table === metric.query.table ? col : fullCol;
                                  updateQuery(index, { fields: [...metric.query.fields, colName] });
                                }
                              }}
                              disabled={isSelected}
                            >
                              {col}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Custom expression input */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Input
                      type="text"
                      id={`edit-custom-field-${index}`}
                      placeholder="Custom: COUNT(*) as count, SUM(amount), etc."
                      style={{ flex: 1 }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const input = e.target as HTMLInputElement;
                          const value = input.value.trim();
                          if (value && !metric.query.fields.includes(value)) {
                            updateQuery(index, { fields: [...metric.query.fields, value] });
                            input.value = '';
                          }
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const input = document.getElementById(`edit-custom-field-${index}`) as HTMLInputElement;
                        if (input) {
                          const value = input.value.trim();
                          if (value && !metric.query.fields.includes(value)) {
                            updateQuery(index, { fields: [...metric.query.fields, value] });
                            input.value = '';
                          }
                        }
                      }}
                    >
                      Add
                    </Button>
                  </div>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Group By</Text>

                  {/* Selected group by fields as removable chips */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px', minHeight: '28px', padding: '6px', background: 'var(--alga-bg)', border: '1px solid var(--alga-border)', borderRadius: 'var(--alga-radius)' }}>
                    {(metric.query.groupBy || []).length === 0 ? (
                      <Text tone="muted" style={{ fontSize: '0.75rem' }}>No grouping. Click columns below to add.</Text>
                    ) : (
                      (metric.query.groupBy || []).map((field, fieldIndex) => (
                        <Badge
                          key={fieldIndex}
                          tone="info"
                          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          onClick={() => updateQuery(index, { groupBy: (metric.query.groupBy || []).filter((_, i) => i !== fieldIndex) })}
                        >
                          {field}
                          <span style={{ marginLeft: '4px', fontWeight: 'bold' }}>×</span>
                        </Badge>
                      ))
                    )}
                  </div>

                  {/* Available columns - click to add (from ALL tables including joins) */}
                  {getAllMetricColumns(metric).map(({ table, columns }) => (
                    <div key={table} style={{ marginBottom: '8px' }}>
                      <Text style={{ display: 'block', fontSize: '0.7rem', fontWeight: 500, color: 'var(--alga-primary)', marginBottom: '4px' }}>
                        {table}:
                      </Text>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {columns.map((col) => {
                          const fullCol = `${table}.${col}`;
                          const currentGroupBy = metric.query.groupBy || [];
                          const isSelected = currentGroupBy.includes(col) || currentGroupBy.includes(fullCol);
                          return (
                            <Button
                              key={col}
                              type="button"
                              variant="secondary"
                              size="sm"
                              style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                              onClick={() => {
                                if (!isSelected) {
                                  const colName = table === metric.query.table ? col : fullCol;
                                  updateQuery(index, { groupBy: [...currentGroupBy, colName] });
                                }
                              }}
                              disabled={isSelected}
                            >
                              {col}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <Text style={{ fontWeight: 500 }}>Filters</Text>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => addFilter(index)}
                    >
                      + Add Filter
                    </Button>
                  </div>

                  {(metric.query.filters || []).map((filter, filterIndex) => (
                    <div
                      key={filterIndex}
                      style={{
                        display: 'flex',
                        gap: '8px',
                        marginBottom: '8px',
                        alignItems: 'center',
                      }}
                    >
                      <CustomSelect
                        options={getAllFieldOptions(metric)}
                        placeholder="Select field..."
                        value={filter.field}
                        onValueChange={(value) => updateFilter(index, filterIndex, { field: value })}
                        style={{ flex: 1 }}
                      />
                      <CustomSelect
                        options={OPERATOR_OPTIONS}
                        value={filter.operator}
                        onValueChange={(value) => updateFilter(index, filterIndex, { operator: value as FilterDefinition['operator'] })}
                        style={{ width: '100px' }}
                      />
                      <Input
                        type="text"
                        value={String(filter.value)}
                        onChange={(e) => updateFilter(index, filterIndex, { value: e.target.value })}
                        placeholder="Value"
                        style={{ flex: 1 }}
                      />
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => removeFilter(index, filterIndex)}
                      >
                        X
                      </Button>
                    </div>
                  ))}
                </div>
                  </>
                )}
              </Card>
            ))}
          </div>
        )}
      </Card>

      {error && <Alert tone="danger" style={{ marginBottom: '16px' }}>{error}</Alert>}

      <div style={{ display: 'flex', gap: '8px' }}>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
        <Button variant="secondary" onClick={onBack}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// Main App
type View = 'reports' | 'create' | 'execute' | 'tenants' | 'audit';

function App() {
  const [currentView, setCurrentView] = useState<View>('reports');

  // Log extension access on mount (via proxy)
  useEffect(() => {
    const logAccess = async () => {
      try {
        await proxyApiCall('/api/v1/platform-reports/access', {
          method: 'POST',
          body: {
            details: {
              source: 'iframe',
              userAgent: navigator.userAgent,
            },
          },
        });
      } catch (error) {
        // Silently fail - access logging shouldn't break the app
        console.debug('[nineminds-reporting] Failed to log access:', error);
      }
    };
    logAccess();
  }, []);

  // Handle navigation from header buttons
  useEffect(() => {
    const nav = document.getElementById('nav');
    if (!nav) return;

    const handleClick = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'BUTTON' && target.dataset.view) {
        // Update button states
        nav.querySelectorAll('button').forEach((btn) => btn.classList.remove('active'));
        target.classList.add('active');
        setCurrentView(target.dataset.view as View);
      }
    };

    nav.addEventListener('click', handleClick);
    return () => nav.removeEventListener('click', handleClick);
  }, []);

  return (
    <>
      {currentView === 'reports' && <ReportsList />}
      {currentView === 'create' && <CreateReport />}
      {currentView === 'execute' && <ExecuteReport />}
      {currentView === 'tenants' && <TenantManagementView />}
      {currentView === 'audit' && <AuditLogs />}
    </>
  );
}

// Mount the app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
