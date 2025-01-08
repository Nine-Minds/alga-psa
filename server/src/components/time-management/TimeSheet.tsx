'use client'

import { useState, useEffect } from 'react';
import { ITimeEntryWithWorkItem, ITimeEntry, ITimeSheet, ITimeSheetComment, TimeSheetStatus } from '@/interfaces/timeEntry.interfaces';
import { IWorkItem } from '@/interfaces/workItem.interfaces';
import { TimeEntryDialog } from './TimeEntryDialog';
import { AddWorkItemDialog } from './AddWorkItemDialog';
import { fetchTimeEntriesForTimeSheet, fetchWorkItemsForTimeSheet, saveTimeEntry, submitTimeSheet, addWorkItem } from '@/lib/actions/timeEntryActions';
import { ApprovalActions } from './ApprovalActions';
import { fetchTimeSheet } from '@/lib/actions/timeSheetActions';
import { Button } from '@/components/ui/Button';
import React from 'react';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import { fetchTimeSheetComments, addCommentToTimeSheet } from '@/lib/actions/timeSheetActions';
import { TextArea } from '../ui/TextArea';
import { useTenant } from '@/components/TenantProvider';
import { fromZonedTime } from 'date-fns-tz';
import { formatISO, parseISO } from 'date-fns';
import { time } from 'console';

interface TimeSheetProps {
    timeSheet: ITimeSheet;
    onSaveTimeEntry: (timeEntry: ITimeEntry) => Promise<void>;
    isManager?: boolean;
    onSubmitTimeSheet: () => Promise<void>;
    initialWorkItem?: IWorkItem;
    initialDate?: string;
    initialDuration?: number;
    onBack: () => void;
}

// Update ITimeEntryWithWorkItem interface to use string types for dates
interface ITimeEntryWithWorkItemString extends Omit<ITimeEntryWithWorkItem, 'start_time' | 'end_time'> {
    start_time: string;
    end_time: string;
}

const Comments: React.FC<{
    comments: ITimeSheetComment[],
    onAddComment: (comment: string) => Promise<void>,
    timeSheetStatus: TimeSheetStatus,
    timeSheetId: string,
    onCommentsUpdate: (comments: ITimeSheetComment[]) => void
}> = ({ comments, onAddComment, timeSheetStatus, timeSheetId, onCommentsUpdate }) => {
    const [newComment, setNewComment] = useState('');
    const [isAddingComment, setIsAddingComment] = useState(false);

    const handleAddComment = async () => {
        if (newComment.trim() && !isAddingComment) {
            setIsAddingComment(true);
            try {
                await onAddComment(newComment);
                const fetchedComments = await fetchTimeSheetComments(timeSheetId);
                onCommentsUpdate(fetchedComments);
                setNewComment('');
            } catch (error) {
                console.error('Failed to add comment:', error);
            } finally {
                setIsAddingComment(false);
            }
        }
    };

    return (
        <div className="space-y-4">
            {comments.map((comment) => (
                <div 
                    key={comment.comment_id} 
                    className={`${comment.is_approver ? 'p-3 rounded shadow bg-orange-50 border border-orange-200' : 'p-3 rounded shadow bg-white'}`}
                >
                    <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2">
                            <p className="font-semibold">
                                {comment.is_approver ? 
                                    <span className="text-orange-600">
                                        {comment.user_name}
                                    </span> : 
                                    <span>{comment.user_name}</span>
                                }
                            </p>
                            {comment.is_approver ? (
                                <span className="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">
                                    Approver
                                </span>
                            ) : (
                                <span className="text-xs bg-gray-100 text-gray-800 px-2 py-1 rounded">
                                    Employee
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-gray-500">
                            {new Date(comment.created_at).toLocaleString()}
                        </p>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{comment.comment}</p>
                </div>
            ))}
            <div className="mt-4">
                <TextArea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder={timeSheetStatus === 'CHANGES_REQUESTED' ? 
                        "Respond to the requested changes..." : 
                        "Add a comment..."}
                    className={timeSheetStatus === 'CHANGES_REQUESTED' ? 
                        'border-orange-200 focus:border-orange-500' : ''}
                />
                <Button
                    onClick={handleAddComment}
                    disabled={isAddingComment}
                    className={`mt-2 ${timeSheetStatus === 'CHANGES_REQUESTED' ? 
                        'bg-orange-500 hover:bg-orange-600' : ''}`}
                >
                    {isAddingComment ? 'Adding...' : 
                        timeSheetStatus === 'CHANGES_REQUESTED' ? 
                        'Respond to Changes' : 'Add Comment'}
                </Button>
            </div>
        </div>
    );
};


export function TimeSheet({
    timeSheet: initialTimeSheet,
    onSaveTimeEntry,
    isManager = false,
    onSubmitTimeSheet,
    initialWorkItem,
    initialDate,
    initialDuration,
    onBack
}: TimeSheetProps) {

    const tenant = useTenant();
    if (!tenant) {
        throw new Error('tenant is not defined');
    }

    const initialDateObj = initialDate ? parseISO(initialDate) : undefined;
    if (initialDateObj) {
        // back the initial date to the start of the day
        initialDateObj.setHours(0, 0, 0, 0);
    }

    const [timeSheet, setTimeSheet] = useState<ITimeSheet>(initialTimeSheet);
    const [workItemsByType, setWorkItemsByType] = useState<Record<string, IWorkItem[]>>({});
    const [groupedTimeEntries, setGroupedTimeEntries] = useState<Record<string, ITimeEntryWithWorkItemString[]>>({});
    const [isAddWorkItemDialogOpen, setIsAddWorkItemDialogOpen] = useState(false);
    const [localWorkItems, setLocalWorkItems] = useState<IWorkItem[]>([]);
    const [comments, setComments] = useState<ITimeSheetComment[]>([]);
    const [isLoadingComments, setIsLoadingComments] = useState(false);
    const [newComment, setNewComment] = useState('');
    const [isAddingComment, setIsAddingComment] = useState(false);
    const [isBillable, setIsBillable] = useState<boolean[]>([]);

    const [selectedCell, setSelectedCell] = useState<{
        workItem: IWorkItem;
        date: string;
        entries: ITimeEntryWithWorkItemString[];
        defaultStartTime?: string;
        defaultEndTime?: string;
    } | null>(null);

    useEffect(() => {
        const loadComments = async () => {
            if (timeSheet.approval_status !== 'DRAFT') {
                setIsLoadingComments(true);
                try {
                    const fetchedComments = await fetchTimeSheetComments(timeSheet.id);
                    setComments(fetchedComments);
                } catch (error) {
                    console.error('Failed to fetch comments:', error);
                    // Optionally, set an error state here to display to the user
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

            // Add initialWorkItem if it doesn't exist
            if (initialWorkItem && !workItems.some(item => item.work_item_id === initialWorkItem.work_item_id)) {
                workItems = [...workItems, initialWorkItem];
            }

            console.log('workItems', workItems);

            const fetchedWorkItemsByType = workItems.reduce((acc: Record<string, IWorkItem[]>, item: IWorkItem) => {
                if (!acc[item.type]) {
                    acc[item.type] = [];
                }
                acc[item.type].push(item);
                return acc;
            }, {} as Record<string, IWorkItem[]>);
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
            }, {} as Record<string, ITimeEntryWithWorkItemString[]>);

            // Ensure all work items are represented in groupedTimeEntries, even if they have no entries yet
            workItems.forEach(workItem => {
                const key = workItem.work_item_id;
                if (!grouped[key]) {
                    grouped[key] = [];
                }
            });

            setGroupedTimeEntries(grouped);

            // Open the time entry dialog for the initial work item
            if (initialWorkItem && initialDateObj && initialDuration) {
                let endTime = new Date(); // Use current time as end time

                // Convert seconds to milliseconds and round up to the nearest minute
                const durationInMilliseconds = Math.ceil(initialDuration / 60) * 60 * 1000;

                let startTime = new Date(endTime.getTime() - durationInMilliseconds);

                // Ensure the times are within the selected date
                startTime.setFullYear(initialDateObj.getFullYear(), initialDateObj.getMonth(), initialDateObj.getDate());
                endTime.setFullYear(initialDateObj.getFullYear(), initialDateObj.getMonth(), initialDateObj.getDate());

                // If start time is before the date, set it to the start of the day
                if (startTime < initialDateObj) {
                    startTime = new Date(initialDateObj);
                    startTime.setHours(0, 0, 0, 0);
                    endTime = new Date(startTime.getTime() + durationInMilliseconds);
                }

                // If end time is after the end of the day, adjust both start and end times
                const endOfDay = new Date(initialDateObj);
                endOfDay.setHours(23, 59, 59, 999);
                if (endTime > endOfDay) {
                    endTime = new Date(endOfDay);
                    startTime = new Date(endTime.getTime() - durationInMilliseconds);

                    // If this pushes start time before the start of the day, adjust it
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


    useEffect(() => {
        // Merge local work items with fetched work items
        const allWorkItems = [...Object.values(workItemsByType).flat(), ...localWorkItems];
        const mergedWorkItemsByType = allWorkItems.reduce((acc, item) => {
            if (!acc[item.type]) {
                acc[item.type] = [];
            }
            if (!acc[item.type].some(existingItem => existingItem.work_item_id === item.work_item_id)) {
                acc[item.type].push(item);
            }
            return acc;
        }, {} as Record<string, IWorkItem[]>);

        // Only update if there's a change
        if (JSON.stringify(mergedWorkItemsByType) !== JSON.stringify(workItemsByType)) {
            setWorkItemsByType(mergedWorkItemsByType);
        }

        // Group time entries
        const grouped = Object.entries(groupedTimeEntries).reduce((acc, [key, entries]) => {
            acc[key] = entries.map((entry): ITimeEntryWithWorkItemString => {
                const workItem = allWorkItems.find(item => item.work_item_id === entry.work_item_id) || {
                    work_item_id: entry.work_item_id,
                    type: entry.work_item_type,
                    name: '',
                    description: '',
                    is_billable: false
                };
                return { ...entry, workItem };
            });
            return acc;
        }, {} as Record<string, ITimeEntryWithWorkItemString[]>);

        // Only update if there's a change
        if (JSON.stringify(grouped) !== JSON.stringify(groupedTimeEntries)) {
            setGroupedTimeEntries(grouped);
        }
    }, [timeSheet.id, workItemsByType, groupedTimeEntries, localWorkItems]);

const handleSaveTimeEntry = async (timeEntry: ITimeEntry) => {
    try {
        timeEntry.time_sheet_id = timeSheet.id;
        await onSaveTimeEntry(timeEntry);

        // Refresh data after successful save
        const [fetchedTimeEntries, fetchedWorkItems] = await Promise.all([
            fetchTimeEntriesForTimeSheet(timeSheet.id),
            fetchWorkItemsForTimeSheet(timeSheet.id)
        ]);

        // Update workItems state
        const fetchedWorkItemsByType = fetchedWorkItems.reduce((acc: Record<string, IWorkItem[]>, item: IWorkItem) => {
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

        // Clear local work items after successful save
        if (localWorkItems.length > 0) {
            setLocalWorkItems([]);
        }
    } catch (error) {
        console.error('Error saving time entry:', error);
        throw error; // Re-throw to be handled by the dialog
    }

    const localworkItemsByType = workItemsByType;
    // Update groupedTimeEntries with the new time entry
    setGroupedTimeEntries(prevGrouped => {
        const key = `${timeEntry.work_item_id}`;
        const workItem = localworkItemsByType[timeEntry.work_item_type]?.find(item => item.work_item_id === timeEntry.work_item_id) || {
            work_item_id: timeEntry.work_item_id,
            type: timeEntry.work_item_type,
            name: 'Unknown',
            description: '',
            is_billable: timeEntry.billable_duration > 0
        };

        const newEntry: ITimeEntryWithWorkItemString = {
            ...timeEntry,
            workItem,
            start_time: typeof timeEntry.start_time === 'string' ? timeEntry.start_time : formatISO(timeEntry.start_time),
            end_time: typeof timeEntry.end_time === 'string' ? timeEntry.end_time : formatISO(timeEntry.end_time)
        };

        const updatedEntries = { ...prevGrouped };
        if (!updatedEntries[key]) {
            updatedEntries[key] = [];
        }

        // Find the index of the existing entry if it exists
        const existingIndex = updatedEntries[key].findIndex(entry => entry.entry_id === timeEntry.entry_id);

        if (existingIndex !== -1) {
            // Update existing entry
            updatedEntries[key][existingIndex] = newEntry;
        } else {
            // Add new entry
            updatedEntries[key].push(newEntry);
        }

        return updatedEntries;
    });
};

    const handleSubmitTimeSheet = async () => {
        try {
            await submitTimeSheet(timeSheet.id);
            // Refresh the time sheet data after submission
            const updatedTimeSheet = await fetchTimeSheet(timeSheet.id);
            setTimeSheet(updatedTimeSheet);
            // Call the onSubmitTimeSheet prop to notify the parent component
            if (onSubmitTimeSheet) {
                await onSubmitTimeSheet();
            }
        } catch (error) {
            console.error('Error submitting time sheet:', error);
            // Handle the error (e.g., show an error message to the user)
        }
    };

    const onAddWorkItem = (workItem: IWorkItem) => {
        setLocalWorkItems(prevItems => [...prevItems, workItem]);
        setIsAddWorkItemDialogOpen(false);
    };

    const start_month = new Date(timeSheet.time_period?.start_date || new Date()).getUTCMonth() + 1;
    const start_day = new Date(timeSheet.time_period?.start_date || new Date()).getUTCDate();
    const start_year = new Date(timeSheet.time_period?.start_date || new Date()).getUTCFullYear();

    const end_month = new Date(timeSheet.time_period?.end_date || new Date()).getUTCMonth() + 1;
    const end_day = new Date(timeSheet.time_period?.end_date || new Date()).getUTCDate();
    const end_year = new Date(timeSheet.time_period?.end_date || new Date()).getUTCFullYear();    

    const dates = React.useMemo(() => getDatesInPeriod({
        start_date: timeSheet.time_period ? new Date(start_year, start_month-1, start_day) : new Date(),
        end_date: timeSheet.time_period ? new Date(end_year, end_month-1, end_day) : new Date()
    }), [timeSheet.time_period, start_year, start_month, start_day, end_year, end_month, end_day]);

    const handleCellClick = (workItem: IWorkItem, date: Date, entries: ITimeEntryWithWorkItemString[]) => {
        let startTime = new Date(date);
        startTime.setHours(8, 0, 0, 0);
        let endTime = new Date(startTime);
        endTime.setHours(9, 0, 0, 0);


        // If there are existing entries for this day, use the last entry's end time as the start time
        if (entries.length > 0) {
            const sortedEntries = [...entries].sort((a, b) => 
                parseISO(b.end_time).getTime() - parseISO(a.end_time).getTime()
            );
            startTime = parseISO(sortedEntries[0].end_time);
            endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // Add 1 hour
        } else if (initialDuration && initialWorkItem && workItem.work_item_id === initialWorkItem.work_item_id) {
            endTime = new Date(); // Use current time as end time

            // Convert seconds to milliseconds and round up to the nearest minute
            const durationInMilliseconds = Math.ceil(initialDuration / 60) * 60 * 1000;

            startTime = new Date(endTime.getTime() - durationInMilliseconds);

            // Ensure the times are within the selected date
            startTime.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
            endTime.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());

            // If start time is before the date, set it to the start of the day
            if (startTime < date) {
                startTime = new Date(date);
                startTime.setHours(0, 0, 0, 0);
                endTime = new Date(startTime.getTime() + durationInMilliseconds);
            }

            // If end time is after the end of the day, adjust both start and end times
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
            if (endTime > endOfDay) {
                endTime = new Date(endOfDay);
                startTime = new Date(endTime.getTime() - durationInMilliseconds);

                // If this pushes start time before the start of the day, adjust it
                if (startTime < date) {
                    startTime = new Date(date);
                    startTime.setHours(0, 0, 0, 0);
                }
            }
        }

        setSelectedCell({
            workItem,
            date: formatISO(date),
            entries,
            defaultStartTime: formatISO(startTime),
            defaultEndTime: formatISO(endTime)
        });
    };

    const handleAddWorkItemClick = () => {
        setIsAddWorkItemDialogOpen(true);
    };

    const handleAddComment = async (comment: string) => {
        try {
            await addCommentToTimeSheet(
                timeSheet.id,
                timeSheet.user_id,
                comment,
                false // isApprover set to false for regular users
            );
            // Refresh comments after adding a new one
            const fetchedComments = await fetchTimeSheetComments(timeSheet.id);
            setComments(fetchedComments);
        } catch (error) {
            console.error('Failed to add comment:', error);
            throw error; // Re-throw the error to be handled in the Comments component
        }
    };

    type BillabilityPercentage = 0 | 25 | 50 | 75 | 100;

    // const billabilityColorScheme: Record<BillabilityPercentage, string> = {
    //     100: "#22C55E",
    //     75: "#86EFAC",
    //     50: "#FDE68A",
    //     25: "#FEF08A",
    //     0: "#FEF9C3",
    // } as const;


    const getCellBackgroundColor = (duration: number, billable_duration: number) => {
        const percentage = (billable_duration / duration) * 100;
        if (percentage === 100) return billabilityColorScheme[100].background;
        if (percentage >= 75) return billabilityColorScheme[75].background;
        if (percentage >= 50) return billabilityColorScheme[50].background;
        if (percentage >= 25) return billabilityColorScheme[25].background;
        return billabilityColorScheme[0].background;
    };

    const formatDuration = (minutes: number): string => {
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours.toString().padStart(2, '0')}:${remainingMinutes.toString().padStart(2, '0')}`;
    };

    function formatWorkItemType(type: string): string {
        // Split the string by underscores or spaces
        const words = type.split(/[_\s]+/);

        // Capitalize the first letter of each word and join them with a space
        return words.map((word): string =>
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
    }

    const billabilityColorScheme: Record<BillabilityPercentage, {
        background: string;
        border: string;
    }> = {
        100: {
            background: "rgb(var(--color-primary-100))",
            border: "rgb(var(--color-primary-300))"
        },
        75: {
            background: "rgb(var(--color-secondary-100))",
            border: "rgb(var(--color-secondary-300))"
        },
        50: {
            background: "rgb(var(--color-accent-50))",
            border: "rgb(var(--color-accent-300))"
        },
        25: {
            background: "rgb(var(--color-accent-50))",
            border: "rgb(var(--color-accent-300))"
        },
        0: {
            background: "rgb(var(--color-border-50))",
            border: "rgb(var(--color-border-300))"
        }
    } as const;

    const isEditable = timeSheet.approval_status === 'DRAFT' || timeSheet.approval_status === 'CHANGES_REQUESTED';

    // Get all existing work items for the AddWorkItemDialog
    const getAllExistingWorkItems = () => {
        return Object.values(workItemsByType).flat();
    };

    return (
        <div className="h-full overflow-y-auto">
            <div className="flex items-center mb-4">
                <Button
                    onClick={onBack}
                    variant="soft"
                    className="mr-4"
                >
                    <ArrowLeftIcon className="mr-1" /> Back
                </Button>
                <h2 className="text-2xl font-bold">Time Sheet</h2>
            </div>
            <div className="flex justify-between items-center mb-4">
                <span className="text-lg font-medium flex items-center">
                    Status:&nbsp; {'  '}
                    {(() => {
                        switch (timeSheet.approval_status) {
                            case 'DRAFT':
                                return <span className="text-blue-600"> In Progress</span>;
                            case 'SUBMITTED':
                                return <span className="text-yellow-600"> Submitted for Approval</span>;
                            case 'APPROVED':
                                return <span className="text-green-600"> Approved</span>;
                            case 'CHANGES_REQUESTED':
                                return <span className="text-orange-600"> Changes Requested</span>;
                            default:
                                return <span className="text-gray-600"> Unknown</span>;
                        }
                    })()}
                </span>
                {isEditable && (
                    <Button 
                        onClick={handleSubmitTimeSheet}
                        variant="default"
                        className="bg-primary-500 hover:bg-primary-600 text-white"
                    >
                        Submit Time Sheet
                    </Button>
                )}

            </div>

            {(timeSheet.approval_status === 'CHANGES_REQUESTED' || comments.length > 0) && (
                <div className="mb-8">
                    {isLoadingComments ? (
                        <div>Loading comments...</div>
                    ) : (
                        <Comments 
                            comments={comments} 
                            onAddComment={handleAddComment}
                            timeSheetStatus={timeSheet.approval_status}
                            timeSheetId={timeSheet.id}
                            onCommentsUpdate={setComments}
                        />
                    )}
                </div>
            )}

            <div className="overflow-x-auto">

                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                        <thead>
                            <tr>
                                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider shadow-[4px_0_6px_rgba(0,0,0,0.1)] relative">
                                    Work Item
                                </th>
                                {dates.map((date): JSX.Element => (
                                    <th key={date.toLocaleDateString()} className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r">
                                        {date.toLocaleDateString()}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            <tr className="h-10 bg-primary-100">
                                <td
                                    colSpan={1}
                                    className="px-6 py-3 whitespace-nowrap text-xs text-gray-400 cursor-pointer relative shadow-[4px_0_6px_rgba(0,0,0,0.1)]  "
                                    onClick={handleAddWorkItemClick}
                                >
                                    + Add new work item
                                </td>
                                <td colSpan={dates.length} className=''></td>
                            </tr>
                            {Object.entries(workItemsByType).map(([type, workItems]): JSX.Element => (
                                <React.Fragment key={type}>
                                    {workItems.map((workItem): JSX.Element => {
                                        const entries = groupedTimeEntries[workItem.work_item_id] || [];
                                        return (
                                            <tr key={`${workItem.work_item_id}-${Math.random()}`}>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 shadow-[4px_0_6px_rgba(0,0,0,0.1)] border-t border-b relative z-10">
                                                    <div className="flex flex-col">
                                                        <span>{workItem.name}</span>
                                                        <span className="text-xs text-gray-500 mt-1">{formatWorkItemType(workItem.type)}</span>
                                                    </div>
                                                </td>
                                                {dates.map((date): JSX.Element => {
                                                    const dayEntries = entries.filter(entry =>
                                                        parseISO(entry.start_time).toDateString() === date.toDateString()
                                                    );
                                                    const totalDuration = dayEntries.reduce((sum, entry) => {
                                                        const duration = (parseISO(entry.end_time).getTime() - parseISO(entry.start_time).getTime()) / 60000;
                                                        return sum + duration;
                                                    }, 0);
                                                    const totalBillableDuration = dayEntries.reduce((sum, entry) => sum + entry.billable_duration, 0);

                                                    // Calculate percentage and get the appropriate colors
                                                    let colors = billabilityColorScheme[0];
                                                    if (totalDuration > 0) {
                                                        const percentage = (totalBillableDuration / totalDuration) * 100;
                                                        if (percentage === 100) colors = billabilityColorScheme[100];
                                                        else if (percentage >= 75) colors = billabilityColorScheme[75];
                                                        else if (percentage >= 50) colors = billabilityColorScheme[50];
                                                        else if (percentage >= 25) colors = billabilityColorScheme[25];
                                                    }

                                                    return (
                                                        <td
                                                            key={formatISO(date)}
                                                            className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 cursor-pointer border transition-colors relative min-h-[100px]"
                                                            onClick={() => handleCellClick(workItem, date, dayEntries)}
                                                        >
                                                            {dayEntries.length > 0 && (
                                                                <div
                                                                    className="rounded-lg p-2 text-xs shadow-sm h-full w-full"
                                                                    style={{
                                                                        backgroundColor: colors.background,
                                                                        borderColor: colors.border,
                                                                        borderWidth: '1px',
                                                                        borderStyle: 'solid'
                                                                    }}
                                                                >
                                                                    <div>
                                                                        <div className="font-medium text-gray-700">{`Total: ${formatDuration(totalDuration)}`}</div>
                                                                        <div className="text-gray-600">{`Billable: ${formatDuration(totalBillableDuration)}`}</div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </React.Fragment>
                            ))}
                        </tbody>

                        <tfoot>
                            <tr className=' shadow-[0px_-4px_6px_rgba(0,0,0,0.1)]'>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 border-r z-10">Total</td>
                                {dates.map((date): JSX.Element => {
                                    const totalDuration = Object.values(groupedTimeEntries).flat()
                                        .filter((entry) => parseISO(entry.start_time).toDateString() === date.toDateString())
                                        .reduce((sum, entry) => {
                                            const duration = (parseISO(entry.end_time).getTime() - parseISO(entry.start_time).getTime()) / 60000; // Convert milliseconds to minutes
                                            return sum + duration;
                                        }, 0);
                                    const totalBillableDuration = Object.values(groupedTimeEntries).flat()
                                        .filter((entry) => parseISO(entry.start_time).toDateString() === date.toDateString())
                                        .reduce((sum, entry) => sum + entry.billable_duration, 0);
                                    return (
                                        <td key={formatISO(date)} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border-r">
                                            <div>{`Total: ${formatDuration(totalDuration)}`}</div>
                                            <div>{`Billable: ${formatDuration(totalBillableDuration)}`}</div>
                                        </td>
                                    );
                                })}
                            </tr>
                        </tfoot>
                    </table>
                </div>

                {selectedCell && isEditable && timeSheet.time_period && (
                    <TimeEntryDialog
                        id='time-entry-dialog'
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
                            
                            // Update selectedCell if it exists
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


            <AddWorkItemDialog
                isOpen={isAddWorkItemDialogOpen}
                onClose={() => setIsAddWorkItemDialogOpen(false)}
                onAdd={onAddWorkItem}
                existingWorkItems={getAllExistingWorkItems()}
            />

                <div className="mt-4">
                    <h3 className="text-lg font-medium">Legend</h3>
                    <div className="flex space-x-4">
                        {(Object.entries(billabilityColorScheme) as [string, { background: string; border: string; }][]).map(([percentage, colors]): JSX.Element => (
                            <div key={percentage} className="flex items-center">
                                <div
                                    className="w-4 h-4 mr-2 border"
                                    style={{
                                        backgroundColor: colors.background,
                                        borderColor: colors.border
                                    }}
                                ></div>
                                <span>{percentage}% Billable</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function getDatesInPeriod(timePeriod: { start_date: Date; end_date: Date }): Date[] {
    const dates: Date[] = [];
    const currentDate = new Date(timePeriod.start_date);
    currentDate.setHours(0, 0, 0, 0); // Set to start of day
    const endDate = new Date(timePeriod.end_date);
    endDate.setHours(23, 59, 59, 999); // Set to end of day

    while (currentDate <= endDate) {
        dates.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
    }
    return dates;
}

function formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}


