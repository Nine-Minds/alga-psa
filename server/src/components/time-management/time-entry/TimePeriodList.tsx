import React from 'react';
import { ITimePeriodWithStatusView, TimeSheetStatus } from 'server/src/interfaces/timeEntry.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatISO } from 'date-fns';
import { Temporal } from '@js-temporal/polyfill';

// Helper to get the last inclusive day from an exclusive end_date
// end_date is the day AFTER the period ends (exclusive boundary)
function getLastInclusiveDay(exclusiveEndDate: string): string {
  const endDate = Temporal.PlainDate.from(exclusiveEndDate.slice(0, 10));
  const lastDay = endDate.subtract({ days: 1 });
  return lastDay.toString();
}

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
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);

  const navigateToTimeSettings = () => {
    // Navigate to Time Entry tab and then to Time Periods nested tab
    router.push('/msp/settings?tab=time-entry&subtab=time-periods');
  };

  const isCurrentPeriod = (start: string, end: string) => {
    const today = formatISO(new Date(), { representation: 'date' });
    const s = start.slice(0, 10);
    const e = end.slice(0, 10);
    // Periods are treated as half-open: [start_date, end_date)
    return today >= s && today < e;
  };

  return (
    <div className="space-y-4 w-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Select a Time Period</h2>
        <Button
          id="manage-time-periods-button"
          onClick={navigateToTimeSettings}
          variant="soft"
          className="flex items-center gap-2"
        >
          <Settings className="h-4 w-4" />
          Manage Time Periods
        </Button>
      </div>
      <DataTable
        id="time-periods-list"
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
            // Show the last inclusive day (end_date is exclusive - the day AFTER the period)
            render: (value) => getLastInclusiveDay(value)
          },
          {
            title: 'Status',
            dataIndex: 'timeSheetStatus',
            width: '25%',
            render: (status: TimeSheetStatus, record) => {
              const { text, color } = getStatusDisplay(status);
              return (
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium bg-${color}-100 text-${color}-800`}>
                    {text}
                  </span>
                  {isCurrentPeriod(record.start_date, record.end_date) && (
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-800))]">
                      Current
                    </span>
                  )}
                </div>
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
              >
                View
              </Button>
            )
          }
        ]}
        pagination={true}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        pageSize={pageSize}
        onItemsPerPageChange={(newSize) => {
          setPageSize(newSize);
          setCurrentPage(1);
        }}
        onRowClick={(row: ITimePeriodWithStatusView) => onSelectTimePeriod(row)}
        rowClassName={(row: ITimePeriodWithStatusView) => {
          const classes: string[] = [];
          if (row.timeSheetStatus === 'APPROVED') {
            classes.push('bg-green-50');
          } else if (row.timeSheetStatus === 'CHANGES_REQUESTED') {
            classes.push('bg-orange-100');
          }

          if (isCurrentPeriod(row.start_date, row.end_date)) {
            // Always add a primary left border to indicate current period
            classes.push('border-l-4 border-[rgb(var(--color-primary-500))]');
            // Only add a light primary background if no status-specific background present
            if (!classes.some(c => c.startsWith('bg-'))) {
              classes.push('bg-[rgb(var(--color-primary-50))]');
            }
          }

          return classes.join(' ');
        }}
      />
    </div>
  );
}
