'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { DataTable } from 'server/src/components/ui/DataTable';
import {
  Plus,
  Play,
  Settings,
  Trash2,
  Eye,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Clock,
  XCircle,
  Globe,
  Shield,
  Server
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import type { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';

// Types for ASM
interface AsmDomain {
  id: string;
  domain_name: string;
  company_id: string;
  company_name?: string;
  enabled: boolean;
  last_scan_at?: string;
  created_at: string;
}

interface AsmJob {
  id: string;
  domain_id: string;
  domain_name?: string;
  status: string;
  started_at?: string;
  completed_at?: string;
  findings_count: number;
  error_message?: string;
}

interface AsmResult {
  id: string;
  domain_id: string;
  result_type: string;
  severity?: string;
  data: Record<string, unknown>;
  found_at: string;
}

// Tab types for ASM
type AsmTab = 'domains' | 'jobs' | 'results' | 'dashboard';

// Status badge component
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const statusConfig: Record<string, { icon: React.ReactNode; className: string; label: string }> = {
    enabled: { icon: <CheckCircle className="w-3 h-3" />, className: 'bg-green-100 text-green-800', label: 'Enabled' },
    disabled: { icon: <XCircle className="w-3 h-3" />, className: 'bg-gray-100 text-gray-800', label: 'Disabled' },
    queued: { icon: <Clock className="w-3 h-3" />, className: 'bg-blue-100 text-blue-800', label: 'Queued' },
    running: { icon: <RefreshCw className="w-3 h-3 animate-spin" />, className: 'bg-blue-100 text-blue-800', label: 'Running' },
    completed: { icon: <CheckCircle className="w-3 h-3" />, className: 'bg-green-100 text-green-800', label: 'Completed' },
    failed: { icon: <XCircle className="w-3 h-3" />, className: 'bg-red-100 text-red-800', label: 'Failed' },
  };

  const config = statusConfig[status] || statusConfig.disabled;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.className}`}>
      {config.icon}
      {config.label}
    </span>
  );
};

// Severity badge component
const SeverityBadge: React.FC<{ severity: string }> = ({ severity }) => {
  const severityConfig: Record<string, string> = {
    critical: 'bg-red-100 text-red-800',
    high: 'bg-orange-100 text-orange-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-blue-100 text-blue-800',
    info: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${severityConfig[severity] || severityConfig.info}`}>
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  );
};

export default function AsmManager() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<AsmTab>('domains');
  const [domains, setDomains] = useState<AsmDomain[]>([]);
  const [jobs, setJobs] = useState<AsmJob[]>([]);
  const [results, setResults] = useState<AsmResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check for action param to open specific views
  useEffect(() => {
    const action = searchParams?.get('action');
    if (action === 'add-domain') {
      // Open add domain dialog
      setActiveTab('domains');
    }
  }, [searchParams]);

  const fetchDomains = useCallback(async () => {
    try {
      const response = await fetch('/api/guard/asm/domains');
      if (response.ok) {
        const data = await response.json();
        setDomains(data.domains || []);
      }
    } catch (err) {
      console.error('Failed to fetch domains:', err);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/guard/asm/jobs');
      if (response.ok) {
        const data = await response.json();
        setJobs(data.jobs || []);
      }
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
    }
  }, []);

  const fetchResults = useCallback(async () => {
    try {
      const response = await fetch('/api/guard/asm/results');
      if (response.ok) {
        const data = await response.json();
        setResults(data.results || []);
      }
    } catch (err) {
      console.error('Failed to fetch results:', err);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        await Promise.all([fetchDomains(), fetchJobs(), fetchResults()]);
      } catch (err) {
        setError('Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [fetchDomains, fetchJobs, fetchResults]);

  const handleTriggerScan = async (domainId: string) => {
    try {
      const response = await fetch(`/api/guard/asm/domains/${domainId}/scan`, {
        method: 'POST',
      });
      if (response.ok) {
        await fetchJobs();
        setActiveTab('jobs');
      }
    } catch (err) {
      console.error('Failed to trigger scan:', err);
    }
  };

  const handleDeleteDomain = async (domainId: string) => {
    if (!confirm('Are you sure you want to delete this domain?')) return;
    try {
      const response = await fetch(`/api/guard/asm/domains/${domainId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        await fetchDomains();
      }
    } catch (err) {
      console.error('Failed to delete domain:', err);
    }
  };

  const handleToggleDomain = async (domainId: string) => {
    try {
      const response = await fetch(`/api/guard/asm/domains/${domainId}/toggle`, {
        method: 'POST',
      });
      if (response.ok) {
        await fetchDomains();
      }
    } catch (err) {
      console.error('Failed to toggle domain:', err);
    }
  };

  const domainColumns: ColumnDefinition<AsmDomain>[] = [
    { title: 'Domain', dataIndex: 'domain_name', render: (value) => (
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-muted-foreground" />
        {value as string}
      </div>
    )},
    { title: 'Company', dataIndex: 'company_name' },
    { title: 'Status', dataIndex: 'enabled', render: (value) => <StatusBadge status={value ? 'enabled' : 'disabled'} /> },
    { title: 'Last Scan', dataIndex: 'last_scan_at', render: (value) => value ? new Date(value as string).toLocaleDateString() : 'Never' },
    {
      title: 'Actions',
      dataIndex: 'id',
      render: (value, record) => (
        <div className="flex items-center gap-2">
          <Button id={`scan-domain-${value}`} variant="ghost" size="sm" onClick={() => handleTriggerScan(value as string)} title="Scan Now">
            <Play className="w-4 h-4" />
          </Button>
          <Button id={`toggle-domain-${value}`} variant="ghost" size="sm" onClick={() => handleToggleDomain(value as string)} title="Toggle">
            {record.enabled ? <XCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
          </Button>
          <Button id={`view-domain-${value}`} variant="ghost" size="sm" title="View Results">
            <Eye className="w-4 h-4" />
          </Button>
          <Button id={`delete-domain-${value}`} variant="ghost" size="sm" onClick={() => handleDeleteDomain(value as string)} title="Delete">
            <Trash2 className="w-4 h-4 text-red-500" />
          </Button>
        </div>
      ),
    },
  ];

  const jobColumns: ColumnDefinition<AsmJob>[] = [
    { title: 'ID', dataIndex: 'id', render: (value) => (value as string).slice(0, 8) + '...' },
    { title: 'Domain', dataIndex: 'domain_name' },
    { title: 'Status', dataIndex: 'status', render: (value) => <StatusBadge status={value as string} /> },
    { title: 'Findings', dataIndex: 'findings_count' },
    { title: 'Started', dataIndex: 'started_at', render: (value) => value ? new Date(value as string).toLocaleString() : '-' },
    { title: 'Duration', dataIndex: 'completed_at', render: (value, record) => {
      if (!value || !record.started_at) return '-';
      const duration = new Date(value as string).getTime() - new Date(record.started_at as string).getTime();
      return `${Math.round(duration / 1000)}s`;
    }},
  ];

  const resultColumns: ColumnDefinition<AsmResult>[] = [
    { title: 'Type', dataIndex: 'result_type', render: (value) => {
      const typeLabels: Record<string, string> = {
        subdomain: 'Subdomain',
        ip_address: 'IP Address',
        open_port: 'Open Port',
        dns_record: 'DNS Record',
        http_header: 'HTTP Header',
        cloud_storage: 'Cloud Storage',
        cve: 'CVE',
        email_security: 'Email Security',
      };
      return typeLabels[value as string] || value;
    }},
    { title: 'Severity', dataIndex: 'severity', render: (value) => value ? <SeverityBadge severity={value as string} /> : '-' },
    { title: 'Details', dataIndex: 'data', render: (value) => {
      const data = value as Record<string, unknown>;
      if (data.subdomain) return data.subdomain as string;
      if (data.ip) {
        const geoInfo = data.country ? ` (${data.country})` : '';
        return `${data.ip}${geoInfo}`;
      }
      if (data.port) return `Port ${data.port}${data.service ? ` - ${data.service}` : ''}`;
      if (data.cve_id) {
        const cvss = data.cvss_score ? ` (CVSS: ${data.cvss_score})` : '';
        const epss = data.epss ? ` EPSS: ${(data.epss as number * 100).toFixed(1)}%` : '';
        return `${data.cve_id}${cvss}${epss}`;
      }
      if (data.bucket_name) return `${data.bucket_type}: ${data.bucket_name}`;
      if (data.record_type) return `${data.record_type}: ${data.value || ''}`;
      if (data.header_name) return `${data.header_name}: ${data.present ? 'Present' : 'Missing'}`;
      return JSON.stringify(data).slice(0, 50) + '...';
    }},
    { title: 'Found At', dataIndex: 'found_at', render: (value) => new Date(value as string).toLocaleString() },
    {
      title: 'Actions',
      dataIndex: 'id',
      render: (value) => (
        <Button id={`view-result-${value}`} variant="ghost" size="sm" title="View Details">
          <Eye className="w-4 h-4" />
        </Button>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="bg-red-50 border-red-200">
          <CardContent className="pt-6">
            <div className="flex items-center text-red-600">
              <AlertTriangle className="w-5 h-5 mr-2" />
              {error}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Attack Surface Management</h1>
          <p className="text-muted-foreground">Monitor external vulnerabilities and exposures</p>
        </div>
        <div className="flex gap-2">
          <Button id="refresh-domains-btn" variant="outline" onClick={() => fetchDomains()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button id="add-domain-btn">
            <Plus className="w-4 h-4 mr-2" />
            Add Domain
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        {(['domains', 'jobs', 'results', 'dashboard'] as AsmTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'domains' && (
        <Card>
          <CardHeader>
            <CardTitle>Monitored Domains</CardTitle>
            <CardDescription>Manage domains for attack surface monitoring</CardDescription>
          </CardHeader>
          <CardContent>
            {domains.length === 0 ? (
              <div className="text-center py-12">
                <Globe className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No domains configured</h3>
                <p className="text-muted-foreground mb-4">Add your first domain to start monitoring</p>
                <Button id="add-domain-empty-btn">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Domain
                </Button>
              </div>
            ) : (
              <DataTable
                columns={domainColumns}
                data={domains}
              />
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'jobs' && (
        <Card>
          <CardHeader>
            <CardTitle>Scan Jobs</CardTitle>
            <CardDescription>Monitor active and completed ASM scans</CardDescription>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <div className="text-center py-12">
                <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No scan jobs</h3>
                <p className="text-muted-foreground">Trigger a scan from a domain to see jobs here</p>
              </div>
            ) : (
              <DataTable
                columns={jobColumns}
                data={jobs}
              />
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'results' && (
        <Card>
          <CardHeader>
            <CardTitle>Scan Results</CardTitle>
            <CardDescription>All findings across ASM scans</CardDescription>
          </CardHeader>
          <CardContent>
            {results.length === 0 ? (
              <div className="text-center py-12">
                <Shield className="w-12 h-12 mx-auto text-green-500 mb-4" />
                <h3 className="text-lg font-medium mb-2">No findings</h3>
                <p className="text-muted-foreground">Run a scan to discover potential vulnerabilities</p>
              </div>
            ) : (
              <DataTable
                columns={resultColumns}
                data={results}
              />
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'dashboard' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Domains</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{domains.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Scans</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{jobs.filter(j => j.status === 'running').length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Findings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{results.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Critical Findings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {results.filter(r => r.severity === 'critical').length}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
