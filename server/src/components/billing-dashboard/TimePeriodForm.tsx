// TimePeriodForm.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { createTimePeriod, updateTimePeriod, deleteTimePeriod } from '@/lib/actions/timePeriodsActions';
import { ITimePeriodSettings, ITimePeriod } from '@/interfaces/timeEntry.interfaces';
import { Checkbox } from '@/components/ui/Checkbox';
import { ISO8601String } from '@/types/types.d';
import { parseISO, addDays, addWeeks, addMonths, addYears, isBefore, isAfter, isEqual, format, setDate, setMonth, endOfMonth } from 'date-fns';

interface TimePeriodFormProps {
    isOpen: boolean;
    onClose: () => void;
    onTimePeriodCreated: (newPeriod: ITimePeriod) => void;
    onTimePeriodDeleted?: () => void;
    settings: ITimePeriodSettings | null;
    existingTimePeriods: ITimePeriod[];
    selectedPeriod?: ITimePeriod | null;
    mode?: 'create' | 'edit';
}

const TimePeriodForm: React.FC<TimePeriodFormProps> = ({
    isOpen,
    onClose,
    onTimePeriodCreated,
    onTimePeriodDeleted,
    settings,
    existingTimePeriods,
    selectedPeriod,
    mode = 'create'
}) => {
    const [startDate, setStartDate] = useState<ISO8601String>('');
    const [endDate, setEndDate] = useState<ISO8601String>('');
    const [error, setError] = useState<string | null>(null);
    const [override, setOverride] = useState<boolean>(false);
    const [noEndDate, setNoEndDate] = useState<boolean>(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    useEffect(() => {
        if (mode === 'edit' && selectedPeriod) {
            setStartDate(selectedPeriod.start_date);
            setEndDate(selectedPeriod.end_date);
            setStartDateInput(formatDateForInput(selectedPeriod.start_date));
            setEndDateInput(formatDateForInput(selectedPeriod.end_date));
            setError(null);
        } else if (settings) {
            setStartDateInput('');
            setEndDateInput('');
            let newStartDate: Date;
            if (existingTimePeriods.length > 0) {
                // Calculate the next period based on settings and existing periods
                const lastPeriod = existingTimePeriods.sort((a, b) =>
                    parseISO(b.end_date).getTime() - parseISO(a.end_date).getTime()
                )[0];
                newStartDate = addDays(parseISO(lastPeriod.end_date), 1);
            } else {
                // If no existing periods, start from settings.effective_from or today's date
                const effectiveFromDate = parseISO(settings.effective_from);
                newStartDate = isAfter(effectiveFromDate, new Date()) ? effectiveFromDate : new Date();
            }

            // Adjust start date based on settings
            newStartDate = adjustStartDate(newStartDate, settings);

            const newEndDate = calculateEndDate(newStartDate, settings);

            // Format dates as ISO8601 strings
            const startISO = format(newStartDate, "yyyy-MM-dd'T'00:00:00.000'Z'");
            const endISO = format(newEndDate, "yyyy-MM-dd'T'00:00:00.000'Z'");

            setStartDate(startISO as ISO8601String);
            setEndDate(endISO as ISO8601String);
            setStartDateInput(format(newStartDate, 'yyyy-MM-dd'));
            setEndDateInput(format(newEndDate, 'yyyy-MM-dd'));
            setError(null);
        } else {
            setStartDate('');
            setEndDate('');
            setError('No time period settings available. Unable to create a new time period.');
        }
    }, [settings, existingTimePeriods]);

    // Helper function to adjust start date based on settings
    function adjustStartDate(date: Date, settings: ITimePeriodSettings): Date {
        switch (settings.frequency_unit) {
            case 'week':
                return setDate(date, settings.start_day || 1);
            case 'month':
                return setDate(date, settings.start_day || 1);
            case 'year':
                return setDate(setMonth(date, (settings.start_month || 1) - 1), settings.start_day_of_month || 1);
            default:
                return date;
        }
    }

    // Helper function to calculate end date
    function calculateEndDate(start: Date, settings: ITimePeriodSettings): Date {
        let end: Date;
        switch (settings.frequency_unit) {
            case 'day':
                end = addDays(start, settings.frequency - 1);
                break;
            case 'week':
                end = addWeeks(start, settings.frequency);
                end = setDate(end, settings.end_day || 7);
                break;
            case 'month':
                end = addMonths(start, settings.frequency);
                end = setDate(end, settings.end_day || 0);
                if (settings.end_day === 0 || (settings.end_day && settings.end_day > 28)) {
                    end = endOfMonth(end);
                }
                break;
            case 'year':
                end = addYears(start, settings.frequency);
                end = setMonth(end, (settings.end_month || 12) - 1);
                end = setDate(end, settings.end_day_of_month || 0);
                if (settings.end_day_of_month === 0 || (settings.end_day_of_month && settings.end_day_of_month > 28)) {
                    end = endOfMonth(end);
                }
                break;
            default:
                end = start;
        }
        return addDays(end, -1); // Adjust to make the end date inclusive
    }

    const formatDateForInput = (isoString: string) => {
        if (!isoString) return '';
        try {
            return format(parseISO(isoString), 'yyyy-MM-dd');
        } catch (err) {
            return '';
        }
    };

    const parseInputToISO = (inputValue: string): ISO8601String | '' => {
        if (!inputValue) return '';
        try {
            // First try parsing as is
            let date = parseISO(inputValue);
            if (isNaN(date.getTime())) {
                // If that fails, try adding time component
                date = parseISO(inputValue + 'T00:00:00.000Z');
            }
            if (isNaN(date.getTime())) {
                return '';
            }
            return format(date, "yyyy-MM-dd'T'00:00:00.000'Z'") as ISO8601String;
        } catch (err) {
            return '';
        }
    };

    const [startDateInput, setStartDateInput] = useState('');
    const [endDateInput, setEndDateInput] = useState('');

    const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setStartDateInput(e.target.value);
    };

    const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setEndDateInput(e.target.value);
    };

    const handleStartDateBlur = () => {
        const newStartDate = parseInputToISO(startDateInput);
        setStartDate(newStartDate);
        
        if (settings && !override && newStartDate) {
            try {
                const newEndDate = calculateEndDate(parseISO(newStartDate), settings);
                const endDateStr = format(newEndDate, "yyyy-MM-dd'T'00:00:00.000'Z'");
                setEndDate(endDateStr as ISO8601String);
                setEndDateInput(format(newEndDate, 'yyyy-MM-dd'));
            } catch (err) {
                setEndDate('');
                setEndDateInput('');
            }
        }
    };

    const handleEndDateBlur = () => {
        const newEndDate = parseInputToISO(endDateInput);
        setEndDate(newEndDate);
    };

    const handleSubmit = async () => {
        if (!settings) {
            setError('Cannot manage time period without settings.');
            return;
        }

        try {
            // Client-side validations
            if (!startDate) {
                setError('Start date must be provided.');
                return;
            }

            if (endDate && !isBefore(parseISO(startDate), parseISO(endDate))) {
                setError('Start date must be before end date.');
                return;
            }

            // Skip overlap check for the current period in edit mode
            const overlappingPeriod = existingTimePeriods.find((period) => {
                if (mode === 'edit' && selectedPeriod && period.period_id === selectedPeriod.period_id) {
                    return false;
                }
                const existingStart = parseISO(period.start_date);
                const existingEnd = parseISO(period.end_date);
                const newStart = parseISO(startDate);
                const newEnd = parseISO(endDate);
                return (
                    (isEqual(newStart, existingStart) || isAfter(newStart, existingStart)) && (isEqual(newStart, existingEnd) || isBefore(newStart, existingEnd)) ||
                    (isEqual(newEnd, existingStart) || isAfter(newEnd, existingStart)) && (isEqual(newEnd, existingEnd) || isBefore(newEnd, existingEnd)) ||
                    (isBefore(newStart, existingStart) && isAfter(newEnd, existingEnd))
                );
            });

            if (overlappingPeriod) {
                setError('The time period overlaps with an existing period.');
                return;
            }

            let updatedPeriod;
            if (mode === 'edit' && selectedPeriod?.period_id) {
                // Update existing period
                updatedPeriod = await updateTimePeriod(selectedPeriod.period_id, {
                    start_date: startDate,
                    end_date: endDate
                });
            } else {
                // Create new period
                updatedPeriod = await createTimePeriod({
                    start_date: startDate,
                    end_date: endDate
                });
            }

            onTimePeriodCreated(updatedPeriod);
            onClose();
        } catch (err: unknown) {
            if (err instanceof Error) {
                // Handle the specific overlap error
                if (err.message === 'The new time period overlaps with an existing period.') {
                    setError('This time period overlaps with an existing one. Please choose different dates.');
                } else {
                    setError(err.message || 'Failed to create time period.');
                }
            } else {
                // If it's not an Error object, we can't assume it has a 'message' property
                setError('An unexpected error occurred.');
            }
        }
    }

    return (
        <Dialog isOpen={isOpen} onClose={onClose} title={mode === 'create' ? "Create New Time Period" : "Edit Time Period"}>
            <div className="p-4">
                {error && <div className="text-red-600 mb-2">{error}</div>}
                {settings ? (
                    <>
                        <div className="mb-4">
                            <p>Based on your settings, the next time period is suggested.</p>
                            <p>
                                Frequency: {settings.frequency} {settings.frequency_unit}(s)
                            </p>
                        </div>
                        <div className="mb-4">
                            <Checkbox
                                label="Override suggested dates"
                                checked={override}
                                onChange={(e) => setOverride(e.target.checked)}
                            />
                        </div>
                        <div className="mb-4">
                            <Label htmlFor="startDate">Start Date</Label>
                            <Input
                                type="date"
                                id="startDate"
                                value={startDateInput}
                                onChange={handleStartDateChange}
                                onBlur={handleStartDateBlur}
                                readOnly={!override}
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
                                            setEndDate('');
                                        }
                                    }}
                                />
                            </div>
                            {!noEndDate && (
                                <>
                                    <Label htmlFor="endDate">End Date</Label>
                                    <Input
                                        type="date"
                                        id="endDate"
                                        value={endDateInput}
                                        onChange={handleEndDateChange}
                                        onBlur={handleEndDateBlur}
                                        readOnly={!override}
                                        placeholder=""
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
                                                setError(err instanceof Error ? err.message : 'Failed to delete time period');
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
