'use client'

import React, { useState, useRef, useEffect } from 'react';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Trash, Plus, Check, X, ClipboardList, ArrowRight, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { ITimeEntryWithWorkItemString } from 'server/src/interfaces/timeEntry.interfaces';
import { IExtendedWorkItem } from 'server/src/interfaces/workItem.interfaces';
import { formatISO, parseISO, format, isToday } from 'date-fns';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ButtonComponent, ContainerComponent } from 'server/src/types/ui-reflection/types';
import { CommonActions } from 'server/src/types/ui-reflection/actionBuilders';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';

interface TimeSheetTableProps {
    dates: Date[];
    workItemsByType: Record<string, IExtendedWorkItem[]>;
    groupedTimeEntries: Record<string, ITimeEntryWithWorkItemString[]>;
    isEditable: boolean;
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
    onQuickAddTimeEntry?: (params: {
        workItem: IExtendedWorkItem;
        date: string;
        durationInMinutes: number;
        existingEntry?: ITimeEntryWithWorkItemString;
    }) => Promise<void>;
}

const DAYS_PER_PAGE = 7;

type BillabilityPercentage = 0 | 25 | 50 | 75 | 100;

const billabilityColorScheme: Record<BillabilityPercentage, {
    background: string;
    border: string;
}> = {
    0: {
        background: "rgb(var(--color-border-50))",
        border: "rgb(var(--color-border-300))"
    },
    25: {
        background: "rgb(var(--color-accent-50))",
        border: "rgb(var(--color-accent-300))"
    },
    50: {
        background: "rgb(var(--color-accent-100))",
        border: "rgb(var(--color-accent-300))"
    },
    75: {
        background: "rgb(var(--color-secondary-100))",
        border: "rgb(var(--color-secondary-300))"
    },
    100: {
        background: "rgb(var(--color-primary-100))",
        border: "rgb(var(--color-primary-300))"
    }
} as const;

function formatWorkItemType(type: string): string {
    const words = type.split(/[_\s]+/);
    return words.map((word): string =>
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
}

function formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.round(minutes % 60);
    return `${hours.toString().padStart(2, '0')}:${remainingMinutes.toString().padStart(2, '0')}`;
}

export function TimeSheetTable({
    dates,
    workItemsByType,
    groupedTimeEntries,
    isEditable,
    onCellClick,
    onAddWorkItem,
    onWorkItemClick,
    onDeleteWorkItem,
    onQuickAddTimeEntry
}: TimeSheetTableProps): JSX.Element {
    const [selectedWorkItemToDelete, setSelectedWorkItemToDelete] = useState<string | null>(null);
    const [hoveredCell, setHoveredCell] = useState<{ workItemId: string; date: string } | null>(null);
    const [quickInputValues, setQuickInputValues] = useState<{ [key: string]: string }>({});

    // Carousel pagination state
    const [currentPage, setCurrentPage] = useState(0);
    const [isAnimating, setIsAnimating] = useState(false);

    // Calculate total pages and visible dates
    const totalPages = Math.ceil(dates.length / DAYS_PER_PAGE);
    const canGoBack = currentPage > 0;
    const canGoForward = currentPage < totalPages - 1;
    const hasMultiplePages = totalPages > 1;

    // Get visible dates for current page
    const startIndex = currentPage * DAYS_PER_PAGE;
    const visibleDates = dates.slice(startIndex, startIndex + DAYS_PER_PAGE);

    // Format date range for display
    const getDateRangeDisplay = (): string => {
        if (visibleDates.length === 0) return '';
        const firstDate = visibleDates[0];
        const lastDate = visibleDates[visibleDates.length - 1];

        // If same month, show "Oct 31 - Nov 06, 2024" format
        if (firstDate.getFullYear() === lastDate.getFullYear()) {
            if (firstDate.getMonth() === lastDate.getMonth()) {
                return `${format(firstDate, 'MMM d')} - ${format(lastDate, 'd, yyyy')}`;
            }
            return `${format(firstDate, 'MMM d')} - ${format(lastDate, 'MMM d, yyyy')}`;
        }
        return `${format(firstDate, 'MMM d, yyyy')} - ${format(lastDate, 'MMM d, yyyy')}`;
    };

    // Navigation handlers with cross-fade animation
    const goToPreviousPage = () => {
        if (!canGoBack || isAnimating) return;
        setIsAnimating(true);
        setTimeout(() => {
            setCurrentPage(prev => prev - 1);
            setIsAnimating(false);
        }, 200);
    };

    const goToNextPage = () => {
        if (!canGoForward || isAnimating) return;
        setIsAnimating(true);
        setTimeout(() => {
            setCurrentPage(prev => prev + 1);
            setIsAnimating(false);
        }, 200);
    };

    // Check if there are any work items
    const hasWorkItems = Object.values(workItemsByType).some(items => items.length > 0);

    // Register add work item button for automation
    const { automationIdProps: addWorkItemProps } = useAutomationIdAndRegister<ButtonComponent>({
        type: 'button',
        id: 'add-work-item-button',
        label: 'Add Item',
        disabled: !isEditable,
    }, () => [
        CommonActions.click('Add new work item to timesheet'),
        CommonActions.focus('Focus on add work item button')
    ]);

    // Register the timesheet table container
    const { automationIdProps: tableProps } = useAutomationIdAndRegister<ContainerComponent>({
        type: 'container',
        id: 'timesheet-table',
        label: 'Time Sheet Data Table',
    }, () => [
        CommonActions.focus('Focus on timesheet table'),
        {
            type: 'click' as const,
            available: true,
            description: 'Click on time entry cells to add or edit time entries',
            parameters: [
                {
                    name: 'workItemId',
                    type: 'string' as const,
                    required: true,
                    description: 'ID of the work item'
                },
                {
                    name: 'date',
                    type: 'string' as const,
                    required: true,
                    description: 'Date for the time entry (YYYY-MM-DD format)'
                }
            ]
        }
    ]);


    return (
        <ReflectionContainer id="timesheet-table" label="Time Sheet Data Table">
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

            {/* Date Range Navigator */}
            <div className="flex items-center justify-center mb-4">
                <div className="inline-flex items-center bg-white border border-gray-200 rounded-lg px-2 py-1.5 shadow-sm">
                    <button
                        onClick={goToPreviousPage}
                        disabled={!canGoBack || isAnimating}
                        className={`p-1.5 rounded-md transition-colors ${
                            canGoBack && !isAnimating
                                ? 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                : 'text-gray-300 cursor-not-allowed'
                        }`}
                        aria-label="Previous week"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>

                    <div className="flex items-center px-3 min-w-[200px] justify-center">
                        <Calendar className="w-4 h-4 text-gray-400 mr-2" />
                        <span className="text-sm font-medium text-gray-900">
                            {getDateRangeDisplay()}
                        </span>
                    </div>

                    <button
                        onClick={goToNextPage}
                        disabled={!canGoForward || isAnimating}
                        className={`p-1.5 rounded-md transition-colors ${
                            canGoForward && !isAnimating
                                ? 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                : 'text-gray-300 cursor-not-allowed'
                        }`}
                        aria-label="Next week"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>

                {/* Page indicator for multi-page timesheets */}
                {hasMultiplePages && (
                    <div className="ml-3 text-xs text-gray-500">
                        Page {currentPage + 1} of {totalPages}
                    </div>
                )}
            </div>

        <div className="overflow-hidden border border-gray-200 rounded-lg" {...tableProps}>
            <div
                className="transition-opacity duration-200 ease-in-out"
                style={{ opacity: isAnimating ? 0 : 1 }}
            >
            <table className="min-w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                    <tr className="bg-white">
                        <th className="px-4 py-3 border-r border-b border-gray-200 sticky left-0 z-20 bg-white min-w-[160px]">
                            <Button
                                {...addWorkItemProps}
                                variant="outline"
                                size="sm"
                                onClick={onAddWorkItem}
                                className="text-[rgb(var(--color-primary-500))] border-[rgb(var(--color-primary-200))] hover:bg-[rgb(var(--color-primary-50))]"
                            >
                                <Plus className="h-4 w-4 mr-1" />
                                Add Item
                            </Button>
                        </th>
                        {visibleDates.map((date): JSX.Element => {
                            const isTodayDate = isToday(date);
                            return (
                                <th
                                    key={date.toISOString()}
                                    className={`px-4 py-3 text-center border-r border-b border-gray-200 min-w-[120px] ${
                                        isTodayDate ? 'text-[rgb(var(--color-primary-500))]' : 'text-gray-500'
                                    }`}
                                >
                                    <div className="text-xs font-medium uppercase tracking-wider">
                                        {format(date, 'EEE')}
                                    </div>
                                    <div className={`text-base font-semibold ${isTodayDate ? 'text-[rgb(var(--color-primary-500))]' : 'text-gray-900'}`}>
                                        {format(date, 'M/d')}
                                    </div>
                                    {isTodayDate && (
                                        <div className="flex justify-center mt-1">
                                            <div className="w-1.5 h-1.5 rounded-full bg-[rgb(var(--color-primary-500))]"></div>
                                        </div>
                                    )}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {!hasWorkItems ? (
                        <tr>
                            <td
                                colSpan={visibleDates.length + 1}
                                className="bg-white h-64"
                            >
                                <div
                                    className="sticky left-0 flex flex-col items-center justify-center py-16"
                                    style={{ width: 'min(100%, 800px)' }}
                                >
                                    <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                                        <ClipboardList className="w-8 h-8 text-gray-400" />
                                    </div>
                                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                        No work items on your time sheet
                                    </h3>
                                    <p className="text-gray-500 text-sm mb-4 max-w-sm text-center px-4">
                                        Add a new work item to get started tracking your time for this week.
                                    </p>
                                    <button
                                        onClick={onAddWorkItem}
                                        className="inline-flex items-center text-[rgb(var(--color-primary-500))] hover:text-[rgb(var(--color-primary-600))] font-medium text-sm"
                                    >
                                        Get Started
                                        <ArrowRight className="w-4 h-4 ml-1" />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ) : (
                        Object.entries(workItemsByType).map(([type, workItems]): JSX.Element => (
                            <React.Fragment key={type}>
                                {workItems.map((workItem): JSX.Element => {
                                    const entries = groupedTimeEntries[workItem.work_item_id] || [];
                                    return (
                                        <tr key={`${workItem.work_item_id}-${Math.random()}`} className="border-b border-gray-200">
                                    <td
                                        className="px-4 py-3 text-sm font-medium text-gray-900 border-r border-gray-200 sticky left-0 z-10 bg-white min-w-[160px] cursor-pointer hover:bg-gray-50 relative"
                                        onClick={() => onWorkItemClick(workItem)}
                                        data-automation-id={`work-item-${workItem.work_item_id}`}
                                        data-automation-type="work-item-cell"
                                    >
                                        <div className="flex flex-col pr-6">
                                            <span className="break-words whitespace-normal text-sm">
                                                {workItem.type === 'ticket'
                                                    ? `${workItem.ticket_number} - ${workItem.title || workItem.name}`
                                                    : workItem.name
                                                }
                                            </span>
                                            {workItem.type === 'project_task' && workItem.project_name && workItem.phase_name && (
                                                <div className="text-xs text-gray-500 mt-0.5">
                                                    {workItem.project_name} • {workItem.phase_name}
                                                </div>
                                            )}
                                            {workItem.type === 'interaction' && workItem.client_name && (
                                                <div className="text-xs text-gray-500 mt-0.5">
                                                    {workItem.client_name}
                                                    {workItem.contact_name && ` • ${workItem.contact_name}`}
                                                </div>
                                            )}
                                            <span className={`inline-flex w-max items-center px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${
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
                                        {isEditable && (
                                            <Button
                                                id="delete-workitem-button"
                                                variant="icon"
                                                size="sm"
                                                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 opacity-0 group-hover:opacity-100 hover:opacity-100"
                                                title="Delete Work Item"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedWorkItemToDelete(workItem.work_item_id);
                                                }}
                                            >
                                                <Trash className="h-4 w-4 text-gray-400 hover:text-red-500" />
                                            </Button>
                                        )}
                                    </td>
                                        {visibleDates.map((date): JSX.Element => {
                                            const dayEntries = entries.filter(entry =>
                                                parseISO(entry.start_time).toDateString() === date.toDateString()
                                            );

                                            const totalDuration = dayEntries.reduce((sum, entry) => {
                                                const start = parseISO(entry.start_time);
                                                const end = parseISO(entry.end_time);
                                                const durationInMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
                                                return sum + durationInMinutes;
                                            }, 0);

                                            const totalBillableDuration = dayEntries.reduce((sum, entry) =>
                                                sum + entry.billable_duration, 0
                                            );

                                            // Calculate billability percentage
                                            const billabilityPercentage = totalDuration === 0 ? 0 :
                                                Math.round((totalBillableDuration / totalDuration) * 100) as BillabilityPercentage;

                                            // Map to nearest billability tier
                                            const billabilityTier = [0, 25, 50, 75, 100].reduce((prev, curr) =>
                                                Math.abs(curr - billabilityPercentage) < Math.abs(prev - billabilityPercentage) ? curr : prev
                                            ) as BillabilityPercentage;

                                            const colors = billabilityColorScheme[billabilityTier];
                                            const cellKey = `${workItem.work_item_id}-${formatISO(date, { representation: 'date' })}`;
                                            const isHovered = hoveredCell?.workItemId === workItem.work_item_id &&
                                                            hoveredCell?.date === formatISO(date, { representation: 'date' });
                                            const isTodayDate = isToday(date);

                                            return (
                                                <td
                                                    key={formatISO(date)}
                                                    className={`px-3 py-3 text-sm text-gray-500 cursor-pointer border-r border-gray-200 transition-all relative h-20 ${
                                                        isHovered && isEditable ? 'bg-gray-50' : ''
                                                    } hover:bg-gray-50 ${isTodayDate ? 'bg-[rgb(var(--color-primary-50))]/30' : ''}`}
                                                    data-automation-id={`time-cell-${workItem.work_item_id}-${formatISO(date, { representation: 'date' })}`}
                                                    data-automation-type="time-entry-cell"
                                                    onMouseEnter={() => isEditable && setHoveredCell({
                                                        workItemId: workItem.work_item_id,
                                                        date: formatISO(date, { representation: 'date' })
                                                    })}
                                                    onMouseLeave={() => setHoveredCell(null)}
                                                    onClick={() => {
                                                        if (!isEditable) return;

                                                        let startTime: Date | undefined;
                                                        let endTime: Date | undefined;

                                                        if (workItem.type === 'ad_hoc' &&
                                                            'scheduled_start' in workItem &&
                                                            'scheduled_end' in workItem &&
                                                            workItem.scheduled_start &&
                                                            workItem.scheduled_end) {
                                                            startTime = typeof workItem.scheduled_start === 'string' ?
                                                                parseISO(workItem.scheduled_start) :
                                                                workItem.scheduled_start;
                                                            endTime = typeof workItem.scheduled_end === 'string' ?
                                                                parseISO(workItem.scheduled_end) :
                                                                workItem.scheduled_end;
                                                        }

                                                        if (!startTime && dayEntries.length > 0) {
                                                            const sortedEntries = [...dayEntries].sort((a, b) =>
                                                                parseISO(b.end_time).getTime() - parseISO(a.end_time).getTime()
                                                            );
                                                            startTime = parseISO(sortedEntries[0].end_time);
                                                            endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
                                                        } else if (!startTime) {
                                                            startTime = new Date(date);
                                                            startTime.setHours(8, 0, 0, 0);
                                                            endTime = new Date(startTime);
                                                            endTime.setHours(9, 0, 0, 0);
                                                        }

                                                        onCellClick({
                                                            workItem,
                                                            date: formatISO(date),
                                                            entries: dayEntries,
                                                            defaultStartTime: startTime ? formatISO(startTime) : undefined,
                                                            defaultEndTime: endTime ? formatISO(endTime) : undefined
                                                        });
                                                    }}
                                                >
                                                    {dayEntries.length > 0 ? (
                                                        <div
                                                            className="rounded-lg p-2 text-xs h-full w-full"
                                                            style={{
                                                                backgroundColor: colors.background,
                                                                borderColor: colors.border,
                                                                borderWidth: '1px',
                                                                borderStyle: 'solid'
                                                            }}
                                                        >
                                                            <div className="font-medium text-gray-700">{formatDuration(totalDuration)}</div>
                                                            <div className="text-gray-500 text-xs">{`$ ${formatDuration(totalBillableDuration)}`}</div>
                                                        </div>
                                                    ) : (
                                                        <div className="h-full w-full">
                                                            {/* Empty cell - click anywhere to open full dialog */}
                                                            {isHovered && isEditable && (
                                                                <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1 bg-white rounded shadow-sm border border-gray-200 px-1 py-1 z-10"
                                                                     onClick={(e) => e.stopPropagation()}>
                                                                    <Input
                                                                        type="text"
                                                                        placeholder="H:MM"
                                                                        className="!py-0.5 !px-1 !text-xs !border-gray-200 !min-h-0"
                                                                        containerClassName="flex-1 !mb-0"
                                                                        value={quickInputValues[cellKey] || ''}
                                                                        onChange={(e) => {
                                                                            const value = e.target.value;

                                                                            // Only allow digits, colon, and decimal point
                                                                            const sanitized = value.replace(/[^0-9:.]/g, '');

                                                                            // Validate the format and reasonable limits
                                                                            if (sanitized.includes(':')) {
                                                                                // H:MM or HH:MM format - max 24:00
                                                                                const parts = sanitized.split(':');
                                                                                if (parts.length === 2) {
                                                                                    const hours = parseInt(parts[0], 10) || 0;
                                                                                    const minutes = parts[1].substring(0, 2); // Max 2 digits for minutes
                                                                                    if (hours <= 24) {
                                                                                        setQuickInputValues(prev => ({
                                                                                            ...prev,
                                                                                            [cellKey]: `${hours}:${minutes}`
                                                                                        }));
                                                                                    }
                                                                                }
                                                                            } else if (sanitized.includes('.')) {
                                                                                // Decimal format (e.g., 1.5) - max 24.0
                                                                                const decimal = parseFloat(sanitized);
                                                                                if (!isNaN(decimal) && decimal <= 24 && decimal >= 0) {
                                                                                    setQuickInputValues(prev => ({
                                                                                        ...prev,
                                                                                        [cellKey]: sanitized.substring(0, 5) // Max 5 chars (XX.XX)
                                                                                    }));
                                                                                }
                                                                            } else {
                                                                                // Simple number format - max 24
                                                                                const num = parseInt(sanitized, 10);
                                                                                if (sanitized === '' || (!isNaN(num) && num <= 24)) {
                                                                                    setQuickInputValues(prev => ({
                                                                                        ...prev,
                                                                                        [cellKey]: sanitized.substring(0, 2) // Max 2 digits
                                                                                    }));
                                                                                }
                                                                            }
                                                                        }}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                    onKeyDown={async (e) => {
                                                                        if (e.key === 'Enter') {
                                                                            e.stopPropagation();
                                                                            e.preventDefault();

                                                                            const inputValue = quickInputValues[cellKey] || '';
                                                                            let durationInMinutes = 0;

                                                                            // Parse various duration formats
                                                                            // Format: H:MM or HH:MM (e.g., 1:30, 01:30)
                                                                            const colonMatch = inputValue.match(/^(\d{1,2}):(\d{1,2})$/);
                                                                            if (colonMatch) {
                                                                                const hours = parseInt(colonMatch[1], 10);
                                                                                const minutes = parseInt(colonMatch[2], 10);
                                                                                durationInMinutes = hours * 60 + minutes;
                                                                            }
                                                                            // Format: simple number as hours (e.g., 8 for 8 hours)
                                                                            else if (inputValue.match(/^(\d+\.?\d*)$/)) {
                                                                                const hours = parseFloat(inputValue);
                                                                                durationInMinutes = Math.round(hours * 60);
                                                                            }

                                                                            if (durationInMinutes > 0 && onQuickAddTimeEntry) {
                                                                                // Find any existing entry for this work item to copy settings from
                                                                                const allEntriesForWorkItem = groupedTimeEntries[workItem.work_item_id] || [];
                                                                                const existingEntry = allEntriesForWorkItem.length > 0 ? allEntriesForWorkItem[0] : undefined;

                                                                                try {
                                                                                    // Create the time entry directly without opening dialog
                                                                                    await onQuickAddTimeEntry({
                                                                                        workItem,
                                                                                        date: formatISO(date),
                                                                                        durationInMinutes,
                                                                                        existingEntry
                                                                                    });

                                                                                    // Clear the input for this cell
                                                                                    setQuickInputValues(prev => {
                                                                                        const newValues = { ...prev };
                                                                                        delete newValues[cellKey];
                                                                                        return newValues;
                                                                                    });
                                                                                    setHoveredCell(null);
                                                                                } catch (error) {
                                                                                    console.error('Failed to create quick time entry:', error);
                                                                                }
                                                                            }
                                                                        } else if (e.key === 'Escape') {
                                                                            // Clear input on Escape
                                                                            setQuickInputValues(prev => {
                                                                                const newValues = { ...prev };
                                                                                delete newValues[cellKey];
                                                                                return newValues;
                                                                            });
                                                                            setHoveredCell(null);
                                                                        }
                                                                    }}
                                                                    onBlur={() => {
                                                                        // Clear input when focus is lost
                                                                        setTimeout(() => {
                                                                            setQuickInputValues(prev => {
                                                                                const newValues = { ...prev };
                                                                                delete newValues[cellKey];
                                                                                return newValues;
                                                                            });
                                                                        }, 200);
                                                                    }}
                                                                        autoFocus
                                                                    />
                                                                    <Button
                                                                        id="quick-save-time-entry"
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="!h-6 !w-6 !p-0 text-green-600 hover:bg-green-50"
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation();
                                                                        const inputValue = quickInputValues[cellKey] || '';
                                                                        let durationInMinutes = 0;

                                                                        // Parse various duration formats
                                                                        const colonMatch = inputValue.match(/^(\d{1,2}):(\d{1,2})$/);
                                                                        if (colonMatch) {
                                                                            const hours = parseInt(colonMatch[1], 10);
                                                                            const minutes = parseInt(colonMatch[2], 10);
                                                                            durationInMinutes = hours * 60 + minutes;
                                                                        }
                                                                        else if (inputValue.match(/^(\d+\.?\d*)$/)) {
                                                                            const hours = parseFloat(inputValue);
                                                                            durationInMinutes = Math.round(hours * 60);
                                                                        }

                                                                        if (durationInMinutes > 0 && onQuickAddTimeEntry) {
                                                                            const allEntriesForWorkItem = groupedTimeEntries[workItem.work_item_id] || [];
                                                                            const existingEntry = allEntriesForWorkItem.length > 0 ? allEntriesForWorkItem[0] : undefined;

                                                                            try {
                                                                                await onQuickAddTimeEntry({
                                                                                    workItem,
                                                                                    date: formatISO(date),
                                                                                    durationInMinutes,
                                                                                    existingEntry
                                                                                });

                                                                                setQuickInputValues(prev => {
                                                                                    const newValues = { ...prev };
                                                                                    delete newValues[cellKey];
                                                                                    return newValues;
                                                                                });
                                                                                setHoveredCell(null);
                                                                            } catch (error) {
                                                                                console.error('Failed to create quick time entry:', error);
                                                                            }
                                                                        }
                                                                    }}
                                                                        title="Save time entry"
                                                                    >
                                                                        <Check className="h-3 w-3" />
                                                                    </Button>
                                                                    <Button
                                                                        id="quick-cancel-time-entry"
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="!h-6 !w-6 !p-0 text-gray-500 hover:bg-gray-100"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setQuickInputValues(prev => {
                                                                            const newValues = { ...prev };
                                                                            delete newValues[cellKey];
                                                                            return newValues;
                                                                        });
                                                                        setHoveredCell(null);
                                                                    }}
                                                                        title="Cancel"
                                                                    >
                                                                        <X className="h-3 w-3" />
                                                                    </Button>
                                                                </div>
                                                            )}
                                                        </div>
                                                        )
                                                    }
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </React.Fragment>
                    ))
                    )}
                </tbody>

                <tfoot>
                    <tr className="bg-gray-50 border-t border-gray-200">
                        <td className="px-4 py-4 text-sm font-semibold text-gray-900 border-r border-gray-200 sticky left-0 z-10 bg-gray-50">
                            Weekly Total
                        </td>
                        {visibleDates.map((date): JSX.Element => {
                            const entriesForDate = Object.values(groupedTimeEntries).flat()
                                .filter((entry) => parseISO(entry.start_time).toDateString() === date.toDateString());

                            const totalDuration = entriesForDate.reduce((sum, entry) => {
                                const start = parseISO(entry.start_time);
                                const end = parseISO(entry.end_time);
                                const durationInMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
                                return sum + durationInMinutes;
                            }, 0);

                            const totalBillableDuration = entriesForDate.reduce((sum, entry) =>
                                sum + entry.billable_duration, 0
                            );

                            const isTodayDate = isToday(date);

                            return (
                                <td
                                    key={formatISO(date)}
                                    className={`px-3 py-4 text-center border-r border-gray-200 ${
                                        isTodayDate ? 'text-[rgb(var(--color-primary-500))]' : 'text-gray-500'
                                    }`}
                                >
                                    <div className="text-xs text-gray-400 uppercase">Total</div>
                                    <div className={`text-sm font-semibold ${isTodayDate ? 'text-[rgb(var(--color-primary-500))]' : 'text-gray-900'}`}>
                                        {formatDuration(totalDuration)}
                                    </div>
                                    <div className={`text-xs ${isTodayDate ? 'text-[rgb(var(--color-primary-400))]' : 'text-gray-400'}`}>
                                        $ {formatDuration(totalBillableDuration)}
                                    </div>
                                </td>
                            );
                        })}
                    </tr>
                </tfoot>
            </table>
            </div>
        </div>

        {/* Billable Legend */}
        <div className="mt-6 p-4 bg-white border border-gray-200 rounded-lg">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">Billable Legend</h3>
                    <p className="text-xs text-gray-500">Color indicators for billable time ratios</p>
                </div>
                <div className="flex items-center gap-4">
                    {([0, 25, 50, 75, 100] as BillabilityPercentage[]).map((percentage) => {
                        const colors = billabilityColorScheme[percentage];
                        return (
                            <div key={percentage} className="flex items-center gap-1.5">
                                <div
                                    className="w-5 h-5 rounded border"
                                    style={{
                                        backgroundColor: colors.background,
                                        borderColor: colors.border
                                    }}
                                />
                                <span className="text-xs text-gray-600">{percentage}%</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
            </React.Fragment>
        </ReflectionContainer>
    );
}
