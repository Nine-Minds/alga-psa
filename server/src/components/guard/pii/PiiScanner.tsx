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
  FileSearch,
  Download
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import type { IGuardPiiProfile, IGuardPiiJob, IGuardPiiResult } from '@/interfaces/guard/pii.interfaces';
import type { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';

// Local type aliases for cleaner code
type PiiProfile = IGuardPiiProfile;
type PiiJob = IGuardPiiJob;
type PiiResult = IGuardPiiResult;

// Tab types for the PII Scanner
type PiiTab = 'profiles' | 'jobs' | 'results' | 'dashboard';

// Status badge component
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const statusConfig: Record<string, { icon: React.ReactNode; className: string; label: string }> = {
    active: { icon: <CheckCircle className="w-3 h-3" />, className: 'bg-green-100 text-green-800', label: 'Active' },
    inactive: { icon: <XCircle className="w-3 h-3" />, className: 'bg-gray-100 text-gray-800', label: 'Inactive' },
    pending: { icon: <Clock className="w-3 h-3" />, className: 'bg-yellow-100 text-yellow-800', label: 'Pending' },
    queued: { icon: <Clock className="w-3 h-3" />, className: 'bg-blue-100 text-blue-800', label: 'Queued' },
    running: { icon: <RefreshCw className="w-3 h-3 animate-spin" />, className: 'bg-blue-100 text-blue-800', label: 'Running' },
    completed: { icon: <CheckCircle className="w-3 h-3" />, className: 'bg-green-100 text-green-800', label: 'Completed' },
    failed: { icon: <XCircle className="w-3 h-3" />, className: 'bg-red-100 text-red-800', label: 'Failed' },
    cancelled: { icon: <XCircle className="w-3 h-3" />, className: 'bg-gray-100 text-gray-800', label: 'Cancelled' },
  };

  const config = statusConfig[status] || statusConfig.pending;

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

export default function PiiScanner() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<PiiTab>('profiles');
  const [profiles, setProfiles] = useState<PiiProfile[]>([]);
  const [jobs, setJobs] = useState<PiiJob[]>([]);
  const [results, setResults] = useState<PiiResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check for action param to open specific views
  useEffect(() => {
    const action = searchParams?.get('action');
    if (action === 'new-scan') {
      // Open new scan dialog
      setActiveTab('profiles');
    }
  }, [searchParams]);

  const fetchProfiles = useCallback(async () => {
    try {
      const response = await fetch('/api/guard/pii/profiles');
      if (response.ok) {
        const data = await response.json();
        setProfiles(data.profiles || []);
      }
    } catch (err) {
      console.error('Failed to fetch profiles:', err);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/guard/pii/jobs');
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
      const response = await fetch('/api/guard/pii/results');
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
        await Promise.all([fetchProfiles(), fetchJobs(), fetchResults()]);
      } catch (err) {
        setError('Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [fetchProfiles, fetchJobs, fetchResults]);

  const handleTriggerScan = async (profileId: string) => {
    try {
      const response = await fetch(`/api/guard/pii/profiles/${profileId}/scan`, {
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

  const handleDeleteProfile = async (profileId: string) => {
    if (!confirm('Are you sure you want to delete this profile?')) return;
    try {
      const response = await fetch(`/api/guard/pii/profiles/${profileId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        await fetchProfiles();
      }
    } catch (err) {
      console.error('Failed to delete profile:', err);
    }
  };

  const handleExportResults = async () => {
    try {
      const response = await fetch('/api/guard/pii/results?format=csv');
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pii-results-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Failed to export results:', err);
    }
  };

  const profileColumns: ColumnDefinition<PiiProfile>[] = [
    { title: 'Name', dataIndex: 'name' },
    { title: 'Description', dataIndex: 'description' },
    { title: 'Status', dataIndex: 'is_active', render: (value) => <StatusBadge status={value ? 'active' : 'inactive'} /> },
    { title: 'Created', dataIndex: 'created_at', render: (value) => new Date(value as string).toLocaleDateString() },
    {
      title: 'Actions',
      dataIndex: 'id',
      render: (value, _record) => (
        <div className="flex items-center gap-2">
          <Button id={`run-scan-${value}`} variant="ghost" size="sm" onClick={() => handleTriggerScan(value as string)} title="Run Scan">
            <Play className="w-4 h-4" />
          </Button>
          <Button id={`edit-profile-${value}`} variant="ghost" size="sm" title="Edit">
            <Settings className="w-4 h-4" />
          </Button>
          <Button id={`delete-profile-${value}`} variant="ghost" size="sm" onClick={() => handleDeleteProfile(value as string)} title="Delete">
            <Trash2 className="w-4 h-4 text-red-500" />
          </Button>
        </div>
      ),
    },
  ];

  const jobColumns: ColumnDefinition<PiiJob>[] = [
    { title: 'ID', dataIndex: 'id', render: (value) => (value as string).slice(0, 8) + '...' },
    { title: 'Profile', dataIndex: 'profile_id' },
    { title: 'Status', dataIndex: 'status', render: (value) => <StatusBadge status={value as string} /> },
    { title: 'Files Scanned', dataIndex: 'files_scanned' },
    { title: 'Findings', dataIndex: 'findings_count' },
    { title: 'Started', dataIndex: 'started_at', render: (value) => value ? new Date(value as string).toLocaleString() : '-' },
    { title: 'Duration', dataIndex: 'completed_at', render: (value, record) => {
      if (!value || !record.started_at) return '-';
      const completedAt = typeof value === 'string' ? value : String(value);
      const startedAt = typeof record.started_at === 'string' ? record.started_at : String(record.started_at);
      const duration = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      return `${Math.round(duration / 1000)}s`;
    }},
  ];

  // Map PII types to severity
  const getPiiSeverity = (piiType: string): string => {
    const severityMap: Record<string, string> = {
      ssn: 'critical',
      credit_card: 'critical',
      bank_account: 'high',
      passport: 'high',
      drivers_license: 'high',
      dob: 'medium',
      phone: 'medium',
      email: 'low',
      ip_address: 'low',
      mac_address: 'low',
    };
    return severityMap[piiType] || 'info';
  };

  const resultColumns: ColumnDefinition<PiiResult>[] = [
    { title: 'PII Type', dataIndex: 'pii_type' },
    { title: 'Severity', dataIndex: 'pii_type', render: (value) => <SeverityBadge severity={getPiiSeverity(value as string)} /> },
    { title: 'File Path', dataIndex: 'file_path' },
    { title: 'Lines', dataIndex: 'line_numbers', render: (value) => Array.isArray(value) ? (value as number[]).join(', ') : '-' },
    { title: 'Confidence', dataIndex: 'confidence_score', render: (value) => `${Math.round((value as number) * 100)}%` },
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
          <h1 className="text-2xl font-bold">PII Scanner</h1>
          <p className="text-muted-foreground">Detect and monitor sensitive data exposure</p>
        </div>
        <div className="flex gap-2">
          <Button id="refresh-profiles-btn" variant="outline" onClick={() => fetchProfiles()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button id="new-profile-btn">
            <Plus className="w-4 h-4 mr-2" />
            New Profile
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        {(['profiles', 'jobs', 'results', 'dashboard'] as PiiTab[]).map((tab) => (
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
      {activeTab === 'profiles' && (
        <Card>
          <CardHeader>
            <CardTitle>Scan Profiles</CardTitle>
            <CardDescription>Configure and manage PII scan profiles</CardDescription>
          </CardHeader>
          <CardContent>
            {profiles.length === 0 ? (
              <div className="text-center py-12">
                <FileSearch className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No scan profiles yet</h3>
                <p className="text-muted-foreground mb-4">Create your first scan profile to start detecting PII</p>
                <Button id="create-profile-empty-btn">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Profile
                </Button>
              </div>
            ) : (
              <DataTable
                columns={profileColumns}
                data={profiles}
              />
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'jobs' && (
        <Card>
          <CardHeader>
            <CardTitle>Scan Jobs</CardTitle>
            <CardDescription>Monitor active and completed scan jobs</CardDescription>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <div className="text-center py-12">
                <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No scan jobs</h3>
                <p className="text-muted-foreground">Trigger a scan from a profile to see jobs here</p>
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
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Scan Results</CardTitle>
              <CardDescription>All PII findings across scans</CardDescription>
            </div>
            <Button id="export-results-btn" variant="outline" onClick={handleExportResults}>
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </CardHeader>
          <CardContent>
            {results.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-4" />
                <h3 className="text-lg font-medium mb-2">No PII findings</h3>
                <p className="text-muted-foreground">Run a scan to detect potential PII exposure</p>
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
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Profiles</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{profiles.length}</div>
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
                {results.filter(r => getPiiSeverity(r.pii_type) === 'critical').length}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
