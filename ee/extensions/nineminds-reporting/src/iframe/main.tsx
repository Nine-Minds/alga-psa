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

// Audit log types
interface AuditLogEntry {
  log_id: string;
  event_type: string;
  user_id: string | null;
  user_email: string | null;
  report_id: string | null;
  report_name: string | null;
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

// Simple API client that calls through the extension handler
async function callExtensionApi<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  // Get extension context from URL params
  const params = new URLSearchParams(window.location.search);
  const extensionId = params.get('extensionId') || params.get('ext') || '';

  if (!extensionId) {
    console.error('No extensionId provided in URL params');
    return { success: false, error: 'Extension ID not provided' };
  }

  const hostOrigin = getHostOrigin();
  const baseUrl = `${hostOrigin}/api/ext/${extensionId}`;

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      credentials: 'include', // Include cookies for auth
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    return await response.json();
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
      const hostOrigin = getHostOrigin();
      const response = await fetch(`${hostOrigin}/api/v1/platform-reports/schema`, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result: ApiResponse<SchemaResponse> = await response.json();

      if (result.success && result.data?.tables) {
        schemaCache = result.data.tables;
        return schemaCache;
      }

      console.error('[Schema] Failed to fetch:', result.error);
      return [];
    } catch (error) {
      console.error('[Schema] Fetch error:', error);
      return [];
    }
  })();

  return schemaPromise;
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

// Table for displaying metric rows
function ResultsTable({ data, title }: { data: unknown[]; title: string }) {
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
  const columns = Object.keys(firstRow);

  // Format cell value
  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return value.toLocaleString();
    if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T/)) {
      return new Date(value).toLocaleString();
    }
    return String(value);
  };

  // Format column header
  const formatHeader = (col: string): string => {
    return col
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  };

  return (
    <Card>
      <h4 style={{ marginTop: 0 }}>{title}</h4>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col}>{formatHeader(col)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr key={idx}>
                {columns.map(col => (
                  <td key={col}>{formatValue((row as Record<string, unknown>)[col])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Text tone="muted" style={{ display: 'block', fontSize: '0.75rem', marginTop: '8px' }}>
        {data.length} row{data.length !== 1 ? 's' : ''}
      </Text>
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
    const result = await callExtensionApi<PlatformReport[]>('/reports');
    if (result.success && result.data) {
      setReports(result.data);
    } else {
      setError(result.error || 'Failed to fetch reports');
    }
    setLoading(false);
  }

  if (loading) {
    return <Text tone="muted">Loading reports...</Text>;
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

    const result = await callExtensionApi<ReportResult>(`/reports/${report.report_id}/execute`, {
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

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this report?')) {
      return;
    }

    const result = await callExtensionApi(`/reports/${report.report_id}`, {
      method: 'DELETE',
    });

    if (result.success) {
      onRefresh();
      onBack();
    } else {
      setError(result.error || 'Failed to delete report');
    }
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
          <Button variant="danger" onClick={handleDelete}>
            Delete Report
          </Button>
        </div>
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

// Category options for Select
const CATEGORY_OPTIONS: SelectOption[] = [
  { value: 'tenants', label: 'Tenants' },
  { value: 'users', label: 'Users' },
  { value: 'tickets', label: 'Tickets' },
  { value: 'billing', label: 'Billing' },
  { value: 'analytics', label: 'Analytics' },
];

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

    const result = await callExtensionApi('/reports', {
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

  const getFieldOptions = (tableName: string): SelectOption[] => {
    return getTableColumns(tableName).map(col => ({ value: col, label: col }));
  };

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
            <CustomSelect
              options={CATEGORY_OPTIONS}
              placeholder="Select a category..."
              value={category}
              onValueChange={setCategory}
            />
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

                  <div style={{ marginBottom: '16px' }}>
                    <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Table</Text>
                    <CustomSelect
                      options={tableOptions}
                      value={metric.query.table}
                      onValueChange={(value) => updateQuery(index, { table: value, fields: ['COUNT(*) as count'] })}
                      disabled={schemaLoading}
                    />
                    {schemaLoading && (
                      <Text tone="muted" style={{ display: 'block', fontSize: '0.75rem', marginTop: '4px' }}>
                        Loading available tables...
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
                    <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Fields (comma-separated)</Text>
                    <Input
                      type="text"
                      value={metric.query.fields.join(', ')}
                      onChange={(e) => updateQuery(index, {
                        fields: e.target.value.split(',').map((f) => f.trim()).filter(Boolean)
                      })}
                      placeholder="e.g., tenant, COUNT(*) as count"
                      style={{ width: '100%' }}
                    />
                    <Text tone="muted" style={{ display: 'block', fontSize: '0.75rem', marginTop: '4px' }}>
                      Available columns: {getTableColumns(metric.query.table).join(', ')}
                    </Text>
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Group By (comma-separated)</Text>
                    <Input
                      type="text"
                      value={(metric.query.groupBy || []).join(', ')}
                      onChange={(e) => updateQuery(index, {
                        groupBy: e.target.value.split(',').map((f) => f.trim()).filter(Boolean)
                      })}
                      placeholder="e.g., tenant"
                      style={{ width: '100%' }}
                    />
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
                          options={getFieldOptions(metric.query.table)}
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
                </Card>
              ))}
            </div>
          )}
        </Card>

        {error && <Alert tone="danger" style={{ marginBottom: '16px' }}>{error}</Alert>}

        {success && (
          <Alert tone="success" style={{ marginBottom: '16px' }}>
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
      const result = await callExtensionApi<PlatformReport[]>('/reports');
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

    const result = await callExtensionApi<ReportResult>(`/reports/${selectedReportId}/execute`, {
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
    return <Text tone="muted">Loading reports...</Text>;
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
              <strong>Parameters</strong> let you customize report execution:
              <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                <li><strong>Date filters:</strong> Override auto-generated date ranges</li>
                <li><strong>Entity filters:</strong> Filter by specific tenant, user, etc.</li>
                <li><strong>Custom values:</strong> Pass any values your report queries expect</li>
              </ul>
              <div style={{ marginTop: '12px' }}>
                <strong>Examples:</strong>
                <pre style={{
                  background: 'var(--alga-bg)',
                  padding: '8px',
                  borderRadius: 'var(--alga-radius)',
                  margin: '4px 0',
                  fontSize: '0.75rem',
                  overflow: 'auto',
                  border: '1px solid var(--alga-border)',
                }}>
{`// Empty - uses defaults
{}

// Filter by tenant
{"tenant_id": "abc-123"}

// Custom date range
{
  "start_of_month": "2024-01-01T00:00:00Z",
  "end_of_month": "2024-01-31T23:59:59Z"
}`}
                </pre>
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
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
              <span style={{
                width: '14px',
                height: '14px',
                border: '2px solid rgba(255,255,255,0.3)',
                borderTopColor: 'white',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }} />
              Executing...
            </span>
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

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// Audit event type options for Select
const AUDIT_EVENT_TYPE_OPTIONS: SelectOption[] = [
  { value: '', label: 'All Events' },
  { value: 'report.list', label: 'Report List' },
  { value: 'report.view', label: 'Report View' },
  { value: 'report.create', label: 'Report Create' },
  { value: 'report.update', label: 'Report Update' },
  { value: 'report.delete', label: 'Report Delete' },
  { value: 'report.execute', label: 'Report Execute' },
  { value: 'schema.view', label: 'Schema View' },
  { value: 'extension.access', label: 'Extension Access' },
];

function AuditLogs() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [reportIdFilter, setReportIdFilter] = useState('');
  const [limit, setLimit] = useState(50);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (eventTypeFilter) params.set('eventType', eventTypeFilter);
    if (reportIdFilter) params.set('reportId', reportIdFilter);
    params.set('limit', String(limit));

    const queryString = params.toString();
    const path = queryString ? `/audit?${queryString}` : '/audit';

    const result = await callExtensionApi<AuditLogEntry[]>(path);

    if (result.success && result.data) {
      setLogs(result.data);
    } else {
      setError(result.error || 'Failed to fetch audit logs');
    }
    setLoading(false);
  }, [eventTypeFilter, reportIdFilter, limit]);

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
      render: (row) => (
        <Text style={{ fontSize: '0.8125rem' }}>
          {new Date(row.created_at).toLocaleString()}
        </Text>
      ),
    },
    {
      key: 'event_type',
      header: 'Event',
      render: (row) => (
        <Badge tone={getEventBadgeTone(row.event_type)}>
          {formatEventType(row.event_type)}
        </Badge>
      ),
    },
    {
      key: 'user_email',
      header: 'User',
      render: (row) => (
        <div>
          {row.user_email ? (
            <>
              <div style={{ fontWeight: 500 }}>{row.user_email}</div>
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
      key: 'report_name',
      header: 'Report',
      render: (row) => row.report_name ? (
        <div>
          <div style={{ fontWeight: 500 }}>{row.report_name}</div>
          {row.report_id && (
            <div style={{ fontSize: '0.75rem', color: 'var(--alga-muted-fg)' }}>
              {row.report_id.slice(0, 8)}...
            </div>
          )}
        </div>
      ) : (
        <Text tone="muted">—</Text>
      ),
    },
    {
      key: 'details',
      header: 'Details',
      render: (row) => row.details ? (
        <details style={{ fontSize: '0.75rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--alga-primary)' }}>
            View Details
          </summary>
          <pre style={{
            marginTop: '4px',
            fontSize: '0.7rem',
            background: 'var(--alga-muted)',
            padding: '8px',
            borderRadius: '4px',
            overflow: 'auto',
            maxWidth: '300px',
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
          {loading ? 'Loading...' : 'Refresh'}
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
            <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Report ID</Text>
            <Input
              type="text"
              value={reportIdFilter}
              onChange={(e) => setReportIdFilter(e.target.value)}
              placeholder="Filter by report ID..."
            />
          </div>
          <div style={{ minWidth: '120px' }}>
            <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Limit</Text>
            <CustomSelect
              options={[
                { value: '25', label: '25' },
                { value: '50', label: '50' },
                { value: '100', label: '100' },
                { value: '200', label: '200' },
              ]}
              value={String(limit)}
              onValueChange={(v) => setLimit(parseInt(v, 10))}
            />
          </div>
        </div>
      </Card>

      {error && <Alert tone="danger" style={{ marginBottom: '16px' }}>{error}</Alert>}

      {loading ? (
        <Text tone="muted">Loading audit logs...</Text>
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
            defaultPageSize={10}
            initialSortKey="created_at"
          />
          <Text tone="muted" style={{ display: 'block', marginTop: '8px', fontSize: '0.75rem' }}>
            Showing {logs.length} log entries
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

    const result = await callExtensionApi(`/reports/${report.report_id}`, {
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

  const getFieldOptions = (tableName: string): SelectOption[] => {
    return getTableColumns(tableName).map(col => ({ value: col, label: col }));
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
          <CustomSelect
            options={CATEGORY_OPTIONS}
            placeholder="Select a category..."
            value={category}
            onValueChange={setCategory}
          />
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

                <div style={{ marginBottom: '16px' }}>
                  <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Table</Text>
                  <CustomSelect
                    options={tableOptions}
                    value={metric.query.table}
                    onValueChange={(value) => updateQuery(index, { table: value })}
                    disabled={schemaLoading}
                  />
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
                  <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Fields (comma-separated)</Text>
                  <Input
                    type="text"
                    value={metric.query.fields.join(', ')}
                    onChange={(e) => updateQuery(index, {
                      fields: e.target.value.split(',').map((f) => f.trim()).filter(Boolean)
                    })}
                    placeholder="e.g., tenant, COUNT(*) as count"
                    style={{ width: '100%' }}
                  />
                  <Text tone="muted" style={{ display: 'block', fontSize: '0.75rem', marginTop: '4px' }}>
                    Available columns: {getTableColumns(metric.query.table).join(', ')}
                  </Text>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <Text style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Group By (comma-separated)</Text>
                  <Input
                    type="text"
                    value={(metric.query.groupBy || []).join(', ')}
                    onChange={(e) => updateQuery(index, {
                      groupBy: e.target.value.split(',').map((f) => f.trim()).filter(Boolean)
                    })}
                    placeholder="e.g., tenant"
                    style={{ width: '100%' }}
                  />
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
                        options={getFieldOptions(metric.query.table)}
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
type View = 'reports' | 'create' | 'execute' | 'audit';

function App() {
  const [currentView, setCurrentView] = useState<View>('reports');

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
