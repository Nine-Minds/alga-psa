'use client'

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Trash, Plus, Check, X, ClipboardList, ArrowRight } from 'lucide-react';
import { ITimeEntryWithWorkItemString } from '@alga-psa/types';
import { IExtendedWorkItem } from '@alga-psa/types';
import { formatISO, parseISO, format, isToday } from 'date-fns';
import { BillabilityPercentage, billabilityColorScheme, formatDuration, formatWorkItemType } from './utils';
import { BillableLegend } from './BillableLegend';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { TimeEntrySelectionRequest, TimeSheetDateNavigatorState, TimeSheetQuickAddState } from './types';
import { getProminentTimeEntryChangeRequest } from '../../../../lib/timeEntryChangeRequests';

interface TimeSheetTableProps {
    dates: Date[];
    workItemsByType: Record<string, IExtendedWorkItem[]>;
    groupedTimeEntries: Record<string, ITimeEntryWithWorkItemString[]>;
    isEditable: boolean;
    isLoading?: boolean;
    onDeleteWorkItem: (workItemId: string) => Promise<void>;
    onCellClick: (params: TimeEntrySelectionRequest) => void;
    onAddEntryForCell: (params: TimeEntrySelectionRequest) => void;
    onAddWorkItem: (date?: string) => void;
    onWorkItemClick: (workItem: IExtendedWorkItem) => void;
    activeQuickAdd?: TimeSheetQuickAddState | null;
    onActivateQuickAdd: (quickAddTarget: Omit<TimeSheetQuickAddState, 'value'>) => void;
    onQuickAddValueChange: (value: string) => void;
    onQuickAddCancel: () => void;
    onQuickAddSubmit: () => Promise<void>;
    onDateNavigatorChange?: (state: TimeSheetDateNavigatorState) => void;
}

// Fixed widths for layout calculations
const WORK_ITEM_COLUMN_WIDTH = 180; // Width of the first column (work item names)
const DAY_COLUMN_WIDTH = 120; // Width of each day column
const MIN_DAYS_PER_PAGE = 3; // Minimum days to show
const MAX_DAYS_PER_PAGE = 14; // Maximum days to show

function sanitizeQuickAddInput(value: string): string {
    const sanitized = value.replace(/[^0-9:.]/g, '');

    if (sanitized.includes(':')) {
        const parts = sanitized.split(':');
        if (parts.length === 2) {
            const hours = parseInt(parts[0], 10) || 0;
            const minutes = parts[1].substring(0, 2);
            if (hours <= 24) {
                return `${hours}:${minutes}`;
            }
        }
        return sanitized.substring(0, 5);
    }

    if (sanitized.includes('.')) {
        const decimal = parseFloat(sanitized);
        if (!isNaN(decimal) && decimal <= 24 && decimal >= 0) {
            return sanitized.substring(0, 5);
        }
        return '';
    }

    const num = parseInt(sanitized, 10);
    if (sanitized === '' || (!isNaN(num) && num <= 24)) {
        return sanitized.substring(0, 2);
    }

    return '';
}

export function TimeSheetTable({
    dates,
    workItemsByType,
    groupedTimeEntries,
    isEditable,
    isLoading = false,
    onCellClick,
    onAddEntryForCell,
    onAddWorkItem,
    onWorkItemClick,
    onDeleteWorkItem,
    activeQuickAdd = null,
    onActivateQuickAdd,
    onQuickAddValueChange,
    onQuickAddCancel,
    onQuickAddSubmit,
    onDateNavigatorChange
}: TimeSheetTableProps): React.JSX.Element {
    const { t } = useTranslation('msp/time-entry');
    const [selectedWorkItemToDelete, setSelectedWorkItemToDelete] = useState<string | null>(null);
    const [hoveredCell, setHoveredCell] = useState<{ workItemId: string; date: string } | null>(null);

    // Container ref for measuring available width
    const containerRef = useRef<HTMLDivElement>(null);

    // Carousel pagination state
    const [currentPage, setCurrentPage] = useState(0);
    const [isAnimating, setIsAnimating] = useState(false);
    const [daysPerPage, setDaysPerPage] = useState(7); // Default, will be calculated

    // Calculate days per page based on container width
    const calculateDaysPerPage = useCallback((containerWidth: number) => {
        const availableWidth = containerWidth - WORK_ITEM_COLUMN_WIDTH;
        const calculatedDays = Math.floor(availableWidth / DAY_COLUMN_WIDTH);
        return Math.max(MIN_DAYS_PER_PAGE, Math.min(MAX_DAYS_PER_PAGE, calculatedDays, dates.length));
    }, [dates.length]);

    // Set up resize observer to track container width changes
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const updateDaysPerPage = () => {
            const newDaysPerPage = calculateDaysPerPage(container.offsetWidth);
            setDaysPerPage(prevDays => {
                if (prevDays !== newDaysPerPage) {
                    // Adjust current page if it would now be out of bounds
                    const newTotalPages = Math.ceil(dates.length / newDaysPerPage);
                    setCurrentPage(prevPage => Math.min(prevPage, Math.max(0, newTotalPages - 1)));
                }
                return newDaysPerPage;
            });
        };

        // Initial calculation
        updateDaysPerPage();

        // Set up resize observer
        const resizeObserver = new ResizeObserver(() => {
            updateDaysPerPage();
        });

        resizeObserver.observe(container);

        return () => {
            resizeObserver.disconnect();
        };
    }, [calculateDaysPerPage, dates.length]);

    // Calculate total pages and visible dates
    const totalPages = Math.ceil(dates.length / daysPerPage);
    const canGoBack = currentPage > 0;
    const canGoForward = currentPage < totalPages - 1;
    const hasMultiplePages = totalPages > 1;

    const buildCellSelection = useCallback((
        workItem: IExtendedWorkItem,
        date: Date,
        dayEntries: ITimeEntryWithWorkItemString[]
    ): TimeEntrySelectionRequest => {
        let startTime: Date | undefined;
        let endTime: Date | undefined;

        if (workItem.type === 'ad_hoc' &&
            'scheduled_start' in workItem &&
            'scheduled_end' in workItem &&
            workItem.scheduled_start &&
            workItem.scheduled_end) {
            startTime = typeof workItem.scheduled_start === 'string'
                ? parseISO(workItem.scheduled_start)
                : workItem.scheduled_start;
            endTime = typeof workItem.scheduled_end === 'string'
                ? parseISO(workItem.scheduled_end)
                : workItem.scheduled_end;
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

        return {
            workItem,
            date: formatISO(date),
            entries: dayEntries,
            defaultStartTime: startTime ? formatISO(startTime) : undefined,
            defaultEndTime: endTime ? formatISO(endTime) : undefined,
        };
    }, []);

    // Get visible dates for current page
    const startIndex = currentPage * daysPerPage;
    const visibleDates = dates.slice(startIndex, startIndex + daysPerPage);

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

    const dateRangeDisplay = getDateRangeDisplay();

    // Navigation handlers with cross-fade animation
    const goToPreviousPage = useCallback(() => {
        if (!canGoBack || isAnimating) return;
        setIsAnimating(true);
        setTimeout(() => {
            setCurrentPage(prev => prev - 1);
            setIsAnimating(false);
        }, 200);
    }, [canGoBack, isAnimating]);

    const goToNextPage = useCallback(() => {
        if (!canGoForward || isAnimating) return;
        setIsAnimating(true);
        setTimeout(() => {
            setCurrentPage(prev => prev + 1);
            setIsAnimating(false);
        }, 200);
    }, [canGoForward, isAnimating]);

    useEffect(() => {
        if (!onDateNavigatorChange) return;

        onDateNavigatorChange({
            dateRangeDisplay,
            canGoBack,
            canGoForward,
            hasMultiplePages,
            currentPage,
            totalPages,
            isAnimating,
            goToPreviousPage,
            goToNextPage
        });
    }, [
        onDateNavigatorChange,
        canGoBack,
        canGoForward,
        hasMultiplePages,
        currentPage,
        totalPages,
        isAnimating,
        goToPreviousPage,
        goToNextPage,
        dateRangeDisplay
    ]);

    // Check if there are any work items
    const hasWorkItems = Object.values(workItemsByType).some(items => items.length > 0);
    const lastWorkItemId = Object.values(workItemsByType).flat().at(-1)?.work_item_id;
    const activeQuickAddCellKey = useMemo(
        () => activeQuickAdd ? `${activeQuickAdd.workItem.work_item_id}-${activeQuickAdd.date}` : null,
        [activeQuickAdd]
    );

    const tableAutomationProps = {
        id: 'timesheet-table',
        'data-automation-id': 'timesheet-table',
        'data-automation-type': 'container',
    } as const;

    return (
        <div ref={containerRef}>
        <ReflectionContainer id="timesheet-table" label="Time Sheet Data Table">
            <React.Fragment>
            {selectedWorkItemToDelete && (
                <ConfirmationDialog
                    id="timesheet-table-delete-work-item-confirmation"
                    isOpen={true}
                    onConfirm={async () => {
                        await onDeleteWorkItem(selectedWorkItemToDelete);
                        setSelectedWorkItemToDelete(null);
                    }}
                    onClose={() => setSelectedWorkItemToDelete(null)}
                    title="Delete Work Item"
                    message="This will permanently delete all time entries for this work item. This action cannot be undone."
                    confirmLabel="Delete"
                />
            )}

        <div className="overflow-hidden bg-white border border-gray-200 rounded-lg shadow-md" {...tableAutomationProps}>
            <div
                className="transition-opacity duration-200 ease-in-out"
                style={{ opacity: isAnimating ? 0 : 1 }}
            >
            <table className="min-w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                    <tr className="bg-gray-50">
                        <th
                            className="px-4 py-3 sticky left-0 z-20 bg-gray-50 min-w-[160px]"
                            style={{ boxShadow: 'inset -1px 0 0 #e5e7eb, inset 0 -1px 0 #e5e7eb' }}
                        >
                            <Button
                                id="add-work-item-button"
                                variant="dashed"
                                size="sm"
                                onClick={() => onAddWorkItem()}
                                disabled={!isEditable}
                            >
                                <Plus className="h-4 w-4 mr-1.5" />
                                Add Item
                            </Button>
                        </th>
                        {visibleDates.map((date, index): React.JSX.Element => {
                            const isTodayDate = isToday(date);
                            const isLastHeaderCell = index === visibleDates.length - 1;
                            return (
                                <th
                                    key={date.toISOString()}
                                    className={`px-4 py-3 text-center min-w-[120px] bg-gray-50 ${
                                        isTodayDate ? 'text-[rgb(var(--color-primary-500))]' : 'text-gray-500'
                                    }`}
                                    style={{
                                        boxShadow: isLastHeaderCell
                                            ? 'inset 0 -1px 0 #e5e7eb'
                                            : 'inset -1px 0 0 #e5e7eb, inset 0 -1px 0 #e5e7eb'
                                    }}
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
                    {isLoading ? (
                        Array.from({ length: 3 }).map((_, rowIndex) => (
                            <tr key={`skeleton-${rowIndex}`} className="border-b border-gray-200">
                                <td className="px-4 py-3 border-b border-r border-gray-200 sticky left-0 z-10 bg-white min-w-[160px]">
                                    <div className="animate-pulse space-y-2 pr-6">
                                        <div className="h-3 w-28 bg-gray-200 rounded" />
                                        <div className="h-3 w-20 bg-gray-200 rounded" />
                                        <div className="h-4 w-14 bg-gray-200 rounded-full" />
                                    </div>
                                </td>
                                {visibleDates.map((date): React.JSX.Element => (
                                    <td
                                        key={`skeleton-${rowIndex}-${date.toISOString()}`}
                                        className="px-3 py-3 border-b border-r border-gray-200 last:border-r-0 h-20"
                                    >
                                        <div className="h-full w-full flex items-center justify-center">
                                            <div className="animate-pulse w-12 h-12 bg-gray-200 rounded-lg" />
                                        </div>
                                    </td>
                                ))}
                            </tr>
                        ))
                    ) : !hasWorkItems ? (
                        <tr>
                            <td
                                colSpan={visibleDates.length + 1}
                                className="bg-white h-64"
                            >
                                <div className="flex w-full h-full items-center justify-center py-16 px-4">
                                    <div className="flex flex-col items-center justify-center text-center max-w-md">
                                        <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                                            <ClipboardList className="w-8 h-8 text-gray-400" />
                                        </div>
                                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                            {t('timeSheetTable.empty.title', { defaultValue: 'No work items on your time sheet' })}
                                        </h3>
                                        <p className="text-gray-500 text-sm mb-4">
                                            {t('timeSheetTable.empty.description', { defaultValue: 'Add a new work item to get started tracking your time for this week.' })}
                                        </p>
                                        <Button
                                            id="get-started-button"
                                            variant="link"
                                            onClick={() => onAddWorkItem()}
                                        >
                                            {t('timeSheetTable.empty.getStarted', { defaultValue: 'Get Started' })}
                                            <ArrowRight className="w-4 h-4 ml-1" />
                                        </Button>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    ) : (
                        Object.entries(workItemsByType).map(([type, workItems]): React.JSX.Element => (
                            <React.Fragment key={type}>
                                {workItems.map((workItem): React.JSX.Element => {
                                    const isLastWorkItemRow = !!lastWorkItemId && workItem.work_item_id === lastWorkItemId;
                                    const entries = groupedTimeEntries[workItem.work_item_id] || [];
                                    return (
                                        <tr
                                            key={workItem.work_item_id}
                                            className={isLastWorkItemRow ? '' : 'border-b border-gray-200'}
                                        >
                                    <td
                                        className={`px-4 py-3 text-sm font-medium text-gray-900 border-r border-gray-200 sticky left-0 z-10 bg-white min-w-[160px] cursor-pointer hover:bg-gray-50 relative ${
                                            isLastWorkItemRow ? '' : 'border-b border-gray-200'
                                        }`}
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
                                                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                                            : 'bg-gray-100 dark:bg-gray-800/30 text-gray-700 dark:text-gray-300'
                                            }`}>
                                                {formatWorkItemType(workItem.type)}
                                            </span>
                                        </div>
                                        {isEditable && (
                                            <Button
                                                id={`delete-workitem-${workItem.work_item_id}`}
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
                                        {visibleDates.map((date): React.JSX.Element => {
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
                                            const dateKey = formatISO(date, { representation: 'date' });
                                            const cellKey = `${workItem.work_item_id}-${dateKey}`;
                                            const isHovered = hoveredCell?.workItemId === workItem.work_item_id &&
                                                hoveredCell?.date === dateKey;
                                            const isTodayDate = isToday(date);
                                            const canOpenCell = isEditable || dayEntries.length > 0;
                                            const isQuickAddActive = activeQuickAddCellKey === cellKey;
                                            const shouldShowQuickAddPreview = isEditable && dayEntries.length === 0 && !activeQuickAddCellKey && isHovered;
                                            const quickAddInputId = `timesheet-quick-input-${cellKey}`;
                                            const quickAddSaveId = `timesheet-quick-save-${cellKey}`;
                                            const quickAddCancelId = `timesheet-quick-cancel-${cellKey}`;
                                            const quickAddTriggerId = `timesheet-quick-trigger-${cellKey}`;
                                            const cellFeedbackState = dayEntries.some((entry) => entry.change_request_state === 'unresolved')
                                              ? 'unresolved'
                                              : dayEntries.some((entry) => entry.change_request_state === 'handled')
                                                ? 'handled'
                                                : null;
                                            const prominentCellFeedback = getProminentTimeEntryChangeRequest(
                                              dayEntries.flatMap((entry) => entry.change_requests ?? []),
                                            );

	                                            return (
	                                                <td
	                                                    key={formatISO(date)}
	                                                    className={`px-3 py-3 text-sm text-gray-500 border-r border-gray-200 transition-all relative h-20 ${
                                                            canOpenCell ? 'cursor-pointer' : 'cursor-default'
                                                        } ${
	                                                        (isHovered || isQuickAddActive) && isEditable ? 'bg-gray-50' : ''
	                                                    } hover:bg-gray-50 ${isTodayDate ? 'bg-[rgb(var(--color-primary-50))]/30' : ''} ${
	                                                        isLastWorkItemRow ? '' : 'border-b border-gray-200'
	                                                    }`}
	                                                    data-automation-id={`time-cell-${workItem.work_item_id}-${dateKey}`}
	                                                    data-automation-type="time-entry-cell"
	                                                    onMouseEnter={() => isEditable && setHoveredCell({
	                                                        workItemId: workItem.work_item_id,
	                                                        date: dateKey
                                                    })}
                                                    onMouseLeave={() => setHoveredCell(null)}
                                                >
                                                    <div className="relative h-full w-full">
                                                        {isEditable && (
                                                            <button
                                                                type="button"
                                                                className={`absolute inset-0 transition-colors ${
                                                                    dayEntries.length > 0
                                                                        ? 'rounded-2xl bg-white/70 hover:bg-white/90 dark:bg-gray-900/10 dark:hover:bg-gray-900/20'
                                                                        : 'rounded-xl hover:bg-white/70 dark:hover:bg-gray-900/10'
                                                                }`}
                                                                data-automation-id={`time-cell-add-area-${workItem.work_item_id}-${dateKey}`}
                                                                data-automation-type="time-entry-add-area"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onAddEntryForCell(buildCellSelection(workItem, date, dayEntries));
                                                                }}
                                                                aria-label={`Add time entry for ${workItem.name} on ${dateKey}`}
                                                            />
                                                        )}
	                                                    {dayEntries.length > 0 ? (
	                                                        <button
                                                                type="button"
                                                                className="absolute inset-2 z-10 flex items-center justify-center rounded-xl p-3 text-xs shadow-sm transition-transform hover:scale-[1.01]"
	                                                            style={{
	                                                                backgroundColor: colors.background,
	                                                                borderColor: colors.border,
	                                                                borderWidth: '1px',
	                                                                borderStyle: 'solid'
	                                                            }}
                                                                data-automation-id={`time-cell-entry-${workItem.work_item_id}-${dateKey}`}
                                                                data-automation-type="time-entry-summary"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onCellClick(buildCellSelection(workItem, date, dayEntries));
                                                                }}
	                                                        >
	                                                            {cellFeedbackState ? (
	                                                                <span
	                                                                    className={`absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full ${
	                                                                        cellFeedbackState === 'unresolved'
	                                                                            ? 'bg-amber-100 text-amber-700'
	                                                                            : 'bg-emerald-100 text-emerald-700'
	                                                                    }`}
	                                                                    title={prominentCellFeedback?.comment}
	                                                                    data-feedback-state={cellFeedbackState}
	                                                                    aria-label={cellFeedbackState === 'unresolved' ? 'Change requested' : 'Addressed'}
	                                                                >
	                                                                    {cellFeedbackState === 'unresolved' ? (
	                                                                        <X className="h-3 w-3" />
	                                                                    ) : (
	                                                                        <Check className="h-3 w-3" />
	                                                                    )}
	                                                                </span>
	                                                            ) : null}
	                                                            <div className="font-medium text-gray-700 text-center">
	                                                                {formatDuration(totalDuration)}
	                                                            </div>
	                                                        </button>
	                                                    ) : (
                                                        <div className="h-full w-full rounded-xl">
                                                            {shouldShowQuickAddPreview && (
                                                                <div className="absolute bottom-2 left-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
                                                                    <button
                                                                        id={quickAddTriggerId}
                                                                        type="button"
                                                                        data-automation-id={quickAddTriggerId}
                                                                        className="flex w-full items-center justify-center rounded border border-dashed border-gray-300 bg-white/95 px-2 py-1 text-xs font-medium text-gray-500 shadow-sm transition hover:border-[rgb(var(--color-primary-300))] hover:text-[rgb(var(--color-primary-600))]"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            onActivateQuickAdd({
                                                                                workItem,
                                                                                date: dateKey,
                                                                            });
                                                                        }}
                                                                    >
                                                                        H:MM
                                                                    </button>
                                                                </div>
                                                            )}
                                                            {isQuickAddActive && activeQuickAdd && (
                                                                <div
                                                                    className="absolute bottom-2 left-2 right-2 z-20 flex items-center gap-1 rounded border border-gray-200 bg-white px-1 py-1 shadow-sm"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <input
                                                                        id={quickAddInputId}
                                                                        data-automation-id={quickAddInputId}
                                                                        type="text"
                                                                        placeholder="H:MM"
                                                                        className="h-7 min-h-0 flex-1 rounded border border-gray-200 px-1 py-0.5 text-xs text-gray-900 outline-none focus:border-[rgb(var(--color-primary-400))] focus:ring-1 focus:ring-[rgb(var(--color-primary-400))]"
                                                                        value={activeQuickAdd.value}
                                                                        onChange={(e) => onQuickAddValueChange(sanitizeQuickAddInput(e.target.value))}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        onKeyDown={async (e) => {
                                                                            if (e.key === 'Enter') {
                                                                                e.preventDefault();
                                                                                e.stopPropagation();
                                                                                await onQuickAddSubmit();
                                                                            }

                                                                            if (e.key === 'Escape') {
                                                                                e.preventDefault();
                                                                                e.stopPropagation();
                                                                                onQuickAddCancel();
                                                                            }
                                                                        }}
                                                                        autoFocus
                                                                    />
                                                                    <button
                                                                        id={quickAddSaveId}
                                                                        type="button"
                                                                        data-automation-id={quickAddSaveId}
                                                                        className="flex h-6 w-6 items-center justify-center rounded text-green-600 hover:bg-green-50"
                                                                        onClick={async (e) => {
                                                                            e.preventDefault();
                                                                            e.stopPropagation();
                                                                            await onQuickAddSubmit();
                                                                        }}
                                                                        title="Save time entry"
                                                                    >
                                                                        <Check className="h-3 w-3" />
                                                                    </button>
                                                                    <button
                                                                        id={quickAddCancelId}
                                                                        type="button"
                                                                        data-automation-id={quickAddCancelId}
                                                                        className="flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100"
                                                                        onClick={(e) => {
                                                                            e.preventDefault();
                                                                            e.stopPropagation();
                                                                            onQuickAddCancel();
                                                                        }}
                                                                        title="Cancel"
                                                                    >
                                                                        <X className="h-3 w-3" />
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    </div>
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
                    <tr className="bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 border-t border-r border-gray-200 dark:border-gray-700 sticky left-0 z-10 bg-gray-100 dark:bg-gray-800">
                            Weekly Total
                        </td>
                        {visibleDates.map((date): React.JSX.Element => {
                            const entriesForDate = Object.values(groupedTimeEntries).flat()
                                .filter((entry) => parseISO(entry.start_time).toDateString() === date.toDateString());

                            const totalDuration = entriesForDate.reduce((sum, entry) => {
                                const start = parseISO(entry.start_time);
                                const end = parseISO(entry.end_time);
                                const durationInMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
                                return sum + durationInMinutes;
                            }, 0);

                            const isTodayDate = isToday(date);

                            return (
                                <td
                                    key={formatISO(date)}
                                    className={`px-3 py-3 text-center border-t border-r border-gray-200 last:border-r-0 ${
                                        isTodayDate ? 'text-[rgb(var(--color-primary-500))]' : 'text-gray-500'
                                    }`}
                                >
                                    <div className={`text-sm font-semibold ${isTodayDate ? 'text-[rgb(var(--color-primary-500))]' : 'text-gray-900'}`}>
                                        {formatDuration(totalDuration)}
                                    </div>
                                </td>
                            );
                        })}
                    </tr>
                </tfoot>
            </table>
            </div>
        </div>

        <BillableLegend className="mt-6" />
            </React.Fragment>
        </ReflectionContainer>
        </div>
    );
}
