'use client';

import { useState, useRef, useCallback, memo, useEffect } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import { formatISO, parseISO } from 'date-fns';
import { toast } from 'react-hot-toast';
import { generateUUID } from '@alga-psa/core';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { deleteTimeEntry, fetchTimeEntriesForTimeSheet } from '../../../../actions/timeEntryActions';
import { Button } from '@alga-psa/ui/components/Button';
import { 
  ITimeEntry, 
  ITimeEntryWithWorkItem, 
  ITimePeriod,
  ITimePeriodView, 
  TimeSheetStatus, 
  ITimeEntryWithWorkItemString 
} from '@alga-psa/types';
import { IExtendedWorkItem } from '@alga-psa/types';
import { TimeEntryProvider, useTimeEntry } from './TimeEntryProvider';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import TimeEntrySkeletons from './TimeEntrySkeletons';
import TimeEntryList from '../TimeEntryList';
import SingleTimeEntryForm from './SingleTimeEntryForm';
import { validateTimeEntry, calculateDuration } from './utils';

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
  startInAddMode?: boolean;
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
    timePeriod: _timePeriod,
    isEditable,
    defaultStartTime,
    defaultEndTime,
    defaultTaxRegion,
    timeSheetId,
    onTimeEntriesUpdate,
    inDrawer,
    startInAddMode = false,
  } = props;
  const {
    entries,
    services,
    taxRegions,
    timeInputs,
    editingIndex,
    totalDurations,
    isLoading,
    initializeEntries,
    updateEntry,
    setEditingIndex,
    updateTimeInputs,
  } = useTimeEntry();

  // Convert string dates to Temporal.PlainDate for internal use
  const timePeriod: ITimePeriod = {
    ...props.timePeriod,
    start_date: Temporal.PlainDate.from(props.timePeriod.start_date.slice(0, 10)),
    end_date: Temporal.PlainDate.from(props.timePeriod.end_date.slice(0, 10))
  };

  const lastNoteInputRef = useRef<HTMLTextAreaElement>(null);
  const [shouldFocusNotes, setShouldFocusNotes] = useState(false);
  const hasSetInitialEditingIndex = useRef(false);
  const hasTriggeredInitialAddMode = useRef(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ isOpen: boolean; index: number | null }>({
    isOpen: false,
    index: null
  });
  const [closeConfirmation, setCloseConfirmation] = useState(false);
  const [activeSave, setActiveSave] = useState<{ source: 'dialog' | 'entry'; index: number } | null>(null);

  // Initialize entries when dialog opens
  useEffect(() => {
    if (isOpen) {
      initializeEntries({
        existingEntries: existingEntries?.map(entry => ({
          ...entry,
          notes: entry.notes || workItem.description || ''
        })) || [],
        defaultStartTime,
        defaultEndTime,
        defaultTaxRegion,
        workItem,
        date,
      });
    }
  }, [isOpen]);
  
  // Set editing index for single entry - separate effect to avoid infinite loop
  useEffect(() => {
    if (isOpen && existingEntries?.length === 1 && !hasSetInitialEditingIndex.current) {
      setEditingIndex(0);
      hasSetInitialEditingIndex.current = true;
    } else if (!isOpen) {
      // Reset the flag when dialog closes
      hasSetInitialEditingIndex.current = false;
    }
  }, [isOpen, existingEntries?.length]);

  // Focus notes input when adding new entry
  useEffect(() => {
    if (isOpen && lastNoteInputRef.current && shouldFocusNotes) {
      lastNoteInputRef.current.focus();
      setShouldFocusNotes(false);
    }
  }, [isOpen, shouldFocusNotes]);

  const handleAddEntry = useCallback(() => {
    if (!isEditable) return;

    let defaultStartTime = new Date(date);
    if (entries.length > 0) {
      defaultStartTime = parseISO(entries[entries.length - 1].end_time);
    } else {
      defaultStartTime.setHours(8, 0, 0, 0);
    }

    const defaultEndTime = new Date(defaultStartTime);
    defaultEndTime.setHours(defaultEndTime.getHours() + 1);
    const duration = calculateDuration(defaultStartTime, defaultEndTime);

    const newEntry = {
      // Required fields from schema
      work_item_id: workItem.work_item_id,
      work_item_type: workItem.type,
      start_time: formatISO(defaultStartTime),
      end_time: formatISO(defaultEndTime),
      billable_duration: duration,
      notes: '',
      created_at: formatISO(new Date()),
      updated_at: formatISO(new Date()),
      approval_status: 'DRAFT' as TimeSheetStatus,
      user_id: '',
      // Optional fields
      entry_id: '',
      service_id: '',
      tax_region: defaultTaxRegion || '',
      
      // Local state fields (not sent to server)
      isNew: true,
      tempId: generateUUID(),
    };

    updateEntry(entries.length, newEntry);
    setEditingIndex(entries.length);
    setShouldFocusNotes(true);
  }, [isEditable, date, entries, workItem, defaultTaxRegion, updateEntry, setEditingIndex]);

  useEffect(() => {
    if (!isOpen) {
      hasTriggeredInitialAddMode.current = false;
      return;
    }

    if (!startInAddMode || hasTriggeredInitialAddMode.current || !isEditable || isLoading) {
      return;
    }

    if (!existingEntries || existingEntries.length === 0) {
      hasTriggeredInitialAddMode.current = true;
      return;
    }

    handleAddEntry();
    hasTriggeredInitialAddMode.current = true;
  }, [existingEntries, handleAddEntry, isEditable, isLoading, isOpen, startInAddMode]);

  const handleSaveEntry = useCallback(async (index: number, source: 'dialog' | 'entry' = 'entry') => {
    if (!isEditable) return;
    if (activeSave) return;
  
    const entry = entries[index];
    const shouldKeepDialogOpen = entries.length > 1;
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
      setActiveSave({ source, index });
      const { isNew, isDirty, tempId, ...cleanedEntry } = entry;

      // Calculate actual duration for validation purposes
      const actualDuration = calculateDuration(parseISO(entry.start_time), parseISO(entry.end_time));

      // For ad_hoc items, always set billable_duration to 0
      // For other items, respect the user's billable setting - use entry.billable_duration as-is
      const durationToSend = isAdHoc ? 0 : entry.billable_duration;

      console.log('Preparing time entry with billable_duration:', {
        entryBillableDuration: entry.billable_duration,
        actualDuration,
        durationToSend,
        isAdHoc,
        respectingUserBillableSetting: !isAdHoc
      });

      // Prepare the time entry with all required fields
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
        // Ensure service_id and tax_region are null/undefined when not applicable
        service_id: entry.service_id || undefined,
        tax_region: entry.tax_region || undefined,
      };

      console.log('Prepared time entry:', timeEntry);

      console.log('Billable duration before sending to backend:', {
        billableDuration: timeEntry.billable_duration,
        type: typeof timeEntry.billable_duration,
        isZero: timeEntry.billable_duration === 0,
        isNumber: typeof timeEntry.billable_duration === 'number'
      });

      await onSave(timeEntry);
  
      // Fetch updated entries
      if (onTimeEntriesUpdate && timeSheetId) {
        const fetchedTimeEntries = await fetchTimeEntriesForTimeSheet(timeSheetId);
        const updatedEntries = fetchedTimeEntries.map(entry => ({
          ...entry,
          start_time: typeof entry.start_time === 'string' ? entry.start_time : formatISO(entry.start_time),
          end_time: typeof entry.end_time === 'string' ? entry.end_time : formatISO(entry.end_time),
        }));
        await onTimeEntriesUpdate(updatedEntries);

        if (shouldKeepDialogOpen) {
          await initializeEntries({
            existingEntries: updatedEntries,
            workItem,
            date,
            defaultTaxRegion
          });
        }
      }
  
      toast.dismiss(loadingToast);
      toast.success('Time entry saved');

      if (shouldKeepDialogOpen) {
        setEditingIndex(null);
      } else {
        onClose();
      }
    } catch (error) {
      toast.dismiss(loadingToast);
      handleError(error, 'Failed to save time entry. Please try again.');
    } finally {
      setActiveSave(null);
    }
  }, [activeSave, isEditable, timeSheetId, entries, services, workItem, onSave, onTimeEntriesUpdate, onClose, initializeEntries, date, defaultTaxRegion, setEditingIndex]);

  const deleteTimeEntryAtIndex = async (index: number) => {
    try {
      const entry = entries[index];
      if (entry.entry_id) {
        await deleteTimeEntry(entry.entry_id);
      }
      
      // Remove the entry from state and maintain workItem property
      const newEntries = entries.filter((_, i) => i !== index).map(entry => ({
        ...entry,
        workItem: workItem
      }));

      if (newEntries.length === 0) {
        // If no entries left, close the form
        onClose();
      } else {
        // Otherwise reinitialize with remaining entries
        initializeEntries({
          existingEntries: newEntries,
          workItem,
          date,
          defaultTaxRegion
        });
        setEditingIndex(null);
      }
      
      if (onTimeEntriesUpdate && timeSheetId) {
        const fetchedTimeEntries = await fetchTimeEntriesForTimeSheet(timeSheetId);
        const updatedEntries = fetchedTimeEntries.map(entry => ({
          ...entry,
          start_time: typeof entry.start_time === 'string' ? entry.start_time : formatISO(entry.start_time),
          end_time: typeof entry.end_time === 'string' ? entry.end_time : formatISO(entry.end_time),
        }));
        onTimeEntriesUpdate(updatedEntries);
      }
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
    // For new entries that were never saved, don't show confirmation - just close
    const hasOnlyNewUnsavedEntries = entries.every(entry => entry.isNew && !entry.entry_id);
    const hasSavedEntriesWithChanges = entries.some(entry => entry.isDirty && entry.entry_id);
    
    if (hasOnlyNewUnsavedEntries) {
      // Just close without saving new entries that were never saved
      onClose();
    } else if (hasSavedEntriesWithChanges) {
      // Show confirmation for existing entries that have changes
      setCloseConfirmation(true);
    } else {
      onClose();
    }
  }, [entries, onClose]);

  const handleSaveAll = useCallback(async () => {
    if (!isEditable) {
      onClose();
      return;
    }
    if (activeSave) return;

    // Find the first entry that needs to be saved
    const entryToSave = entries.findIndex(entry => entry.isDirty || entry.isNew);
    if (entryToSave !== -1) {
      await handleSaveEntry(entryToSave, 'dialog');
    } else {
      onClose();
    }
  }, [activeSave, entries, handleSaveEntry, isEditable, onClose]);

  const hasExistingEntries = Boolean(existingEntries && existingEntries.length > 0);
  const title = hasExistingEntries
    ? `${isEditable ? 'Edit' : 'View'} Time Entries for ${workItem.name}`
    : `Add New Time Entry for ${workItem.name}`;
  const content = (
    <ReflectionContainer id={id} label={title}>
      <div className="mx-auto w-full max-w-[35rem]">
        {inDrawer && <h2 className="mb-4 text-lg font-semibold">{title}</h2>}
        {isLoading ? (
          <TimeEntrySkeletons />
        ) : existingEntries && existingEntries.length > 0 ? (
          <TimeEntryList
            id={id}
            entries={entries}
            services={services}
            taxRegions={taxRegions}
            timeInputs={timeInputs}
            editingIndex={editingIndex}
            totalDurations={totalDurations}
            isEditable={isEditable}
            lastNoteInputRef={lastNoteInputRef}
            onSave={handleSaveEntry}
            onDelete={handleDeleteEntry}
            onEdit={setEditingIndex}
            onUpdateEntry={updateEntry}
            onUpdateTimeInputs={updateTimeInputs}
            onAddEntry={handleAddEntry}
            date={date}
            savingEntryIndex={activeSave?.source === 'entry' ? activeSave.index : null}
            disableSaveActions={activeSave !== null}
          />
        ) : (
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
              isNewEntry={!existingEntries || existingEntries.length === 0}
            />
          </div>
        )}

        <DialogFooter>
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
              onClick={handleSaveAll}
              variant="default"
              disabled={activeSave !== null}
            >
              {activeSave?.source === 'dialog' ? 'Saving...' : 'Save'}
            </Button>
          )}
        </DialogFooter>
      </div>
    </ReflectionContainer>
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
          id={id}
          data-automation-id={id}
          data-automation-type="time-entry-dialog"
        >
          <DialogContent className="w-full max-w-2xl">
            {content}
          </DialogContent>
        </Dialog>
      )}

      <ConfirmationDialog
        id={`${id}-delete-confirmation`}
        isOpen={deleteConfirmation.isOpen}
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

      <ConfirmationDialog
        id={`${id}-close-confirmation`}
        isOpen={closeConfirmation}
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
