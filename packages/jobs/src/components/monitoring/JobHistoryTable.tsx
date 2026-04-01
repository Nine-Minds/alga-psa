'use client';

import React from 'react';
import { JobData } from '@alga-psa/jobs/lib/jobs/jobScheduler';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import JobDetailsDrawer from './JobDetailsDrawer';
import { getJobDetailsWithHistory } from '@alga-psa/jobs/actions';

interface JobHistoryTableProps {
  initialData?: JobData[];
}

export default function JobHistoryTable({ initialData = [] }: JobHistoryTableProps) {
  const { t } = useTranslation('msp/jobs');
  const [selectedJobId, setSelectedJobId] = React.useState<string | null>(null);
  const [data, setData] = React.useState<JobData[]>(initialData);
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

  const formatDateTime = React.useCallback((value?: Date) => {
    return value ? new Date(value).toLocaleString() : t('shared.fallbacks.empty', { defaultValue: '-' });
  }, [t]);

  const columns = React.useMemo<ColumnDefinition<JobData>[]>(() => [
    {
      title: t('historyTable.columns.jobName', { defaultValue: 'Job Name' }),
      dataIndex: 'type',
      render: (type: string) => type,
    },
    {
      title: t('historyTable.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      render: (status: string) => (
        <span className={`font-medium px-2 py-1 rounded ${
          status === 'completed' ? 'bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-600))]' :
          status === 'failed' ? 'bg-[rgb(var(--color-accent-50))] text-[rgb(var(--color-accent-600))]' :
          'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-700))]'
        }`}>
          {getStatusLabel(status)}
        </span>
      ),
    },
    {
      title: t('historyTable.columns.created', { defaultValue: 'Created' }),
      dataIndex: 'created_at',
      render: (value?: Date) => formatDateTime(value),
    },
    {
      title: t('historyTable.columns.started', { defaultValue: 'Started' }),
      dataIndex: 'processed_at',
      render: (value?: Date) => formatDateTime(value),
    },
    {
      title: t('historyTable.columns.completed', { defaultValue: 'Completed' }),
      dataIndex: 'updated_at',
      render: (value?: Date) => formatDateTime(value),
    },
  ], [formatDateTime, getStatusLabel, t]);

  const hasActiveJobs = (jobs: any[]) => {
    console.log('Checking for active jobs:', jobs);

    return jobs.some(job => job.status === 'processing');
  };

  const fetchData = async () => {
    try {
      const newData = await getJobDetailsWithHistory({});
      setData(newData as unknown as JobData[]);

      // Stop polling if there are no active jobs
      if (!hasActiveJobs(newData)) {
        clearInterval(intervalRef.current);
      }
    } catch (error) {
      console.error('Error fetching job data:', error);
    }
  };

  React.useEffect(() => {
    if (hasActiveJobs(data)) {
      intervalRef.current = setInterval(fetchData, 5000);
    }
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [data]);

  const handleRowClick = (row: JobData) => {
    setSelectedJobId(row.job_id);
  };

  return (
    <div className="w-full">
      <DataTable
        data={data}
        columns={columns}
        onRowClick={handleRowClick}
        id="job-history-table"
        rowClassName={() => "cursor-pointer"}
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
