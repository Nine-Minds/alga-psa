'use client'

import React, { useState, useMemo } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import TimeSheetListViewSkeleton from '@alga-psa/ui/components/skeletons/TimeSheetListViewSkeleton';
import { Plus, Pencil, ClipboardList, ArrowRight, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { ITimeEntryWithWorkItemString } from '@alga-psa/types';
import { IExtendedWorkItem } from '@alga-psa/types';
import { formatISO, parseISO, format } from 'date-fns';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { BillabilityPercentage, billabilityColorScheme, formatDuration, formatWorkItemType, formatTimeRange } from './utils';
import { BillableLegend } from './BillableLegend';
import { ContainerComponent } from '@alga-psa/ui/ui-reflection/types';
import { CommonActions } from '@alga-psa/ui/ui-reflection/actionBuilders';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';

interface TimeSheetListViewProps {
    dates: Date[];
    workItemsByType: Record<string, IExtendedWorkItem[]>;
    groupedTimeEntries: Record<string, ITimeEntryWithWorkItemString[]>;
    isEditable: boolean;
    isLoading?: boolean;
    onDeleteWorkItem: (workItemId: string) => Promise<void>;
    onCellClick: (params: {
        workItem: IExtendedWorkItem;
        date: string;
        entries: ITimeEntryWithWorkItemString[];
        defaultStartTime?: string;
        defaultEndTime?: string;
    }) => void;
    onAddWorkItem: () => void;
    onWorkItemClick: (workItem: IExtendedWorkItem) => void;
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
    onDeleteWorkItem
}: TimeSheetListViewProps): React.JSX.Element {
    const [selectedWorkItemToDelete, setSelectedWorkItemToDelete] = useState<string | null>(null);
    const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

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

    // Group entries by day
    const dayGroups = useMemo((): DayGroup[] => {
        const groups = new Map<string, DayGroup>();

        // Initialize groups for all dates in the period
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

        // Add entries to their respective groups
        flattenedEntries.forEach(entry => {
            const group = groups.get(entry.dateKey);
            if (group) {
                group.entries.push(entry);
                group.totalDuration += entry.duration;
                group.totalBillable += entry.entry.billable_duration;
            }
        });

        // Sort entries within each group by start time
        groups.forEach(group => {
            group.entries.sort((a, b) => a.date.getTime() - b.date.getTime());
        });

        return Array.from(groups.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [flattenedEntries, dates]);

    // Calculate totals
    const totals = useMemo(() => {
        return flattenedEntries.reduce((acc, { duration, entry }) => ({
            totalDuration: acc.totalDuration + duration,
            totalBillable: acc.totalBillable + entry.billable_duration
        }), { totalDuration: 0, totalBillable: 0 });
    }, [flattenedEntries]);

    const hasWorkItems = Object.values(workItemsByType).some(items => items.length > 0);

    // Expand all days that have entries on initial load
    React.useEffect(() => {
        const daysWithEntries = dayGroups.filter(g => g.entries.length > 0).map(g => g.dateKey);
        setExpandedDays(new Set(daysWithEntries));
    }, [dayGroups.length]); // Only run when number of groups changes

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
        if (!isEditable) return;

        const { entry, workItem } = flatEntry;
        const dateStr = entry.work_date || formatISO(parseISO(entry.start_time), { representation: 'date' });

        // Get all entries for this work item on this date
        const entriesForDate = (groupedTimeEntries[workItem.work_item_id] || [])
            .filter(e => {
                const entryWorkDate = e.work_date?.slice(0, 10);
                if (entryWorkDate) return entryWorkDate === dateStr.slice(0, 10);
                return parseISO(e.start_time).toDateString() === parseISO(entry.start_time).toDateString();
            });

        onCellClick({
            workItem,
            date: dateStr,
            entries: entriesForDate,
            defaultStartTime: entry.start_time,
            defaultEndTime: entry.end_time
        });
    };

    // Register the list view container
    const { automationIdProps: listProps } = useAutomationIdAndRegister<ContainerComponent>({
        type: 'container',
        id: 'timesheet-list-view',
        label: 'Time Sheet List View',
    }, () => [
        CommonActions.focus('Focus on timesheet list view')
    ]);

    // Use the skeleton component
    const renderSkeleton = () => <TimeSheetListViewSkeleton dayCount={Math.min(dates.length, 5)} />;

    return (
        <div>
            <ReflectionContainer id="timesheet-list-view" label="Time Sheet List View">
                <React.Fragment>
                    <ConfirmationDialog
                        isOpen={!!selectedWorkItemToDelete}
                        onConfirm={async () => {
                            if (selectedWorkItemToDelete) {
                                await onDeleteWorkItem(selectedWorkItemToDelete);
                                setSelectedWorkItemToDelete(null);
                            }
                        }}
                        onClose={() => setSelectedWorkItemToDelete(null)}
                        title="Delete Work Item"
                        message="This will permanently delete all time entries for this work item. This action cannot be undone."
                        confirmLabel="Delete"
                    />

                    <div className="overflow-hidden bg-white border border-gray-200 rounded-lg shadow-md" {...listProps}>
                        {/* Header with Add button on left, totals right */}
                        <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                {isEditable && (
                                    <Button
                                        id="add-work-item-button-list"
                                        variant="dashed"
                                        size="sm"
                                        onClick={onAddWorkItem}
                                    >
                                        <Plus className="h-4 w-4 mr-1.5" />
                                        Add Item
                                    </Button>
                                )}
                            </div>
                            <div className="flex items-center gap-4 text-sm text-gray-500">
                                <span>{flattenedEntries.length} {flattenedEntries.length === 1 ? 'entry' : 'entries'}</span>
                                <span className="font-medium text-gray-700">
                                    Total: {formatDuration(totals.totalDuration)}
                                </span>
                                <span className="font-medium text-[rgb(var(--color-primary-600))]">
                                    Billable: {formatDuration(totals.totalBillable)}
                                </span>
                            </div>
                        </div>

                        {isLoading ? (
                            renderSkeleton()
                        ) : !hasWorkItems || flattenedEntries.length === 0 ? (
                            <div className="flex w-full h-48 items-center justify-center py-8 px-4">
                                <div className="flex flex-col items-center justify-center text-center max-w-md">
                                    <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                                        <ClipboardList className="w-6 h-6 text-gray-400" />
                                    </div>
                                    <h3 className="text-base font-semibold text-gray-900 mb-1">
                                        No time entries yet
                                    </h3>
                                    <p className="text-gray-500 text-sm mb-3">
                                        Add a work item and start tracking your time.
                                    </p>
                                    <Button
                                        id="get-started-button-list"
                                        variant="link"
                                        onClick={onAddWorkItem}
                                    >
                                        Get Started
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
                                            <col style={{ width: '3%' }} />
                                            <col style={{ width: '40%' }} />
                                            <col style={{ width: '15%' }} />
                                            <col style={{ width: '15%' }} />
                                            <col style={{ width: '15%' }} />
                                            <col style={{ width: '12%' }} />
                                        </colgroup>
                                        <thead>
                                            <tr>
                                                <th className="pl-3" />
                                                <th className="py-2 pr-3 text-left text-xs font-medium text-gray-500 tracking-wider">
                                                    Work Item
                                                </th>
                                                <th className="py-2 px-3 text-left text-xs font-medium text-gray-500 tracking-wider">
                                                    Time Entry
                                                </th>
                                                <th className="py-2 px-3 text-left text-xs font-medium text-gray-500 tracking-wider">
                                                    Duration
                                                </th>
                                                <th className="py-2 px-3 text-left text-xs font-medium text-gray-500 tracking-wider">
                                                    Billable Duration
                                                </th>
                                                <th className="py-2 px-3 text-right text-xs font-medium text-gray-500 tracking-wider">
                                                    Actions
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
                                                    <col style={{ width: '3%' }} />  {/* Indent */}
                                                    <col style={{ width: '40%' }} /> {/* Work item / Date */}
                                                    <col style={{ width: '15%' }} /> {/* Time range / Entries count */}
                                                    <col style={{ width: '15%' }} /> {/* Duration */}
                                                    <col style={{ width: '15%' }} /> {/* Billable */}
                                                    <col style={{ width: '10%' }} /> {/* Actions */}
                                                </colgroup>
                                                {/* Day header row */}
                                                <thead>
                                                    <tr
                                                        className={`${
                                                            hasEntries
                                                                ? 'bg-gray-50 hover:bg-gray-100 cursor-pointer'
                                                                : 'bg-gray-50/50 cursor-default'
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
                                                                `${group.entries.length} ${group.entries.length === 1 ? 'entry' : 'entries'}`
                                                            ) : (
                                                                <span className="text-gray-400 italic">No entries</span>
                                                            )}
                                                        </td>
                                                        <td className="py-2 px-3 text-sm font-medium text-gray-700">
                                                            {hasEntries && formatDuration(group.totalDuration)}
                                                        </td>
                                                        <td className="py-2 px-3 text-sm font-medium text-[rgb(var(--color-primary-600))]">
                                                            {hasEntries && formatDuration(group.totalBillable)}
                                                        </td>
                                                        <td className="py-2 px-3" />
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
                                                                    className={`group bg-white hover:bg-gray-50 ${isEditable ? 'cursor-pointer' : ''}`}
                                                                    onClick={() => handleEntryClick(flatEntry)}
                                                                    data-automation-id={`time-entry-row-${entry.entry_id}`}
                                                                >
                                                                    {/* Indent spacer */}
                                                                    <td className="pl-3" />

                                                                    {/* Work item info */}
                                                                    <td className="py-2 pr-3">
                                                                        <div className="flex items-center gap-2">
                                                                            <span
                                                                                className="text-sm text-gray-900 hover:text-[rgb(var(--color-primary-500))] truncate cursor-pointer"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    onWorkItemClick(workItem);
                                                                                }}
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
                                                                                            ? 'bg-green-100 text-green-700'
                                                                                            : 'bg-gray-100 text-gray-700'
                                                                            }`}>
                                                                                {formatWorkItemType(workItem.type)}
                                                                            </span>
                                                                        </div>
                                                                    </td>

                                                                    {/* Time range */}
                                                                    <td className="py-2 px-3">
                                                                        <span className="text-sm text-gray-500">
                                                                            {formatTimeRange(entry.start_time, entry.end_time)}
                                                                        </span>
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
                                                                            title={`${billabilityPercentage}% billable`}
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
                                                                                    title="Copy to another day"
                                                                                >
                                                                                    <Copy className="h-4 w-4" />
                                                                                </Button>
                                                                                <Button
                                                                                    id={`edit-entry-${entry.entry_id}`}
                                                                                    variant="ghost"
                                                                                    size="sm"
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        handleEntryClick(flatEntry);
                                                                                    }}
                                                                                    title="Edit entry"
                                                                                >
                                                                                    <Pencil className="h-4 w-4" />
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
                    {flattenedEntries.length > 0 && (
                        <BillableLegend className="mt-6" />
                    )}
                </React.Fragment>
            </ReflectionContainer>
        </div>
    );
}
