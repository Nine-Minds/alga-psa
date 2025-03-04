'use client'

import { useState, useEffect } from 'react';
import { 
    ITimeEntry, 
    ITimeSheet, 
    ITimeSheetView,
    ITimeSheetComment, 
    TimeSheetStatus, 
    ITimeEntryWithWorkItemString, 
    ITimeEntryWithWorkItem,
    ITimePeriodView
} from 'server/src/interfaces/timeEntry.interfaces';
import { IExtendedWorkItem } from 'server/src/interfaces/workItem.interfaces';
import TimeEntryDialog from './TimeEntryDialog';
import { AddWorkItemDialog } from './AddWorkItemDialog';
import { fetchTimeEntriesForTimeSheet, fetchWorkItemsForTimeSheet, saveTimeEntry, submitTimeSheet, deleteWorkItem } from 'server/src/lib/actions/timeEntryActions';
import { updateScheduleEntry } from 'server/src/lib/actions/scheduleActions';
import { toast } from 'react-hot-toast';
import { fetchTimeSheet, fetchTimeSheetComments, addCommentToTimeSheet } from 'server/src/lib/actions/timeSheetActions';
import { useDrawer } from "server/src/context/DrawerContext";
import { formatISO, parseISO } from 'date-fns';
import { TimeSheetTable } from './TimeSheetTable';
import { TimeSheetHeader } from './TimeSheetHeader';
import { TimeSheetComments } from 'server/src/components/time-management/approvals/TimeSheetComments';
import { WorkItemDrawer } from './WorkItemDrawer';

interface TimeSheetProps {
    timeSheet: ITimeSheetView;
    onSaveTimeEntry: (timeEntry: ITimeEntry) => Promise<void>;
    isManager?: boolean;
    onSubmitTimeSheet: () => Promise<void>;
    initialWorkItem?: IExtendedWorkItem;
    initialDate?: string;
    initialDuration?: number;
    onBack: () => void;
}

import { Temporal } from '@js-temporal/polyfill';

function getDatesInPeriod(timePeriod: ITimePeriodView): Date[] {
    const dates: Date[] = [];
    let currentDate = Temporal.PlainDate.from(timePeriod.start_date);
    const endDate = Temporal.PlainDate.from(timePeriod.end_date);

    while (Temporal.PlainDate.compare(currentDate, endDate) < 0) {
        // Convert PlainDate to Date at midnight UTC
        const dateStr = `${currentDate.toString()}T00:00:00Z`;
        dates.push(new Date(dateStr));
        currentDate = currentDate.add({ days: 1 });
    }
    return dates;
}

export function TimeSheet({
    timeSheet: initialTimeSheet,
    onSaveTimeEntry,
    isManager = false,
    onSubmitTimeSheet,
    initialWorkItem,
    initialDate,
    initialDuration,
    onBack
}: TimeSheetProps): JSX.Element {
    const [timeSheet, setTimeSheet] = useState<ITimeSheetView>(initialTimeSheet);
    const [workItemsByType, setWorkItemsByType] = useState<Record<string, IExtendedWorkItem[]>>({});
    const [groupedTimeEntries, setGroupedTimeEntries] = useState<Record<string, ITimeEntryWithWorkItemString[]>>({});
    const [isAddWorkItemDialogOpen, setIsAddWorkItemDialogOpen] = useState(false);
    const [localWorkItems, setLocalWorkItems] = useState<IExtendedWorkItem[]>([]);
    const [comments, setComments] = useState<ITimeSheetComment[]>([]);
    const [isLoadingComments, setIsLoadingComments] = useState(false);
    const { openDrawer, closeDrawer } = useDrawer();

    const [selectedCell, setSelectedCell] = useState<{
        workItem: IExtendedWorkItem;
        date: string;
        entries: ITimeEntryWithWorkItemString[];
        defaultStartTime?: string;
        defaultEndTime?: string;
    } | null>(null);

    const initialDateObj = initialDate ? parseISO(initialDate) : undefined;
    if (initialDateObj) {
        initialDateObj.setHours(0, 0, 0, 0);
    }

    useEffect(() => {
        const loadComments = async () => {
            if (timeSheet.approval_status !== 'DRAFT') {
                setIsLoadingComments(true);
                try {
                    const fetchedComments = await fetchTimeSheetComments(timeSheet.id);
                    setComments(fetchedComments);
                } catch (error) {
                    console.error('Failed to fetch comments:', error);
                } finally {
                    setIsLoadingComments(false);
                }
            }
        };

        loadComments();
    }, [timeSheet.id, timeSheet.approval_status]);

    useEffect(() => {
        const loadData = async () => {
            const [fetchedTimeEntries, fetchedWorkItems, updatedTimeSheet] = await Promise.all([
                fetchTimeEntriesForTimeSheet(timeSheet.id),
                fetchWorkItemsForTimeSheet(timeSheet.id),
                fetchTimeSheet(timeSheet.id)
            ]);

            setTimeSheet(updatedTimeSheet);

            let workItems = fetchedWorkItems;
            if (initialWorkItem && !workItems.some(item => item.work_item_id === initialWorkItem.work_item_id)) {
                workItems = [...workItems, initialWorkItem];
            }

            const fetchedWorkItemsByType = workItems.reduce((acc: Record<string, IExtendedWorkItem[]>, item) => {
                if (!acc[item.type]) {
                    acc[item.type] = [];
                }
                acc[item.type].push(item);
                return acc;
            }, {});
            setWorkItemsByType(fetchedWorkItemsByType);

            const grouped = fetchedTimeEntries.reduce((acc: Record<string, ITimeEntryWithWorkItemString[]>, entry: ITimeEntryWithWorkItem) => {
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

            workItems.forEach(workItem => {
                const key = workItem.work_item_id;
                if (!grouped[key]) {
                    grouped[key] = [];
                }
            });

            setGroupedTimeEntries(grouped);

            if (initialWorkItem && initialDateObj && initialDuration) {
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

                setSelectedCell({
                    workItem: initialWorkItem,
                    date: formatISO(initialDateObj),
                    entries: grouped[initialWorkItem.work_item_id] || [],
                    defaultStartTime: formatISO(startTime),
                    defaultEndTime: formatISO(endTime)
                });
            }
        };

        loadData();
    }, [timeSheet.id, initialWorkItem, initialDateObj, initialDuration]);

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

            // Refresh the data
            const [fetchedTimeEntries, fetchedWorkItems] = await Promise.all([
                fetchTimeEntriesForTimeSheet(timeSheet.id),
                fetchWorkItemsForTimeSheet(timeSheet.id)
            ]);

            // Update work items state
            const fetchedWorkItemsByType = fetchedWorkItems.reduce((acc: Record<string, IExtendedWorkItem[]>, item) => {
                if (!acc[item.type]) {
                    acc[item.type] = [];
                }
                acc[item.type].push(item);
                return acc;
            }, {});
            setWorkItemsByType(fetchedWorkItemsByType);

            // Update time entries state
            const grouped = fetchedTimeEntries.reduce((acc: Record<string, ITimeEntryWithWorkItemString[]>, entry: ITimeEntryWithWorkItem) => {
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

            // Ensure all work items have an entry in groupedTimeEntries
            Object.keys(workItemsByType).forEach(type => {
                workItemsByType[type].forEach(workItem => {
                    const key = workItem.work_item_id;
                    if (!grouped[key]) {
                        grouped[key] = [];
                    }
                });
            });

            setGroupedTimeEntries(grouped);

            if (localWorkItems.length > 0) {
                setLocalWorkItems([]);
            }

            toast.success('Time entry saved successfully');
        } catch (error) {
            console.error('Error saving time entry:', error);
            toast.error('Failed to save time entry');
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

    const handleAddWorkItem = (workItem: IExtendedWorkItem) => {
        // Update workItemsByType
        setWorkItemsByType(prevTypes => {
            const newTypes = { ...prevTypes };
            if (!newTypes[workItem.type]) {
                newTypes[workItem.type] = [];
            }
            newTypes[workItem.type] = [...newTypes[workItem.type], workItem];
            return newTypes;
        });

        // Update groupedTimeEntries to include the new work item
        setGroupedTimeEntries(prev => ({
            ...prev,
            [workItem.work_item_id]: []
        }));

        setLocalWorkItems(prevItems => [...prevItems, workItem]);
        setIsAddWorkItemDialogOpen(false);
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

    const handleTaskUpdate = async (updated: any) => {
        try {
            const fetchedWorkItems = await fetchWorkItemsForTimeSheet(timeSheet.id);
            const fetchedWorkItemsByType = fetchedWorkItems.reduce((acc: Record<string, IExtendedWorkItem[]>, item) => {
                if (!acc[item.type]) {
                    acc[item.type] = [];
                }
                acc[item.type].push(item);
                return acc;
            }, {});
            setWorkItemsByType(fetchedWorkItemsByType);

            toast.success('Task updated successfully');
            closeDrawer();
        } catch (error) {
            console.error('Error updating task:', error);
            toast.error('Failed to update task');
        }
    };

    const handleScheduleUpdate = async (updated: any) => {
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

            const fetchedWorkItems = await fetchWorkItemsForTimeSheet(timeSheet.id);
            const fetchedWorkItemsByType = fetchedWorkItems.reduce((acc: Record<string, IExtendedWorkItem[]>, item) => {
                if (!acc[item.type]) {
                    acc[item.type] = [];
                }
                acc[item.type].push(item);
                return acc;
            }, {});
            setWorkItemsByType(fetchedWorkItemsByType);

            toast.success('Changes saved successfully');
            closeDrawer();
        } catch (error) {
            console.error('Error updating schedule entry:', error);
            toast.error('Failed to save changes');
        }
    };

    const dates = timeSheet.time_period ? getDatesInPeriod({
        period_id: timeSheet.time_period.period_id,
        start_date: timeSheet.time_period.start_date,
        end_date: timeSheet.time_period.end_date
    }) : [];

    const isEditable = timeSheet.approval_status === 'DRAFT' || timeSheet.approval_status === 'CHANGES_REQUESTED';

    return (
        <div className="h-full overflow-y-auto">
            <TimeSheetHeader
                status={timeSheet.approval_status}
                isEditable={isEditable}
                onSubmit={handleSubmitTimeSheet}
                onBack={onBack}
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

            <TimeSheetTable
                dates={dates}
                workItemsByType={workItemsByType}
                groupedTimeEntries={groupedTimeEntries}
                isEditable={isEditable}
                onCellClick={setSelectedCell}
                onAddWorkItem={() => setIsAddWorkItemDialogOpen(true)}
            onWorkItemClick={(workItem: IExtendedWorkItem) => {
                openDrawer(
                    <WorkItemDrawer
                        workItem={workItem}
                        onClose={closeDrawer}
                        onTaskUpdate={handleTaskUpdate}
                        onScheduleUpdate={handleScheduleUpdate}
                    />
                );
            }}
            onDeleteWorkItem={async (workItemId: string) => {
                try {
                    await deleteWorkItem(workItemId);
                    
                    // Refresh work items and time entries after deletion
                    const [fetchedTimeEntries, fetchedWorkItems] = await Promise.all([
                        fetchTimeEntriesForTimeSheet(timeSheet.id),
                        fetchWorkItemsForTimeSheet(timeSheet.id)
                    ]);

                    // Update work items state
                    const fetchedWorkItemsByType = fetchedWorkItems.reduce((acc: Record<string, IExtendedWorkItem[]>, item) => {
                        if (!acc[item.type]) {
                            acc[item.type] = [];
                        }
                        acc[item.type].push(item);
                        return acc;
                    }, {});
                    setWorkItemsByType(fetchedWorkItemsByType);

                    // Update time entries state
                    const grouped = fetchedTimeEntries.reduce((acc: Record<string, ITimeEntryWithWorkItemString[]>, entry: ITimeEntryWithWorkItem) => {
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

                    setGroupedTimeEntries(grouped);
                    toast.success('Work item deleted successfully');
                } catch (error) {
                    console.error('Error deleting work item:', error);
                    toast.error('Failed to delete work item');
                }
            }}
            />

            {selectedCell && isEditable && timeSheet.time_period && (
                <TimeEntryDialog
                    id="time-entry-dialog"
                    isOpen={true}
                    onClose={() => setSelectedCell(null)}
                    onSave={handleSaveTimeEntry}
                    workItem={selectedCell.workItem}
                    date={parseISO(selectedCell.date)}
                    existingEntries={selectedCell.entries.map((entry): ITimeEntryWithWorkItem => ({
                        ...entry,
                    }))}
                    timePeriod={timeSheet.time_period}
                    isEditable={isEditable}
                    defaultEndTime={selectedCell.defaultEndTime ? parseISO(selectedCell.defaultEndTime) : undefined}
                    defaultStartTime={selectedCell.defaultStartTime ? parseISO(selectedCell.defaultStartTime) : undefined}
                    timeSheetId={timeSheet.id}
                    inDrawer={false}
                    onTimeEntriesUpdate={(entries) => {
                        const grouped = entries.reduce((acc, entry) => {
                            const key = `${entry.work_item_id}`;
                            if (!acc[key]) {
                                acc[key] = [];
                            }
                            acc[key].push(entry);
                            return acc;
                        }, {} as Record<string, ITimeEntryWithWorkItemString[]>);
                        setGroupedTimeEntries(grouped);
                        
                        if (selectedCell) {
                            const updatedEntries = entries.filter(entry => 
                                entry.work_item_id === selectedCell.workItem.work_item_id &&
                                parseISO(entry.start_time).toDateString() === parseISO(selectedCell.date).toDateString()
                            );
                            setSelectedCell(prev => prev ? {
                                ...prev,
                                entries: updatedEntries
                            } : null);
                        }
                    }}
                />
            )}

            {timeSheet.time_period && (
                <AddWorkItemDialog
                    isOpen={isAddWorkItemDialogOpen}
                    onClose={() => setIsAddWorkItemDialogOpen(false)}
                    onAdd={handleAddWorkItem}
                    availableWorkItems={Object.values(workItemsByType).flat()}
                    timePeriod={timeSheet.time_period}
                />
            )}
        </div>
    );
}
