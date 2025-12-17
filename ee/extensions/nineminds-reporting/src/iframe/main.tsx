import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

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

interface ApiResponse<T> {
  success: boolean;
  error?: string;
  data?: T;
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

// Allowed tables for query builder (matches server-side allowlist)
const ALLOWED_TABLES = [
  { value: 'tenants', label: 'Tenants', columns: ['tenant', 'company_name', 'created_at', 'updated_at', 'is_active'] },
  { value: 'users', label: 'Users', columns: ['user_id', 'tenant', 'username', 'email', 'created_at', 'last_login', 'is_inactive'] },
  { value: 'tickets', label: 'Tickets', columns: ['ticket_id', 'tenant', 'created_at', 'updated_at', 'status_id', 'priority_id', 'channel_id'] },
  { value: 'invoices', label: 'Invoices', columns: ['invoice_id', 'tenant', 'created_at', 'due_date', 'total', 'status', 'is_paid'] },
  { value: 'time_entries', label: 'Time Entries', columns: ['entry_id', 'tenant', 'user_id', 'created_at', 'billable_duration', 'work_item_type'] },
  { value: 'companies', label: 'Companies', columns: ['company_id', 'tenant', 'company_name', 'created_at', 'is_inactive'] },
];

const OPERATORS = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'like', label: 'LIKE' },
];

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
    return <div className="loading">Loading reports...</div>;
  }

  if (error) {
    return (
      <div>
        <div className="error">{error}</div>
        <button className="btn" style={{ marginTop: '16px' }} onClick={fetchReports}>
          Retry
        </button>
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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0 }}>Platform Reports</h2>
        <button className="btn btn-secondary" onClick={fetchReports}>
          Refresh
        </button>
      </div>

      {reports.length === 0 ? (
        <div className="card">
          <p style={{ color: 'var(--alga-muted-fg)', margin: 0 }}>
            No reports found. Create your first report using the "Create Report" tab.
          </p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr key={report.report_id}>
                <td>
                  <strong>{report.name}</strong>
                  {report.description && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--alga-muted-fg)' }}>
                      {report.description}
                    </div>
                  )}
                </td>
                <td>
                  {report.category && (
                    <span className="badge badge-info">{report.category}</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${report.is_active ? 'badge-success' : 'badge-warning'}`}>
                    {report.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ color: 'var(--alga-muted-fg)', fontSize: '0.875rem' }}>
                  {new Date(report.created_at).toLocaleDateString()}
                </td>
                <td>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                    onClick={() => setSelectedReport(report)}
                  >
                    View Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
  const [results, setResults] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExecute = async () => {
    setExecuting(true);
    setError(null);
    setResults(null);

    const result = await callExtensionApi(`/reports/${report.report_id}/execute`, {
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
      <button
        className="btn btn-secondary"
        style={{ marginBottom: '20px' }}
        onClick={onBack}
      >
        Back to Reports
      </button>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{report.name}</h2>
        {report.description && (
          <p style={{ color: 'var(--alga-muted-fg)' }}>{report.description}</p>
        )}

        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          {report.category && (
            <span className="badge badge-info">{report.category}</span>
          )}
          <span className={`badge ${report.is_active ? 'badge-success' : 'badge-warning'}`}>
            {report.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>

        <div style={{ fontSize: '0.875rem', color: 'var(--alga-muted-fg)', marginBottom: '20px' }}>
          <div>Created: {new Date(report.created_at).toLocaleString()}</div>
          <div>Updated: {new Date(report.updated_at).toLocaleString()}</div>
        </div>

        <h3>Report Definition</h3>
        <pre>{JSON.stringify(report.report_definition, null, 2)}</pre>

        <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
          <button
            className="btn btn-success"
            onClick={handleExecute}
            disabled={executing}
          >
            {executing ? 'Executing...' : 'Execute Report'}
          </button>
          <button className="btn btn-danger" onClick={handleDelete}>
            Delete Report
          </button>
        </div>
      </div>

      {error && <div className="error" style={{ marginTop: '16px' }}>{error}</div>}

      {results && (
        <div className="card" style={{ marginTop: '16px' }}>
          <h3 style={{ marginTop: 0 }}>Results</h3>
          <pre>{JSON.stringify(results, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function CreateReport() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [metrics, setMetrics] = useState<MetricDefinition[]>([]);
  const [creating, setCreating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addMetric = () => {
    setMetrics([
      ...metrics,
      {
        id: `metric_${Date.now()}`,
        name: '',
        type: 'count',
        query: {
          table: 'tenants',
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

  const getTableColumns = (tableName: string) => {
    const table = ALLOWED_TABLES.find((t) => t.value === tableName);
    return table?.columns || [];
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Create New Report</h2>

      <form onSubmit={handleSubmit}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Basic Information</h3>

          <div className="form-group">
            <label className="label">Report Name *</label>
            <input
              type="text"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Tenant User Summary"
            />
          </div>

          <div className="form-group">
            <label className="label">Description</label>
            <textarea
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this report shows..."
              rows={3}
              style={{ resize: 'vertical' }}
            />
          </div>

          <div className="form-group">
            <label className="label">Category</label>
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Select a category...</option>
              <option value="tenants">Tenants</option>
              <option value="users">Users</option>
              <option value="tickets">Tickets</option>
              <option value="billing">Billing</option>
              <option value="analytics">Analytics</option>
            </select>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>Metrics</h3>
            <button type="button" className="btn btn-secondary" onClick={addMetric}>
              + Add Metric
            </button>
          </div>

          {metrics.length === 0 ? (
            <p style={{ color: 'var(--alga-muted-fg)' }}>
              No metrics added yet. Click "Add Metric" to define what data this report should query.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {metrics.map((metric, index) => (
                <div
                  key={metric.id}
                  style={{
                    border: '1px solid var(--alga-border)',
                    borderRadius: '8px',
                    padding: '16px',
                    background: '#fff',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <strong>Metric {index + 1}</strong>
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                      onClick={() => removeMetric(index)}
                    >
                      Remove
                    </button>
                  </div>

                  <div className="form-group">
                    <label className="label">Metric Name</label>
                    <input
                      type="text"
                      className="input"
                      value={metric.name}
                      onChange={(e) => updateMetric(index, { name: e.target.value })}
                      placeholder="e.g., Active Users Count"
                    />
                  </div>

                  <div className="form-group">
                    <label className="label">Metric Type</label>
                    <select
                      className="input"
                      value={metric.type}
                      onChange={(e) => updateMetric(index, { type: e.target.value as 'count' | 'sum' | 'avg' | 'query' })}
                    >
                      <option value="count">Count</option>
                      <option value="sum">Sum</option>
                      <option value="avg">Average</option>
                      <option value="query">Custom Query</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="label">Table</label>
                    <select
                      className="input"
                      value={metric.query.table}
                      onChange={(e) => updateQuery(index, { table: e.target.value, fields: ['COUNT(*) as count'] })}
                    >
                      {ALLOWED_TABLES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="label">Fields (comma-separated)</label>
                    <input
                      type="text"
                      className="input"
                      value={metric.query.fields.join(', ')}
                      onChange={(e) => updateQuery(index, {
                        fields: e.target.value.split(',').map((f) => f.trim()).filter(Boolean)
                      })}
                      placeholder="e.g., tenant, COUNT(*) as count"
                    />
                    <div style={{ fontSize: '0.75rem', color: 'var(--alga-muted-fg)', marginTop: '4px' }}>
                      Available columns: {getTableColumns(metric.query.table).join(', ')}
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="label">Group By (comma-separated)</label>
                    <input
                      type="text"
                      className="input"
                      value={(metric.query.groupBy || []).join(', ')}
                      onChange={(e) => updateQuery(index, {
                        groupBy: e.target.value.split(',').map((f) => f.trim()).filter(Boolean)
                      })}
                      placeholder="e.g., tenant"
                    />
                  </div>

                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <label className="label" style={{ margin: 0 }}>Filters</label>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                        onClick={() => addFilter(index)}
                      >
                        + Add Filter
                      </button>
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
                        <select
                          className="input"
                          style={{ flex: 1 }}
                          value={filter.field}
                          onChange={(e) => updateFilter(index, filterIndex, { field: e.target.value })}
                        >
                          <option value="">Select field...</option>
                          {getTableColumns(metric.query.table).map((col) => (
                            <option key={col} value={col}>
                              {col}
                            </option>
                          ))}
                        </select>
                        <select
                          className="input"
                          style={{ width: '100px' }}
                          value={filter.operator}
                          onChange={(e) => updateFilter(index, filterIndex, { operator: e.target.value as FilterDefinition['operator'] })}
                        >
                          {OPERATORS.map((op) => (
                            <option key={op.value} value={op.value}>
                              {op.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          className="input"
                          style={{ flex: 1 }}
                          value={String(filter.value)}
                          onChange={(e) => updateFilter(index, filterIndex, { value: e.target.value })}
                          placeholder="Value"
                        />
                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{ padding: '8px' }}
                          onClick={() => removeFilter(index, filterIndex)}
                        >
                          X
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div className="error" style={{ marginBottom: '16px' }}>{error}</div>}

        {success && (
          <div
            style={{
              padding: '16px',
              background: '#dcfce7',
              borderRadius: '8px',
              border: '1px solid #bbf7d0',
              marginBottom: '16px',
            }}
          >
            Report created successfully! View it in the "Reports" tab.
          </div>
        )}

        <button type="submit" className="btn" disabled={creating}>
          {creating ? 'Creating...' : 'Create Report'}
        </button>
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
  const [results, setResults] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

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

    const result = await callExtensionApi(`/reports/${selectedReportId}/execute`, {
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
    return <div className="loading">Loading reports...</div>;
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Execute Report</h2>

      <div className="card">
        <div className="form-group">
          <label className="label">Select Report</label>
          <select
            className="input"
            value={selectedReportId}
            onChange={(e) => setSelectedReportId(e.target.value)}
          >
            <option value="">Choose a report...</option>
            {reports.map((report) => (
              <option key={report.report_id} value={report.report_id}>
                {report.name} {report.category ? `(${report.category})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="label">Parameters (JSON)</label>
          <textarea
            className="input"
            value={parameters}
            onChange={(e) => setParameters(e.target.value)}
            rows={5}
            style={{ fontFamily: 'monospace', resize: 'vertical' }}
            placeholder='{"startDate": "2024-01-01", "endDate": "2024-12-31"}'
          />
          <div style={{ fontSize: '0.75rem', color: 'var(--alga-muted-fg)', marginTop: '4px' }}>
            Optional: Pass parameters as JSON object to filter results
          </div>
        </div>

        <button
          className="btn"
          onClick={handleExecute}
          disabled={executing || !selectedReportId}
        >
          {executing ? 'Executing...' : 'Execute Report'}
        </button>
      </div>

      {error && <div className="error" style={{ marginTop: '16px' }}>{error}</div>}

      {results && (
        <div className="card" style={{ marginTop: '16px' }}>
          <h3 style={{ marginTop: 0 }}>Results</h3>
          <pre>{JSON.stringify(results, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

// Main App
type View = 'reports' | 'create' | 'execute';

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
    </>
  );
}

// Mount the app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
