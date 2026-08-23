// TimePeriodForm.tsx
'use client';

import React, { useState, useEffect, useReducer } from 'react';
import Link from 'next/link';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { createTimePeriod, updateTimePeriod, deleteTimePeriod } from '@alga-psa/scheduling/actions/timePeriodsActions';
import { ITimePeriodSettings, ITimePeriodView } from '@alga-psa/types';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { toPlainDate } from '@alga-psa/core';
import { TimePeriodSuggester } from '../../../lib/timePeriodSuggester';
import { Temporal } from '@js-temporal/polyfill';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const isTimePeriodActionError = (
    value: unknown
): value is { readonly actionError: string } | { readonly permissionError: string } =>
    isActionMessageError(value) || isActionPermissionError(value);

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
    const { t } = useTranslation(['msp/settings', 'common']);
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
        // The "no settings yet" branch shows an extra link. Carried as a code because the
        // message it used to be compared against stops being that sentence once translated.
        errorCode: 'NO_SETTINGS' | null;
    }

    // Define the initial form state
    const initialFormState: FormState = {
        startDate: null,
        endDate: null,
        error: null,
        errorCode: null
    };

    // Define action types
    type FormAction =
        | { type: 'INITIALIZE_EDIT_MODE', payload: { selectedPeriod: ITimePeriodView } }
        | { type: 'INITIALIZE_CREATE_MODE', payload: { settings: ITimePeriodSettings[], existingTimePeriods: ITimePeriodView[] } }
        | { type: 'SET_ERROR', payload: { message: string | null; code?: 'NO_SETTINGS' } }
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
                    error: null,
                    errorCode: null
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
                        // The suggester is a pure library, so it names its failure with a key
                        // rather than trusting the sentence to survive translation.
                        error: suggestion.errorKey
                            ? t(suggestion.errorKey)
                            : suggestion.error || t('timeEntry.periods.errors.suggest'),
                        errorCode: suggestion.errorKey ? 'NO_SETTINGS' : null
                    };
                }

                const { start_date: suggestedStart, end_date: suggestedEnd } = suggestion.data;

                return {
                    startDate: toPlainDate(suggestedStart),
                    endDate: suggestedEnd ? toPlainDate(suggestedEnd) : null,
                    error: null,
                    errorCode: null
                };
            case 'SET_ERROR':
                return {
                    ...state,
                    error: action.payload.message,
                    errorCode: action.payload.code ?? null
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
    const { startDate, endDate, error, errorCode } = formState;

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
                payload: { message: t('timeEntry.periods.errors.noSettings'), code: 'NO_SETTINGS' }
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
                payload: { message: t('timeEntry.periods.errors.settingsRequired') }
            });
            return;
        }

        try {
            // Client-side validations
            if (!startDate) {
                dispatch({
                    type: 'SET_ERROR',
                    payload: { message: t('timeEntry.periods.errors.startDateRequired') }
                });
                return;
            }

            if (endDate && Temporal.PlainDate.compare(startDate, endDate) >= 0) {
                dispatch({
                    type: 'SET_ERROR',
                    payload: { message: t('timeEntry.periods.errors.startBeforeEnd') }
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
                    payload: { message: t('timeEntry.periods.errors.overlap') }
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
                if (isTimePeriodActionError(modelPeriod)) {
                    dispatch({
                        type: 'SET_ERROR',
                        payload: { message: getErrorMessage(modelPeriod) }
                    });
                    return;
                }
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
                if (isTimePeriodActionError(modelPeriod)) {
                    dispatch({
                        type: 'SET_ERROR',
                        payload: { message: getErrorMessage(modelPeriod) }
                    });
                    return;
                }
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
                        payload: { message: t('timeEntry.periods.errors.overlapRetry') }
                    });
                } else {
                    dispatch({
                        type: 'SET_ERROR',
                        payload: { message: err.message || t('timeEntry.periods.errors.create') }
                    });
                }
            } else {
                dispatch({
                    type: 'SET_ERROR',
                    payload: { message: t('timeEntry.periods.errors.unexpected') }
                });
            }
        }
    }

    const mainFooter = settings ? (
        <div className="flex justify-between w-full">
            {mode === 'edit' && selectedPeriod ? (
                <Button
                    id='delete-period-button'
                    variant="destructive"
                    onClick={() => setShowDeleteConfirm(true)}
                >
                    {t('timeEntry.periods.form.deletePeriod')}
                </Button>
            ) : <div />}
            <div className="flex ml-auto space-x-2">
                <Button id="close-button" variant="outline" onClick={onClose}>
                    {t('common:actions.cancel')}
                </Button>
                <Button id="submit-button" onClick={handleSubmit}>
                    {mode === 'create' ? t('common:actions.create') : t('common:actions.save')}
                </Button>
            </div>
        </div>
    ) : (
        <div className="flex justify-end">
            <Button id="settings-close-button" variant="outline" onClick={onClose}>
                {t('common:actions.close')}
            </Button>
        </div>
    );

    const deleteFooter = (
        <div className="flex justify-end space-x-2">
            <Button
                id="cancel-delete-button"
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
            >
                {t('common:actions.cancel')}
            </Button>
            <Button
                id="confirm-delete-button"
                variant="destructive"
                onClick={async () => {
                    try {
                        if (selectedPeriod?.period_id) {
                            const result = await deleteTimePeriod(selectedPeriod.period_id);
                            if (isTimePeriodActionError(result)) {
                                dispatch({
                                    type: 'SET_ERROR',
                                    payload: { message: getErrorMessage(result) }
                                });
                                setShowDeleteConfirm(false);
                                return;
                            }
                            setShowDeleteConfirm(false);
                            onTimePeriodDeleted?.();
                            onClose();
                        }
                    } catch (err) {
                        dispatch({
                            type: 'SET_ERROR',
                            payload: { message: err instanceof Error ? err.message : t('timeEntry.periods.errors.delete') }
                        });
                    }
                }}
            >
                {t('common:actions.delete')}
            </Button>
        </div>
    );

    return (
        <Dialog
            isOpen={isOpen}
            onClose={onClose}
            title={mode === 'create' ? t('timeEntry.periods.form.createTitle') : t('timeEntry.periods.form.editTitle')}
            footer={mainFooter}
        >
            <div className="p-4">
                {error && (
                    <div className="text-red-600 mb-2">
                        {error}
                        {errorCode === 'NO_SETTINGS' && (
                            <>
                                {' '}
                                <Link href="/msp/settings?tab=time-entry" className="underline text-blue-600 hover:text-blue-800">
                                    {t('timeEntry.periods.form.checkSettingsLink')}
                                </Link>
                            </>
                        )}
                    </div>
                )}
                {settings ? (
                    <>
                        {mode === 'create' && (
                            <div className="mb-4">
                                <p>{t('timeEntry.periods.form.suggestion')}</p>
                                {settings[0] && (
                                    <p>
                                        {t('timeEntry.periods.form.frequency', {
                                            value: settings[0].frequency,
                                            unit: t(`timeEntry.timePeriods.units.${settings[0].frequency_unit}`)
                                        })}
                                    </p>
                                )}
                            </div>
                        )}
                        <div className="mb-4">
                            <Checkbox
                                label={t('timeEntry.periods.form.overrideDates')}
                                checked={override}
                                onChange={(e) => setOverride(e.target.checked)}
                            />
                        </div>
                        <div className="mb-4">
                            <Label htmlFor="time-period-start-date-picker">{t('timeEntry.periods.form.startDate')}</Label>
                            <DatePicker
                                id="time-period-start-date-picker"
                                value={plainDateToDate(startDate)}
                                onChange={handleStartDateChange}
                                disabled={!override}
                                placeholder={t('timeEntry.periods.form.startDatePlaceholder')}
                            />
                        </div>
                        <div className="mb-4">
                            <div className="mb-2">
                                <Checkbox
                                    label={t('timeEntry.periods.form.noEndDate')}
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
                                    <Label htmlFor="time-period-end-date-picker">{t('timeEntry.periods.form.endDate')}</Label>
                                    <DatePicker
                                        id="time-period-end-date-picker"
                                        value={plainDateToDate(endDate)}
                                        onChange={handleEndDateChange}
                                        disabled={!override}
                                        placeholder={t('timeEntry.periods.form.endDatePlaceholder')}
                                    />
                                </>
                            )}
                        </div>

                        {/* Delete Confirmation Dialog */}
                        <Dialog
                            isOpen={showDeleteConfirm}
                            onClose={() => setShowDeleteConfirm(false)}
                            title={t('timeEntry.periods.form.confirmDeleteTitle')}
                            footer={deleteFooter}
                        >
                            <div className="p-4">
                                <p className="mb-4">{t('timeEntry.periods.form.confirmDeleteBody')}</p>
                            </div>
                        </Dialog>
                    </>
                ) : null}
            </div>
        </Dialog>
    );
};

export default TimePeriodForm;
