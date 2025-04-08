import React from 'react';
import { ITimePeriodWithStatusView, TimeSheetStatus } from 'server/src/interfaces/timeEntry.interfaces';
import { Button } from '@radix-ui/themes';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';

interface TimePeriodListProps {
  timePeriods: ITimePeriodWithStatusView[];
  onSelectTimePeriod: (timePeriod: ITimePeriodWithStatusView) => void;
}

const getStatusDisplay = (status: TimeSheetStatus): { text: string; color: string } => {
  switch (status) {
    case 'DRAFT':
      return { text: 'In Progress', color: 'blue' };
    case 'SUBMITTED':
      return { text: 'Submitted', color: 'yellow' };
    case 'APPROVED':
      return { text: 'Approved', color: 'green' };
    case 'CHANGES_REQUESTED':
      return { text: 'Changes Requested', color: 'orange' };
    default:
      return { text: 'Unknown', color: 'gray' };
  }
};

export function TimePeriodList({ timePeriods, onSelectTimePeriod }: TimePeriodListProps) {
  return (
    <div className="space-y-4 w-full">
      <h2 className="text-2xl font-bold mb-4">Select a Time Period</h2>
      <DataTable
        data={timePeriods}
        columns={[
          {
            title: 'Start Date',
            dataIndex: 'start_date',
            width: '25%',
            render: (value) => value.slice(0, 10)
          },
          {
            title: 'End Date',
            dataIndex: 'end_date', 
            width: '25%',
            render: (value) => value.slice(0, 10)
          },
          {
            title: 'Status',
            dataIndex: 'timeSheetStatus',
            width: '25%',
            render: (status: TimeSheetStatus) => {
              const { text, color } = getStatusDisplay(status);
              return (
                <span className={`px-2 py-1 rounded-full text-xs font-medium bg-${color}-100 text-${color}-800`}>
                  {text}
                </span>
              );
            }
          },
          {
            title: 'Actions',
            dataIndex: 'action',
            width: '10%',
            render: (_, record) => (
              <Button
                id={`view-period-${record.period_id}`}
                onClick={() => onSelectTimePeriod(record)}
                variant="soft"
                color="purple"
              >
                View
              </Button>
            )
          }
        ]}
        pagination={false}
        onRowClick={(row: ITimePeriodWithStatusView) => onSelectTimePeriod(row)}
        rowClassName={(row: ITimePeriodWithStatusView) => 
          row.timeSheetStatus === 'APPROVED' 
            ? 'bg-green-50' 
            : row.timeSheetStatus === 'CHANGES_REQUESTED'
              ? 'bg-orange-100'
              : ''
        }
      />
    </div>
  );
}
