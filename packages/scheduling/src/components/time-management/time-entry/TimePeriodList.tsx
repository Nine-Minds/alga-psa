import React from 'react';
import { ITimePeriodWithStatusView, TimeSheetStatus } from '@alga-psa/types';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatISO, parseISO } from 'date-fns';
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

function formatPeriodRange(startDate: string, endDate: string): string {
  return `${startDate.slice(0, 10)} - ${getLastInclusiveDay(endDate)}`;
}

export function TimePeriodList({ timePeriods, onSelectTimePeriod }: TimePeriodListProps) {
  const { t } = useTranslation('msp/time-entry');
  const { formatDate, formatNumber } = useFormatters();
  const router = useRouter();
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);

  const getStatusBadgeConfig = React.useCallback((status: string) => {
    const statusBadgeConfig: Record<string, { variant: 'outline' | 'secondary' | 'success' | 'warning'; label: string }> = {
      DRAFT: {
        variant: 'outline',
        label: t('common.states.inProgress', { defaultValue: 'In Progress' })
      },
      SUBMITTED: {
        variant: 'secondary',
        label: t('common.states.submitted', { defaultValue: 'Submitted' })
      },
      APPROVED: {
        variant: 'success',
        label: t('common.states.approved', { defaultValue: 'Approved' })
      },
      CHANGES_REQUESTED: {
        variant: 'warning',
        label: t('common.states.changesRequested', { defaultValue: 'Changes Requested' })
      },
    };

    return statusBadgeConfig[status] ?? {
      variant: 'outline' as const,
      label: t('common.states.unknown', { defaultValue: 'Unknown' })
    };
  }, [t]);

  const formatHoursEntered = React.useCallback((hoursEntered: number): string => {
    const formatted = formatNumber(hoursEntered, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1
    });

    return `${formatted}${t('common.units.hoursShort', { defaultValue: 'h' })}`;
  }, [formatNumber, t]);

  const formatDaysLogged = React.useCallback((daysLogged: number): string => {
    return `${daysLogged} ${daysLogged === 1
      ? t('common.units.dayOne', { defaultValue: 'day' })
      : t('common.units.dayOther', { defaultValue: 'days' })}`;
  }, [t]);

  const formatLastEntryDate = React.useCallback((lastEntryDate?: string): string => {
    if (!lastEntryDate) {
      return t('timePeriodList.lastEntry.none', { defaultValue: 'No entries' });
    }

    return formatDate(parseISO(lastEntryDate), {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }, [formatDate, t]);

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
        <h2 className="text-2xl font-bold">
          {t('timePeriodList.title', { defaultValue: 'Select a Time Period' })}
        </h2>
        <Button
          id="manage-time-periods-button"
          onClick={navigateToTimeSettings}
          variant="soft"
          className="flex items-center gap-2"
        >
          <Settings className="h-4 w-4" />
          {t('common.actions.manageTimePeriods', { defaultValue: 'Manage Time Periods' })}
        </Button>
      </div>
      <DataTable
        id="time-periods-list"
        data={timePeriods}
        columns={[
          {
            title: t('timePeriodList.columns.period', { defaultValue: 'Period' }),
            dataIndex: 'start_date',
            width: '28%',
            render: (_, record) => formatPeriodRange(record.start_date, record.end_date)
          },
          {
            title: t('timePeriodList.columns.status', { defaultValue: 'Status' }),
            dataIndex: 'timeSheetStatus',
            width: '20%',
            render: (status: TimeSheetStatus, record) => {
              const config = getStatusBadgeConfig(status);
              return (
                <div className="flex items-center gap-2">
                  <Badge variant={config.variant} className="py-1">{config.label}</Badge>
                  {isCurrentPeriod(record.start_date, record.end_date) && (
                    <Badge variant="primary" className="py-1">
                      {t('common.states.current', { defaultValue: 'Current' })}
                    </Badge>
                  )}
                </div>
              );
            }
          },
          {
            title: t('timePeriodList.columns.hoursEntered', { defaultValue: 'Hours Entered' }),
            dataIndex: 'hoursEntered',
            width: '14%',
            render: (hoursEntered: number) => formatHoursEntered(hoursEntered)
          },
          {
            title: t('timePeriodList.columns.daysLogged', { defaultValue: 'Days Logged' }),
            dataIndex: 'daysLogged',
            width: '12%',
            render: (daysLogged: number) => formatDaysLogged(daysLogged)
          },
          {
            title: t('timePeriodList.columns.lastEntry', { defaultValue: 'Last Entry' }),
            dataIndex: 'lastEntryDate',
            width: '16%',
            render: (lastEntryDate?: string) => formatLastEntryDate(lastEntryDate)
          },
          {
            title: t('timePeriodList.columns.actions', { defaultValue: 'Actions' }),
            dataIndex: 'action',
            width: '10%',
            render: (_, record) => (
              <Button
                id={`view-period-${record.period_id}`}
                onClick={() => onSelectTimePeriod(record)}
                variant="soft"
              >
                {t('common.actions.view', { defaultValue: 'View' })}
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
            classes.push('bg-table-status-approved');
          } else if (row.timeSheetStatus === 'CHANGES_REQUESTED') {
            classes.push('bg-table-status-warning');
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
