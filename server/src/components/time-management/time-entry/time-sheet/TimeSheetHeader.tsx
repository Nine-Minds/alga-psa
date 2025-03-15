'use client'

import React from 'react';
import { TimeSheetStatus } from 'server/src/interfaces/timeEntry.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import { Switch } from 'server/src/components/ui/Switch';
import { Label } from 'server/src/components/ui/Label';
import { Clock } from 'lucide-react';

interface TimeSheetHeaderProps {
    status: TimeSheetStatus;
    isEditable: boolean;
    onSubmit: () => Promise<void>;
    onBack: () => void;
    showIntervals?: boolean;
    onToggleIntervals?: () => void;
}

export function TimeSheetHeader({
    status,
    isEditable,
    onSubmit,
    onBack,
    showIntervals = false,
    onToggleIntervals
}: TimeSheetHeaderProps): JSX.Element {
    const getStatusDisplay = (status: TimeSheetStatus): { text: string; className: string } => {
        switch (status) {
            case 'DRAFT':
                return { text: 'In Progress', className: 'text-blue-600' };
            case 'SUBMITTED':
                return { text: 'Submitted for Approval', className: 'text-yellow-600' };
            case 'APPROVED':
                return { text: 'Approved', className: 'text-green-600' };
            case 'CHANGES_REQUESTED':
                return { text: 'Changes Requested', className: 'text-orange-600' };
            default:
                return { text: 'Unknown', className: 'text-gray-600' };
        }
    };

    const statusDisplay = getStatusDisplay(status);

    return (
        <>
            <div className="flex items-center mb-4">
                <Button
                    id="back-button"
                    onClick={onBack}
                    variant="soft"
                    className="mr-4"
                >
                    <ArrowLeftIcon className="mr-1" /> Back
                </Button>
                <h2 className="text-2xl font-bold">Time Sheet</h2>
            </div>
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center">
                    <span className="text-lg font-medium flex items-center mr-6">
                        Status:&nbsp; {'  '}
                        <span className={statusDisplay.className}> {statusDisplay.text}</span>
                    </span>
                    
                    {onToggleIntervals && (
                        <div className="flex items-center space-x-2">
                            <Switch
                                id="show-intervals-toggle"
                                checked={showIntervals}
                                onCheckedChange={onToggleIntervals}
                            />
                            <Label htmlFor="show-intervals-toggle" className="flex items-center">
                                <Clock className="h-4 w-4 mr-1" />
                                Show Ticket Intervals
                            </Label>
                        </div>
                    )}
                </div>
                
                {isEditable && (
                    <Button
                        id="submit-timesheet-button"
                        onClick={onSubmit}
                        variant="default"
                        className="bg-primary-500 hover:bg-primary-600 text-white"
                    >
                        Submit Time Sheet
                    </Button>
                )}
            </div>
        </>
    );
}
