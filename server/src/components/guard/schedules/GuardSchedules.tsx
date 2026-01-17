'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { DataTable } from 'server/src/components/ui/DataTable';
import {
  Plus,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Calendar,
  Clock,
  Play,
  Pause
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import type { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';

// Types for Schedules
interface Schedule {
  id: string;
  name: string;
  schedule_type: 'pii_scan' | 'asm_scan';
  target_id: string;
  target_name?: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  day_of_week?: number;
  day_of_month?: number;
  time_of_day: string;
  timezone: string;
  enabled: boolean;
  next_run_at?: string;
  last_run_at?: string;
  created_at: string;
}

// Status badge component
const StatusBadge: React.FC<{ enabled: boolean }> = ({ enabled }) => {
  if (enabled) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
        <CheckCircle className="w-3 h-3" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
      <XCircle className="w-3 h-3" />
      Paused
    </span>
  );
};

// Frequency badge component
const FrequencyBadge: React.FC<{ schedule: Schedule }> = ({ schedule }) => {
  const getFrequencyText = () => {
    switch (schedule.frequency) {
      case 'daily':
        return `Daily at ${schedule.time_of_day}`;
      case 'weekly':
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return `Weekly on ${days[schedule.day_of_week || 0]} at ${schedule.time_of_day}`;
      case 'monthly':
        return `Monthly on day ${schedule.day_of_month} at ${schedule.time_of_day}`;
      default:
        return schedule.frequency;
    }
  };

  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
      <Clock className="w-4 h-4" />
      {getFrequencyText()}
    </span>
  );
};

// Schedule type label
const getScheduleTypeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    pii_scan: 'PII Scan',
    asm_scan: 'ASM Scan',
  };
  return labels[type] || type;
};

export default function GuardSchedules() {
  const searchParams = useSearchParams();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Check for action param to open create form
  useEffect(() => {
    const action = searchParams?.get('action');
    if (action === 'new-schedule') {
      setShowCreateForm(true);
    }
  }, [searchParams]);

  const fetchSchedules = useCallback(async () => {
    try {
      const response = await fetch('/api/guard/schedules');
      if (response.ok) {
        const data = await response.json();
        setSchedules(data.schedules || []);
      }
    } catch (err) {
      console.error('Failed to fetch schedules:', err);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        await fetchSchedules();
      } catch (err) {
        setError('Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [fetchSchedules]);

  const handleToggle = async (scheduleId: string) => {
    try {
      const response = await fetch(`/api/guard/schedules/${scheduleId}/toggle`, {
        method: 'POST',
      });
      if (response.ok) {
        await fetchSchedules();
      }
    } catch (err) {
      console.error('Failed to toggle schedule:', err);
    }
  };

  const handleDelete = async (scheduleId: string) => {
    if (!confirm('Are you sure you want to delete this schedule?')) return;
    try {
      const response = await fetch(`/api/guard/schedules/${scheduleId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        await fetchSchedules();
      }
    } catch (err) {
      console.error('Failed to delete schedule:', err);
    }
  };

  const scheduleColumns: ColumnDefinition<Schedule>[] = [
    { title: 'Name', dataIndex: 'name' },
    { title: 'Type', dataIndex: 'schedule_type', render: (value) => getScheduleTypeLabel(value as string) },
    { title: 'Target', dataIndex: 'target_name' },
    { title: 'Frequency', dataIndex: 'frequency', render: (_value, record) => <FrequencyBadge schedule={record} /> },
    { title: 'Status', dataIndex: 'enabled', render: (value) => <StatusBadge enabled={value as boolean} /> },
    {
      title: 'Next Run',
      dataIndex: 'next_run_at',
      render: (value) => value ? new Date(value as string).toLocaleString() : '-'
    },
    {
      title: 'Last Run',
      dataIndex: 'last_run_at',
      render: (value) => value ? new Date(value as string).toLocaleString() : 'Never'
    },
    {
      title: 'Actions',
      dataIndex: 'id',
      render: (value, record) => (
        <div className="flex items-center gap-2">
          <Button
            id={`toggle-schedule-${value}`}
            variant="ghost"
            size="sm"
            onClick={() => handleToggle(value as string)}
            title={record.enabled ? 'Pause' : 'Resume'}
          >
            {record.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </Button>
          <Button
            id={`delete-schedule-${value}`}
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
          <h1 className="text-2xl font-bold">Schedules</h1>
          <p className="text-muted-foreground">Configure recurring security scans</p>
        </div>
        <div className="flex gap-2">
          <Button id="refresh-schedules-btn" variant="outline" onClick={fetchSchedules}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button id="new-schedule-btn" onClick={() => setShowCreateForm(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Schedule
          </Button>
        </div>
      </div>

      {/* Schedule Creation Form */}
      {showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create New Schedule</CardTitle>
            <CardDescription>Configure a recurring security scan</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Schedule Name</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="Weekly PII Scan"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Scan Type</label>
                  <select className="w-full px-3 py-2 border rounded-md">
                    <option value="pii_scan">PII Scan</option>
                    <option value="asm_scan">ASM Scan</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Frequency</label>
                  <select className="w-full px-3 py-2 border rounded-md">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Time of Day</label>
                  <input
                    type="time"
                    className="w-full px-3 py-2 border rounded-md"
                    defaultValue="02:00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Timezone</label>
                  <select className="w-full px-3 py-2 border rounded-md">
                    <option value="UTC">UTC</option>
                    <option value="America/New_York">Eastern Time</option>
                    <option value="America/Chicago">Central Time</option>
                    <option value="America/Denver">Mountain Time</option>
                    <option value="America/Los_Angeles">Pacific Time</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button id="cancel-schedule-btn" variant="outline" onClick={() => setShowCreateForm(false)}>
                  Cancel
                </Button>
                <Button id="create-schedule-btn">
                  Create Schedule
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Schedules Table */}
      <Card>
        <CardHeader>
          <CardTitle>Configured Schedules</CardTitle>
          <CardDescription>Manage your recurring security scans</CardDescription>
        </CardHeader>
        <CardContent>
          {schedules.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No schedules configured</h3>
              <p className="text-muted-foreground mb-4">Set up recurring scans to automate security monitoring</p>
              <Button id="create-first-schedule-btn" onClick={() => setShowCreateForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create Schedule
              </Button>
            </div>
          ) : (
            <DataTable
              columns={scheduleColumns}
              data={schedules}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
