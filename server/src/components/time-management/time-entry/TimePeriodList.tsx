import React from 'react';
import { ITimePeriodWithStatusView, TimeSheetStatus } from 'server/src/interfaces/timeEntry.interfaces';
import { Button } from '@radix-ui/themes';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';

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
  const router = useRouter();

  const navigateToTimeSettings = () => {
    router.push('/msp/settings?tab=time-entry');
  };

  return (
    <div className="space-y-4 w-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Select a Time Period</h2>
        <Button
          onClick={navigateToTimeSettings}
          variant="soft"
          color="gray"
          className="flex items-center gap-2"
        >
          <Settings className="h-4 w-4" />
          Manage Time Periods
        </Button>
      </div>
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
