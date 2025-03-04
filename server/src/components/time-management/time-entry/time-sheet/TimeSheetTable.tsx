'use client'

import React, { useState }  from 'react';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Button } from 'server/src/components/ui/Button';
import { Trash } from 'lucide-react';
import { ITimeEntryWithWorkItemString } from 'server/src/interfaces/timeEntry.interfaces';
import { IExtendedWorkItem } from 'server/src/interfaces/workItem.interfaces';
import { formatISO, parseISO } from 'date-fns';

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
}


type BillabilityPercentage = 0 | 25 | 50 | 75 | 100;

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
    onDeleteWorkItem
}: TimeSheetTableProps): JSX.Element {
    const [selectedWorkItemToDelete, setSelectedWorkItemToDelete] = useState<string | null>(null);
    
    return (
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
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                    <tr>
                        <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider shadow-[4px_0_6px_rgba(0,0,0,0.1)] sticky left-0 z-20 min-w-fit max-w-[15%] whitespace-nowrap truncate bg-gray-50">
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
                            className="px-6 py-3 whitespace-nowrap text-xs text-gray-400 cursor-pointer relative shadow-[4px_0_6px_rgba(0,0,0,0.1)] sticky left-0 z-10 w-[25vw] truncate bg-primary-100"
                            onClick={onAddWorkItem}
                        >
                            + Add new work item
                        </td>
                        <td colSpan={dates.length} className=""></td>
                    </tr>
                    {Object.entries(workItemsByType).map(([type, workItems]): JSX.Element => (
                        <React.Fragment key={type}>
                            {workItems.map((workItem): JSX.Element => {
                                const entries = groupedTimeEntries[workItem.work_item_id] || [];
                                return (
                                    <tr key={`${workItem.work_item_id}-${Math.random()}`}>
                                    <td 
                                        className="px-6 py-4 pr-1 whitespace-nowrap text-sm font-medium text-gray-900 shadow-[4px_0_6px_rgba(0,0,0,0.1)] border-t border-b sticky left-0 z-10 bg-white min-w-fit max-w-[15%] truncate bg-white cursor-pointer hover:bg-white"
                                        onClick={() => onWorkItemClick(workItem)}
                                    >
                                        <div className="flex flex-col pr-8">
                                            <span>
                                                {workItem.type === 'ticket'
                                                    ? `${workItem.ticket_number} - ${workItem.title || workItem.name}`
                                                    : workItem.name
                                                }
                                            </span>
                                            {workItem.type === 'project_task' && workItem.project_name && workItem.phase_name && (
                                                <div className="text-xs text-gray-600 mt-1">
                                                    {workItem.project_name} • {workItem.phase_name}
                                                </div>
                                            )}
                                            <span className={`inline-flex w-max items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                workItem.type === 'ticket' 
                                                    ? 'bg-[rgb(var(--color-primary-200))] text-[rgb(var(--color-primary-900))]' 
                                                    : workItem.type === 'project_task' 
                                                        ? 'bg-[rgb(var(--color-secondary-100))] text-[rgb(var(--color-secondary-900))]' 
                                                        : 'bg-[rgb(var(--color-border-200))] text-[rgb(var(--color-border-900))]'
                                            }`}>
                                                {formatWorkItemType(workItem.type)}
                                            </span>
                                        </div>
                                        {isEditable && (
                                            <Button
                                                id="delete-workitem-button"
                                                variant="ghost"
                                                size="sm"
                                                className="absolute right-1 top-2 p-1 hover:bg-[rgb(var(--color-primary-50))]"
                                                title="Delete"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedWorkItemToDelete(workItem.work_item_id);
                                                }}
                                            >
                                                <Trash className="h-4 w-4 text-[rgb(var(--color-text-300))] hover:text-red-600" />
                                            </Button>
                                        )}
                                    </td>
                                        {dates.map((date): JSX.Element => {
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

                                            return (
                                                <td
                                                    key={formatISO(date)}
                                                    className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 cursor-pointer border transition-colors relative min-h-[100px]"
                                                    onClick={() => {
                                                        if (!isEditable) return;
                                                        
                                                        let startTime, endTime;

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
                    <tr className="shadow-[0px_-4px_6px_rgba(0,0,0,0.1)]">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 border-r z-10 min-w-fit max-w-[15%] shadow-[4px_0_6px_rgba(0,0,0,0.1)] sticky left-0 bg-white">Total</td>
                        {dates.map((date): JSX.Element => {
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
        </React.Fragment>
    );
}
