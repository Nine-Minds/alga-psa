'use client';

import React from 'react';
import { JobData } from 'server/src/lib/jobs/jobScheduler';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import JobDetailsDrawer from './JobDetailsDrawer';
import { getJobDetailsWithHistory } from 'server/src/lib/actions/job-actions';
import { CheckCircle2, XCircle, Clock, Activity } from 'lucide-react';

const formatDuration = (startTime?: Date, endTime?: Date): string => {
  if (!startTime) return '-';

  const start = new Date(startTime).getTime();
  const end = endTime ? new Date(endTime).getTime() : Date.now();
  const durationMs = end - start;

  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
  if (durationMs < 3600000) return `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`;

  const hours = Math.floor(durationMs / 3600000);
  const minutes = Math.floor((durationMs % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
};

const formatRelativeTime = (date?: Date): string => {
  if (!date) return '-';

  const now = Date.now();
  const time = new Date(date).getTime();
  const diffMs = now - time;

  if (diffMs < 60000) return 'Just now';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;

  return new Date(date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const statusConfig = {
    completed: {
      icon: CheckCircle2,
      label: 'Completed',
      className: 'bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-600))] border border-[rgb(var(--color-primary-200))]'
    },
    failed: {
      icon: XCircle,
      label: 'Failed',
      className: 'bg-[rgb(var(--color-accent-50))] text-[rgb(var(--color-accent-600))] border border-[rgb(var(--color-accent-200))]'
    },
    processing: {
      icon: Activity,
      label: 'Processing',
      className: 'bg-[rgb(var(--color-secondary-50))] text-[rgb(var(--color-secondary-600))] border border-[rgb(var(--color-secondary-200))]'
    },
    pending: {
      icon: Clock,
      label: 'Pending',
      className: 'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-600))] border border-[rgb(var(--color-border-200))]'
    }
  };

  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.className}`}>
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  );
};

interface RecentJobsDataTableProps {
  initialData?: JobData[];
}

export default function RecentJobsDataTable({ initialData = [] }: RecentJobsDataTableProps) {
  const [selectedJobId, setSelectedJobId] = React.useState<string | null>(null);
  const [data, setData] = React.useState<JobData[]>(initialData);
  const intervalRef = React.useRef<NodeJS.Timeout | undefined>(undefined);

  const columns = React.useMemo<ColumnDefinition<JobData>[]>(() => [
    {
      title: 'Job Name',
      dataIndex: 'type',
      render: (type: string, record: JobData) => (
        <div className="flex flex-col">
          <span className="font-medium text-[rgb(var(--color-text-900))]">{type}</span>
          {record.job_id && (
            <span className="text-xs text-[rgb(var(--color-text-400))] font-mono mt-0.5">
              {record.job_id.slice(0, 8)}
            </span>
          )}
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (status: string) => <StatusBadge status={status} />,
    },
    {
      title: 'Duration',
      dataIndex: 'processed_at',
      render: (processedAt: Date | undefined, record: JobData) => {
        const duration = formatDuration(processedAt, record.updated_at);
        return (
          <span className="text-sm text-[rgb(var(--color-text-700))]">
            {duration}
          </span>
        );
      },
    },
    {
      title: 'Started',
      dataIndex: 'processed_at',
      render: (value?: Date) => (
        <span className="text-sm text-[rgb(var(--color-text-700))]">
          {formatRelativeTime(value)}
        </span>
      ),
    },
    {
      title: 'Completed',
      dataIndex: 'updated_at',
      render: (value?: Date, record?: JobData) => {
        if (record?.status === 'processing' || record?.status === 'pending') {
          return <span className="text-sm text-[rgb(var(--color-text-400))]">-</span>;
        }
        return (
          <span className="text-sm text-[rgb(var(--color-text-700))]">
            {formatRelativeTime(value)}
          </span>
        );
      },
    },
  ], []);

  const hasActiveJobs = React.useCallback((jobs: JobData[]) => {
    return jobs.some(job => job.status === 'processing');
  }, []);

  const fetchData = React.useCallback(async () => {
    try {
      const newData = await getJobDetailsWithHistory({ limit: 50 }) as JobData[];
      setData(newData);
      
      // Stop polling if there are no active jobs
      if (!hasActiveJobs(newData) && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = undefined;
      }
    } catch (error) {
      console.error('Error fetching job data:', error);
    }
  }, [hasActiveJobs]);

  React.useEffect(() => {
    if (!hasActiveJobs(data)) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = undefined;
      }
      return;
    }

    if (!intervalRef.current) {
      intervalRef.current = setInterval(fetchData, 5000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = undefined;
      }
    };
  }, [data, fetchData, hasActiveJobs]);

  const handleRowClick = React.useCallback((row: JobData) => {
    if (row.job_id) {
      setSelectedJobId(row.job_id);
    }
  }, []);

  React.useEffect(() => {
    setData(initialData);
  }, [initialData]);

  return (
    <div className="w-full">
      <DataTable
        data={data}
        columns={columns}
        onRowClick={handleRowClick}
        id="recent-jobs-table"
        rowClassName={() => 'hover:bg-[rgb(var(--color-primary-50))] cursor-pointer'}
        initialSorting={[{ id: 'processed_at', desc: true }]}
        itemsPerPageOptions={[
          { value: '10', label: '10 rows' },
          { value: '25', label: '25 rows' },
          { value: '50', label: '50 rows' },
        ]}
      />

      <JobDetailsDrawer 
        jobId={selectedJobId}
        onClose={() => setSelectedJobId(null)}
      />
    </div>
  );
}
