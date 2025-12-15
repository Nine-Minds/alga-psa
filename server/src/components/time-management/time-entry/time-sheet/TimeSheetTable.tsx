'use client'

import React, { useState }  from 'react';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Trash, Plus, Check, X } from 'lucide-react';
import { ITimeEntryWithWorkItemString } from 'server/src/interfaces/timeEntry.interfaces';
import { IExtendedWorkItem } from 'server/src/interfaces/workItem.interfaces';
import { formatISO, parseISO } from 'date-fns';
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
    onDeleteWorkItem,
    onQuickAddTimeEntry
}: TimeSheetTableProps): JSX.Element {
    const [selectedWorkItemToDelete, setSelectedWorkItemToDelete] = useState<string | null>(null);
    const [hoveredCell, setHoveredCell] = useState<{ workItemId: string; date: string } | null>(null);
    const [quickInputValues, setQuickInputValues] = useState<{ [key: string]: string }>({});
    
    // Register add work item button for automation
    const { automationIdProps: addWorkItemProps } = useAutomationIdAndRegister<ButtonComponent>({
        type: 'button',
        id: 'add-work-item-button',
        label: 'Add new work item',
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
        <div className="overflow-x-auto" {...tableProps}>
            <table className="min-w-full divide-y divide-gray-200" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                    <tr>
                        <th className="px-6 py-3 bg-gray-50 shadow-[4px_0_6px_rgba(var(--color-border-200),0.3)] sticky left-0 z-20 w-1/4 min-w-[250px] bg-gray-50">
                            <div className="flex justify-start">
                                <Button
                                    {...addWorkItemProps}
                                    variant="soft"
                                    size="sm"
                                    onClick={onAddWorkItem}
                                >
                                    <Plus className="h-4 w-4 mr-2" />
                                    Add new work item
                                </Button>
                            </div>
                        </th>
                        {dates.map((date): JSX.Element => (
                            <th key={date.toLocaleDateString()} className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r">
                                {date.toLocaleDateString()}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                    {Object.entries(workItemsByType).map(([type, workItems]): JSX.Element => (
                        <React.Fragment key={type}>
                            {workItems.map((workItem): JSX.Element => {
                                const entries = groupedTimeEntries[workItem.work_item_id] || [];
                                return (
                                    <tr key={`${workItem.work_item_id}-${Math.random()}`}>
                                    <td 
                                        className="px-6 py-4 pr-1 text-sm font-medium text-gray-900 shadow-[4px_0_6px_rgba(var(--color-border-200),0.3)] border-t border-b sticky left-0 z-10 bg-white w-1/5 min-w-[250px] cursor-pointer hover:bg-gray-50"
                                        onClick={() => onWorkItemClick(workItem)}
                                        data-automation-id={`work-item-${workItem.work_item_id}`}
                                        data-automation-type="work-item-cell"
                                    >
                                        <div className="flex flex-col pr-8">
                                            <span className="break-words whitespace-normal">
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
                                            {workItem.type === 'interaction' && workItem.client_name && (
                                                <div className="text-xs text-gray-600 mt-1">
                                                    {workItem.client_name}
                                                    {workItem.contact_name && ` • ${workItem.contact_name}`}
                                                </div>
                                            )}
                                            <span className={`inline-flex w-max items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                workItem.type === 'ticket' 
                                                    ? 'bg-[rgb(var(--color-primary-200))] text-[rgb(var(--color-primary-900))]' 
                                                    : workItem.type === 'project_task' 
                                                        ? 'bg-[rgb(var(--color-secondary-100))] text-[rgb(var(--color-secondary-900))]' 
                                                        : workItem.type === 'interaction'
                                                            ? 'bg-green-100 text-green-900'
                                                            : 'bg-[rgb(var(--color-border-200))] text-[rgb(var(--color-border-900))]'
                                            }`}>
                                                {formatWorkItemType(workItem.type)}
                                            </span>
                                        </div>
                                        {isEditable && (
                                            <Button
                                                id="delete-workitem-button"
                                                variant="icon"
                                                size="sm"
                                                className="absolute right-1 top-2 p-1"
                                                title="Delete Work Item"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedWorkItemToDelete(workItem.work_item_id);
                                                }}
                                            >
                                                <Trash className="h-4 w-4" /> 
                                            </Button>
                                        )}
                                    </td>
                                        {dates.map((date): JSX.Element => {
                                            const dateKey = formatISO(date, { representation: 'date' });
                                            const dayEntries = entries.filter(entry => {
                                                const entryWorkDate = entry.work_date?.slice(0, 10);
                                                if (entryWorkDate) return entryWorkDate === dateKey;
                                                return parseISO(entry.start_time).toDateString() === date.toDateString();
                                            });
                                            
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
                                            const cellKey = `${workItem.work_item_id}-${dateKey}`;
                                            const isHovered = hoveredCell?.workItemId === workItem.work_item_id && 
                                                            hoveredCell?.date === dateKey;

                                            return (
                                                <td
                                                    key={dateKey}
                                                    className={`px-6 py-4 whitespace-nowrap text-sm text-gray-500 cursor-pointer border transition-all relative h-20 ${
                                                        isHovered && isEditable ? 'bg-gray-50' : ''
                                                    } hover:bg-gray-50`}
                                                    data-automation-id={`time-cell-${workItem.work_item_id}-${dateKey}`}
                                                    data-automation-type="time-entry-cell"
                                                    onMouseEnter={() => isEditable && setHoveredCell({ 
                                                        workItemId: workItem.work_item_id, 
                                                        date: dateKey
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
                                                            date: dateKey,
                                                            entries: dayEntries,
                                                            defaultStartTime: startTime ? formatISO(startTime) : undefined,
                                                            defaultEndTime: endTime ? formatISO(endTime) : undefined
                                                        });
                                                    }}
                                                >
                                                    {dayEntries.length > 0 ? (
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
                                                                                        date: dateKey,
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
                                                                                    date: dateKey,
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
                    ))}
                </tbody>

                <tfoot>
                    <tr className="shadow-[0px_-4px_6px_rgba(var(--color-border-200),0.3)]">
                        <td className="px-6 py-4 text-sm font-medium text-gray-900 border-r z-10 w-1/5 min-w-[250px] shadow-[4px_0_6px_rgba(var(--color-border-200),0.3)] sticky left-0 bg-white">Total</td>
                        {dates.map((date): JSX.Element => {
                            const dateKey = formatISO(date, { representation: 'date' });
                            const entriesForDate = Object.values(groupedTimeEntries).flat()
                                .filter((entry) => {
                                    const entryWorkDate = entry.work_date?.slice(0, 10);
                                    if (entryWorkDate) return entryWorkDate === dateKey;
                                    return parseISO(entry.start_time).toDateString() === date.toDateString();
                                });
                            
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
                                <td key={dateKey} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border-r">
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
        </ReflectionContainer>
    );
}
