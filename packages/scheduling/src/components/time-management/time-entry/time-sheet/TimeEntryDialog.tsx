'use client';

import { useState, useRef, useCallback, memo, useEffect, useMemo } from 'react';
import { formatISO } from 'date-fns';
import { toast } from 'react-hot-toast';
import {
  getErrorMessage,
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatStopwatchDuration } from '@alga-psa/ui/context';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { DrawerFooter } from '@alga-psa/ui/components/Drawer';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { deleteTimeEntry, fetchTimeEntriesForTimeSheet, isServiceOptionalForWorkItem } from '../../../../actions/timeEntryActions';
import { Button } from '@alga-psa/ui/components/Button';
import { 
  ITimeEntry, 
  ITimeEntryWithWorkItem,
  ITimePeriodView,
  TimeSheetStatus, 
  ITimeEntryWithWorkItemString 
} from '@alga-psa/types';
import { IExtendedWorkItem } from '@alga-psa/types';
import { TimeEntryProvider, useTimeEntry } from './TimeEntryProvider';
import TimeEntrySkeletons from './TimeEntrySkeletons';
import SingleTimeEntryForm from './SingleTimeEntryForm';
import { contractLineFieldsForWrite, getTimeEntryValidationErrors, type TimeEntryValidationErrors } from './utils';
import { useTimeEntryMode } from '../../../../context/TimeEntryModeContext';
import { useSchedulingCrossFeatureOptional } from '../../../../context/SchedulingCrossFeatureContext';
import { TimeEntrySaveRejectedError } from '../../../../lib/timeEntrySaveAdapter';
import {
  dateOnlyToLocalDate,
  isEditableSheetStatus,
  periodForWorkDate,
  workDateInTimeZone,
  type CatalogPeriod,
} from '../../../../lib/timeEntryPeriodSelection';
import { sheetStatusLabel } from '../../../../lib/timeEntrySaveAdapter';

type EntryFieldErrors = TimeEntryValidationErrors & { date?: string; service?: string };

function isReturnedActionError(value: unknown): value is { actionError: string } | { permissionError: string } {
  return isActionMessageError(value) || isActionPermissionError(value);
}

interface TimeEntryDialogProps {
  id?: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (timeEntry: Omit<ITimeEntry, 'tenant'>) => Promise<void>;
  /**
   * Saves every entry of a multi-day stopwatch plan in one atomic call. Required whenever
   * `defaultEntries` holds more than one item.
   */
  onSaveAll?: (timeEntries: Array<Omit<ITimeEntry, 'tenant'>>) => Promise<void>;
  workItem: Omit<IExtendedWorkItem, 'tenant'>;
  date: Date;
  existingEntries?: ITimeEntryWithWorkItem[];
  /** The one period the entry is bounded to (existing entries, time sheet page). */
  timePeriod?: ITimePeriodView;
  /**
   * Every period the subject user could file against, with sheet statuses. When
   * given instead of `timePeriod`, the date field spans the editable periods and
   * shows which sheet the chosen day lands on; the caller's `onSave` resolves the
   * sheet from the date.
   */
  periodCatalog?: readonly CatalogPeriod[];
  isEditable: boolean;
  defaultStartTime?: Date;
  defaultEndTime?: Date;
  /**
   * A stopwatch session split into one new entry per work day. One item behaves like
   * defaultStartTime/defaultEndTime; several render one dated form per day with one atomic Save.
   */
  defaultEntries?: Array<{ start: Date; end: Date }>;
  defaultTaxRegion?: string;
  timeSheetId?: string;
  onTimeEntriesUpdate?: (entries: ITimeEntryWithWorkItemString[]) => void;
  inDrawer?: boolean;
  /** Optional selected-period context shown under the drawer title. */
  periodContextLabel?: string;
  /** Optional explanation shown above the form, e.g. why the default date moved. */
  notice?: string;
  /** IANA timezone the entry's work_date is derived in (the subject user's). */
  workTimeZone?: string;
}

function splitPaymentWarning(message: string): [string, string] {
  const match = message.match(/^(.+?[.!?])(?:\s+|$)(.*)$/s);
  return match ? [match[1], match[2]] : [message, ''];
}

// Main dialog content component
const TimeEntryDialogContent = memo(function TimeEntryDialogContent(props: TimeEntryDialogProps): React.JSX.Element {
  const {
    id = 'time-entry-dialog',
    isOpen,
    onClose,
    onSave,
    onSaveAll,
    workItem,
    date,
    existingEntries,
    timePeriod,
    periodCatalog,
    isEditable,
    defaultStartTime,
    defaultEndTime,
    defaultEntries,
    defaultTaxRegion,
    timeSheetId,
    onTimeEntriesUpdate,
    inDrawer,
    periodContextLabel,
    notice,
    workTimeZone,
  } = props;
  const { t } = useTranslation('msp/time-entry');
  const { formatDate } = useFormatters();
  // Injected from the composition layer (billing owns the warning action).
  const getProjectTaskPaymentWarning = useSchedulingCrossFeatureOptional()?.getProjectTaskPaymentWarning;
  // Mode the server resolved for the viewer. Operational (seat technician): no commercial read is made.
  const operationalMode = useTimeEntryMode() === 'operational';
  const {
    entries,
    services,
    taxRegions,
    timeInputs,
    totalDurations,
    isLoading,
    initializeEntries,
    updateEntry,
    removeEntry,
    updateTimeInputs,
  } = useTimeEntry();

  // LEVERAGE: friction dialog-single-entry — the dialog, its cancel/save handlers and the provider were built around entries[0]; the multi-day drawer layers an isMultiDay branch beside the single-entry path instead of the dialog being entry-list native.
  // A session that ran across several work days: one dated form per day, one atomic Save.
  const isMultiDay = (defaultEntries?.length ?? 0) > 1 && Boolean(onSaveAll);


  const lastNoteInputRef = useRef<HTMLTextAreaElement>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ isOpen: boolean; index: number | null }>({
    isOpen: false,
    index: null
  });
  const [closeConfirmation, setCloseConfirmation] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Set by the first Save attempt; from then on every form shows its field errors live.
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [hasProjectPaymentWarning, setHasProjectPaymentWarning] = useState(false);
  // Asked of the registered time source; the drawer never inspects tenant identity. Until answered, a service is required.
  const [serviceOptional, setServiceOptional] = useState(false);

  useEffect(() => {
    let stale = false;
    setServiceOptional(false);
    if (!isOpen || !workItem.work_item_id || operationalMode) return;
    isServiceOptionalForWorkItem(workItem.type, workItem.work_item_id)
      .then(answer => { if (!stale) setServiceOptional(answer === true); })
      .catch(() => { if (!stale) setServiceOptional(false); });
    return () => { stale = true; };
  }, [isOpen, workItem.type, workItem.work_item_id, operationalMode]);

  useEffect(() => {
    let stale = false;

    if (!isOpen || operationalMode || workItem.type !== 'project_task' || !getProjectTaskPaymentWarning) {
      setHasProjectPaymentWarning(false);
      return () => {
        stale = true;
      };
    }

    getProjectTaskPaymentWarning(workItem.work_item_id)
      .then((result) => {
        if (stale) return;
        setHasProjectPaymentWarning(Boolean(result && !isReturnedActionError(result)));
      })
      .catch(() => {
        if (!stale) setHasProjectPaymentWarning(false);
      });

    return () => {
      stale = true;
    };
  }, [isOpen, workItem.type, workItem.work_item_id, getProjectTaskPaymentWarning, operationalMode]);

  // Initialize a single-entry form whenever the dialog opens.
  useEffect(() => {
    if (isOpen) {
      initializeEntries({
        existingEntries: existingEntries?.slice(0, 1).map(entry => ({
          ...entry,
          notes: entry.notes || ''
        })) || [],
        defaultStartTime,
        defaultEndTime,
        defaults: defaultEntries,
        defaultTaxRegion,
        workItem,
        date,
      });
      setValidationAttempted(false);
    }
  }, [date, defaultEndTime, defaultEntries, defaultStartTime, defaultTaxRegion, existingEntries, initializeEntries, isOpen, workItem]);

  /**
   * Field errors per entry, rendered inline in that entry's form (never a toast): the service, the
   * span rules, and (multi-day) the sheet the entry's real day lands on.
   */
  const entryErrors = useMemo((): EntryFieldErrors[] =>
    entries.map((entry) => {
      const errors: EntryFieldErrors = getTimeEntryValidationErrors(entry, workTimeZone);
      // No service is only allowed when the time source said so; the entry is then operational and carries no billable minutes.
      const isOperational = operationalMode || (serviceOptional && !entry.service_id?.trim());
      if (!isOperational && !entry.service_id?.trim()) {
        errors.service = t('timeEntryForm.validation.serviceRequired', {
          defaultValue: 'Service is required for time entries',
        });
      } else if (workItem.type !== 'ad_hoc' && !isOperational && !services.some(s => s.id === entry.service_id)) {
        // Tax region is no longer collected at time entry. Billing derives it from the service's
        // tax_rate_id (falling back to the client default), so only the service itself is checked.
        errors.service = t('messages.invalidService');
      }
      if (isMultiDay && periodCatalog && workTimeZone && entry.start_time) {
        const workDate = workDateInTimeZone(entry.start_time, workTimeZone);
        const formatted = formatDate(dateOnlyToLocalDate(workDate), { dateStyle: 'medium' });
        const period = periodForWorkDate(periodCatalog, workDate);
        if (!period) {
          errors.date = t('workItemEntry.save.noPeriod', {
            date: formatted,
            defaultValue: 'No time period covers {{date}}. Pick a day inside a time period.',
          });
        } else if (!isEditableSheetStatus(period.timeSheetStatus)) {
          errors.date = t('workItemEntry.save.sheetLocked', {
            date: formatted,
            status: sheetStatusLabel(period.timeSheetStatus),
            defaultValue:
              'The time sheet for {{date}} is {{status}}. Pick a day on a draft sheet or one with changes requested.',
          });
        }
      }
      return errors;
    }),
    [entries, formatDate, isMultiDay, operationalMode, periodCatalog, serviceOptional, services, t, workItem.type, workTimeZone],
  );

  /** Shows the errors of every invalid entry and scrolls to the first. Returns true when any exist. */
  const rejectInvalidEntries = useCallback((indexes: number[]): boolean => {
    const firstInvalid = indexes.find((index) => Object.keys(entryErrors[index] ?? {}).length > 0);
    if (firstInvalid === undefined) return false;
    setValidationAttempted(true);
    const target = typeof document !== 'undefined'
      ? document.getElementById(`${id}-entry-${firstInvalid}`)
      : null;
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    return true;
  }, [entryErrors, id]);

  const buildSavePayload = useCallback((entry: (typeof entries)[number]) => {
    const isAdHoc = workItem.type === 'ad_hoc';
    const isOperational = operationalMode || (serviceOptional && !entry.service_id?.trim());
    const { isNew, isDirty, tempId, ...cleanedEntry } = entry;
    const durationToSend = isAdHoc || isOperational ? 0 : entry.billable_duration;

    return {
      ...cleanedEntry,
      work_item_id: workItem.work_item_id,
      work_item_type: workItem.type,
      time_sheet_id: timeSheetId,
      billable_duration: durationToSend,
      start_time: entry.start_time,
      end_time: entry.end_time,
      created_at: entry.created_at || formatISO(new Date()),
      updated_at: formatISO(new Date()),
      notes: entry.notes || '',
      approval_status: 'DRAFT' as TimeSheetStatus,
      // Operational mode never sends a commercial field; the server would reject one.
      ...(operationalMode
        ? { service_id: undefined, tax_region: undefined, tax_rate_id: undefined, contract_line_id: undefined, contract_line_source: undefined }
        : {
          service_id: entry.service_id || undefined,
          tax_region: entry.tax_region || undefined,
          // Never echo a server-resolved (auto_*) line back: see contractLineFieldsForWrite.
          ...contractLineFieldsForWrite(entry, 'resave'),
        }),
    };
  }, [operationalMode, serviceOptional, timeSheetId, workItem]);

  /** The save lifecycle shared by one entry and a whole plan: progress toast, refresh, close, rejection copy. */
  const runSave = useCallback(async (save: () => Promise<void>) => {
    const loadingToast = toast.loading(t('messages.savingEntry'));

    try {
      setIsSaving(true);
      await save();

      if (onTimeEntriesUpdate && timeSheetId) {
        const fetchedTimeEntries = await fetchTimeEntriesForTimeSheet(timeSheetId);
        if (isReturnedActionError(fetchedTimeEntries)) {
          throw new Error(getErrorMessage(fetchedTimeEntries));
        }
        const updatedEntries = fetchedTimeEntries.map(entry => ({
          ...entry,
          start_time: typeof entry.start_time === 'string' ? entry.start_time : formatISO(entry.start_time),
          end_time: typeof entry.end_time === 'string' ? entry.end_time : formatISO(entry.end_time),
        }));
        await onTimeEntriesUpdate(updatedEntries);
      }

      toast.dismiss(loadingToast);
      toast.success(t('messages.entrySaved'));
      onClose();
    } catch (error) {
      toast.dismiss(loadingToast);
      // Only a server rejection gets a toast of its own: it already says what to do
      // (locked sheet, no period). Field errors never reach here; they render inline.
      handleError(
        error,
        error instanceof TimeEntrySaveRejectedError ? undefined : 'Failed to save time entry. Please try again.',
      );
    } finally {
      setIsSaving(false);
    }
  }, [onClose, onTimeEntriesUpdate, t, timeSheetId]);

  const handleSaveEntry = useCallback(async (index = 0) => {
    if (!isEditable || isSaving) return;

    const entry = entries[index];
    if (!entry) return;

    console.log('Entry to save:', entry);

    if (rejectInvalidEntries([index])) return;

    await runSave(() => onSave(buildSavePayload(entry)));
  }, [buildSavePayload, entries, isEditable, isSaving, onSave, rejectInvalidEntries, runSave]);

  /** Multi-day: validate every day first; nothing is sent unless all of them are valid. */
  const handleSaveAll = useCallback(async () => {
    if (!isEditable || isSaving || !onSaveAll || entries.length === 0) return;

    if (rejectInvalidEntries(entries.map((_, index) => index))) return;

    await runSave(() => onSaveAll(entries.map(buildSavePayload)));
  }, [buildSavePayload, entries, isEditable, isSaving, onSaveAll, rejectInvalidEntries, runSave]);

  const deleteTimeEntryAtIndex = async (index: number) => {
    try {
      const entry = entries[index];
      if (entry?.entry_id) {
        const result = await deleteTimeEntry(entry.entry_id);
        if (isReturnedActionError(result)) {
          throw new Error(getErrorMessage(result));
        }
      }

      if (onTimeEntriesUpdate && timeSheetId) {
        const fetchedTimeEntries = await fetchTimeEntriesForTimeSheet(timeSheetId);
        if (isReturnedActionError(fetchedTimeEntries)) {
          throw new Error(getErrorMessage(fetchedTimeEntries));
        }
        const updatedEntries = fetchedTimeEntries.map(entry => ({
          ...entry,
          start_time: typeof entry.start_time === 'string' ? entry.start_time : formatISO(entry.start_time),
          end_time: typeof entry.end_time === 'string' ? entry.end_time : formatISO(entry.end_time),
        }));
        await onTimeEntriesUpdate(updatedEntries);
      }

      onClose();
    } catch (error) {
      handleError(error, 'Failed to delete time entry. Please try again.');
    } finally {
      setDeleteConfirmation({ isOpen: false, index: null });
    }
  };

  const handleDeleteEntry = async (index: number) => {
    if (!isEditable) {
      return;
    }

    const entry = entries[index];
    if (!entry.entry_id) {
      // For new entries that haven't been saved, delete without confirmation
      await deleteTimeEntryAtIndex(index);
    } else {
      setDeleteConfirmation({ isOpen: true, index });
    }
  };

  const handleCancel = useCallback(() => {
    const entry = entries[0];

    if (!entry || (entry.isNew && !entry.entry_id)) {
      onClose();
      return;
    }

    if (entry.isDirty && entry.entry_id) {
      setCloseConfirmation(true);
      return;
    }

    onClose();
  }, [entries, onClose]);

  const handleSave = useCallback(async () => {
    if (!isEditable) {
      onClose();
      return;
    }

    if (isMultiDay) {
      await handleSaveAll();
      return;
    }

    const entry = entries[0];
    if (!entry) {
      return;
    }

    if (entry.isDirty || entry.isNew) {
      await handleSaveEntry(0);
      return;
    }

    onClose();
  }, [entries, handleSaveAll, handleSaveEntry, isEditable, isMultiDay, onClose]);

  const hasExistingEntry = Boolean(existingEntries && existingEntries.length > 0);
  const title = hasExistingEntry
    ? `${isEditable ? 'Edit' : 'View'} Time Entry for ${workItem.name}`
    : `Add New Time Entry for ${workItem.name}`;
  // LEVERAGE: pattern payment-warning-banner — this duplicates the project-billing warning presentation because scheduling cannot import billing UI; extract through the cross-feature composition layer if another consumer appears.
  const [paymentWarningEmphasis, paymentWarningRest] = splitPaymentWarning(t(
    'workItemPicker.paymentWarning',
    {
      defaultValue: 'Payment is required for a flagged project billing milestone and has not been confirmed. Confirm payment before continuing work.',
    },
  ));
  const totalDurationMinutes = totalDurations.reduce((sum, minutes) => sum + minutes, 0);
  const footerActions = (
    <div className={`flex items-center space-x-2 ${isMultiDay ? 'justify-between' : 'justify-end'}`}>
      {isMultiDay && (
        <span id={`${id}-total`} className="text-sm font-medium text-[rgb(var(--color-text-700))]">
          {t('workItemEntry.multiDay.total', {
            duration: formatStopwatchDuration(totalDurationMinutes * 60_000),
            defaultValue: 'Total: {{duration}}',
          })}
        </span>
      )}
      <div className="flex space-x-2">
      <Button
        id={`${id}-cancel-dialog-btn`}
        onClick={handleCancel}
        variant="outline"
      >
        {isEditable ? 'Cancel' : 'Close'}
      </Button>
      {isEditable && (
        <Button
          id={`${id}-save-dialog-btn`}
          onClick={handleSave}
          variant="default"
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      )}
      </div>
    </div>
  );
  const content = (
    <div
      className="mx-auto w-full max-w-[35rem]"
      data-automation-id={id}
      data-automation-type="container"
    >
      {inDrawer && <h2 className="mb-4 text-lg font-semibold">{title}</h2>}
      {inDrawer && periodContextLabel && (
        <p className="mb-3 text-sm text-[rgb(var(--color-text-600))]">{periodContextLabel}</p>
      )}
      {notice && (
        <Alert id={`${id}-notice`} variant="info" className="mb-3">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {hasProjectPaymentWarning && (
        <Alert id={`${id}-project-payment-warning`} variant="warning" className="mb-3">
          <AlertDescription>
            <span className="font-medium">
              {t('workItemPicker.paymentWarningTitle', {
                defaultValue: 'Payment prerequisite warning',
              })}
            </span>{' '}
            <strong>{paymentWarningEmphasis}</strong>
            {paymentWarningRest && <> {paymentWarningRest}</>}
          </AlertDescription>
        </Alert>
      )}
      {workItem.type === 'ticket' && workItem.master_ticket_id && (
        <div className="mb-3 rounded-md bg-blue-50 dark:bg-blue-900/20 p-3 text-sm text-[rgb(var(--color-text-700))]">
          {workItem.master_ticket_number
            ? t('bundleNotice.withNumber', {
                defaultValue: 'This ticket is bundled under {{number}}. Bundle time is usually logged on the master ticket.',
                number: workItem.master_ticket_number
              })
            : t('bundleNotice.withoutNumber', {
                defaultValue: 'This ticket is part of a bundle. Bundle time is usually logged on the master ticket.'
              })}
        </div>
      )}
      {isLoading ? (
        <TimeEntrySkeletons />
      ) : isMultiDay ? (
        <div className="mt-2 space-y-6">
          <Alert id={`${id}-multi-day-notice`} variant="info">
            <AlertDescription>
              {t('workItemEntry.multiDay.notice', {
                count: defaultEntries?.length ?? entries.length,
                defaultValue:
                  'This timer ran across {{count}} days, so it will be saved as one time entry per day. Remove a day to leave its time out.',
              })}
            </AlertDescription>
          </Alert>
          {entries.map((entry, index) => (
            <section
              key={entry.tempId ?? index}
              id={`${id}-entry-${index}`}
              className="space-y-3 rounded-md border border-[rgb(var(--color-border-200))] p-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  {t('workItemEntry.multiDay.dayHeading', {
                    index: index + 1,
                    count: entries.length,
                    date: formatDate(
                      dateOnlyToLocalDate(workTimeZone ? workDateInTimeZone(entry.start_time, workTimeZone) : entry.start_time.slice(0, 10)),
                      { dateStyle: 'full' },
                    ),
                    defaultValue: 'Day {{index}} of {{count}} · {{date}}',
                  })}
                </h3>
                {entries.length > 1 && (
                  <Button
                    id={`${id}-remove-day-${index}`}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isSaving}
                    onClick={() => removeEntry(index)}
                  >
                    {t('workItemEntry.multiDay.remove', { defaultValue: 'Remove' })}
                  </Button>
                )}
              </div>
              <SingleTimeEntryForm
                id={`${id}-day-${index}`}
                index={index}
                entry={entry}
                services={services}
                taxRegions={taxRegions}
                timeInputs={timeInputs}
                totalDuration={totalDurations[index] || 0}
                isEditable={isEditable}
                lastNoteInputRef={lastNoteInputRef}
                onDelete={handleDeleteEntry}
                onUpdateEntry={updateEntry}
                onUpdateTimeInputs={updateTimeInputs}
                timePeriod={timePeriod}
                periodCatalog={periodCatalog}
                date={date}
                workTimeZone={workTimeZone}
                isNewEntry={true}
                serviceOptional={serviceOptional}
                errors={validationAttempted ? entryErrors[index] : undefined}
                showErrors={validationAttempted}
              />
            </section>
          ))}
        </div>
      ) : entries[0] ? (
        <div className="mt-2">
          <SingleTimeEntryForm
            id={id}
            entry={entries[0]}
            services={services}
            taxRegions={taxRegions}
            timeInputs={timeInputs}
            totalDuration={totalDurations[0] || 0}
            isEditable={isEditable}
            lastNoteInputRef={lastNoteInputRef}
            onDelete={handleDeleteEntry}
            onUpdateEntry={updateEntry}
            onUpdateTimeInputs={updateTimeInputs}
            timePeriod={timePeriod}
            periodCatalog={periodCatalog}
            date={date}
            workTimeZone={workTimeZone}
            isNewEntry={!hasExistingEntry}
            serviceOptional={serviceOptional}
            errors={validationAttempted ? entryErrors[0] : undefined}
            showErrors={validationAttempted}
          />
        </div>
      ) : null}

      {inDrawer && <DrawerFooter>{footerActions}</DrawerFooter>}
    </div>
  );

  return (
    <>
      {inDrawer ? (
        content
      ) : (
        <Dialog
          isOpen={isOpen}
          onClose={handleCancel}
          title={title}
          hideCloseButton={false}
          id={`__skip_registration_${id}`}
          data-automation-id={id}
          data-automation-type="time-entry-dialog"
          footer={footerActions}
        >
          <DialogContent className="w-full max-w-2xl">
            {content}
          </DialogContent>
        </Dialog>
      )}

      {deleteConfirmation.isOpen && (
        <ConfirmationDialog
          id={`${id}-delete-confirmation`}
          isOpen={true}
          onClose={() => setDeleteConfirmation({ isOpen: false, index: null })}
          onConfirm={async () => {
            if (deleteConfirmation.index !== null) {
              await deleteTimeEntryAtIndex(deleteConfirmation.index);
            }
          }}
          title="Delete Time Entry"
          message="Are you sure you want to delete this time entry?"
          confirmLabel="Delete"
          cancelLabel="Cancel"
        />
      )}

      {closeConfirmation && (
        <ConfirmationDialog
          id={`${id}-close-confirmation`}
          isOpen={true}
          onClose={() => setCloseConfirmation(false)}
          onConfirm={async () => {
            onClose();
            setCloseConfirmation(false);
          }}
          title="Discard Changes"
          message="You have unsaved changes. Are you sure you want to discard them?"
          confirmLabel="Discard"
          cancelLabel="Keep Editing"
        />
      )}
    </>
  );
});

const TimeEntryDialog = memo(function TimeEntryDialog(props: TimeEntryDialogProps) {
  return (
    <TimeEntryProvider>
      <TimeEntryDialogContent {...props} />
    </TimeEntryProvider>
  );
});

TimeEntryDialog.displayName = 'TimeEntryDialog';

// Export the component
export default TimeEntryDialog;
