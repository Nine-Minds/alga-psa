'use client'

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    ITimeEntry,
    ITimeSheet,
    ITimeSheetView,
    ITimeSheetComment,
    TimeSheetStatus,
    ITimeEntryWithWorkItemString,
    ITimeEntryWithWorkItem,
    ITimePeriodView
} from '@alga-psa/types';
import { IExtendedWorkItem } from '@alga-psa/types';
import TimeEntryDialog from './TimeEntryDialog';
import { AddWorkItemDialog } from './AddWorkItemDialog';
import { fetchTimeEntriesForTimeSheet, fetchWorkItemsForTimeSheet, submitTimeSheet, deleteWorkItem } from '../../../../actions/timeEntryActions';
import { updateScheduleEntry } from '@alga-psa/scheduling/actions';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { fetchTimeSheet, fetchTimeSheetComments, addCommentToTimeSheet } from '../../../../actions/timeSheetActions';
import { useDrawer } from "@alga-psa/ui";
import { formatISO, parseISO, format } from 'date-fns';
import { TimeSheetTable } from './TimeSheetTable';
import { TimeSheetListView } from './TimeSheetListView';
import { TimeSheetHeader, TimeSheetViewMode } from './TimeSheetHeader';
import {
    TimeEntrySelectionRequest,
    TimeSheetDateNavigatorState,
    TimeSheetInteractionState,
    TimeSheetListFocusFilter,
    TimeSheetQuickAddState,
} from './types';
import { TimeSheetComments } from '../../approvals/TimeSheetComments';
import { WorkItemDrawer } from './WorkItemDrawer';
import { IntervalSection } from '../../interval-tracking/IntervalSection';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { useUserPreference } from '@alga-psa/user-composition/hooks';

const TIMESHEET_VIEW_MODE_SETTING = 'timesheet_view_mode';

interface TimeSheetProps {
    timeSheet: ITimeSheetView;
    initialEntries: ITimeEntryWithWorkItem[];
    initialWorkItems: IExtendedWorkItem[];
    initialComments: ITimeSheetComment[];
    onSaveTimeEntry: (timeEntry: ITimeEntry) => Promise<void>;
    isManager?: boolean;
    subjectName?: string;
    actorName?: string;
    isDelegated?: boolean;
    allowDelegatedEditing?: boolean;
    canReopenForEdits?: boolean;
    onReopenForEdits?: () => Promise<void>;
    onSubmitTimeSheet: () => Promise<void>;
    initialWorkItem?: IExtendedWorkItem;
    initialDate?: string;
    initialDuration?: number;
    onBack: () => void;
}

import { Temporal } from '@js-temporal/polyfill';

function toDateOnlyString(dateValue: unknown): string {
    if (typeof dateValue === 'string') {
        return dateValue.slice(0, 10);
    }

    if (dateValue instanceof Date) {
        return formatISO(dateValue, { representation: 'date' });
    }

    if (dateValue && typeof dateValue === 'object') {
        const temporalLike = dateValue as { year?: unknown; month?: unknown; day?: unknown; toString?: () => string };
        if (
            typeof temporalLike.year === 'number' &&
            typeof temporalLike.month === 'number' &&
            typeof temporalLike.day === 'number'
        ) {
            const y = String(temporalLike.year).padStart(4, '0');
            const m = String(temporalLike.month).padStart(2, '0');
            const d = String(temporalLike.day).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }

        if (typeof temporalLike.toString === 'function') {
            const value = temporalLike.toString();
            if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
                return value.slice(0, 10);
            }
        }
    }

    throw new Error(`Invalid date value: ${String(dateValue)}`);
}

function parseLocalDate(dateValue: unknown): Date {
    const dateStr = toDateOnlyString(dateValue);
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function normalizeOptionalDateInput(dateValue?: unknown): string | null {
    if (dateValue == null) {
        return null;
    }

    try {
        return toDateOnlyString(dateValue);
    } catch {
        return null;
    }
}

function getDatesInPeriod(timePeriod: ITimePeriodView): Date[] {
    const dates: Date[] = [];
    let currentDate = Temporal.PlainDate.from(timePeriod.start_date);
    const endDate = Temporal.PlainDate.from(timePeriod.end_date);

    while (Temporal.PlainDate.compare(currentDate, endDate) < 0) {
        // Convert PlainDate to a local Date at midnight to avoid UTC offset drift in the UI.
        dates.push(new Date(currentDate.year, currentDate.month - 1, currentDate.day));
        currentDate = currentDate.add({ days: 1 });
    }
    return dates;
}

function getWorkItemDisplayName(workItem: IExtendedWorkItem): string {
    if (workItem.type === 'ticket') {
        return workItem.ticket_number
            ? `${workItem.ticket_number} - ${workItem.title || workItem.name}`
            : (workItem.title || workItem.name);
    }

    return workItem.name;
}

function groupWorkItemsByType(items: IExtendedWorkItem[]): Record<string, IExtendedWorkItem[]> {
    return items.reduce((acc: Record<string, IExtendedWorkItem[]>, item) => {
        if (!acc[item.type]) {
            acc[item.type] = [];
        }
        acc[item.type].push(item);
        return acc;
    }, {});
}

function groupEntriesByWorkItem(
    entries: ITimeEntryWithWorkItem[],
    workItemsMap?: Record<string, IExtendedWorkItem[]>,
): Record<string, ITimeEntryWithWorkItemString[]> {
    const grouped = entries.reduce((acc: Record<string, ITimeEntryWithWorkItemString[]>, entry: ITimeEntryWithWorkItem) => {
        const key = `${entry.work_item_id}`;
        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push({
            ...entry,
            start_time: typeof entry.start_time === 'string' ? entry.start_time : formatISO(entry.start_time),
            end_time: typeof entry.end_time === 'string' ? entry.end_time : formatISO(entry.end_time)
        });
        return acc;
    }, {});

    if (workItemsMap) {
        Object.values(workItemsMap).forEach((items) => {
            items.forEach((workItem) => {
                if (!grouped[workItem.work_item_id]) {
                    grouped[workItem.work_item_id] = [];
                }
            });
        });
    }

    return grouped;
}

function parseQuickAddDurationToMinutes(value: string): number {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
        return 0;
    }

    const colonMatch = trimmedValue.match(/^(\d{1,2}):(\d{1,2})$/);
    if (colonMatch) {
        const hours = parseInt(colonMatch[1], 10);
        const minutes = parseInt(colonMatch[2], 10);
        return Number.isFinite(hours) && Number.isFinite(minutes)
            ? (hours * 60) + minutes
            : 0;
    }

    if (/^(\d+\.?\d*)$/.test(trimmedValue)) {
        const hours = parseFloat(trimmedValue);
        return Number.isFinite(hours) ? Math.round(hours * 60) : 0;
    }

    return 0;
}

export function TimeSheet({
    timeSheet: initialTimeSheet,
    initialEntries,
    initialWorkItems,
    initialComments,
    onSaveTimeEntry,
    isManager = false,
    subjectName,
    actorName,
    isDelegated = false,
    allowDelegatedEditing = true,
    canReopenForEdits = false,
    onReopenForEdits,
    onSubmitTimeSheet,
    initialWorkItem,
    initialDate,
    initialDuration,
    onBack
}: TimeSheetProps): React.JSX.Element {
    const [showIntervals, setShowIntervals] = useState(false);
    const [dateNavigator, setDateNavigator] = useState<TimeSheetDateNavigatorState | null>(null);
    const isLoadingTimeSheetData = false;
    const [timeSheet, setTimeSheet] = useState<ITimeSheetView>(initialTimeSheet);
    const [workItemsByType, setWorkItemsByType] = useState<Record<string, IExtendedWorkItem[]>>(() =>
        groupWorkItemsByType(initialWorkItems)
    );
    const [groupedTimeEntries, setGroupedTimeEntries] = useState<Record<string, ITimeEntryWithWorkItemString[]>>(() =>
        groupEntriesByWorkItem(initialEntries, groupWorkItemsByType(initialWorkItems))
    );
    const [isAddWorkItemDialogOpen, setIsAddWorkItemDialogOpen] = useState(false);
    const [addWorkItemDate, setAddWorkItemDate] = useState<string | null>(null);
    const [localWorkItems, setLocalWorkItems] = useState<IExtendedWorkItem[]>([]);
    const [comments, setComments] = useState<ITimeSheetComment[]>(initialComments);
    const [isLoadingComments, setIsLoadingComments] = useState(false);
    const { openDrawer, closeDrawer } = useDrawer();

    // View mode preference (grid or list)
    const {
        value: viewMode,
        setValue: setViewMode,
        isLoading: isViewModeLoading
    } = useUserPreference<TimeSheetViewMode>(
        TIMESHEET_VIEW_MODE_SETTING,
        {
            defaultValue: 'grid',
            localStorageKey: TIMESHEET_VIEW_MODE_SETTING,
            debounceMs: 300,
            skipServerFetch: true,
        }
    );

    const [interactionState, setInteractionState] = useState<TimeSheetInteractionState>({ type: 'idle' });

    const selectedCell = interactionState.type === 'dialog'
        ? interactionState.selection
        : null;
    const listFocusFilter = interactionState.type === 'list-focus'
        ? interactionState.filter
        : null;
    const activeQuickAdd = interactionState.type === 'quick-add'
        ? interactionState.quickAdd
        : null;

    const handleViewModeChange = useCallback((newMode: TimeSheetViewMode) => {
        setInteractionState((currentInteraction) => {
            if (currentInteraction.type === 'quick-add') {
                return { type: 'idle' };
            }

            if (newMode === 'grid' && currentInteraction.type === 'list-focus') {
                return { type: 'idle' };
            }

            return currentInteraction;
        });
        setViewMode(newMode);
    }, [setViewMode]);

    const handleClearListFocusFilter = useCallback(() => {
        setInteractionState((currentInteraction) =>
            currentInteraction.type === 'list-focus' ? { type: 'idle' } : currentInteraction
        );
    }, []);

    const handleBackToGrid = useCallback(() => {
        setInteractionState((currentInteraction) =>
            currentInteraction.type === 'list-focus' ? { type: 'idle' } : currentInteraction
        );
        setViewMode('grid');
    }, [setViewMode]);

    const handleTimeEntrySelection = useCallback((selection: TimeEntrySelectionRequest) => {
        const normalizedDate = toDateOnlyString(selection.date);

        if (selection.entries.length > 1) {
            setInteractionState({
                type: 'list-focus',
                filter: {
                    workItemId: selection.workItem.work_item_id,
                    workItemLabel: getWorkItemDisplayName(selection.workItem),
                    date: normalizedDate,
                    dateLabel: format(parseLocalDate(normalizedDate), 'MMM d'),
                    entryIds: selection.entries
                        .map((entry) => entry.entry_id)
                        .filter((entryId): entryId is string => Boolean(entryId)),
                    entryCount: selection.entries.length,
                },
            });
            setViewMode('list');
            return;
        }

        setInteractionState({
            type: 'dialog',
            selection: {
                ...selection,
                date: normalizedDate,
                entries: selection.entries.slice(0, 1),
            },
        });
    }, [setViewMode]);

    const initialDateObj = useMemo(() => {
        if (!initialDate) {
            return undefined;
        }

        const parsedDate = parseISO(initialDate);
        parsedDate.setHours(0, 0, 0, 0);
        return parsedDate;
    }, [initialDate]);

    const syncListFocusFilter = useCallback((entries: ITimeEntryWithWorkItem[]) => {
        setInteractionState((currentInteraction) => {
            if (currentInteraction.type !== 'list-focus') {
                return currentInteraction;
            }

            const currentFilter = currentInteraction.filter;
            const matchingEntries = entries.filter((entry) => {
                const entryDate = entry.work_date?.slice(0, 10) ?? toDateOnlyString(entry.start_time);
                return entry.work_item_id === currentFilter.workItemId &&
                    entryDate === currentFilter.date &&
                    typeof entry.entry_id === 'string' &&
                    currentFilter.entryIds.includes(entry.entry_id);
            });

            if (matchingEntries.length === 0) {
                return { type: 'idle' };
            }

            return {
                type: 'list-focus',
                filter: {
                    ...currentFilter,
                    entryIds: matchingEntries
                        .map((entry) => entry.entry_id)
                        .filter((entryId): entryId is string => Boolean(entryId)),
                    entryCount: matchingEntries.length,
                },
            };
        });
    }, []);

    const applyTimeEntryUpdates = useCallback((entries: ITimeEntryWithWorkItem[], workItemsMap?: Record<string, IExtendedWorkItem[]>) => {
        setGroupedTimeEntries(groupEntriesByWorkItem(entries, workItemsMap));
        syncListFocusFilter(entries);
    }, [syncListFocusFilter]);

    const activateQuickAdd = useCallback((quickAddTarget: Omit<TimeSheetQuickAddState, 'value'>) => {
        setInteractionState((currentInteraction) => {
            if (
                currentInteraction.type === 'quick-add' &&
                currentInteraction.quickAdd.workItem.work_item_id === quickAddTarget.workItem.work_item_id &&
                currentInteraction.quickAdd.date === quickAddTarget.date
            ) {
                return currentInteraction;
            }

            return {
                type: 'quick-add',
                quickAdd: {
                    ...quickAddTarget,
                    value: '',
                },
            };
        });
    }, []);

    const updateQuickAddValue = useCallback((value: string) => {
        setInteractionState((currentInteraction) =>
            currentInteraction.type === 'quick-add'
                ? {
                    type: 'quick-add',
                    quickAdd: {
                        ...currentInteraction.quickAdd,
                        value,
                    },
                }
                : currentInteraction
        );
    }, []);

    const cancelQuickAdd = useCallback(() => {
        setInteractionState((currentInteraction) =>
            currentInteraction.type === 'quick-add' ? { type: 'idle' } : currentInteraction
        );
    }, []);

    useEffect(() => {
        if (!initialWorkItem || !initialDateObj || !initialDuration) {
            return;
        }

        let endTime = new Date();
        const durationInMilliseconds = Math.ceil(initialDuration / 60) * 60 * 1000;
        let startTime = new Date(endTime.getTime() - durationInMilliseconds);

        startTime.setFullYear(initialDateObj.getFullYear(), initialDateObj.getMonth(), initialDateObj.getDate());
        endTime.setFullYear(initialDateObj.getFullYear(), initialDateObj.getMonth(), initialDateObj.getDate());

        if (startTime < initialDateObj) {
            startTime = new Date(initialDateObj);
            startTime.setHours(0, 0, 0, 0);
            endTime = new Date(startTime.getTime() + durationInMilliseconds);
        }

        const endOfDay = new Date(initialDateObj);
        endOfDay.setHours(23, 59, 59, 999);
        if (endTime > endOfDay) {
            endTime = new Date(endOfDay);
            startTime = new Date(endTime.getTime() - durationInMilliseconds);

            if (startTime < initialDateObj) {
                startTime = new Date(initialDateObj);
                startTime.setHours(0, 0, 0, 0);
            }
        }

        setInteractionState({
            type: 'dialog',
            selection: {
                workItem: initialWorkItem,
                date: formatISO(initialDateObj, { representation: 'date' }),
                entries: [],
                defaultStartTime: formatISO(startTime),
                defaultEndTime: formatISO(endTime)
            },
        });
    }, [initialWorkItem, initialDateObj, initialDuration]);

    const handleQuickAddTimeEntry = async (params: {
        workItem: IExtendedWorkItem;
        date: string;
        durationInMinutes: number;
        existingEntry?: ITimeEntryWithWorkItemString;
    }) => {
        const { workItem, date, durationInMinutes, existingEntry } = params;
        
        const workDate = date.slice(0, 10);

        // Set start time to 8 AM on the selected date (local time)
        const startTime = parseLocalDate(workDate);
        startTime.setHours(8, 0, 0, 0);
        
        // Calculate end time based on duration
        const endTime = new Date(startTime.getTime() + durationInMinutes * 60 * 1000);
        
        // Get entries for this date to check for overlaps
        const entriesForDate = (groupedTimeEntries[workItem.work_item_id] || [])
            .filter(entry => {
                const entryWorkDate = entry.work_date?.slice(0, 10);
                if (entryWorkDate) return entryWorkDate === workDate;
                return parseISO(entry.start_time).toDateString() === startTime.toDateString();
            });
        
        // If there are existing entries for this date, start after the last one
        if (entriesForDate.length > 0) {
            const sortedEntries = [...entriesForDate].sort((a, b) => 
                parseISO(b.end_time).getTime() - parseISO(a.end_time).getTime()
            );
            const lastEndTime = parseISO(sortedEntries[0].end_time);
            startTime.setTime(lastEndTime.getTime());
            endTime.setTime(startTime.getTime() + durationInMinutes * 60 * 1000);
        }
        
        // Create the time entry, copying settings from existing entry if available
        const timeEntry: ITimeEntry = {
            entry_id: '',
            work_item_id: workItem.work_item_id,
            user_id: timeSheet.user_id,
            start_time: formatISO(startTime),
            end_time: formatISO(endTime),
            billable_duration: existingEntry ? 
                (existingEntry.billable_duration > 0 ? durationInMinutes : 0) : 
                durationInMinutes, // Default to billable if no existing entry
            work_item_type: workItem.type,
            notes: existingEntry?.notes || '',
            approval_status: 'DRAFT' as TimeSheetStatus,
            created_at: formatISO(new Date()),
            updated_at: formatISO(new Date()),
            time_sheet_id: timeSheet.id,
            service_id: existingEntry?.service_id || undefined,  // Use undefined instead of empty string
            tax_region: existingEntry?.tax_region || undefined,  // Use undefined instead of empty string
            contract_line_id: existingEntry?.contract_line_id || undefined  // Also handle contract_line_id
        };
        
        await handleSaveTimeEntry(timeEntry);
    };

    const refreshTimeSheetData = useCallback(async () => {
        const [fetchedTimeEntries, fetchedWorkItems] = await Promise.all([
            fetchTimeEntriesForTimeSheet(timeSheet.id),
            fetchWorkItemsForTimeSheet(timeSheet.id)
        ]);

        const fetchedWorkItemsByType = groupWorkItemsByType(fetchedWorkItems);
        setWorkItemsByType(fetchedWorkItemsByType);
        applyTimeEntryUpdates(fetchedTimeEntries, fetchedWorkItemsByType);

        return {
            fetchedTimeEntries,
            fetchedWorkItems,
            fetchedWorkItemsByType,
        };
    }, [applyTimeEntryUpdates, timeSheet.id]);

    const submitQuickAdd = useCallback(async () => {
        if (!activeQuickAdd) {
            return;
        }

        const durationInMinutes = parseQuickAddDurationToMinutes(activeQuickAdd.value);
        if (durationInMinutes <= 0) {
            return;
        }

        const allEntriesForWorkItem = groupedTimeEntries[activeQuickAdd.workItem.work_item_id] || [];
        const existingEntry = allEntriesForWorkItem.length > 0 ? allEntriesForWorkItem[0] : undefined;

        try {
            await handleQuickAddTimeEntry({
                workItem: activeQuickAdd.workItem,
                date: activeQuickAdd.date,
                durationInMinutes,
                existingEntry,
            });

            setInteractionState({ type: 'idle' });
        } catch {
            // Error handling/toast is already performed downstream in handleSaveTimeEntry.
        }
    }, [activeQuickAdd, groupedTimeEntries, handleQuickAddTimeEntry]);

    const handleSaveTimeEntry = async (timeEntry: ITimeEntry) => {
        try {
            // Ensure timeEntry has all required fields
            const completeTimeEntry = {
                ...timeEntry,
                time_sheet_id: timeSheet.id,
                user_id: timeSheet.user_id,
                approval_status: 'DRAFT' as TimeSheetStatus,
                created_at: timeEntry.created_at || formatISO(new Date()),
                updated_at: formatISO(new Date())
            };

            // Save the time entry and get the response
            await onSaveTimeEntry(completeTimeEntry);

            await refreshTimeSheetData();

            if (localWorkItems.length > 0) {
                setLocalWorkItems([]);
            }

            toast.success('Time entry saved successfully');
        } catch (error) {
            handleError(error, 'Failed to save time entry');
            throw error;
        }
    };

    const handleSubmitTimeSheet = async () => {
        try {
            await submitTimeSheet(timeSheet.id);
            const updatedTimeSheet = await fetchTimeSheet(timeSheet.id);
            setTimeSheet(updatedTimeSheet);
            if (onSubmitTimeSheet) {
                await onSubmitTimeSheet();
            }
        } catch (error) {
            console.error('Error submitting time sheet:', error);
        }
    };

  const openAddWorkItemDialog = useCallback((date?: string) => {
    setInteractionState((currentInteraction) =>
      currentInteraction.type === 'quick-add' ? { type: 'idle' } : currentInteraction
    );
    setAddWorkItemDate(normalizeOptionalDateInput(date));
    setIsAddWorkItemDialogOpen(true);
  }, []);

  const handleAddWorkItem = async (workItem: IExtendedWorkItem) => {
    console.log('Selected work item for time entry:', workItem);
    
    // Close the add work item dialog
    setIsAddWorkItemDialogOpen(false);
    
    // Set up for creating a new time entry
    let defaultStartTime: Date | undefined;
    let defaultEndTime: Date | undefined;
    const selectedDate = addWorkItemDate ? parseLocalDate(addWorkItemDate) : undefined;
    let currentDate: Date;
    
    // For ad_hoc items, use their scheduled times as defaults
    if (workItem.type === 'ad_hoc' && workItem.scheduled_start && workItem.scheduled_end) {
      const scheduledStart = new Date(workItem.scheduled_start);
      const scheduledEnd = new Date(workItem.scheduled_end);
      const adjustedScheduledEnd = new Date(scheduledEnd);

      if (adjustedScheduledEnd < scheduledStart) {
        adjustedScheduledEnd.setDate(adjustedScheduledEnd.getDate() + 1);
      }

      if (selectedDate) {
        defaultStartTime = new Date(selectedDate);
        defaultStartTime.setHours(
          scheduledStart.getHours(),
          scheduledStart.getMinutes(),
          scheduledStart.getSeconds(),
          scheduledStart.getMilliseconds()
        );
        defaultEndTime = new Date(defaultStartTime.getTime() + (adjustedScheduledEnd.getTime() - scheduledStart.getTime()));
        currentDate = selectedDate;
      } else {
        defaultStartTime = scheduledStart;
        defaultEndTime = adjustedScheduledEnd;
        currentDate = timeSheet.time_period ?
          parseLocalDate(timeSheet.time_period.start_date) :
          new Date();
      }
    } else {
      // For other work items, set reasonable defaults
      currentDate = selectedDate || (timeSheet.time_period ?
        parseLocalDate(timeSheet.time_period.start_date) :
        new Date());
      defaultStartTime = new Date(currentDate);
      defaultStartTime.setHours(8, 0, 0, 0); // 8:00 AM
      defaultEndTime = new Date(defaultStartTime);
      defaultEndTime.setHours(9, 0, 0, 0); // 9:00 AM (1 hour duration)
    }

    // Open the time entry dialog for the selected work item.
    // The work item will be added to the time sheet only when the time entry is saved.
    handleTimeEntrySelection({
      workItem,
      date: formatISO(currentDate, { representation: 'date' }),
      entries: [],
      defaultStartTime: defaultStartTime ? formatISO(defaultStartTime) : undefined,
      defaultEndTime: defaultEndTime ? formatISO(defaultEndTime) : undefined
    });
    setAddWorkItemDate(null);
  };

    const handleAddComment = async (comment: string) => {
        try {
            await addCommentToTimeSheet(
                timeSheet.id,
                timeSheet.user_id,
                comment,
                false
            );
            const fetchedComments = await fetchTimeSheetComments(timeSheet.id);
            setComments(fetchedComments);
        } catch (error) {
            console.error('Failed to add comment:', error);
            throw error;
        }
    };

    const handleTaskUpdate = useCallback(async (_updated: any) => {
        try {
            await refreshTimeSheetData();
            toast.success('Task updated successfully');
            closeDrawer();
        } catch (error) {
            handleError(error, 'Failed to update task');
        }
    }, [closeDrawer, refreshTimeSheetData]);

    const handleScheduleUpdate = useCallback(async (updated: any) => {
        try {
            const result = await updateScheduleEntry(updated.entry_id, {
                title: updated.title,
                notes: updated.notes,
                scheduled_start: updated.scheduled_start,
                scheduled_end: updated.scheduled_end,
                assigned_user_ids: updated.assigned_user_ids,
                status: updated.status
            });

            if (!result.success) {
                toast.error(result.error || 'Failed to save changes');
                return;
            }

            await refreshTimeSheetData();
            toast.success('Changes saved successfully');
            closeDrawer();
        } catch (error) {
            handleError(error, 'Failed to save changes');
        }
    }, [closeDrawer, refreshTimeSheetData]);

    const handleDeleteWorkItem = useCallback(async (workItemId: string) => {
        try {
            await deleteWorkItem(workItemId);
            await refreshTimeSheetData();
            setInteractionState((currentInteraction) => {
                if (currentInteraction.type === 'quick-add' && currentInteraction.quickAdd.workItem.work_item_id === workItemId) {
                    return { type: 'idle' };
                }

                if (currentInteraction.type === 'dialog' && currentInteraction.selection.workItem.work_item_id === workItemId) {
                    return { type: 'idle' };
                }

                if (currentInteraction.type === 'list-focus' && currentInteraction.filter.workItemId === workItemId) {
                    return { type: 'idle' };
                }

                return currentInteraction;
            });
            toast.success('Work item deleted successfully');
        } catch (error) {
            handleError(error, 'Failed to delete work item');
        }
    }, [refreshTimeSheetData]);

    const handleWorkItemClick = useCallback((workItem: IExtendedWorkItem) => {
        openDrawer(
            <WorkItemDrawer
                workItem={workItem}
                onClose={closeDrawer}
                onTaskUpdate={handleTaskUpdate}
                onScheduleUpdate={handleScheduleUpdate}
            />
        );
    }, [openDrawer, closeDrawer, handleTaskUpdate, handleScheduleUpdate]);

    const dates = timeSheet.time_period ? getDatesInPeriod({
        period_id: timeSheet.time_period.period_id,
        start_date: timeSheet.time_period.start_date,
        end_date: timeSheet.time_period.end_date
    }) : [];

    // For list view, show the full time period range (no pagination)
    const listViewDateNavigator = useMemo((): TimeSheetDateNavigatorState | null => {
        if (!timeSheet.time_period || dates.length === 0) return null;

        const startDate = dates[0];
        const endDate = dates[dates.length - 1];

        // Format: "Mon, Dec 16 - Sun, Dec 22"
        const dateRangeDisplay = `${format(startDate, 'EEE, MMM d')} - ${format(endDate, 'EEE, MMM d')}`;

        return {
            dateRangeDisplay,
            canGoBack: false,
            canGoForward: false,
            hasMultiplePages: false,
            currentPage: 0,
            totalPages: 1,
            isAnimating: false,
            goToPreviousPage: () => {},
            goToNextPage: () => {}
        };
    }, [timeSheet.time_period, dates]);

    // Use the appropriate date navigator based on view mode
    // Fall back to dateNavigator if listViewDateNavigator is null (e.g., no time period)
    const effectiveDateNavigator = viewMode === 'list'
        ? (listViewDateNavigator ?? dateNavigator)
        : dateNavigator;

    const isEditable = timeSheet.approval_status === 'DRAFT' || timeSheet.approval_status === 'CHANGES_REQUESTED';
    const delegatedEditingBlocked = isDelegated && !allowDelegatedEditing;
    const effectiveIsEditable = isEditable && !delegatedEditingBlocked;

    const timeSheetAutomationProps = {
        id: 'timesheet-main',
        'data-automation-id': 'timesheet-main',
        'data-automation-type': 'container',
    } as const;

    return (
        <ReflectionContainer id="timesheet-main" label="Time Sheet Management">
            <div className="h-full overflow-y-auto" {...timeSheetAutomationProps}>
                {delegatedEditingBlocked && (
                    <Alert variant="warning" className="mb-4">
                        <AlertDescription>
                            Delegated time entry is currently disabled. Enable the <span className="font-mono">delegated-time-entry</span> feature flag to
                            edit other users&#39; time sheets.
                        </AlertDescription>
                    </Alert>
                )}
                <TimeSheetHeader
                status={timeSheet.approval_status}
                isEditable={effectiveIsEditable}
                subjectName={subjectName}
                actorName={actorName}
                isDelegated={isDelegated}
                allowDelegatedEditing={allowDelegatedEditing}
                canReopenForEdits={canReopenForEdits}
                onReopenForEdits={onReopenForEdits}
                onSubmit={handleSubmitTimeSheet}
                onBack={onBack}
                showIntervals={showIntervals}
                onToggleIntervals={() => setShowIntervals(!showIntervals)}
                dateNavigator={effectiveDateNavigator}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
            />

            {(timeSheet.approval_status === 'CHANGES_REQUESTED' || comments.length > 0) && (
                <div className="mb-8">
                    {isLoadingComments ? (
                        <div>Loading comments...</div>
                    ) : (
                        <TimeSheetComments 
                            comments={comments} 
                            onAddComment={handleAddComment}
                            timeSheetStatus={timeSheet.approval_status}
                            timeSheetId={timeSheet.id}
                            onCommentsUpdate={setComments}
                        />
                    )}
                </div>
            )}
            
            {/* Show intervals section if enabled */}
            {showIntervals && timeSheet.time_period && (
                <div className="mb-8">
                    <IntervalSection
                        userId={timeSheet.user_id}
                        timePeriod={timeSheet.time_period}
                        onCreateTimeEntry={effectiveIsEditable ? handleSaveTimeEntry : async (_timeEntry) => {}}
                    />
                </div>
            )}

            {viewMode === 'grid' ? (
                <TimeSheetTable
                    dates={dates}
                    workItemsByType={workItemsByType}
                    groupedTimeEntries={groupedTimeEntries}
                    isEditable={effectiveIsEditable}
                    isLoading={isLoadingTimeSheetData || isViewModeLoading}
                    onCellClick={handleTimeEntrySelection}
                    onAddWorkItem={openAddWorkItemDialog}
                    activeQuickAdd={activeQuickAdd}
                    onActivateQuickAdd={activateQuickAdd}
                    onQuickAddValueChange={updateQuickAddValue}
                    onQuickAddCancel={cancelQuickAdd}
                    onQuickAddSubmit={submitQuickAdd}
                    onDateNavigatorChange={setDateNavigator}
                    onWorkItemClick={handleWorkItemClick}
                    onDeleteWorkItem={handleDeleteWorkItem}
                />
            ) : (
                <TimeSheetListView
                    dates={dates}
                    workItemsByType={workItemsByType}
                    groupedTimeEntries={groupedTimeEntries}
                    isEditable={effectiveIsEditable}
                    isLoading={isLoadingTimeSheetData || isViewModeLoading}
                    onCellClick={handleTimeEntrySelection}
                    onAddWorkItem={openAddWorkItemDialog}
                    onWorkItemClick={handleWorkItemClick}
                    onDeleteWorkItem={handleDeleteWorkItem}
                    focusFilter={listFocusFilter}
                    onClearFocusFilter={handleClearListFocusFilter}
                    onBackToGrid={handleBackToGrid}
                />
            )}

            {selectedCell && timeSheet.time_period && (
                <TimeEntryDialog
                    id="time-entry-dialog"
                    isOpen={true}
                    onClose={() => setInteractionState({ type: 'idle' })}
                    onSave={handleSaveTimeEntry}
                    workItem={selectedCell.workItem}
                    date={parseLocalDate(selectedCell.date)}
                    existingEntries={selectedCell.entries.map((entry): ITimeEntryWithWorkItem => ({
                        ...entry,
                    }))}
                    timePeriod={timeSheet.time_period}
                    isEditable={effectiveIsEditable}
                    defaultEndTime={selectedCell.defaultEndTime ? parseISO(selectedCell.defaultEndTime) : undefined}
                    defaultStartTime={selectedCell.defaultStartTime ? parseISO(selectedCell.defaultStartTime) : undefined}
                    timeSheetId={timeSheet.id}
                    inDrawer={false}
                    onTimeEntriesUpdate={(entries) => {
                        applyTimeEntryUpdates(entries as ITimeEntryWithWorkItem[]);
                    }}
                />
            )}

            {timeSheet.time_period && isAddWorkItemDialogOpen && (
                <AddWorkItemDialog
                    isOpen={true}
                    onClose={() => {
                        setIsAddWorkItemDialogOpen(false);
                        setAddWorkItemDate(null);
                    }}
                    onAdd={handleAddWorkItem}
                    availableWorkItems={Object.values(workItemsByType).flat()}
                    timePeriod={timeSheet.time_period}
                />
            )}
            </div>
        </ReflectionContainer>
    );
}
