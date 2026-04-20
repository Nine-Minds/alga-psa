'use client';

import { useState, useRef, useCallback, memo, useEffect } from 'react';
import { formatISO } from 'date-fns';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
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
    isEditable,
    defaultStartTime,
    defaultEndTime,
    defaultTaxRegion,
    timeSheetId,
    onTimeEntriesUpdate,
    inDrawer,
  } = props;
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
      toast.error('Please select a service before saving time entries');
      return;
    }

    if (!isAdHoc) {
      const selectedService = services.find(s => s.id === entry.service_id);
      if (!selectedService) {
        toast.error('Invalid service selected');
        return;
      }

      const hasTaxableRate = selectedService.tax_rate_id != null &&
        selectedService.tax_percentage != null &&
        selectedService.tax_percentage > 0;
      if (hasTaxableRate && !entry.tax_region) {
        toast.error('Please select a tax region for taxable services');
        return;
      }
    }

    if (!validateTimeEntry(entry)) {
      toast.error('Please check the time entry values');
      return;
    }

    const loadingToast = toast.loading('Saving time entry...');

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
        const updatedEntries = fetchedTimeEntries.map(entry => ({
          ...entry,
          start_time: typeof entry.start_time === 'string' ? entry.start_time : formatISO(entry.start_time),
          end_time: typeof entry.end_time === 'string' ? entry.end_time : formatISO(entry.end_time),
        }));
        await onTimeEntriesUpdate(updatedEntries);
      }

      toast.dismiss(loadingToast);
      toast.success('Time entry saved');
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
        await deleteTimeEntry(entry.entry_id);
      }

      if (onTimeEntriesUpdate && timeSheetId) {
        const fetchedTimeEntries = await fetchTimeEntriesForTimeSheet(timeSheetId);
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
