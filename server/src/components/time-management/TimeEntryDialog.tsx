'use client';

import { useState, useRef, useCallback, memo, useEffect } from 'react';
import { formatISO, parseISO } from 'date-fns';
import { Dialog, DialogContent, DialogFooter } from '../ui/Dialog';
import { deleteTimeEntry, fetchTimeEntriesForTimeSheet } from '../../lib/actions/timeEntryActions';
import { Button } from '../ui/Button';
import { ITimeEntry, ITimeEntryWithWorkItem, ITimePeriod, TimeSheetStatus } from '../../interfaces/timeEntry.interfaces';
import { IWorkItem } from '../../interfaces/workItem.interfaces';
import { TimeEntryProvider, useTimeEntry } from './TimeEntryProvider';
import { ReflectionContainer } from '@/types/ui-reflection/ReflectionContainer';
import TimeEntrySkeletons from './TimeEntrySkeletons';
import TimeEntryList from './TimeEntryList';
import { validateTimeEntry, calculateDuration } from './utils';

interface TimeEntryDialogProps {
  id?: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (timeEntry: Omit<ITimeEntry, 'tenant'>) => Promise<void>;
  workItem: Omit<IWorkItem, 'tenant'>;
  date: Date;
  existingEntries?: ITimeEntryWithWorkItem[];
  timePeriod: ITimePeriod;
  isEditable: boolean;
  defaultStartTime?: Date;
  defaultEndTime?: Date;
  defaultTaxRegion?: string;
  timeSheetId?: string;
  onTimeEntriesUpdate?: (entries: ITimeEntryWithWorkItemString[]) => void;
}

interface ITimeEntryWithWorkItemString extends Omit<ITimeEntryWithWorkItem, 'start_time' | 'end_time'> {
  start_time: string;
  end_time: string;
}

// Main dialog wrapper component that provides the TimeEntryProvider context
export function TimeEntryDialog(props: TimeEntryDialogProps) {
  return (
    <TimeEntryProvider>
      <TimeEntryDialogContent {...props} />
    </TimeEntryProvider>
  );
}

// Main dialog content component
const TimeEntryDialogContent = memo(function TimeEntryDialogContent({
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
}: TimeEntryDialogProps) {
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

  const lastNoteInputRef = useRef<HTMLInputElement>(null);
  const [shouldFocusNotes, setShouldFocusNotes] = useState(false);

  // Initialize entries when dialog opens
  useEffect(() => {
    if (isOpen) {
      initializeEntries({
        existingEntries,
        defaultStartTime,
        defaultEndTime,
        defaultTaxRegion,
        workItem,
        date,
      });
    }
  }, [isOpen, defaultStartTime, defaultEndTime, defaultTaxRegion, date]);

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
      work_item_id: workItem.work_item_id,
      start_time: formatISO(defaultStartTime),
      end_time: formatISO(defaultEndTime),
      billable_duration: duration,
      work_item_type: workItem.type,
      notes: '',
      entry_id: '',
      user_id: '',
      created_at: formatISO(new Date()),
      updated_at: formatISO(new Date()),
      approval_status: 'DRAFT' as TimeSheetStatus,
      service_id: '',
      tax_region: defaultTaxRegion || '',
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
    if (!entry.service_id) {
      alert('Please select a service');
      return;
    }

    const selectedService = services.find(s => s.id === entry.service_id);
    if (selectedService?.is_taxable && !entry.tax_region) {
      alert('Please select a tax region for taxable services');
      return;
    }

    if (!validateTimeEntry(entry)) {
      return;
    }

    try {
      const { isNew, isDirty, tempId, ...entryToSave } = entry;
      await onSave(entryToSave);
      
      if (timeSheetId) {
        const fetchedTimeEntries = await fetchTimeEntriesForTimeSheet(timeSheetId);
        const updatedEntries = fetchedTimeEntries
          .filter(entry => entry.work_item_id === workItem.work_item_id)
          .map(entry => ({
            ...entry,
            start_time: typeof entry.start_time === 'string' ? entry.start_time : formatISO(entry.start_time),
            end_time: typeof entry.end_time === 'string' ? entry.end_time : formatISO(entry.end_time),
          }));

        if (onTimeEntriesUpdate) {
          onTimeEntriesUpdate(updatedEntries);
        }
      }

      setEditingIndex(null);
    } catch (error) {
      console.error('Error saving time entry:', error);
      alert('Failed to save time entry. Please try again.');
    }
  }, [isEditable, timeSheetId, entries, services, workItem, onSave, onTimeEntriesUpdate, setEditingIndex]);

  const handleDeleteEntry = useCallback(async (index: number) => {
    const entry = entries[index];
    if (!entry.entry_id || window.confirm('Are you sure you want to delete this time entry?')) {
      try {
        if (entry.entry_id) {
          await deleteTimeEntry(entry.entry_id);
        }
        
        const newEntries = [...entries];
        newEntries.splice(index, 1);
        updateEntry(index, newEntries[index]);
        setEditingIndex(null);
        
        if (onTimeEntriesUpdate && timeSheetId) {
          const fetchedTimeEntries = await fetchTimeEntriesForTimeSheet(timeSheetId);
          onTimeEntriesUpdate(fetchedTimeEntries.map(entry => ({
            ...entry,
            start_time: typeof entry.start_time === 'string' ? entry.start_time : formatISO(entry.start_time),
            end_time: typeof entry.end_time === 'string' ? entry.end_time : formatISO(entry.end_time),
          })));
        }
      } catch (error) {
        console.error('Error deleting time entry:', error);
        alert('Failed to delete time entry. Please try again.');
      }
    }
  }, [entries, timeSheetId, updateEntry, setEditingIndex, onTimeEntriesUpdate]);

  const handleClose = useCallback(() => {
    const hasUnsavedChanges = entries.some(entry => entry.isDirty);
    if (hasUnsavedChanges) {
      if (window.confirm('You have unsaved changes. Are you sure you want to close?')) {
        onClose();
      }
    } else {
      onClose();
    }
  }, [entries, onClose]);

  return (
    <Dialog isOpen={isOpen} onClose={handleClose} title={`Edit Time Entries for ${workItem.name}`}>
      <DialogContent className="w-full max-w-4xl">
        <ReflectionContainer id={id} label="Time Entry Dialog">
          {isLoading && existingEntries?.length ? (
            <TimeEntrySkeletons />
          ) : (
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
              onCollapse={() => setEditingIndex(null)}
              onUpdateEntry={updateEntry}
              onUpdateTimeInputs={updateTimeInputs}
              onAddEntry={handleAddEntry}
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
      </DialogContent>
    </Dialog>
  );
});

export default TimeEntryDialog;
