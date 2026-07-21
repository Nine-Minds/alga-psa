'use client';

import { useState, useRef, useCallback, memo, useEffect } from 'react';
import { formatISO } from 'date-fns';
import { toast } from 'react-hot-toast';
import {
  getErrorMessage,
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { deleteTimeEntry, fetchTimeEntriesForTimeSheet } from '../../../../actions/timeEntryActions';
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
import { validateTimeEntry } from './utils';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useSchedulingCrossFeatureOptional } from '../../../../context/SchedulingCrossFeatureContext';

function isReturnedActionError(value: unknown): value is { actionError: string } | { permissionError: string } {
  return isActionMessageError(value) || isActionPermissionError(value);
}

interface TimeEntryDialogProps {
  id?: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (timeEntry: Omit<ITimeEntry, 'tenant'>) => Promise<void>;
  workItem: Omit<IExtendedWorkItem, 'tenant'>;
  date: Date;
  existingEntries?: ITimeEntryWithWorkItem[];
  timePeriod: ITimePeriodView;
  isEditable: boolean;
  defaultStartTime?: Date;
  defaultEndTime?: Date;
  defaultTaxRegion?: string;
  timeSheetId?: string;
  onTimeEntriesUpdate?: (entries: ITimeEntryWithWorkItemString[]) => void;
  inDrawer?: boolean;
}

// Main dialog content component
const TimeEntryDialogContent = memo(function TimeEntryDialogContent(props: TimeEntryDialogProps): React.JSX.Element {
  const {
    id = 'time-entry-dialog',
    isOpen,
    onClose,
    onSave,
    workItem,
    date,
    existingEntries,
    timePeriod,
    isEditable,
    defaultStartTime,
    defaultEndTime,
    defaultTaxRegion,
    timeSheetId,
    onTimeEntriesUpdate,
    inDrawer,
  } = props;
  const { t } = useTranslation('msp/time-entry');
  const { enabled: projectBillingUiEnabled } = useFeatureFlag('project-billing-ui', { defaultValue: false });
  // Injected from the composition layer (billing owns the warning action).
  const getProjectTaskPaymentWarning = useSchedulingCrossFeatureOptional()?.getProjectTaskPaymentWarning;
  const {
    entries,
    services,
    taxRegions,
    timeInputs,
    totalDurations,
    isLoading,
    initializeEntries,
    updateEntry,
    updateTimeInputs,
  } = useTimeEntry();


  const lastNoteInputRef = useRef<HTMLTextAreaElement>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ isOpen: boolean; index: number | null }>({
    isOpen: false,
    index: null
  });
  const [closeConfirmation, setCloseConfirmation] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasProjectPaymentWarning, setHasProjectPaymentWarning] = useState(false);

  useEffect(() => {
    let stale = false;

    if (!isOpen || workItem.type !== 'project_task' || !getProjectTaskPaymentWarning) {
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
  }, [isOpen, workItem.type, workItem.work_item_id, getProjectTaskPaymentWarning]);

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
        defaultTaxRegion,
        workItem,
        date,
      });
    }
  }, [date, defaultEndTime, defaultStartTime, defaultTaxRegion, existingEntries, initializeEntries, isOpen, workItem]);

  const handleSaveEntry = useCallback(async (index = 0) => {
    if (!isEditable || isSaving) return;

    const entry = entries[index];
    if (!entry) return;

    console.log('Entry to save:', entry);

    const isAdHoc = workItem.type === 'ad_hoc';

    if (!entry.service_id?.trim()) {
      toast.error(t('messages.serviceRequired'));
      return;
    }

    if (!isAdHoc) {
      const selectedService = services.find(s => s.id === entry.service_id);
      if (!selectedService) {
        toast.error(t('messages.invalidService'));
        return;
      }
      // Tax region is no longer collected at time entry. Billing derives it from
      // the service's tax_rate_id (falling back to the client default), so there
      // is nothing to validate here. See billingEngine.getTaxInfoFromService.
    }

    if (!validateTimeEntry(entry)) {
      toast.error(t('messages.invalidTimeEntry'));
      return;
    }

    const loadingToast = toast.loading(t('messages.savingEntry'));

    try {
      setIsSaving(true);
      const { isNew, isDirty, tempId, ...cleanedEntry } = entry;
      const durationToSend = isAdHoc ? 0 : entry.billable_duration;

      const timeEntry = {
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
        service_id: entry.service_id || undefined,
        tax_region: entry.tax_region || undefined,
      };

      await onSave(timeEntry);

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
      handleError(error, 'Failed to save time entry. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [entries, isEditable, isSaving, onClose, onSave, onTimeEntriesUpdate, services, timeSheetId, workItem]);

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

    const entry = entries[0];
    if (!entry) {
      return;
    }

    if (entry.isDirty || entry.isNew) {
      await handleSaveEntry(0);
      return;
    }

    onClose();
  }, [entries, handleSaveEntry, isEditable, onClose]);

  const hasExistingEntry = Boolean(existingEntries && existingEntries.length > 0);
  const title = hasExistingEntry
    ? `${isEditable ? 'Edit' : 'View'} Time Entry for ${workItem.name}`
    : `Add New Time Entry for ${workItem.name}`;
  const footerActions = (
    <div className="flex justify-end space-x-2">
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
  );
  const content = (
    <div
      className="mx-auto w-full max-w-[35rem]"
      data-automation-id={id}
      data-automation-type="container"
    >
      {inDrawer && <h2 className="mb-4 text-lg font-semibold">{title}</h2>}
      {projectBillingUiEnabled && hasProjectPaymentWarning && (
        <Alert id={`${id}-project-payment-warning`} variant="warning" className="mb-3">
          <AlertDescription>
            <span className="font-medium">
              {t('workItemPicker.paymentWarningTitle', {
                defaultValue: 'Payment prerequisite warning',
              })}
            </span>{' '}
            {t('workItemPicker.paymentWarning', {
              defaultValue: 'Payment is required for a flagged project billing milestone and has not been confirmed. Confirm payment before continuing work.',
            })}
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
            date={date}
            isNewEntry={!hasExistingEntry}
          />
        </div>
      ) : null}

      {inDrawer && <div className="mt-4">{footerActions}</div>}
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
