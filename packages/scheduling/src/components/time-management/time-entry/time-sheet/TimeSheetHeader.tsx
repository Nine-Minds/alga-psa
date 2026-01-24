'use client'

import React from 'react';
import { TimeSheetStatus } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import { ArrowLeft, Calendar, ChevronLeft, ChevronRight, Clock, LayoutGrid, List } from 'lucide-react';
import { TimeSheetDateNavigatorState } from './types';
import ViewSwitcher, { ViewSwitcherOption } from '@alga-psa/ui/components/ViewSwitcher';

export type TimeSheetViewMode = 'grid' | 'list';

interface TimeSheetHeaderProps {
    status: TimeSheetStatus;
    isEditable: boolean;
    onSubmit: () => Promise<void>;
    onBack: () => void;
    showIntervals?: boolean;
    onToggleIntervals?: () => void;
    dateNavigator?: TimeSheetDateNavigatorState | null;
    viewMode?: TimeSheetViewMode;
    onViewModeChange?: (mode: TimeSheetViewMode) => void;
}

const viewOptions: ViewSwitcherOption<TimeSheetViewMode>[] = [
    { value: 'grid', label: 'Grid', icon: LayoutGrid },
    { value: 'list', label: 'List', icon: List },
];

export function TimeSheetHeader({
    status,
    isEditable,
    onSubmit,
    onBack,
    showIntervals = false,
    onToggleIntervals,
    dateNavigator,
    viewMode = 'grid',
    onViewModeChange
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
                        <ArrowLeft className="h-4 w-4 mr-1" /> Back
                    </Button>
                    <h2 className="text-2xl font-bold truncate">Time Sheet</h2>
                </div>

                {dateNavigator?.dateRangeDisplay && (
                    <div className="flex items-center justify-center flex-1 min-w-[280px]">
                        <div className="flex items-center">
                            <div className="inline-flex items-center bg-white border border-gray-200 rounded-lg px-2 py-1.5 shadow-sm">
                                {/* Only show pagination controls in grid view */}
                                {viewMode === 'grid' && (
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
                                )}

                                <div className="flex items-center px-3 min-w-[200px] justify-center">
                                    <Calendar className="w-4 h-4 text-gray-400 mr-2" />
                                    <span className="text-sm font-medium text-gray-900">
                                        {dateNavigator.dateRangeDisplay}
                                    </span>
                                </div>

                                {/* Only show pagination controls in grid view */}
                                {viewMode === 'grid' && (
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
                                )}
                            </div>

                            {/* Only show page indicator in grid view */}
                            {viewMode === 'grid' && dateNavigator.hasMultiplePages && (
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

                    {onViewModeChange && (
                        <ViewSwitcher
                            currentView={viewMode}
                            onChange={onViewModeChange}
                            options={viewOptions}
                        />
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
