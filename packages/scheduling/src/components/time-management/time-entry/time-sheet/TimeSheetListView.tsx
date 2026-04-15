'use client'

import React, { useState, useMemo, useRef } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import TimeSheetListViewSkeleton from '@alga-psa/ui/components/skeletons/TimeSheetListViewSkeleton';
import { Plus, ClipboardList, ArrowRight, ChevronDown, ChevronRight, Copy, ExternalLink } from 'lucide-react';
import { ITimeEntryWithWorkItemString } from '@alga-psa/types';
import { IExtendedWorkItem } from '@alga-psa/types';
import { formatISO, parseISO, format } from 'date-fns';
import { BillabilityPercentage, billabilityColorScheme, formatDuration, formatWorkItemType, formatTimeRange } from './utils';
import { TimeEntrySelectionRequest, TimeSheetListFocusFilter } from './types';
import { BillableLegend } from './BillableLegend';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { TimeEntryChangeRequestIndicator } from './TimeEntryChangeRequestFeedback';

interface TimeSheetListViewProps {
    dates: Date[];
    workItemsByType: Record<string, IExtendedWorkItem[]>;
    groupedTimeEntries: Record<string, ITimeEntryWithWorkItemString[]>;
    isEditable: boolean;
    isLoading?: boolean;
    onDeleteWorkItem: (workItemId: string) => Promise<void>;
    onCellClick: (params: TimeEntrySelectionRequest) => void;
    onAddWorkItem: (date?: string) => void;
    onWorkItemClick: (workItem: IExtendedWorkItem) => void;
    focusFilter?: TimeSheetListFocusFilter | null;
    onClearFocusFilter?: () => void;
    onBackToGrid?: () => void;
}

interface FlattenedEntry {
    entry: ITimeEntryWithWorkItemString;
    workItem: IExtendedWorkItem;
    date: Date;
    dateKey: string;
    duration: number;
    billabilityPercentage: number;
}

interface DayGroup {
    dateKey: string;
    date: Date;
    entries: FlattenedEntry[];
    totalDuration: number;
    totalBillable: number;
}

export function TimeSheetListView({
    dates,
    workItemsByType,
    groupedTimeEntries,
    isEditable,
    isLoading = false,
    onCellClick,
    onAddWorkItem,
    onWorkItemClick,
    onDeleteWorkItem,
    focusFilter = null,
    onClearFocusFilter,
    onBackToGrid,
}: TimeSheetListViewProps): React.JSX.Element {
    const { t } = useTranslation('msp/time-entry');
    const [selectedWorkItemToDelete, setSelectedWorkItemToDelete] = useState<string | null>(null);
    const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
    const previousDayLayoutSignatureRef = useRef<string>('');
    const headerColumnWidths = ['3%', '40%', '15%', '15%', '15%', '12%'] as const;
    const dayColumnWidths = ['3%', '40%', '15%', '15%', '15%', '10%'] as const;

    // Get date range boundaries for filtering
    const dateRange = useMemo(() => {
        if (dates.length === 0) return null;
        const startDate = new Date(dates[0]);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(dates[dates.length - 1]);
        endDate.setHours(23, 59, 59, 999);
        return { startDate, endDate };
    }, [dates]);

    // Flatten all time entries into a single list, filtering by date range
    const flattenedEntries = useMemo((): FlattenedEntry[] => {
        const allWorkItems = Object.values(workItemsByType).flat();
        const entries: FlattenedEntry[] = [];

        Object.entries(groupedTimeEntries).forEach(([workItemId, workItemEntries]) => {
            const workItem = allWorkItems.find(w => w.work_item_id === workItemId);
            if (!workItem) return;

            workItemEntries.forEach(entry => {
                const start = parseISO(entry.start_time);

                // Filter entries to only those within the time period
                if (dateRange) {
                    if (start < dateRange.startDate || start > dateRange.endDate) {
                        return; // Skip entries outside the date range
                    }
                }

                const end = parseISO(entry.end_time);
                const duration = (end.getTime() - start.getTime()) / (1000 * 60);
                const billabilityPercentage = duration === 0 ? 0 :
                    Math.round((entry.billable_duration / duration) * 100);

                entries.push({
                    entry,
                    workItem,
                    date: start,
                    dateKey: format(start, 'yyyy-MM-dd'),
                    duration,
                    billabilityPercentage
                });
            });
        });

        return entries;
    }, [groupedTimeEntries, workItemsByType, dateRange]);

    const filteredEntries = useMemo((): FlattenedEntry[] => {
        if (!focusFilter) {
            return flattenedEntries;
        }

        const focusEntryIds = new Set(focusFilter.entryIds);
        return flattenedEntries.filter(({ entry, workItem, dateKey }) =>
            workItem.work_item_id === focusFilter.workItemId &&
            dateKey === focusFilter.date &&
            typeof entry.entry_id === 'string' &&
            focusEntryIds.has(entry.entry_id),
        );
    }, [flattenedEntries, focusFilter]);

    // Group entries by day
    const dayGroups = useMemo((): DayGroup[] => {
        const groups = new Map<string, DayGroup>();

        if (focusFilter) {
            filteredEntries.forEach((flatEntry) => {
                const existingGroup = groups.get(flatEntry.dateKey);
                if (existingGroup) {
                    existingGroup.entries.push(flatEntry);
                    existingGroup.totalDuration += flatEntry.duration;
                    existingGroup.totalBillable += flatEntry.entry.billable_duration;
                    return;
                }

                groups.set(flatEntry.dateKey, {
                    dateKey: flatEntry.dateKey,
                    date: flatEntry.date,
                    entries: [flatEntry],
                    totalDuration: flatEntry.duration,
                    totalBillable: flatEntry.entry.billable_duration,
                });
            });
        } else {
            dates.forEach(date => {
                const dateKey = format(date, 'yyyy-MM-dd');
                groups.set(dateKey, {
                    dateKey,
                    date,
                    entries: [],
                    totalDuration: 0,
                    totalBillable: 0
                });
            });

            filteredEntries.forEach(entry => {
                const group = groups.get(entry.dateKey);
                if (group) {
                    group.entries.push(entry);
                    group.totalDuration += entry.duration;
                    group.totalBillable += entry.entry.billable_duration;
                }
            });
        }

        groups.forEach(group => {
            group.entries.sort((a, b) => a.date.getTime() - b.date.getTime());
        });

        return Array.from(groups.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [filteredEntries, dates, focusFilter]);

    // Calculate totals
    const totals = useMemo(() => {
        return filteredEntries.reduce((acc, { duration, entry }) => ({
            totalDuration: acc.totalDuration + duration,
            totalBillable: acc.totalBillable + entry.billable_duration
        }), { totalDuration: 0, totalBillable: 0 });
    }, [filteredEntries]);

    const hasWorkItems = Object.values(workItemsByType).some(items => items.length > 0);
    const hasVisibleEntries = filteredEntries.length > 0;

    const unresolvedFeedbackDayKeys = useMemo(
        () => dayGroups
            .filter((group) => group.entries.some(({ entry }) =>
                entry.change_request_state === 'unresolved' ||
                entry.approval_status === 'CHANGES_REQUESTED',
            ))
            .map((group) => group.dateKey),
        [dayGroups],
    );

    // Expand all populated days on initial layout changes, and always reopen days with unresolved feedback.
    React.useEffect(() => {
        const dayLayoutSignature = dayGroups.map((group) => group.dateKey).join('|');
        const daysWithEntries = dayGroups.filter((group) => group.entries.length > 0).map((group) => group.dateKey);

        setExpandedDays((prevExpandedDays) => {
            const nextExpandedDays = dayLayoutSignature !== previousDayLayoutSignatureRef.current
                ? new Set(daysWithEntries)
                : new Set(prevExpandedDays);

            unresolvedFeedbackDayKeys.forEach((dateKey) => nextExpandedDays.add(dateKey));

            return nextExpandedDays;
        });

        previousDayLayoutSignatureRef.current = dayLayoutSignature;
    }, [dayGroups, unresolvedFeedbackDayKeys]);

    const toggleDay = (dateKey: string) => {
        setExpandedDays(prev => {
            const next = new Set(prev);
            if (next.has(dateKey)) {
                next.delete(dateKey);
            } else {
                next.add(dateKey);
            }
            return next;
        });
    };

    const handleEntryClick = (flatEntry: FlattenedEntry) => {
        const { entry, workItem } = flatEntry;
        const dateStr = entry.work_date || formatISO(parseISO(entry.start_time), { representation: 'date' });

        onCellClick({
            workItem,
            date: dateStr,
            entries: [entry],
            defaultStartTime: entry.start_time,
            defaultEndTime: entry.end_time
        });
    };

    const listAutomationProps = {
        id: 'timesheet-list-view',
        'data-automation-id': 'timesheet-list-view',
        'data-automation-type': 'container',
    } as const;

    // Use the skeleton component
    const renderSkeleton = () => <TimeSheetListViewSkeleton dayCount={Math.min(dates.length, 5)} />;

    return (
        <div>
            <ReflectionContainer id="timesheet-list-view" label="Time Sheet List View">
                <React.Fragment>
                    {selectedWorkItemToDelete && (
                        <ConfirmationDialog
                            id="timesheet-list-delete-work-item-confirmation"
                            isOpen={true}
                            onConfirm={async () => {
                                await onDeleteWorkItem(selectedWorkItemToDelete);
                                setSelectedWorkItemToDelete(null);
                            }}
                            onClose={() => setSelectedWorkItemToDelete(null)}
                            title={t('timeSheetList.delete.title', { defaultValue: 'Delete Work Item' })}
                            message={t('timeSheetList.delete.message', {
                                defaultValue: 'This will permanently delete all time entries for this work item. This action cannot be undone.'
                            })}
                            confirmLabel={t('common.actions.delete', { defaultValue: 'Delete' })}
                        />
                    )}

                    <div className="overflow-hidden bg-white border border-gray-200 rounded-lg shadow-md" {...listAutomationProps}>
                        {focusFilter && (
                            <div
                                id="timesheet-list-focus-filter"
                                className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgb(var(--color-primary-200))] bg-[rgb(var(--color-primary-50))] px-3 py-3"
                            >
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-[rgb(var(--color-primary-700))]">
                                        {t('timeSheetList.focusFilter.summary', {
                                            defaultValue: 'Showing {{count}} entries for {{workItem}} on {{date}}',
                                            count: focusFilter.entryCount,
                                            workItem: focusFilter.workItemLabel,
                                            date: focusFilter.dateLabel,
                                        })}
                                    </p>
                                    <p className="text-xs text-[rgb(var(--color-primary-600))]">
                                        {t('timeSheetList.focusFilter.description', {
                                            defaultValue: 'Only entries from the selected grid cell are visible.',
                                        })}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {onClearFocusFilter && (
                                        <Button
                                            id="clear-time-entry-focus-filter-button"
                                            variant="outline"
                                            size="sm"
                                            onClick={onClearFocusFilter}
                                        >
                                            {t('common.actions.clearFilter', { defaultValue: 'Clear filter' })}
                                        </Button>
                                    )}
                                    {onBackToGrid && (
                                        <Button
                                            id="back-to-grid-view-button"
                                            variant="soft"
                                            size="sm"
                                            onClick={onBackToGrid}
                                        >
                                            {t('timeSheetList.focusFilter.backToGrid', { defaultValue: 'Back to grid' })}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Header with Add button on left, totals right */}
                        <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                {isEditable && (
                                    <Button
                                        id="add-work-item-button-list"
                                        variant="dashed"
                                        size="sm"
                                        onClick={() => onAddWorkItem()}
                                    >
                                        <Plus className="h-4 w-4 mr-1.5" />
                                        {t('common.actions.addItem', { defaultValue: 'Add Item' })}
                                    </Button>
                                )}
                            </div>
                            <div className="flex items-center gap-4 text-sm text-gray-500">
                                <span>
                                    {filteredEntries.length} {filteredEntries.length === 1
                                        ? t('timeSheetList.summary.entryOne', { defaultValue: 'entry' })
                                        : t('timeSheetList.summary.entryOther', { defaultValue: 'entries' })}
                                </span>
                                <span className="font-medium text-gray-700">
                                    {t('timeSheetList.summary.total', { defaultValue: 'Total: {{value}}', value: formatDuration(totals.totalDuration) })}
                                </span>
                                <span className="font-medium text-[rgb(var(--color-primary-600))]">
                                    {t('timeSheetList.summary.billable', { defaultValue: 'Billable: {{value}}', value: formatDuration(totals.totalBillable) })}
                                </span>
                            </div>
                        </div>

                        {isLoading ? (
                            renderSkeleton()
                        ) : !hasWorkItems || !hasVisibleEntries ? (
                            <div className="flex w-full h-48 items-center justify-center py-8 px-4">
                                <div className="flex flex-col items-center justify-center text-center max-w-md">
                                    <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                                        <ClipboardList className="w-6 h-6 text-gray-400" />
                                    </div>
                                    <h3 className="text-base font-semibold text-gray-900 mb-1">
                                        {t('timeSheetList.empty.title', { defaultValue: 'No time entries yet' })}
                                    </h3>
                                    <p className="text-gray-500 text-sm mb-3">
                                        {t('timeSheetList.empty.description', {
                                            defaultValue: 'Add a work item and start tracking your time.'
                                        })}
                                    </p>
                                    <Button
                                        id="get-started-button-list"
                                        variant="link"
                                        onClick={() => onAddWorkItem()}
                                        disabled={!isEditable}
                                    >
                                        {t('common.actions.getStarted', { defaultValue: 'Get Started' })}
                                        <ArrowRight className="w-4 h-4 ml-1" />
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-200">
                                {/* Column headers - shown once at top */}
                                <div className="bg-gray-50 border-b border-gray-200">
                                    <table className="w-full table-fixed">
                                        <colgroup>
                                            {headerColumnWidths.map((width, index) => (
                                                <col key={`header-col-${index}`} style={{ width }} />
                                            ))}
                                        </colgroup>
                                        <thead>
                                            <tr>
                                                <th className="pl-3" />
                                                <th className="py-2 pr-3 text-left text-xs font-medium text-gray-500 tracking-wider">
                                                    {t('timeSheetList.columns.workItem', { defaultValue: 'Work Item' })}
                                                </th>
                                                <th className="py-2 px-3 text-left text-xs font-medium text-gray-500 tracking-wider">
                                                    {t('timeSheetList.columns.timeEntry', { defaultValue: 'Time Entry' })}
                                                </th>
                                                <th className="py-2 px-3 text-left text-xs font-medium text-gray-500 tracking-wider">
                                                    {t('timeSheetList.columns.duration', { defaultValue: 'Duration' })}
                                                </th>
                                                <th className="py-2 px-3 text-left text-xs font-medium text-gray-500 tracking-wider">
                                                    {t('timeSheetList.columns.billableDuration', { defaultValue: 'Billable Duration' })}
                                                </th>
                                                <th className="py-2 px-3 text-right text-xs font-medium text-gray-500 tracking-wider">
                                                    {t('timeSheetList.columns.actions', { defaultValue: 'Actions' })}
                                                </th>
                                                <th className="py-2 px-3" />
                                            </tr>
                                        </thead>
                                    </table>
                                </div>
                                {dayGroups.map((group) => {
                                    const isExpanded = expandedDays.has(group.dateKey);
                                    const hasEntries = group.entries.length > 0;

                                    return (
                                        <div key={group.dateKey}>
                                            {/* Day header and entries use same table structure for column alignment */}
                                            <table className="w-full table-fixed">
                                                <colgroup>
                                                    {dayColumnWidths.map((width, index) => (
                                                        <col key={`${group.dateKey}-col-${index}`} style={{ width }} />
                                                    ))}
                                                </colgroup>
                                                {/* Day header row */}
                                                <thead>
                                                    <tr
                                                        className={`${
                                                            hasEntries
                                                                ? 'bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer'
                                                                : 'bg-gray-50/50 dark:bg-gray-800/30 cursor-default'
                                                        }`}
                                                        onClick={() => hasEntries && toggleDay(group.dateKey)}
                                                    >
                                                        <td className="py-2 pl-3">
                                                            {hasEntries ? (
                                                                isExpanded ? (
                                                                    <ChevronDown className="h-4 w-4 text-gray-400" />
                                                                ) : (
                                                                    <ChevronRight className="h-4 w-4 text-gray-400" />
                                                                )
                                                            ) : (
                                                                <div className="w-4" />
                                                            )}
                                                        </td>
                                                        <td className="py-2 pr-3">
                                                            <span className={`text-base font-medium ${hasEntries ? 'text-gray-900' : 'text-gray-400'}`}>
                                                                {format(group.date, 'EEE, MMM d')}
                                                            </span>
                                                        </td>
                                                        <td className="py-2 px-3 text-sm text-gray-500">
                                                            {hasEntries ? (
                                                                `${group.entries.length} ${group.entries.length === 1
                                                                    ? t('timeSheetList.summary.entryOne', { defaultValue: 'entry' })
                                                                    : t('timeSheetList.summary.entryOther', { defaultValue: 'entries' })}`
                                                            ) : (
                                                                <span className="text-gray-400 italic">
                                                                    {t('timeSheetList.empty.noEntries', { defaultValue: 'No entries' })}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="py-2 px-3 text-sm font-medium text-gray-700">
                                                            {hasEntries && formatDuration(group.totalDuration)}
                                                        </td>
                                                        <td className="py-2 px-3 text-sm font-medium text-[rgb(var(--color-primary-600))]">
                                                            {hasEntries && formatDuration(group.totalBillable)}
                                                        </td>
                                                        <td className="py-2 px-3 text-right">
                                                            {isEditable && (
                                                                <Button
                                                                    id={`add-entry-${group.dateKey}`}
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        onAddWorkItem(group.dateKey);
                                                                    }}
                                                                    className="inline-flex items-center gap-1.5"
                                                                >
                                                                    <Plus className="h-4 w-4" />
                                                                    {t('common.actions.addEntry', { defaultValue: 'Entry' })}
                                                                </Button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                </thead>
                                                {/* Entry rows */}
                                                {isExpanded && hasEntries && (
                                                    <tbody className="divide-y divide-gray-100">
                                                        {group.entries.map((flatEntry, index) => {
                                                            const { entry, workItem, duration, billabilityPercentage } = flatEntry;

                                                            // Map to nearest billability tier
                                                            const billabilityTier = [0, 25, 50, 75, 100].reduce((prev, curr) =>
                                                                Math.abs(curr - billabilityPercentage) < Math.abs(prev - billabilityPercentage) ? curr : prev
                                                            ) as BillabilityPercentage;

                                                            const colors = billabilityColorScheme[billabilityTier];

                                                            return (
                                                                <tr
                                                                    key={`${entry.entry_id}-${index}`}
                                                                    className="group bg-white hover:bg-gray-50 cursor-pointer"
                                                                    onClick={() => handleEntryClick(flatEntry)}
                                                                    data-automation-id={`time-entry-row-${entry.entry_id}`}
                                                                >
                                                                    {/* Indent spacer */}
                                                                    <td className="pl-3" />

                                                                    {/* Work item info */}
                                                                    <td className="py-2 pr-3">
                                                                        <div className="flex items-center gap-2">
                                                                            <span
                                                                                className="text-sm text-gray-900 truncate"
                                                                                title={workItem.type === 'ticket'
                                                                                    ? `${workItem.ticket_number} - ${workItem.title || workItem.name}`
                                                                                    : workItem.name
                                                                                }
                                                                            >
                                                                                {workItem.type === 'ticket'
                                                                                    ? `${workItem.ticket_number} - ${workItem.title || workItem.name}`
                                                                                    : workItem.name
                                                                                }
                                                                            </span>
                                                                            <span className={`inline-flex shrink-0 items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                                                                                workItem.type === 'ticket'
                                                                                    ? 'bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-700))]'
                                                                                    : workItem.type === 'project_task'
                                                                                        ? 'bg-[rgb(var(--color-secondary-100))] text-[rgb(var(--color-secondary-700))]'
                                                                                        : workItem.type === 'interaction'
                                                                                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                                                                            : 'bg-gray-100 dark:bg-gray-800/30 text-gray-700 dark:text-gray-300'
                                                                            }`}>
                                                                                {formatWorkItemType(workItem.type)}
                                                                            </span>
                                                                        </div>
                                                                    </td>

                                                                    {/* Time range */}
                                                                    <td className="py-2 px-3">
                                                                        <div className="flex flex-col items-start gap-1">
                                                                            <span className="text-sm text-gray-500">
                                                                                {formatTimeRange(entry.start_time, entry.end_time)}
                                                                            </span>
                                                                            <TimeEntryChangeRequestIndicator
                                                                                changeRequests={entry.change_requests}
                                                                                showLabel
                                                                            />
                                                                        </div>
                                                                    </td>

                                                                    {/* Duration */}
                                                                    <td className="py-2 px-3">
                                                                        <span className="text-sm font-medium text-gray-700">
                                                                            {formatDuration(duration)}
                                                                        </span>
                                                                    </td>

                                                                    {/* Billable indicator */}
                                                                    <td className="py-2 px-3">
                                                                        <div
                                                                            className="inline-flex items-center px-2 py-0.5 rounded text-sm font-medium"
                                                                            style={{
                                                                                backgroundColor: colors.background,
                                                                                color: colors.text
                                                                            }}
                                                                            title={t('common.units.percentBillable', {
                                                                                defaultValue: '{{value}}% billable',
                                                                                value: billabilityPercentage
                                                                            })}
                                                                        >
                                                                            {formatDuration(entry.billable_duration)}
                                                                        </div>
                                                                    </td>

                                                                    {/* Actions */}
                                                                    <td className="py-2 px-3 text-right">
                                                                        {isEditable && (
                                                                            <div className="flex items-center justify-end gap-1">
                                                                                {/* Copy entry - opens dialog with prefilled data */}
                                                                                <Button
                                                                                    id={`copy-entry-${entry.entry_id}`}
                                                                                    variant="ghost"
                                                                                    size="sm"
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        // Open dialog with prefilled data but empty entries (to create new)
                                                                                        const nextDayIndex = dayGroups.findIndex(g => g.dateKey === group.dateKey) + 1;
                                                                                        const targetDay = nextDayIndex < dayGroups.length
                                                                                            ? dayGroups[nextDayIndex]
                                                                                            : dayGroups[0];

                                                                                        onCellClick({
                                                                                            workItem,
                                                                                            date: targetDay.dateKey,
                                                                                            entries: [], // Empty = create new entry
                                                                                            defaultStartTime: entry.start_time,
                                                                                            defaultEndTime: entry.end_time
                                                                                        });
                                                                                    }}
                                                                                    title={t('common.actions.copyToAnotherDay', { defaultValue: 'Copy to another day' })}
                                                                                >
                                                                                    <Copy className="h-4 w-4" />
                                                                                </Button>
                                                                                <Button
                                                                                    id={`view-work-item-${entry.entry_id}`}
                                                                                    variant="ghost"
                                                                                    size="sm"
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        onWorkItemClick(workItem);
                                                                                    }}
                                                                                    title={t('common.actions.viewDetails', { defaultValue: 'View details' })}
                                                                                >
                                                                                    <ExternalLink className="h-4 w-4" />
                                                                                </Button>
                                                                            </div>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                )}
                                            </table>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Billable Legend */}
                    {filteredEntries.length > 0 && (
                        <BillableLegend className="mt-6" />
                    )}
                </React.Fragment>
            </ReflectionContainer>
        </div>
    );
}
