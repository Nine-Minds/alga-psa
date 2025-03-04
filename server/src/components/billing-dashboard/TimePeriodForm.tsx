// TimePeriodForm.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Dialog } from 'server/src/components/ui/Dialog';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { createTimePeriod, updateTimePeriod, deleteTimePeriod } from 'server/src/lib/actions/timePeriodsActions';
import { ITimePeriodSettings, ITimePeriodView } from 'server/src/interfaces/timeEntry.interfaces';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { TimePeriodSuggester } from 'server/src/lib/timePeriodSuggester';
import { Temporal } from '@js-temporal/polyfill';

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
    const [startDate, setStartDate] = useState<Temporal.PlainDate | null>(null);
    const [endDate, setEndDate] = useState<Temporal.PlainDate | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [override, setOverride] = useState<boolean>(false);
    const [noEndDate, setNoEndDate] = useState<boolean>(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    useEffect(() => {
        if (mode === 'edit' && selectedPeriod) {
            setStartDate(toPlainDate(selectedPeriod.start_date));
            setEndDate(selectedPeriod.end_date ? toPlainDate(selectedPeriod.end_date) : null);
            setStartDateInput(formatDateForInput(toPlainDate(selectedPeriod.start_date)));
            setEndDateInput(formatDateForInput(selectedPeriod.end_date ? toPlainDate(selectedPeriod.end_date) : null));
            setError(null);
        } else if (settings) {
            setStartDateInput('');
            setEndDateInput('');
            // Convert view types to model types for the suggester
            const modelPeriods = existingTimePeriods.map(period => ({
                ...period,
                start_date: toPlainDate(period.start_date),
                end_date: toPlainDate(period.end_date)
            }));
            const { start_date: suggestedStart, end_date: suggestedEnd } =
                TimePeriodSuggester.suggestNewTimePeriod(settings, modelPeriods);
            setStartDate(toPlainDate(suggestedStart));
            setEndDate(toPlainDate(suggestedEnd));
            setStartDateInput(formatDateForInput(toPlainDate(suggestedStart)));
            setEndDateInput(formatDateForInput(toPlainDate(suggestedEnd)));
            setError(null);
        } else {
            setStartDate(null);
            setEndDate(null);
            setError('No time period settings available. Unable to create a new time period.');
        }
    }, [settings, existingTimePeriods]);

    const formatDateForInput = (date: Temporal.PlainDate | null): string => {
        if (!date) return '';
        return date.toString().split('T')[0];
    };

    const parseInputToDate = (inputValue: string): Temporal.PlainDate | null => {
        if (!inputValue) return null;
        try {
            return toPlainDate(inputValue);
        } catch {
            return null;
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
        const newStartDate = parseInputToDate(startDateInput);
        setStartDate(newStartDate);

        if (settings && !override && newStartDate) {
            try {
                const newEndDate = TimePeriodSuggester.calculateEndDate(newStartDate,settings[0]);
                setEndDate(newEndDate);
                setEndDateInput(formatDateForInput(newEndDate));
            } catch {
                setEndDate(null);
                setEndDateInput('');
            }
        }
    };

    const handleEndDateBlur = () => {
        const newEndDate = parseInputToDate(endDateInput);
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

            if (endDate && Temporal.PlainDate.compare(startDate, endDate) >= 0) {
                setError('Start date must be before end date.');
                return;
            }

            // Skip overlap check for the current period in edit mode
            const overlappingPeriod = existingTimePeriods.find((period) => {
                if (mode === 'edit' && selectedPeriod && period.period_id === selectedPeriod.period_id) {
                    return false;
                }
                const existingStart = toPlainDate(period.start_date);
                const existingEnd = period.end_date ? toPlainDate(period.end_date) : existingStart;
                const newStart = startDate;
                const newEnd = endDate || newStart;

                return (
                    (Temporal.PlainDate.compare(newStart, existingStart) >= 0 && Temporal.PlainDate.compare(newStart, existingEnd) <= 0) ||
                    (Temporal.PlainDate.compare(newEnd, existingStart) >= 0 && Temporal.PlainDate.compare(newEnd, existingEnd) <= 0) ||
                    (Temporal.PlainDate.compare(newStart, existingStart) <= 0 && Temporal.PlainDate.compare(newEnd, existingEnd) >= 0)
                );
            });

            if (overlappingPeriod) {
                setError('The time period overlaps with an existing period.');
                return;
            }

            let updatedPeriod;
            if (mode === 'edit' && selectedPeriod?.period_id) {
                // Update existing period
                const modelPeriod = await updateTimePeriod(selectedPeriod.period_id, {
                    start_date: startDate,
                    end_date: endDate!
                });
                // Convert model type to view type
                updatedPeriod = {
                    ...modelPeriod,
                    start_date: modelPeriod.start_date.toString(),
                    end_date: modelPeriod.end_date.toString()
                };
            } else {
                // Create new period
                const modelPeriod = await createTimePeriod({
                    start_date: startDate,
                    end_date: endDate!
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
                    setError('This time period overlaps with an existing one. Please choose different dates.');
                } else {
                    setError(err.message || 'Failed to create time period.');
                }
            } else {
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
                                Frequency: {settings[0].frequency} {settings[0].frequency_unit}(s)
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
                                            setEndDate(null);
                                            setEndDateInput('');
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
