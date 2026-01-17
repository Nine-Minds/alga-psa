'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { DataTable } from 'server/src/components/ui/DataTable';
import {
  Plus,
  Download,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Clock,
  XCircle,
  FileText,
  FileSpreadsheet,
  File
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import type { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';

// Types for Reports
interface ReportJob {
  id: string;
  name: string;
  report_type: 'pii' | 'asm' | 'security_score' | 'combined';
  format: 'docx' | 'xlsx' | 'pdf';
  status: string;
  company_id?: string;
  company_name?: string;
  date_from?: string;
  date_to?: string;
  file_path?: string;
  file_size?: number;
  created_at: string;
  completed_at?: string;
  error_message?: string;
}

// Status badge component
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const statusConfig: Record<string, { icon: React.ReactNode; className: string; label: string }> = {
    pending: { icon: <Clock className="w-3 h-3" />, className: 'bg-yellow-100 text-yellow-800', label: 'Pending' },
    queued: { icon: <Clock className="w-3 h-3" />, className: 'bg-blue-100 text-blue-800', label: 'Queued' },
    running: { icon: <RefreshCw className="w-3 h-3 animate-spin" />, className: 'bg-blue-100 text-blue-800', label: 'Generating' },
    completed: { icon: <CheckCircle className="w-3 h-3" />, className: 'bg-green-100 text-green-800', label: 'Completed' },
    failed: { icon: <XCircle className="w-3 h-3" />, className: 'bg-red-100 text-red-800', label: 'Failed' },
  };

  const config = statusConfig[status] || statusConfig.pending;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.className}`}>
      {config.icon}
      {config.label}
    </span>
  );
};

// Format icon component
const FormatIcon: React.FC<{ format: string }> = ({ format }) => {
  const icons: Record<string, React.ReactNode> = {
    docx: <FileText className="w-4 h-4 text-blue-600" />,
    xlsx: <FileSpreadsheet className="w-4 h-4 text-green-600" />,
    pdf: <File className="w-4 h-4 text-red-600" />,
  };

  return icons[format] || <File className="w-4 h-4" />;
};

// Report type label
const getReportTypeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    pii: 'PII Scanner',
    asm: 'Attack Surface',
    security_score: 'Security Score',
    combined: 'Combined',
  };
  return labels[type] || type;
};

export default function GuardReports() {
  const searchParams = useSearchParams();
  const [reports, setReports] = useState<ReportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Check for action param to open create form
  useEffect(() => {
    const action = searchParams?.get('action');
    if (action === 'new-report') {
      setShowCreateForm(true);
    }
  }, [searchParams]);

  const fetchReports = useCallback(async () => {
    try {
      const response = await fetch('/api/guard/reports');
      if (response.ok) {
        const data = await response.json();
        setReports(data.reports || []);
      }
    } catch (err) {
      console.error('Failed to fetch reports:', err);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        await fetchReports();
      } catch (err) {
        setError('Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [fetchReports]);

  const handleDownload = async (reportId: string) => {
    try {
      window.open(`/api/guard/reports/${reportId}/download`, '_blank');
    } catch (err) {
      console.error('Failed to download report:', err);
    }
  };

  const handleDelete = async (reportId: string) => {
    if (!confirm('Are you sure you want to delete this report?')) return;
    try {
      const response = await fetch(`/api/guard/reports/${reportId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        await fetchReports();
      }
    } catch (err) {
      console.error('Failed to delete report:', err);
    }
  };

  const handleCancel = async (reportId: string) => {
    try {
      const response = await fetch(`/api/guard/reports/${reportId}/cancel`, {
        method: 'POST',
      });
      if (response.ok) {
        await fetchReports();
      }
    } catch (err) {
      console.error('Failed to cancel report:', err);
    }
  };

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const reportColumns: ColumnDefinition<ReportJob>[] = [
    { title: 'Name', dataIndex: 'name' },
    { title: 'Type', dataIndex: 'report_type', render: (value) => getReportTypeLabel(value as string) },
    {
      title: 'Format',
      dataIndex: 'format',
      render: (value) => (
        <div className="flex items-center gap-2">
          <FormatIcon format={value as string} />
          {(value as string).toUpperCase()}
        </div>
      )
    },
    { title: 'Status', dataIndex: 'status', render: (value) => <StatusBadge status={value as string} /> },
    { title: 'Company', dataIndex: 'company_name', render: (value) => value || 'All Companies' },
    { title: 'Size', dataIndex: 'file_size', render: (value) => formatFileSize(value as number | undefined) },
    { title: 'Created', dataIndex: 'created_at', render: (value) => new Date(value as string).toLocaleString() },
    {
      title: 'Actions',
      dataIndex: 'id',
      render: (value, record) => (
        <div className="flex items-center gap-2">
          {record.status === 'completed' && (
            <Button
              id={`download-report-${value}`}
              variant="ghost"
              size="sm"
              onClick={() => handleDownload(value as string)}
              title="Download"
            >
              <Download className="w-4 h-4" />
            </Button>
          )}
          {(record.status === 'pending' || record.status === 'queued' || record.status === 'running') && (
            <Button
              id={`cancel-report-${value}`}
              variant="ghost"
              size="sm"
              onClick={() => handleCancel(value as string)}
              title="Cancel"
            >
              <XCircle className="w-4 h-4" />
            </Button>
          )}
          <Button
            id={`delete-report-${value}`}
            variant="ghost"
            size="sm"
            onClick={() => handleDelete(value as string)}
            title="Delete"
          >
            <Trash2 className="w-4 h-4 text-red-500" />
          </Button>
        </div>
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
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-muted-foreground">Generate and download security reports</p>
        </div>
        <div className="flex gap-2">
          <Button id="refresh-reports-btn" variant="outline" onClick={fetchReports}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button id="new-report-btn" onClick={() => setShowCreateForm(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Report
          </Button>
        </div>
      </div>

      {/* Report Generation Form */}
      {showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle>Generate New Report</CardTitle>
            <CardDescription>Select report type, format, and date range</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Report Name</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="Monthly Security Report"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Report Type</label>
                  <select className="w-full px-3 py-2 border rounded-md">
                    <option value="combined">Combined Report</option>
                    <option value="pii">PII Scanner Report</option>
                    <option value="asm">ASM Report</option>
                    <option value="security_score">Security Score Report</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Format</label>
                  <select className="w-full px-3 py-2 border rounded-md">
                    <option value="pdf">PDF</option>
                    <option value="docx">Word (DOCX)</option>
                    <option value="xlsx">Excel (XLSX)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Company</label>
                  <select className="w-full px-3 py-2 border rounded-md">
                    <option value="">All Companies</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button id="cancel-create-btn" variant="outline" onClick={() => setShowCreateForm(false)}>
                  Cancel
                </Button>
                <Button id="generate-report-btn">
                  Generate Report
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Reports Table */}
      <Card>
        <CardHeader>
          <CardTitle>Generated Reports</CardTitle>
          <CardDescription>View and download your security reports</CardDescription>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No reports yet</h3>
              <p className="text-muted-foreground mb-4">Generate your first report to get started</p>
              <Button id="create-first-report-btn" onClick={() => setShowCreateForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Generate Report
              </Button>
            </div>
          ) : (
            <DataTable
              columns={reportColumns}
              data={reports}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
