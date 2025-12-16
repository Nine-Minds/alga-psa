import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

// Types
interface Report {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  data?: Record<string, unknown>;
  type?: string;
  estimatedCompletion?: string;
}

interface ExternalData {
  joke?: string;
  id?: string;
  status?: number;
}

interface ApiResponse<T> {
  ok: boolean;
  error?: string;
  message?: string;
  reports?: Report[];
  report?: Report;
  data?: T;
  fetchedAt?: string;
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

// Simple API client
async function callExtensionApi<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  // Get extension context from URL params
  const params = new URLSearchParams(window.location.search);
  const extensionId = params.get('extensionId') || params.get('ext') || '';

  if (!extensionId) {
    console.error('No extensionId provided in URL params');
    return { ok: false, error: 'config_error', message: 'Extension ID not provided' };
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
    return { ok: false, error: 'fetch_failed', message: String(error) };
  }
}

// Components
function ReportsList() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchReports() {
      setLoading(true);
      const result = await callExtensionApi<Report[]>('/reports');
      if (result.ok && result.reports) {
        setReports(result.reports);
      } else {
        setError(result.message || 'Failed to fetch reports');
      }
      setLoading(false);
    }
    fetchReports();
  }, []);

  if (loading) {
    return <div className="loading">Loading reports...</div>;
  }

  if (error) {
    return <div className="error">{error}</div>;
  }

  return (
    <div className="reports-list">
      <h2 style={{ marginTop: 0 }}>Available Reports</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--alga-border)' }}>
            <th style={{ textAlign: 'left', padding: '12px 8px' }}>ID</th>
            <th style={{ textAlign: 'left', padding: '12px 8px' }}>Name</th>
            <th style={{ textAlign: 'left', padding: '12px 8px' }}>Status</th>
            <th style={{ textAlign: 'left', padding: '12px 8px' }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => (
            <tr key={report.id} style={{ borderBottom: '1px solid var(--alga-border)' }}>
              <td style={{ padding: '12px 8px', fontFamily: 'monospace', fontSize: '0.875rem' }}>{report.id}</td>
              <td style={{ padding: '12px 8px' }}>{report.name}</td>
              <td style={{ padding: '12px 8px' }}>
                <span
                  style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    background: report.status === 'completed' ? '#dcfce7' : '#fef3c7',
                    color: report.status === 'completed' ? '#166534' : '#92400e',
                  }}
                >
                  {report.status}
                </span>
              </td>
              <td style={{ padding: '12px 8px', color: 'var(--alga-muted-fg)' }}>{report.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExternalDataView() {
  const [data, setData] = useState<ExternalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await callExtensionApi<ExternalData>('/external-data');
    if (result.ok && result.data) {
      setData(result.data);
      setFetchedAt(result.fetchedAt || new Date().toISOString());
    } else {
      setError(result.message || 'Failed to fetch external data');
    }
    setLoading(false);
  }, []);

  return (
    <div className="external-data">
      <h2 style={{ marginTop: 0 }}>External Data (HTTP Fetch Demo)</h2>
      <p style={{ color: 'var(--alga-muted-fg)', marginBottom: '20px' }}>
        This demonstrates the <code>cap:http.fetch</code> capability by fetching data from an external API.
      </p>

      <button
        onClick={fetchData}
        disabled={loading}
        style={{
          padding: '10px 20px',
          background: 'var(--alga-primary)',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: loading ? 'wait' : 'pointer',
          fontSize: '0.875rem',
          fontWeight: 500,
        }}
      >
        {loading ? 'Fetching...' : 'Fetch External Data'}
      </button>

      {error && <div className="error" style={{ marginTop: '16px' }}>{error}</div>}

      {data && (
        <div
          style={{
            marginTop: '20px',
            padding: '20px',
            background: 'var(--alga-card-bg)',
            borderRadius: '8px',
            border: '1px solid var(--alga-border)',
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: '12px' }}>Response from External API</h3>
          {data.joke && (
            <p style={{ fontSize: '1.1rem', fontStyle: 'italic', margin: 0 }}>"{data.joke}"</p>
          )}
          {fetchedAt && (
            <p style={{ marginTop: '12px', marginBottom: 0, fontSize: '0.75rem', color: 'var(--alga-muted-fg)' }}>
              Fetched at: {new Date(fetchedAt).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function GenerateReport() {
  const [reportName, setReportName] = useState('');
  const [reportType, setReportType] = useState('revenue');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!reportName.trim()) {
      setError('Please enter a report name');
      return;
    }

    setGenerating(true);
    setError(null);
    setResult(null);

    const response = await callExtensionApi<Report>('/reports/generate', {
      method: 'POST',
      body: JSON.stringify({ name: reportName, type: reportType }),
    });

    if (response.ok && response.report) {
      setResult(response.report);
      setReportName('');
    } else {
      setError(response.message || 'Failed to generate report');
    }
    setGenerating(false);
  };

  return (
    <div className="generate-report">
      <h2 style={{ marginTop: 0 }}>Generate New Report</h2>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Report Name</label>
        <input
          type="text"
          value={reportName}
          onChange={(e) => setReportName(e.target.value)}
          placeholder="Enter report name..."
          style={{
            width: '100%',
            maxWidth: '400px',
            padding: '10px 12px',
            border: '1px solid var(--alga-border)',
            borderRadius: '6px',
            fontSize: '0.875rem',
          }}
        />
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>Report Type</label>
        <select
          value={reportType}
          onChange={(e) => setReportType(e.target.value)}
          style={{
            padding: '10px 12px',
            border: '1px solid var(--alga-border)',
            borderRadius: '6px',
            fontSize: '0.875rem',
            minWidth: '200px',
          }}
        >
          <option value="revenue">Revenue Report</option>
          <option value="tickets">Ticket Analysis</option>
          <option value="sla">SLA Compliance</option>
          <option value="utilization">Resource Utilization</option>
        </select>
      </div>

      <button
        onClick={handleGenerate}
        disabled={generating}
        style={{
          padding: '10px 20px',
          background: 'var(--alga-primary)',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: generating ? 'wait' : 'pointer',
          fontSize: '0.875rem',
          fontWeight: 500,
        }}
      >
        {generating ? 'Generating...' : 'Generate Report'}
      </button>

      {error && <div className="error" style={{ marginTop: '16px' }}>{error}</div>}

      {result && (
        <div
          style={{
            marginTop: '20px',
            padding: '16px',
            background: '#dcfce7',
            borderRadius: '8px',
            border: '1px solid #bbf7d0',
          }}
        >
          <strong>Report generation started!</strong>
          <p style={{ margin: '8px 0 0' }}>
            ID: <code>{result.id}</code><br />
            Status: {result.status}<br />
            Estimated completion: {result.estimatedCompletion ? new Date(result.estimatedCompletion).toLocaleString() : 'Soon'}
          </p>
        </div>
      )}
    </div>
  );
}

// Main App
type View = 'reports' | 'external' | 'generate';

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
      {currentView === 'external' && <ExternalDataView />}
      {currentView === 'generate' && <GenerateReport />}
    </>
  );
}

// Mount the app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
