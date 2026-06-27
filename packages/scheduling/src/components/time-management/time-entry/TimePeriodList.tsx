import React from 'react';
import { ITimePeriodWithStatusView, TimeSheetStatus } from '@alga-psa/types';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { BulkActionBar } from '@alga-psa/ui/components/BulkActionBar';
import { Settings, Trash2 } from 'lucide-react';
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

// Removing a row is a single action that fully clears it when possible. Each removable row
// resolves to a composite operation:
//  - deleteTimeSheetId: the user's empty draft (DRAFT/CHANGES_REQUESTED, no entries) to delete.
//  - deletePeriod:      whether to also delete the (then-unused) period so the row disappears.
// A manager removing their empty draft on an otherwise-unused period clears both in one go;
// on a shared period only the timesheet is removed (the period stays for the other users).
interface RowRemoval {
  deleteTimeSheetId?: string;
  deletePeriod: boolean;
}

const DELETABLE_STATUSES: ReadonlySet<string> = new Set(['DRAFT', 'CHANGES_REQUESTED']);

interface TimePeriodListProps {
  timePeriods: ITimePeriodWithStatusView[];
  onSelectTimePeriod: (timePeriod: ITimePeriodWithStatusView) => void;
  /** Removes the backing timesheets for the given ids. Omit to hide timesheet removal. */
  onDeleteTimeSheets?: (timeSheetIds: string[]) => Promise<void>;
  /** Removes the given unused periods entirely. Omit (or canManagePeriods=false) to hide period removal. */
  onDeletePeriods?: (periodIds: string[]) => Promise<void>;
  /** Whether the current user may remove tenant-wide periods (team manager). */
  canManagePeriods?: boolean;
}

function formatPeriodRange(startDate: string, endDate: string): string {
  return `${startDate.slice(0, 10)} - ${getLastInclusiveDay(endDate)}`;
}

export function TimePeriodList({
  timePeriods,
  onSelectTimePeriod,
  onDeleteTimeSheets,
  onDeletePeriods,
  canManagePeriods = false,
}: TimePeriodListProps) {
  const { t } = useTranslation('msp/time-entry');
  const { formatDate, formatNumber } = useFormatters();
  const router = useRouter();
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [selectedPeriodIds, setSelectedPeriodIds] = React.useState<Set<string>>(new Set());
  const [pendingRemovalIds, setPendingRemovalIds] = React.useState<string[] | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const canRemoveTimeSheets = !!onDeleteTimeSheets;
  const canRemovePeriods = canManagePeriods && !!onDeletePeriods;
  const removalEnabled = canRemoveTimeSheets || canRemovePeriods;

  const isCurrentPeriod = React.useCallback((start: string, end: string) => {
    const today = formatISO(new Date(), { representation: 'date' });
    const s = start.slice(0, 10);
    const e = end.slice(0, 10);
    // Periods are treated as half-open: [start_date, end_date)
    return today >= s && today < e;
  }, []);

  // Resolve a row to its single (possibly composite) removal, or null if nothing is removable.
  const getRowRemoval = React.useCallback((record: ITimePeriodWithStatusView): RowRemoval | null => {
    const hasUserSheet = !!record.timeSheetId;
    const userHasEmptyDraft = hasUserSheet
      && (record.entryCount ?? 1) === 0
      && DELETABLE_STATUSES.has(record.timeSheetStatus as string);

    // A user timesheet that is not an empty draft (has entries / submitted / approved) blocks the row.
    if (hasUserSheet && !userHasEmptyDraft) {
      return null;
    }

    const deleteTimeSheetId = userHasEmptyDraft && canRemoveTimeSheets ? (record.timeSheetId as string) : undefined;
    // The user's sheet (if any) must actually be going away for the period to become empty.
    const userSheetCleared = hasUserSheet ? !!deleteTimeSheetId : true;
    const sheetsLeftAfter = (record.periodTimesheetCount ?? Infinity) - (hasUserSheet ? 1 : 0);
    const deletePeriod = canRemovePeriods
      && userSheetCleared
      && sheetsLeftAfter <= 0
      && !isCurrentPeriod(record.start_date, record.end_date);

    if (!deleteTimeSheetId && !deletePeriod) {
      return null;
    }
    return { deleteTimeSheetId, deletePeriod };
  }, [canRemovePeriods, canRemoveTimeSheets, isCurrentPeriod]);

  const removableIds = React.useMemo(
    () => timePeriods.filter((record) => getRowRemoval(record) !== null).map((record) => record.period_id),
    [timePeriods, getRowRemoval],
  );

  // Drop selections that are no longer removable (e.g. after a refresh changed the row).
  React.useEffect(() => {
    const valid = new Set(removableIds);
    setSelectedPeriodIds((prev) => {
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [removableIds]);

  const allRemovableSelected = removableIds.length > 0 && removableIds.every((id) => selectedPeriodIds.has(id));
  const someRemovableSelected = removableIds.some((id) => selectedPeriodIds.has(id));

  // Split a set of row period_ids into the two underlying removal operations.
  const partitionForRemoval = React.useCallback((periodIds: string[]) => {
    const timeSheetIds: string[] = [];
    const periodsToDelete: string[] = [];
    periodIds.forEach((periodId) => {
      const record = timePeriods.find((r) => r.period_id === periodId);
      if (!record) {
        return;
      }
      const removal = getRowRemoval(record);
      if (!removal) {
        return;
      }
      if (removal.deleteTimeSheetId) {
        timeSheetIds.push(removal.deleteTimeSheetId);
      }
      if (removal.deletePeriod) {
        periodsToDelete.push(periodId);
      }
    });
    return { timeSheetIds, periodsToDelete };
  }, [timePeriods, getRowRemoval]);

  const pendingCounts = React.useMemo(() => {
    if (!pendingRemovalIds) {
      return { timesheets: 0, periods: 0 };
    }
    const { timeSheetIds, periodsToDelete } = partitionForRemoval(pendingRemovalIds);
    return { timesheets: timeSheetIds.length, periods: periodsToDelete.length };
  }, [pendingRemovalIds, partitionForRemoval]);

  const toggleSelectAll = (checked: boolean) => {
    setSelectedPeriodIds(checked ? new Set(removableIds) : new Set());
  };

  const toggleOne = (periodId: string) => {
    setSelectedPeriodIds((prev) => {
      const next = new Set(prev);
      if (next.has(periodId)) {
        next.delete(periodId);
      } else {
        next.add(periodId);
      }
      return next;
    });
  };

  const handleConfirmRemoval = async () => {
    if (!pendingRemovalIds) {
      return;
    }
    const { timeSheetIds, periodsToDelete } = partitionForRemoval(pendingRemovalIds);
    setIsDeleting(true);
    try {
      if (timeSheetIds.length > 0 && onDeleteTimeSheets) {
        await onDeleteTimeSheets(timeSheetIds);
      }
      if (periodsToDelete.length > 0 && onDeletePeriods) {
        await onDeletePeriods(periodsToDelete);
      }
      setSelectedPeriodIds((prev) => {
        const next = new Set(prev);
        pendingRemovalIds.forEach((id) => next.delete(id));
        return next;
      });
      setPendingRemovalIds(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const removalMessage = (): string => {
    const rows = pendingRemovalIds?.length ?? 0;
    const { periods } = pendingCounts;
    if (periods > 0) {
      return t('timePeriodList.remove.message', {
        defaultValue: 'Remove {{count}} selected period(s)? Unused pay periods are removed for the whole organization, along with any empty draft time logged in them. This cannot be undone.',
        count: rows,
      });
    }
    return t('timePeriodList.remove.timesheetMessage', {
      defaultValue: 'Remove {{count}} unused time sheet(s)? Only empty draft time sheets are removed and this cannot be undone.',
      count: rows,
    });
  };

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

  const selectionColumn = {
    title: (
      <div className="flex items-center justify-center" onClick={(event: React.MouseEvent) => event.stopPropagation()}>
        <Checkbox
          id="time-periods-select-all"
          checked={allRemovableSelected}
          indeterminate={someRemovableSelected && !allRemovableSelected}
          disabled={removableIds.length === 0}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            event.stopPropagation();
            toggleSelectAll(event.target.checked);
          }}
          containerClassName="mb-0"
          className="m-0"
          skipRegistration
        />
      </div>
    ),
    dataIndex: 'selection',
    width: '4%',
    sortable: false,
    render: (_: unknown, record: ITimePeriodWithStatusView) => {
      if (getRowRemoval(record) === null) {
        return null;
      }
      const isChecked = selectedPeriodIds.has(record.period_id);
      return (
        <div className="flex items-center justify-center" onClick={(event: React.MouseEvent) => event.stopPropagation()}>
          <Checkbox
            id={`time-period-select-${record.period_id}`}
            checked={isChecked}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              event.stopPropagation();
              toggleOne(record.period_id);
            }}
            containerClassName="mb-0"
            className="m-0"
            skipRegistration
          />
        </div>
      );
    }
  };

  const baseColumns = [
    {
      title: t('timePeriodList.columns.period', { defaultValue: 'Period' }),
      dataIndex: 'start_date',
      width: '30%',
      render: (_: unknown, record: ITimePeriodWithStatusView) => formatPeriodRange(record.start_date, record.end_date)
    },
    {
      title: t('timePeriodList.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'timeSheetStatus',
      width: '20%',
      render: (status: TimeSheetStatus, record: ITimePeriodWithStatusView) => {
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
      width: '12%',
      render: (hoursEntered: number) => formatHoursEntered(hoursEntered)
    },
    {
      title: t('timePeriodList.columns.daysLogged', { defaultValue: 'Days Logged' }),
      dataIndex: 'daysLogged',
      width: '10%',
      render: (daysLogged: number) => formatDaysLogged(daysLogged)
    },
    {
      title: t('timePeriodList.columns.lastEntry', { defaultValue: 'Last Entry' }),
      dataIndex: 'lastEntryDate',
      width: '14%',
      render: (lastEntryDate?: string) => formatLastEntryDate(lastEntryDate)
    },
    {
      title: t('timePeriodList.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'action',
      width: '10%',
      // Removal is selection-driven (checkbox + floating bulk bar); no per-row delete here.
      render: (_: unknown, record: ITimePeriodWithStatusView) => (
        <Button
          id={`view-period-${record.period_id}`}
          onClick={() => onSelectTimePeriod(record)}
          variant="soft"
        >
          {t('common.actions.view', { defaultValue: 'View' })}
        </Button>
      )
    }
  ];

  const columns = removalEnabled ? [selectionColumn, ...baseColumns] : baseColumns;

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
        columns={columns}
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

      {removalEnabled && selectedPeriodIds.size > 0 && (
        <BulkActionBar
          idPrefix="timesheet-bulk-action-bar"
          count={selectedPeriodIds.size}
          selectedLabel={t('timePeriodList.bulk.selectedCount', { defaultValue: '{{count}} selected', count: selectedPeriodIds.size })}
          actions={[
            {
              id: 'delete',
              label: t('common.actions.remove', { defaultValue: 'Remove' }),
              icon: <Trash2 className="h-4 w-4" />,
              onClick: () => setPendingRemovalIds([...selectedPeriodIds]),
              destructive: true,
            },
          ]}
          onClear={() => setSelectedPeriodIds(new Set())}
          clearLabel={t('common.actions.clear', { defaultValue: 'Clear' })}
        />
      )}

      {pendingRemovalIds && (
        <ConfirmationDialog
          id="timesheet-delete-confirmation"
          isOpen={true}
          isConfirming={isDeleting}
          onConfirm={handleConfirmRemoval}
          onClose={() => {
            if (!isDeleting) {
              setPendingRemovalIds(null);
            }
          }}
          title={t('timePeriodList.remove.title', { defaultValue: 'Remove unused items' })}
          message={removalMessage()}
          confirmLabel={t('common.actions.remove', { defaultValue: 'Remove' })}
        />
      )}
    </div>
  );
}
