'use client';

import React from 'react';
import { JobData } from '@/lib/jobs/jobScheduler';
import { DataTable } from '@/components/ui/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';

const columns: ColumnDefinition<JobData>[] = [
  {
    title: 'Job Name',
    dataIndex: 'type',
  },
  {
    title: 'Status',
    dataIndex: 'status',
  },
  {
    title: 'Created',
    dataIndex: 'created_at',
    render: (value?: Date) => value ? value.toLocaleString() : '-',
  },
  {
    title: 'Started',
    dataIndex: 'processed_at',
    render: (value?: Date) => value ? value.toLocaleString() : '-',
  },
  {
    title: 'Completed',
    dataIndex: 'updated_at',
    render: (value?: Date) => value ? value.toLocaleString() : '-',
  },
];

interface JobHistoryTableProps {
  initialData?: JobData[];
}

export default function JobHistoryTable({ initialData = [] }: JobHistoryTableProps) {
  return (
    <div className="w-full">
      <DataTable
        data={initialData}
        columns={columns}
      />
    </div>
  );
}