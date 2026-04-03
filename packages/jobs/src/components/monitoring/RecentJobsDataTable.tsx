'use client';

import React from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import JobDetailsDrawer from './JobDetailsDrawer';
import { getJobDetailsWithHistory, type JobRecord } from '@alga-psa/jobs/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { CheckCircle2, XCircle, Clock, Activity } from 'lucide-react';

const StatusBadge: React.FC<{ status: string; label: string }> = ({ status, label }) => {
  const statusConfig = {
    completed: {
      icon: CheckCircle2,
      className: 'bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-600))] border border-[rgb(var(--color-primary-200))]'
    },
    failed: {
      icon: XCircle,
      className: 'bg-[rgb(var(--color-accent-50))] text-[rgb(var(--color-accent-600))] border border-[rgb(var(--color-accent-200))]'
    },
    processing: {
      icon: Activity,
      className: 'bg-[rgb(var(--color-secondary-50))] text-[rgb(var(--color-secondary-600))] border border-[rgb(var(--color-secondary-200))]'
    },
    pending: {
      icon: Clock,
      className: 'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-600))] border border-[rgb(var(--color-border-200))]'
    }
  };

  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.className}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
};

interface RecentJobsDataTableProps {
  initialData?: JobRecord[];
}

export default function RecentJobsDataTable({ initialData = [] }: RecentJobsDataTableProps) {
  const { t } = useTranslation('msp/jobs');
  const [selectedJobId, setSelectedJobId] = React.useState<string | null>(null);
  const [data, setData] = React.useState<JobRecord[]>(initialData);
  const intervalRef = React.useRef<NodeJS.Timeout | undefined>(undefined);

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  const getStatusLabel = React.useCallback((status: string) => {
    const fallback = status.charAt(0).toUpperCase() + status.slice(1);
    return t(`shared.statusLabels.${status}`, { defaultValue: fallback });
  }, [t]);

  const formatDuration = React.useCallback((startTime?: Date, endTime?: Date): string => {
    if (!startTime) return t('shared.fallbacks.empty', { defaultValue: '-' });

    const start = new Date(startTime).getTime();
    const end = endTime ? new Date(endTime).getTime() : Date.now();
    const durationMs = end - start;

    if (durationMs < 1000) {
      return t('recentTable.duration.milliseconds', { defaultValue: '{{count}}ms', count: durationMs });
    }
    if (durationMs < 60000) {
      return t('recentTable.duration.seconds', {
        defaultValue: '{{count}}s',
        count: Number((durationMs / 1000).toFixed(1)),
      });
    }
    if (durationMs < 3600000) {
      return t('recentTable.duration.minutesSeconds', {
        defaultValue: '{{minutes}}m {{seconds}}s',
        minutes: Math.floor(durationMs / 60000),
        seconds: Math.floor((durationMs % 60000) / 1000),
      });
    }

    const hours = Math.floor(durationMs / 3600000);
    const minutes = Math.floor((durationMs % 3600000) / 60000);
    return t('recentTable.duration.hoursMinutes', {
      defaultValue: '{{hours}}h {{minutes}}m',
      hours,
      minutes,
    });
  }, [t]);

  const formatRelativeTime = React.useCallback((date?: Date): string => {
    if (!date) return t('shared.fallbacks.empty', { defaultValue: '-' });

    const now = Date.now();
    const time = new Date(date).getTime();
    const diffMs = now - time;

    if (diffMs < 60000) return t('recentTable.time.justNow', { defaultValue: 'Just now' });
    if (diffMs < 3600000) {
      return t('recentTable.time.minutesAgo', {
        defaultValue: '{{count}}m ago',
        count: Math.floor(diffMs / 60000),
      });
    }
    if (diffMs < 86400000) {
      return t('recentTable.time.hoursAgo', {
        defaultValue: '{{count}}h ago',
        count: Math.floor(diffMs / 3600000),
      });
    }

    return new Date(date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }, [t]);

  const columns = React.useMemo<ColumnDefinition<JobRecord>[]>(() => [
    {
      title: t('recentTable.columns.jobName', { defaultValue: 'Job Name' }),
      dataIndex: 'type',
      render: (type: string, record: JobRecord) => (
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
      title: t('recentTable.columns.runner', { defaultValue: 'Runner' }),
      dataIndex: 'runner_type',
      render: (runner: string, record: JobRecord) => (
        <div className="flex flex-col items-start">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            runner === 'temporal' 
              ? 'bg-purple-100 text-purple-700 border border-purple-200' 
              : 'bg-blue-100 text-blue-700 border border-blue-200'
          }`}>
            {runner === 'temporal'
              ? t('shared.runnerLabels.temporal', { defaultValue: 'Temporal' })
              : t('shared.runnerLabels.pgboss', { defaultValue: 'PG Boss' })}
          </span>
          {record.external_id && (
            <span className="text-[10px] text-[rgb(var(--color-text-400))] font-mono mt-0.5" title={record.external_id}>
              {t('recentTable.externalId', {
                defaultValue: 'ID: {{id}}...',
                id: record.external_id.slice(0, 8),
              })}
            </span>
          )}
        </div>
      ),
    },
    {
      title: t('recentTable.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      render: (status: string) => <StatusBadge status={status} label={getStatusLabel(status)} />,
    },
    {
      title: t('recentTable.columns.duration', { defaultValue: 'Duration' }),
      dataIndex: 'processed_at',
      render: (processedAt: Date | undefined, record: JobRecord) => {
        const duration = formatDuration(processedAt, record.updated_at);
        return (
          <span className="text-sm text-[rgb(var(--color-text-700))]">
            {duration}
          </span>
        );
      },
    },
    {
      title: t('recentTable.columns.started', { defaultValue: 'Started' }),
      dataIndex: 'processed_at',
      render: (value?: Date) => (
        <span className="text-sm text-[rgb(var(--color-text-700))]">
          {formatRelativeTime(value)}
        </span>
      ),
    },
    {
      title: t('recentTable.columns.completed', { defaultValue: 'Completed' }),
      dataIndex: 'updated_at',
      render: (value?: Date, record?: JobRecord) => {
        if (record?.status === 'processing' || record?.status === 'pending') {
          return <span className="text-sm text-[rgb(var(--color-text-400))]">{t('shared.fallbacks.empty', { defaultValue: '-' })}</span>;
        }
        return (
          <span className="text-sm text-[rgb(var(--color-text-700))]">
            {formatRelativeTime(value)}
          </span>
        );
      },
    },
  ], [formatDuration, formatRelativeTime, getStatusLabel, t]);

  const hasActiveJobs = React.useCallback((jobs: JobRecord[]) => {
    return jobs.some(job => job.status === 'processing');
  }, []);

  const fetchData = React.useCallback(async () => {
    try {
      const newData = await getJobDetailsWithHistory({ limit: 50 });
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

  const handleRowClick = React.useCallback((row: JobRecord) => {
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
        key={`${currentPage}-${pageSize}`}
        data={data}
        columns={columns}
        onRowClick={handleRowClick}
        id="recent-jobs-table"
        rowClassName={() => 'cursor-pointer'}
        initialSorting={[{ id: 'processed_at', desc: true }]}
        pagination={true}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        pageSize={pageSize}
        onItemsPerPageChange={handlePageSizeChange}
      />

      <JobDetailsDrawer 
        jobId={selectedJobId}
        onClose={() => setSelectedJobId(null)}
      />
    </div>
  );
}
