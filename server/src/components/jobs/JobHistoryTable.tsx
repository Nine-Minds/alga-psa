'use client';

import React from 'react';
import { JobData } from 'server/src/lib/jobs/jobScheduler';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import JobDetailsDrawer from './JobDetailsDrawer';
import { getJobDetailsWithHistory } from '@product/actions/job-actions';

const columns: ColumnDefinition<JobData>[] = [
  {
    title: 'Job Name',
    dataIndex: 'type',
    render: (type: string) => type,
  },
  {
    title: 'Status',
    dataIndex: 'status',
    render: (status: string) => (
      <span className={`font-medium px-2 py-1 rounded ${
        status === 'completed' ? 'bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-600))]' :
        status === 'failed' ? 'bg-[rgb(var(--color-accent-50))] text-[rgb(var(--color-accent-600))]' : 
        'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-700))]'
      }`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    ),
  },
  {
    title: 'Created',
    dataIndex: 'created_at',
    render: (value?: Date) => value ? new Date(value).toLocaleString() : '-',
  },
  {
    title: 'Started',
    dataIndex: 'processed_at',
    render: (value?: Date) => value ? new Date(value).toLocaleString() : '-',
  },
  {
    title: 'Completed',
    dataIndex: 'updated_at',
    render: (value?: Date) => value ? new Date(value).toLocaleString() : '-',
  },
];

interface JobHistoryTableProps {
  initialData?: JobData[];
}

export default function JobHistoryTable({ initialData = [] }: JobHistoryTableProps) {
  const [selectedJobId, setSelectedJobId] = React.useState<string | null>(null);
  const [data, setData] = React.useState<JobData[]>(initialData);
  const intervalRef = React.useRef<NodeJS.Timeout>();

  const hasActiveJobs = (jobs: JobData[]) => {
    console.log('Checking for active jobs:', jobs);

    return jobs.some(job => job.status === 'processing');
  };

  const fetchData = async () => {
    try {
      const newData = await getJobDetailsWithHistory({}) as JobData[];
      setData(newData);
      
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
        rowClassName={() => "hover:bg-[rgb(var(--color-primary-50))] cursor-pointer"}
      />

      <JobDetailsDrawer 
        jobId={selectedJobId}
        onClose={() => setSelectedJobId(null)}
      />
    </div>
  );
}
