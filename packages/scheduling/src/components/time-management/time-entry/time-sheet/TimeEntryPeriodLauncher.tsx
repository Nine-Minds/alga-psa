'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Label } from '@alga-psa/ui/components/Label';
import type {
  IExtendedWorkItem,
  ITimeEntry,
  ITimePeriodView,
  ITimePeriodWithStatusView,
  TimeEntryWorkItemContext,
  TimeSheetStatus,
} from '@alga-psa/types';
import { fetchOrCreateTimeSheet, saveTimeEntry } from '../../../../actions/timeEntryActions';
import {
  dateOnlyToLocalDate,
  isEditableSheetStatus,
  periodLastInclusiveDay,
  resolveEntryDefaults,
} from '../../../../lib/timeEntryPeriodSelection';
import TimeEntryDialog from './TimeEntryDialog';

interface TimeEntryPeriodLauncherProps {
  closeDrawer: () => void;
  onComplete?: () => void;
  workItem: Omit<IExtendedWorkItem, 'tenant'>;
  context: TimeEntryWorkItemContext;
  userId: string;
  userTimeZone: string;
  periods: ITimePeriodWithStatusView[];
  currentPeriodId: string | null;
}

interface ResolvedSheet {
  sheetId: string;
  timePeriod: ITimePeriodView;
  status: TimeSheetStatus;
}

const STATUS_FALLBACKS: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes Requested',
};

/**
 * Period-selection stage for a new time entry: pick a period, resolve exactly
 * one sheet on Continue, then mount the existing entry dialog against that
 * sheet. Selection lives here, outside the entry provider, so choosing a
 * period can never discard typed entry state or attach an old sheet id to a
 * new period.
 */
export default function TimeEntryPeriodLauncher({
  closeDrawer,
  onComplete,
  workItem,
  context,
  userId,
  userTimeZone,
  periods,
  currentPeriodId,
}: TimeEntryPeriodLauncherProps): React.JSX.Element {
  const { t } = useTranslation('msp/time-entry');
  const { formatDate } = useFormatters();

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(currentPeriodId);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, TimeSheetStatus>>({});
  const [resolvedSheet, setResolvedSheet] = useState<ResolvedSheet | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusLabel = useCallback(
    (status: string | null | undefined): string => {
      const key = status ?? 'UNKNOWN';
      return t(`periodPicker.status.${key}`, {
        defaultValue: STATUS_FALLBACKS[key] ?? t('periodPicker.status.UNKNOWN', { defaultValue: 'Unknown' }),
      });
    },
    [t],
  );

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.period_id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  );

  const selectedStatus: TimeSheetStatus | null = selectedPeriod
    ? statusOverrides[selectedPeriod.period_id] ?? selectedPeriod.timeSheetStatus
    : null;
  const selectedIsEditable = isEditableSheetStatus(selectedStatus);

  const options = useMemo(
    () =>
      periods.map((period) => {
        const lastDay = periodLastInclusiveDay(period.end_date);
        const range = `${formatDate(dateOnlyToLocalDate(period.start_date), { dateStyle: 'medium' })} – ${formatDate(
          dateOnlyToLocalDate(lastDay),
          { dateStyle: 'medium' },
        )}`;
        const status = statusOverrides[period.period_id] ?? period.timeSheetStatus;
        const parts = [range, statusLabel(status)];
        if (period.period_id === currentPeriodId) {
          parts.push(t('periodPicker.current', { defaultValue: 'Current' }));
        }
        const label = parts.join(' · ');
        return { value: period.period_id, label, textValue: label };
      }),
    [periods, statusOverrides, currentPeriodId, formatDate, statusLabel, t],
  );

  const selectedDefaults = useMemo(
    () =>
      selectedPeriod
        ? resolveEntryDefaults({ context, period: selectedPeriod, timeZone: userTimeZone })
        : null,
    [selectedPeriod, context, userTimeZone],
  );

  const handleContinue = useCallback(async () => {
    if (!selectedPeriodId || !selectedIsEditable || isResolving) {
      return;
    }

    setIsResolving(true);
    setError(null);

    try {
      const result = await fetchOrCreateTimeSheet(userId, selectedPeriodId);
      if (!mountedRef.current) {
        return;
      }

      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }

      // Re-inspect the resolved status: it may have been submitted between
      // selecting and continuing. Stay on the picker with the fresh status.
      if (!isEditableSheetStatus(result.approval_status)) {
        setStatusOverrides((prev) => ({ ...prev, [selectedPeriodId]: result.approval_status }));
        setError(
          t('periodPicker.statusChanged', {
            status: statusLabel(result.approval_status),
            defaultValue: 'This time sheet is now {{status}}. Choose a draft sheet or a sheet with changes requested.',
          }),
        );
        return;
      }

      const timePeriod = result.time_period ?? (selectedPeriod as ITimePeriodWithStatusView);
      setResolvedSheet({
        sheetId: result.id,
        timePeriod: {
          period_id: timePeriod.period_id,
          start_date: timePeriod.start_date,
          end_date: timePeriod.end_date,
          tenant: result.tenant,
        },
        status: result.approval_status,
      });
    } catch (resolveError) {
      if (mountedRef.current) {
        setError(getErrorMessage(resolveError));
      }
    } finally {
      if (mountedRef.current) {
        setIsResolving(false);
      }
    }
  }, [
    isResolving,
    selectedIsEditable,
    selectedPeriod,
    selectedPeriodId,
    statusLabel,
    t,
    userId,
  ]);

  const handleSave = useCallback(
    async (timeEntry: Omit<ITimeEntry, 'tenant'>) => {
      const savedEntry = await saveTimeEntry(timeEntry);
      if (isActionMessageError(savedEntry) || isActionPermissionError(savedEntry)) {
        // Reject so TimeEntryDialog keeps the form and entered values instead
        // of dismissing with a false success toast.
        throw new Error(getErrorMessage(savedEntry));
      }
      if (onComplete) {
        onComplete();
      }
    },
    [onComplete],
  );

  if (resolvedSheet) {
    const defaults = resolveEntryDefaults({
      context,
      period: resolvedSheet.timePeriod,
      timeZone: userTimeZone,
    });
    const startDate = dateOnlyToLocalDate(resolvedSheet.timePeriod.start_date);
    const lastDay = periodLastInclusiveDay(resolvedSheet.timePeriod.end_date);
    const periodContextLabel = `${formatDate(startDate, { dateStyle: 'medium' })} – ${formatDate(
      dateOnlyToLocalDate(lastDay),
      { dateStyle: 'medium' },
    )}`;

    return (
      <TimeEntryDialog
        isOpen={true}
        onClose={closeDrawer}
        onSave={handleSave}
        workItem={workItem}
        date={defaults.date}
        timePeriod={resolvedSheet.timePeriod}
        isEditable={true}
        defaultStartTime={defaults.defaultStartTime}
        defaultEndTime={defaults.defaultEndTime}
        timeSheetId={resolvedSheet.sheetId}
        inDrawer={true}
        periodContextLabel={periodContextLabel}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[35rem]">
      <h2 className="mb-4 text-lg font-semibold">
        {t('periodPicker.title', { defaultValue: 'Add New Time Entry for {{name}}', name: workItem.name })}
      </h2>

      <div className="space-y-3">
        <div>
          <Label htmlFor="time-entry-period-select">
            {t('periodPicker.label', { defaultValue: 'Time period' })}
          </Label>
          <CustomSelect
            id="time-entry-period-select"
            className="mt-1"
            options={options}
            value={selectedPeriodId}
            onValueChange={(value) => {
              setSelectedPeriodId(value);
              setError(null);
            }}
            placeholder={t('periodPicker.placeholder', { defaultValue: 'Choose a time period' })}
          />
        </div>

        {selectedPeriod && !selectedIsEditable && (
          <Alert id="time-entry-period-locked" variant="warning">
            <AlertDescription>
              {t('periodPicker.locked', {
                status: statusLabel(selectedStatus),
                defaultValue:
                  'This time sheet is {{status}}. Choose a draft sheet or a sheet with changes requested.',
              })}
            </AlertDescription>
          </Alert>
        )}

        {selectedDefaults?.adjusted && (
          <Alert id="time-entry-period-outside-warning" variant="warning">
            <AlertDescription>
              {t('periodPicker.outsidePeriod', {
                date: formatDate(selectedDefaults.defaultStartTime, { dateStyle: 'medium' }),
                defaultValue:
                  'The supplied start and end times are outside this period, so the entry starts on {{date}} at 08:00.',
              })}
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert id="time-entry-period-error" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      <div className="mt-6 flex justify-end space-x-2">
        <Button
          id="time-entry-period-cancel"
          type="button"
          variant="outline"
          onClick={closeDrawer}
        >
          {t('periodPicker.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button
          id="time-entry-period-continue"
          type="button"
          variant="default"
          onClick={handleContinue}
          disabled={!selectedPeriodId || !selectedIsEditable || isResolving}
        >
          {isResolving
            ? t('periodPicker.continueLoading', { defaultValue: 'Loading…' })
            : t('periodPicker.continue', { defaultValue: 'Continue' })}
        </Button>
      </div>
    </div>
  );
}
