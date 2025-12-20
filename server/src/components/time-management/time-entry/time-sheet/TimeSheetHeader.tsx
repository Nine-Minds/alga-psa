'use client'

import React from 'react';
import { TimeSheetStatus } from 'server/src/interfaces/timeEntry.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import { Switch } from 'server/src/components/ui/Switch';
import { Label } from 'server/src/components/ui/Label';
import { Calendar, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { TimeSheetDateNavigatorState } from './types';

interface TimeSheetHeaderProps {
    status: TimeSheetStatus;
    isEditable: boolean;
    onSubmit: () => Promise<void>;
    onBack: () => void;
    showIntervals?: boolean;
    onToggleIntervals?: () => void;
    dateNavigator?: TimeSheetDateNavigatorState | null;
}

export function TimeSheetHeader({
    status,
    isEditable,
    onSubmit,
    onBack,
    showIntervals = false,
    onToggleIntervals,
    dateNavigator
}: TimeSheetHeaderProps): React.JSX.Element {
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
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-6">
                <div className="flex items-center gap-4 min-w-0 shrink-0">
                    <Button
                        id="back-button"
                        onClick={onBack}
                        variant="soft"
                        className="shrink-0"
                    >
                        <ArrowLeftIcon className="mr-1" /> Back
                    </Button>
                    <h2 className="text-2xl font-bold truncate">Time Sheet</h2>
                </div>

                {dateNavigator?.dateRangeDisplay && (
                    <div className="flex items-center justify-center flex-1 min-w-[280px]">
                        <div className="flex items-center">
                            <div className="inline-flex items-center bg-white border border-gray-200 rounded-lg px-2 py-1.5 shadow-sm">
                                <button
                                    onClick={dateNavigator.goToPreviousPage}
                                    disabled={!dateNavigator.canGoBack || dateNavigator.isAnimating}
                                    className={`p-1.5 rounded-md transition-colors ${
                                        dateNavigator.canGoBack && !dateNavigator.isAnimating
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
                                        {dateNavigator.dateRangeDisplay}
                                    </span>
                                </div>

                                <button
                                    onClick={dateNavigator.goToNextPage}
                                    disabled={!dateNavigator.canGoForward || dateNavigator.isAnimating}
                                    className={`p-1.5 rounded-md transition-colors ${
                                        dateNavigator.canGoForward && !dateNavigator.isAnimating
                                            ? 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                            : 'text-gray-300 cursor-not-allowed'
                                    }`}
                                    aria-label="Next week"
                                >
                                    <ChevronRight className="w-5 h-5" />
                                </button>
                            </div>

                            {dateNavigator.hasMultiplePages && (
                                <div className="ml-3 text-xs text-gray-500 whitespace-nowrap">
                                    Page {dateNavigator.currentPage + 1} of {dateNavigator.totalPages}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 w-full lg:w-auto lg:ml-auto">
                    <span className="text-sm font-medium flex items-center whitespace-nowrap">
                        Status:&nbsp;
                        <span className={statusDisplay.className}>{statusDisplay.text}</span>
                    </span>

                    {onToggleIntervals && (
                        <div className="flex items-center gap-2 whitespace-nowrap">
                            <Switch
                                id="show-intervals-toggle"
                                checked={showIntervals}
                                onCheckedChange={onToggleIntervals}
                                data-automation-id="show-intervals-toggle"
                                data-automation-type="switch"
                            />
                            <Label htmlFor="show-intervals-toggle" className="flex items-center">
                                <Clock className="h-4 w-4 mr-1" />
                                Show intervals
                            </Label>
                        </div>
                    )}

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
            </div>
        </>
    );
}
