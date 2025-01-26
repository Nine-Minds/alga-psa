'use client';

import React from 'react';
import { JobData } from '@/lib/jobs/jobScheduler';
import { DataTable } from '@/components/ui/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';
import JobDetailsDrawer from './JobDetailsDrawer';
import { getJobDetailsWithHistory } from '@/lib/actions/job-actions';

const columns: ColumnDefinition<JobData>[] = [
  {
    title: 'Job Name',
    dataIndex: 'type',
  },
  {
    title: 'Status',
    dataIndex: 'status',
    render: (status: string) => (
      <span className={`font-medium px-2 py-1 rounded ${
        status === 'completed' ? 'bg-green-100 text-green-700' :
        status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
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
      />

      <JobDetailsDrawer 
        jobId={selectedJobId}
        onClose={() => setSelectedJobId(null)}
      />
    </div>
  );
}