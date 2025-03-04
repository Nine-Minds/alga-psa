'use client';

import { useState, useRef, useCallback, memo, useEffect } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import { formatISO, parseISO } from 'date-fns';
import { toast } from 'react-hot-toast';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { deleteTimeEntry, fetchTimeEntriesForTimeSheet } from 'server/src/lib/actions/timeEntryActions';
import { Button } from 'server/src/components/ui/Button';
import { 
  ITimeEntry, 
  ITimeEntryWithWorkItem, 
  ITimePeriod,
  ITimePeriodView, 
  TimeSheetStatus, 
  ITimeEntryWithWorkItemString 
} from 'server/src/interfaces/timeEntry.interfaces';
import { IWorkItem } from 'server/src/interfaces/workItem.interfaces';
import { TimeEntryProvider, useTimeEntry } from './TimeEntryProvider';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import TimeEntrySkeletons from './TimeEntrySkeletons';
import TimeEntryList from '../TimeEntryList';
import SingleTimeEntryForm from './SingleTimeEntryForm';
import { validateTimeEntry, calculateDuration } from './utils';

interface TimeEntryDialogProps {
  id?: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (timeEntry: Omit<ITimeEntry, 'tenant'>) => Promise<void>;
  workItem: Omit<IWorkItem, 'tenant'>;
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
const TimeEntryDialogContent = memo(function TimeEntryDialogContent(props: TimeEntryDialogProps): JSX.Element {
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
    start_date: Temporal.PlainDate.from(props.timePeriod.start_date),
    end_date: Temporal.PlainDate.from(props.timePeriod.end_date)
  };

  const lastNoteInputRef = useRef<HTMLInputElement>(null);
  const [shouldFocusNotes, setShouldFocusNotes] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ isOpen: boolean; index: number | null }>({
    isOpen: false,
    index: null
  });
  const [closeConfirmation, setCloseConfirmation] = useState(false);

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
  }, [isOpen, defaultStartTime, defaultEndTime, defaultTaxRegion, date, workItem]);

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
      tempId: crypto.randomUUID(),
    };

    updateEntry(entries.length, newEntry);
    setEditingIndex(entries.length);
    setShouldFocusNotes(true);
  }, [isEditable, date, entries, workItem, defaultTaxRegion, updateEntry, setEditingIndex]);

  const handleSaveEntry = useCallback(async (index: number) => {
    if (!isEditable || !timeSheetId) return;
  
    const entry = entries[index];
    console.log('Entry to save:', entry);
    
    // Validate required fields
    if (!entry.service_id) {
      toast.error('Please select a service');
      return;
    }
  
    const selectedService = services.find(s => s.id === entry.service_id);
    if (!selectedService) {
      toast.error('Invalid service selected');
      return;
    }
  
    if (selectedService.is_taxable && !entry.tax_region) {
      toast.error('Please select a tax region for taxable services');
      return;
    }
  
    if (!validateTimeEntry(entry)) {
      toast.error('Please check the time entry values');
      return;
    }
  
    const loadingToast = toast.loading('Saving time entry...');
    
    try {
      const { isNew, isDirty, tempId, ...cleanedEntry } = entry;
  
      // Prepare the time entry with all required fields
      const timeEntry = {
        ...cleanedEntry,
        work_item_id: workItem.work_item_id,
        work_item_type: workItem.type,
        time_sheet_id: timeSheetId,
        billable_duration: entry.billable_duration || 0,
        start_time: entry.start_time,
        end_time: entry.end_time,
        created_at: entry.created_at || formatISO(new Date()),
        updated_at: formatISO(new Date()),
        notes: entry.notes || '',
        approval_status: 'DRAFT' as TimeSheetStatus
      };
      
      console.log('Prepared time entry:', timeEntry);
      const savedEntry = await onSave(timeEntry);
      console.log('Saved entry response:', savedEntry);
  
      // Fetch updated entries
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
      onClose();
    } catch (error) {
      toast.dismiss(loadingToast);
      console.error('Error saving time entry:', error);
      
      // Show a more user-friendly error message
      if (error instanceof Error && error.message.includes('Unauthorized')) {
        toast.error('Please log in to save time entries');
      } else {
        toast.error('Failed to save time entry. Please try again.');
      }
    }
  }, [isEditable, timeSheetId, entries, services, workItem, onSave, onTimeEntriesUpdate, onClose]);

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
      console.error('Error deleting time entry:', error);
      toast.error('Failed to delete time entry. Please try again.');
    } finally {
      setDeleteConfirmation({ isOpen: false, index: null });
    }
  };

  const handleDeleteEntry = useCallback(async (index: number) => {
    const entry = entries[index];
    if (!entry.entry_id) {
      // For new entries that haven't been saved, delete without confirmation
      await deleteTimeEntryAtIndex(index);
    } else {
      setDeleteConfirmation({ isOpen: true, index });
    }
  }, [entries]);

  const handleClose = useCallback(() => {
    const hasUnsavedChanges = entries.some(entry => entry.isDirty);
    if (hasUnsavedChanges) {
      setCloseConfirmation(true);
    } else {
      onClose();
    }
  }, [entries, onClose]);

  const title = existingEntries && existingEntries.length > 0 
    ? `Edit Time Entries for ${workItem.name}`
    : `Add New Time Entry for ${workItem.name}`;
  const content = (
    <ReflectionContainer id={id} label={title}>
      {inDrawer && <h2 className="text-lg font-semibold mb-4">{title}</h2>}
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
        />
      ) : (
        <SingleTimeEntryForm
          id={id}
          entry={entries[0]}
          services={services}
          taxRegions={taxRegions}
          timeInputs={timeInputs}
          totalDuration={totalDurations[0] || 0}
          isEditable={isEditable}
          lastNoteInputRef={lastNoteInputRef}
          onSave={handleSaveEntry}
          onDelete={handleDeleteEntry}
          onUpdateEntry={updateEntry}
          onUpdateTimeInputs={updateTimeInputs}
        />
      )}

      <DialogFooter>
        <Button
          id={`${id}-close-dialog-btn`}
          onClick={handleClose}
          variant="outline"
        >
          Close
        </Button>
      </DialogFooter>
    </ReflectionContainer>
  );

  return (
    <>
      {inDrawer ? (
        content
      ) : (
        <Dialog isOpen={isOpen} onClose={handleClose} title={title}>
          <DialogContent className="w-full max-w-4xl">
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
        title="Unsaved Changes"
        message="You have unsaved changes. Are you sure you want to close?"
        confirmLabel="Close"
        cancelLabel="Cancel"
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
