// TimePeriodForm.tsx
'use client';

import React, { useState, useEffect, useReducer } from 'react';
import Link from 'next/link';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { createTimePeriod, updateTimePeriod, deleteTimePeriod } from '@alga-psa/scheduling/actions/timePeriodsActions';
import { ITimePeriodSettings, ITimePeriodView } from 'server/src/interfaces/timeEntry.interfaces';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { TimePeriodSuggester } from 'server/src/lib/timePeriodSuggester';
import { Temporal } from '@js-temporal/polyfill';

// Helper to convert Temporal.PlainDate to Date (for DatePicker)
function plainDateToDate(plainDate: Temporal.PlainDate | null): Date | undefined {
    if (!plainDate) return undefined;
    return new Date(plainDate.year, plainDate.month - 1, plainDate.day);
}

// Helper to convert Date to Temporal.PlainDate
function dateToPlainDate(date: Date | undefined): Temporal.PlainDate | null {
    if (!date) return null;
    return Temporal.PlainDate.from({
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate()
    });
}

interface TimePeriodFormProps {
    isOpen: boolean;
    onClose: () => void;
    onTimePeriodCreated: (newPeriod: ITimePeriodView) => void;
    onTimePeriodDeleted?: () => void;
    settings: ITimePeriodSettings[] | null;
    existingTimePeriods: ITimePeriodView[];
    selectedPeriod?: ITimePeriodView | null;
    mode?: 'create' | 'edit';
}

const TimePeriodForm: React.FC<TimePeriodFormProps> = (props) => {
    const {
        isOpen,
        onClose,
        onTimePeriodCreated,
        onTimePeriodDeleted,
        settings,
        existingTimePeriods,
        selectedPeriod,
        mode = 'create'
    } = props;
    // Define the form state interface
    interface FormState {
        startDate: Temporal.PlainDate | null;
        endDate: Temporal.PlainDate | null;
        error: string | null;
    }

    // Define the initial form state
    const initialFormState: FormState = {
        startDate: null,
        endDate: null,
        error: null
    };

    // Define action types
    type FormAction =
        | { type: 'INITIALIZE_EDIT_MODE', payload: { selectedPeriod: ITimePeriodView } }
        | { type: 'INITIALIZE_CREATE_MODE', payload: { settings: ITimePeriodSettings[], existingTimePeriods: ITimePeriodView[] } }
        | { type: 'SET_ERROR', payload: string | null }
        | { type: 'SET_START_DATE', payload: Temporal.PlainDate | null }
        | { type: 'SET_END_DATE', payload: Temporal.PlainDate | null }
        | { type: 'RESET' };

    // Define the reducer function
    const formReducer = (state: FormState, action: FormAction): FormState => {
        switch (action.type) {
            case 'INITIALIZE_EDIT_MODE':
                const period = action.payload.selectedPeriod;
                return {
                    startDate: toPlainDate(period.start_date),
                    endDate: period.end_date ? toPlainDate(period.end_date) : null,
                    error: null
                };
            case 'INITIALIZE_CREATE_MODE':
                const { settings, existingTimePeriods } = action.payload;
                // Convert view types to model types for the suggester
                // If end_date is null/undefined, use start_date as fallback to satisfy ITimePeriod interface
                const modelPeriods = existingTimePeriods.map(period => {
                    const startDate = toPlainDate(period.start_date);
                    return {
                        ...period,
                        start_date: startDate,
                        end_date: period.end_date ? toPlainDate(period.end_date) : startDate
                    };
                });
                // Get suggestion for new time period
                const suggestion = TimePeriodSuggester.suggestNewTimePeriod(settings, modelPeriods);

                if (!suggestion.success || !suggestion.data) {
                    return {
                        ...initialFormState,
                        error: suggestion.error || 'Failed to suggest a new time period'
                    };
                }

                const { start_date: suggestedStart, end_date: suggestedEnd } = suggestion.data;

                return {
                    startDate: toPlainDate(suggestedStart),
                    endDate: suggestedEnd ? toPlainDate(suggestedEnd) : null,
                    error: null
                };
            case 'SET_ERROR':
                return {
                    ...state,
                    error: action.payload
                };
            case 'SET_START_DATE':
                return {
                    ...state,
                    startDate: action.payload
                };
            case 'SET_END_DATE':
                return {
                    ...state,
                    endDate: action.payload
                };
            case 'RESET':
                return initialFormState;
            default:
                return state;
        }
    };

    // Use the reducer
    const [formState, dispatch] = useReducer(formReducer, initialFormState);
    const { startDate, endDate, error } = formState;

    // Additional state that doesn't need to be part of the reducer
    const [override, setOverride] = useState<boolean>(false);
    const [noEndDate, setNoEndDate] = useState<boolean>(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // Use useEffect to initialize the form state based on props
    useEffect(() => {
        if (mode === 'edit' && selectedPeriod) {
            dispatch({
                type: 'INITIALIZE_EDIT_MODE',
                payload: { selectedPeriod }
            });
        } else if (settings) {
            dispatch({
                type: 'INITIALIZE_CREATE_MODE',
                payload: { settings, existingTimePeriods }
            });
        } else {
            dispatch({ type: 'RESET' });
            dispatch({
                type: 'SET_ERROR',
                payload: 'No time period settings available. Unable to create a new time period.'
            });
        }
    }, [mode, selectedPeriod, settings, existingTimePeriods]);

    // Handle start date change from DatePicker
    const handleStartDateChange = (date: Date | undefined) => {
        const newStartDate = dateToPlainDate(date);
        dispatch({ type: 'SET_START_DATE', payload: newStartDate });

        // Auto-calculate end date if not in override mode
        if (settings && !override && newStartDate) {
            try {
                const newEndDate = TimePeriodSuggester.calculateEndDate(newStartDate, settings[0]);
                dispatch({ type: 'SET_END_DATE', payload: newEndDate });
            } catch {
                dispatch({ type: 'SET_END_DATE', payload: null });
            }
        }
    };

    // Handle end date change from DatePicker
    const handleEndDateChange = (date: Date | undefined) => {
        dispatch({ type: 'SET_END_DATE', payload: dateToPlainDate(date) });
    };

    const handleSubmit = async () => {
        if (!settings) {
            dispatch({
                type: 'SET_ERROR',
                payload: 'Cannot manage time period without settings.'
            });
            return;
        }

        try {
            // Client-side validations
            if (!startDate) {
                dispatch({
                    type: 'SET_ERROR',
                    payload: 'Start date must be provided.'
                });
                return;
            }

            if (endDate && Temporal.PlainDate.compare(startDate, endDate) >= 0) {
                dispatch({
                    type: 'SET_ERROR',
                    payload: 'Start date must be before end date.'
                });
                return;
            }

            // Skip overlap check for the current period in edit mode
            const overlappingPeriod = existingTimePeriods.find((period) => {
                if (mode === 'edit' && selectedPeriod && period.period_id === selectedPeriod.period_id) {
                    return false;
                }
                // Safely convert dates to PlainDate objects
                try {
                    const existingStart = toPlainDate(period.start_date);
                    const existingEnd = period.end_date ? toPlainDate(period.end_date) : existingStart;
                const newStart = startDate;
                const newEnd = endDate || newStart;

                    // Overlap occurs if existing.start_date < newEnd AND existing.end_date > newStart
                    // This allows periods to touch at boundaries (e.g., newStart == existingEnd)
                    return (
                        Temporal.PlainDate.compare(existingStart, newEnd) < 0 &&
                        Temporal.PlainDate.compare(existingEnd, newStart) > 0
                    );
                } catch (error) {
                    console.error('Error comparing dates:', error);
                    return false; // Skip this period if there's an error
                }
            });

            if (overlappingPeriod) {
                dispatch({
                    type: 'SET_ERROR',
                    payload: 'The time period overlaps with an existing period.'
                });
                return;
            }

            let updatedPeriod;
            if (mode === 'edit' && selectedPeriod?.period_id) {
                // Update existing period - pass string dates (server converts to Temporal)
                const modelPeriod = await updateTimePeriod(selectedPeriod.period_id, {
                    start_date: startDate.toString(),
                    end_date: endDate!.toString()
                });
                // Convert model type to view type
                updatedPeriod = {
                    ...modelPeriod,
                    start_date: modelPeriod.start_date.toString(),
                    end_date: modelPeriod.end_date.toString()
                };
            } else {
                // Create new period - pass string dates (server converts to Temporal)
                const modelPeriod = await createTimePeriod({
                    start_date: startDate.toString(),
                    end_date: endDate!.toString()
                });
                // Convert model type to view type
                updatedPeriod = {
                    ...modelPeriod,
                    start_date: modelPeriod.start_date.toString(),
                    end_date: modelPeriod.end_date.toString()
                };
            }

            onTimePeriodCreated(updatedPeriod);
            onClose();
        } catch (err) {
            if (err instanceof Error) {
                if (err.message === 'The new time period overlaps with an existing period.') {
                    dispatch({
                        type: 'SET_ERROR',
                        payload: 'This time period overlaps with an existing one. Please choose different dates.'
                    });
                } else {
                    dispatch({
                        type: 'SET_ERROR',
                        payload: err.message || 'Failed to create time period.'
                    });
                }
            } else {
                dispatch({
                    type: 'SET_ERROR',
                    payload: 'An unexpected error occurred.'
                });
            }
        }
    }

    return (
        <Dialog isOpen={isOpen} onClose={onClose} title={mode === 'create' ? "Create New Time Period" : "Edit Time Period"}>
            <div className="p-4">
                {error && (
                    <div className="text-red-600 mb-2">
                        {error}
                        {error === 'No time period settings available. Unable to create a new time period.' && (
                            <>
                                {' '} Please{' '}
                                <Link href="/msp/settings?tab=time-entry" className="underline text-blue-600 hover:text-blue-800">
                                    check your time period settings
                                </Link>
                                .
                            </>
                        )}
                    </div>
                )}
                {settings ? (
                    <>
                        {mode === 'create' && (
                            <div className="mb-4">
                                <p>Based on your settings, the next time period is suggested.</p>
                                {settings[0] && (
                                    <p>
                                        Frequency: {settings[0].frequency} {settings[0].frequency_unit}(s)
                                    </p>
                                )}
                            </div>
                        )}
                        <div className="mb-4">
                            <Checkbox
                                label="Override suggested dates"
                                checked={override}
                                onChange={(e) => setOverride(e.target.checked)}
                            />
                        </div>
                        <div className="mb-4">
                            <Label htmlFor="time-period-start-date-picker">Start Date</Label>
                            <DatePicker
                                id="time-period-start-date-picker"
                                value={plainDateToDate(startDate)}
                                onChange={handleStartDateChange}
                                disabled={!override}
                                placeholder="Select start date"
                            />
                        </div>
                        <div className="mb-4">
                            <div className="mb-2">
                                <Checkbox
                                    label="No End Date"
                                    checked={noEndDate}
                                    onChange={(e) => {
                                        setNoEndDate(e.target.checked);
                                        if (e.target.checked) {
                                            dispatch({ type: 'SET_END_DATE', payload: null });
                                        }
                                    }}
                                />
                            </div>
                            {!noEndDate && (
                                <>
                                    <Label htmlFor="time-period-end-date-picker">End Date</Label>
                                    <DatePicker
                                        id="time-period-end-date-picker"
                                        value={plainDateToDate(endDate)}
                                        onChange={handleEndDateChange}
                                        disabled={!override}
                                        placeholder="Select end date"
                                    />
                                </>
                            )}
                        </div>
                        <div className="flex justify-between">
                            {mode === 'edit' && selectedPeriod && (
                                <Button
                                    id='delete-period-button'
                                    variant="destructive"
                                    onClick={() => setShowDeleteConfirm(true)}
                                >
                                    Delete Period
                                </Button>
                            )}
                            <div className="flex ml-auto">
                                <Button id="close-button" variant="outline" onClick={onClose} className="mr-2">
                                    Cancel
                                </Button>
                                <Button id="submit-button" onClick={handleSubmit}>
                                    {mode === 'create' ? 'Create' : 'Save'}
                                </Button>
                            </div>
                        </div>

                        {/* Delete Confirmation Dialog */}
                        <Dialog
                            isOpen={showDeleteConfirm}
                            onClose={() => setShowDeleteConfirm(false)}
                            title="Confirm Delete"
                        >
                            <div className="p-4">
                                <p className="mb-4">Are you sure you want to delete this time period? This action cannot be undone.</p>
                                <div className="flex justify-end">
                                    <Button
                                        id="cancel-delete-button"
                                        variant="outline"
                                        onClick={() => setShowDeleteConfirm(false)}
                                        className="mr-2"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        id="confirm-delete-button"
                                        variant="destructive"
                                        onClick={async () => {
                                            try {
                                                if (selectedPeriod?.period_id) {
                                                    await deleteTimePeriod(selectedPeriod.period_id);
                                                    setShowDeleteConfirm(false);
                                                    onTimePeriodDeleted?.();
                                                    onClose();
                                                }
                                            } catch (err) {
                                                dispatch({
                                                    type: 'SET_ERROR',
                                                    payload: err instanceof Error ? err.message : 'Failed to delete time period'
                                                });
                                            }
                                        }}
                                    >
                                        Delete
                                    </Button>
                                </div>
                            </div>
                        </Dialog>
                    </>
                ) : (
                    <div className="text-center">
                        <Button id="settings-close-button" variant="outline" onClick={onClose} className="mt-4">
                            Close
                        </Button>
                    </div>
                )}
            </div>
        </Dialog>
    );
};

export default TimePeriodForm;
