'use client'

import { useState, useEffect, useRef } from 'react';
import { Pencil, Trash2, MinusCircle, XCircle, Plus } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { TaxRegion } from '@/types/types.d';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { deleteTimeEntry, fetchTimeEntriesForTimeSheet } from '@/lib/actions/timeEntryActions';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import CustomSelect, { SelectOption } from '@/components/ui/CustomSelect';
import { ITimeEntry, ITimeEntryWithWorkItem, ITimePeriod } from '@/interfaces/timeEntry.interfaces';

interface ITimeEntryWithNew extends Omit<ITimeEntry, 'tenant'> {
  isNew?: boolean;
  isDirty?: boolean;
  tempId?: string;
}
import { IWorkItem } from '@/interfaces/workItem.interfaces';
import { BsClock } from 'react-icons/bs';
import { fetchCompanyTaxRateForWorkItem, fetchServicesForTimeEntry, fetchTaxRegions } from '@/lib/actions/timeEntryActions';
import { formatISO, parseISO, setHours, setMinutes, addMinutes } from 'date-fns';
import { Switch } from '../ui/Switch';

// Update ITimeEntryWithWorkItem interface to use string types for dates
interface ITimeEntryWithWorkItemString extends Omit<ITimeEntryWithWorkItem, 'start_time' | 'end_time'> {
  start_time: string;
  end_time: string;
}

interface TimeEntryDialogProps {
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

interface Service {
  id: string;
  name: string;
  type: string;
  is_taxable: boolean;
}

export function TimeEntryDialog({
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
  const [entries, setEntries] = useState<(ITimeEntryWithNew & { tempId?: string })[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const lastNoteInputRef = useRef<HTMLInputElement>(null);
  const [totalDurations, setTotalDurations] = useState<number[]>([]);
  const [taxRegions, setTaxRegions] = useState<TaxRegion[]>([]);
  const [timeInputs, setTimeInputs] = useState<{ [key: string]: string }>({});
  const [shouldFocusNotes, setShouldFocusNotes] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [fetchedServices, fetchedTaxRegions] = await Promise.all([
          fetchServicesForTimeEntry(),
          fetchTaxRegions()
        ]);
        setServices(fetchedServices);
        setTaxRegions(fetchedTaxRegions);
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    if (isOpen) {
      loadData();
    }
  }, [isOpen]); // Only reload when dialog opens

  useEffect(() => {
    const initializeEntries = async () => {
      let defaultTaxRegionFromCompany: string | undefined;
      
      // Fetch company tax rate if this is a ticket
      if (workItem.type === 'ticket' || workItem.type === 'project_task') {
        try {
          defaultTaxRegionFromCompany = await fetchCompanyTaxRateForWorkItem(workItem.work_item_id, workItem.type);
        } catch (error) {
          console.error('Error fetching company tax rate:', error);
        }
      }

      let newEntries: Omit<ITimeEntry, 'tenant'>[] = [];

      if (existingEntries && existingEntries.length > 0) {
        newEntries = existingEntries.map(({ tenant: _tenant, ...rest }): Omit<ITimeEntry, 'tenant'> => {
          // If entry has no tax region but we have a default, use it
          const taxRegion = rest.tax_region || defaultTaxRegion || defaultTaxRegionFromCompany;
          return {
            ...rest,
            start_time: formatISO(parseISO(rest.start_time)),
            end_time: formatISO(parseISO(rest.end_time)),
            created_at: formatISO(parseISO(rest.created_at)),
            updated_at: formatISO(parseISO(rest.updated_at)),
            tax_region: taxRegion
          };
        });
      } else if (defaultStartTime && defaultEndTime) {
        const duration = calculateDuration(defaultStartTime, defaultEndTime);
        const newEntry: ITimeEntryWithNew = {
          work_item_id: workItem.work_item_id,
          start_time: formatISO(defaultStartTime),
          end_time: formatISO(defaultEndTime),
          billable_duration: duration, // Set initial billable duration equal to total duration
          work_item_type: workItem.type,
          notes: '',
          entry_id: '',
          user_id: '',
          created_at: formatISO(new Date()),
          updated_at: formatISO(new Date()),
          approval_status: 'DRAFT',
          service_id: '',
          tax_region: defaultTaxRegion || defaultTaxRegionFromCompany || '',
          isNew: true,
          tempId: crypto.randomUUID()
        };
        newEntries.push(newEntry);
      }

      if (newEntries.length === 0) {
        const defaultStartTime = new Date(date);
        defaultStartTime.setHours(8, 0, 0, 0);
        const defaultEndTime = new Date(defaultStartTime);
        defaultEndTime.setHours(9, 0, 0, 0);
        const duration = calculateDuration(defaultStartTime, defaultEndTime);

        const emptyEntry: ITimeEntryWithNew = {
          work_item_id: workItem.work_item_id,
          start_time: formatISO(defaultStartTime),
          end_time: formatISO(defaultEndTime),
          billable_duration: duration, // Set initial billable duration equal to total duration
          work_item_type: workItem.type,
          notes: '',
          entry_id: '',
          user_id: '',
          created_at: formatISO(new Date()),
          updated_at: formatISO(new Date()),
          approval_status: 'DRAFT',
          service_id: '',
          tax_region: defaultTaxRegion || '',
          isNew: true,
          tempId: crypto.randomUUID()
        };
        newEntries.push(emptyEntry);
      }

      // Sort entries by start time
      const sortedEntries = [...newEntries].sort((a, b): number => 
        parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime()
      );
      console.log('Initializing entries:', { sortedEntries });
      setEntries(sortedEntries);
      
      
      // Only show edit UI if this is a new entry with no existing entries
      if (newEntries.length === 1 && !existingEntries?.length) {
        setEditingIndex(0);
      } else {
        setEditingIndex(null);
      }
    };

    initializeEntries();
  }, [existingEntries, defaultStartTime, defaultEndTime, workItem, date, defaultTaxRegion]);

  useEffect(() => {
    if (isOpen && lastNoteInputRef.current && shouldFocusNotes) {
      lastNoteInputRef.current.focus();
      setShouldFocusNotes(false);
    }
  }, [isOpen, entries, shouldFocusNotes]);

  useEffect(() => {
    const newTotalDurations = entries.map((entry): number =>
      calculateDuration(parseISO(entry.start_time), parseISO(entry.end_time))
    );
    // Only update if durations actually changed
    if (JSON.stringify(newTotalDurations) !== JSON.stringify(totalDurations)) {
      setTotalDurations(newTotalDurations);
    }
  }, [entries, totalDurations]);

  const handleAddEntry = () => {
    if (isEditable) {
      // Get default start time based on last entry's end time or 8am
      let defaultStartTime = new Date(date);
      if (entries.length > 0) {
        // Use the end time of the last entry
        const lastEntry = entries[entries.length - 1];
        defaultStartTime = parseISO(lastEntry.end_time);
      } else {
        // For first entry, set to 8am
        defaultStartTime.setHours(8, 0, 0, 0);
      }

      // Set end time to start time + 1 hour by default
      const defaultEndTime = new Date(defaultStartTime);
      defaultEndTime.setHours(defaultEndTime.getHours() + 1);
      const duration = calculateDuration(defaultStartTime, defaultEndTime);

      // Mark this as a new entry by setting a temporary flag
      const newEntry: ITimeEntryWithNew & { tempId?: string } = {
        work_item_id: workItem.work_item_id,
        start_time: formatISO(defaultStartTime),
        end_time: formatISO(defaultEndTime),
        billable_duration: duration, // Set initial billable duration equal to total duration
        work_item_type: workItem.type,
        notes: '',
        entry_id: '',
        user_id: '',
        created_at: formatISO(new Date()),
        updated_at: formatISO(new Date()),
        approval_status: 'DRAFT',
        service_id: '',
        tax_region: defaultTaxRegion || '',
        isNew: true,
        tempId: crypto.randomUUID()
      };

      console.log('Adding new entry:', { newEntry });
      setEntries([...entries, newEntry]);
      setShouldFocusNotes(true);
    }
  };

  const handleSaveEntry = async (index: number) => {
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

    // Calculate duration
    const duration = calculateDuration(parseISO(entry.start_time), parseISO(entry.end_time));
    
    // Prepare entry for saving by removing UI-only properties
    const { isNew, isDirty, tempId, ...entryToSave } = entry;

    console.log('Saving entry:', {
      duration,
      billable_duration: entryToSave.billable_duration,
      entry: entryToSave
    });

    try {
      await onSave(entryToSave);
      
      // After successful save, fetch fresh data if we have a timesheet ID
      const fetchedTimeEntries = timeSheetId ? await fetchTimeEntriesForTimeSheet(timeSheetId) : [];

      // Convert fetched entries to the correct format
      const updatedEntries = fetchedTimeEntries
        .filter((entry): boolean => entry.work_item_id === workItem.work_item_id)
        .map((entry): ITimeEntryWithWorkItemString => ({
          ...entry,
          start_time: typeof entry.start_time === 'string' ? entry.start_time : formatISO(entry.start_time),
          end_time: typeof entry.end_time === 'string' ? entry.end_time : formatISO(entry.end_time)
        }));

      // Update local entries state with fresh data
      const newEntries = updatedEntries.map((entry): ITimeEntryWithNew => ({
        ...entry,
        isDirty: false,
        isNew: false
      }));
      
      // Sort entries by start time before updating state
      const sortedEntries = [...newEntries].sort((a, b) => 
        parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime()
      );

      console.log('Updating state after save:', {
        sortedEntries
      });

      setEntries(sortedEntries);

      // Notify parent of all updated entries
      if (onTimeEntriesUpdate) {
        onTimeEntriesUpdate(fetchedTimeEntries.map((entry): ITimeEntryWithWorkItemString => ({
          ...entry,
          start_time: typeof entry.start_time === 'string' ? entry.start_time : formatISO(entry.start_time),
          end_time: typeof entry.end_time === 'string' ? entry.end_time : formatISO(entry.end_time)
        })));
      }
      
      // Update timeInputs to reflect the saved times
      setTimeInputs(prev => ({
        ...prev,
        [`start-${index}`]: formatTimeForInput(parseISO(entry.start_time)),
        [`end-${index}`]: formatTimeForInput(parseISO(entry.end_time))
      }));
      
      setEditingIndex(null);
    } catch (error) {
      console.error('Error saving time entry:', error);
      alert('Failed to save time entry. Please try again.');
    }
  };

  const handleClose = () => {
    // Check if there are any unsaved changes
    const hasUnsavedChanges = entries.some(entry => entry.isDirty);
    
    if (hasUnsavedChanges) {
      if (window.confirm('You have unsaved changes. Are you sure you want to close?')) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  const handleStartTimeChange = (index: number, newStartTime: Date) => {
    if (isEditable) {
      const newEntries = [...entries];
      newEntries[index].start_time = formatISO(newStartTime);
      const duration = calculateDuration(newStartTime, parseISO(newEntries[index].end_time));

      // Update billable duration if entry is currently billable
      if (newEntries[index].billable_duration > 0) {
        newEntries[index].billable_duration = duration;
      }

      newEntries[index].isDirty = true;
      console.log('Updating start time:', { index, newStartTime, newEntries });
      setEntries(newEntries);
    }
  };

  const handleEndTimeChange = (index: number, newEndTime: Date) => {
    if (isEditable) {
      const newEntries = [...entries];
      newEntries[index].end_time = formatISO(newEndTime);
      const duration = calculateDuration(parseISO(newEntries[index].start_time), newEndTime);

      // Update billable duration if entry is billable
      if (newEntries[index].billable_duration > 0) {
        newEntries[index].billable_duration = duration;
      }

      console.log('Updating end time:', { index, newEndTime, newEntries });
      setEntries(newEntries);
    }
  };

  const handleTaxRegionChange = (index: number, value: string) => {
    if (isEditable) {
      const newEntries = [...entries];
      newEntries[index].tax_region = value;
      console.log('Updating tax region:', { index, value, newEntries });
      setEntries(newEntries);
    }
  };

  const handleServiceChange = async (index: number, value: string) => {
    if (isEditable) {
      const newEntries = [...entries];
      newEntries[index].service_id = value;
      const selectedService = services.find(s => s.id === value);
      
      if (selectedService?.is_taxable) {
        // Try to get default tax region for tickets and project tasks
        if (workItem.type === 'ticket' || workItem.type === 'project_task') {
          try {
            const defaultTaxRegion = await fetchCompanyTaxRateForWorkItem(workItem.work_item_id, workItem.type);
            if (defaultTaxRegion) {
              newEntries[index].tax_region = defaultTaxRegion;
            }
          } catch (error) {
            console.error('Error fetching default tax region:', error);
          }
        }
      } else {
        newEntries[index].tax_region = '';
      }
      console.log('Updating service:', { index, value, newEntries });
      setEntries(newEntries);
    }
  };

  const handleBillableToggle = (index: number, checked: boolean) => {
    if (isEditable) {
      const newEntries = [...entries];
      const entry = newEntries[index];
      const duration = calculateDuration(
        parseISO(entry.start_time),
        parseISO(entry.end_time)
      );
      
      // Set billable_duration based on toggle
      entry.billable_duration = checked ? duration : 0;
      entry.isDirty = true;

      console.log('Updating billable status:', { 
        index, 
        checked, 
        duration,
        billable_duration: entry.billable_duration,
        entry
      });

      setEntries(newEntries);
    }
  };

  const handleDurationChange = (index: number, hours: number, minutes: number) => {
    if (isEditable) {
      const newEntries = [...entries];
      const startTime = parseISO(newEntries[index].start_time);
      const newEndTime = addMinutes(startTime, hours * 60 + minutes);

      newEntries[index].end_time = formatISO(newEndTime);

      // Update billable duration if entry is billable
      if (newEntries[index].billable_duration > 0) {
        newEntries[index].billable_duration = hours * 60 + minutes;
      }

      console.log('Updating duration:', { index, hours, minutes, newEntries });
      setEntries(newEntries);

      // Update time input to match new end time
      setTimeInputs(prev => ({
        ...prev,
        [`end-${index}`]: formatTimeForInput(newEndTime)
      }));
    }
  };

  const selectedEntry = editingIndex !== null ? entries[editingIndex] : null;
  const totalDuration = editingIndex !== null ? totalDurations[editingIndex] || 0 : 0;
  const durationHours = Math.floor(totalDuration / 60);
  const durationMinutes = totalDuration % 60;

  const handleDeleteEntry = async (index: number) => {
    const entry = entries[index];
    // Only show confirmation for existing entries
    if (!entry.entry_id || window.confirm('Are you sure you want to delete this time entry?')) {
      try {
        if (entry.entry_id) {
          // Delete from database if it's an existing entry
          await deleteTimeEntry(entry.entry_id);
        }
        
        // Remove from local state
        const newEntries = [...entries];
        newEntries.splice(index, 1);
        console.log('Removing entry:', { index, entry, newEntries });
        setEntries(newEntries);
        setEditingIndex(null);
        
        if (onTimeEntriesUpdate && timeSheetId) {
          // Fetch fresh data after deletion if we have a timesheet ID
          const fetchedTimeEntries = await fetchTimeEntriesForTimeSheet(timeSheetId);
          onTimeEntriesUpdate(fetchedTimeEntries.map((entry): ITimeEntryWithWorkItemString => ({
            ...entry,
            start_time: typeof entry.start_time === 'string' ? entry.start_time : formatISO(entry.start_time),
            end_time: typeof entry.end_time === 'string' ? entry.end_time : formatISO(entry.end_time)
          })));
        }
      } catch (error) {
        console.error('Error deleting time entry:', error);
        alert('Failed to delete time entry. Please try again.');
      }
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={handleClose} title={`Edit Time Entries for ${workItem.name}`}>
      <DialogContent className="w-full max-w-4xl">
        <div>
          {isLoading && existingEntries?.length ? (
              <div className="space-y-4">
              {[1, 2].map((i: number): JSX.Element => (
                <div key={`skeleton-${i}`} className="border p-4 rounded">
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {entries.map((entry, index): JSX.Element => (
                <div key={entry.entry_id || entry.tempId || `entry-${index}`}>
                  {editingIndex === index ? (
                    <div className="border p-4 rounded">
                      <div className="space-y-6">
                        <div className="flex justify-end items-center">
                          <div className="flex items-center">
                            {entry.isDirty && (
                              <span className="text-yellow-500 text-sm mr-2">Unsaved changes</span>
                            )}
                          </div>
                          <div className="flex space-x-2">
                            {!entry.isNew && (
                              <Button
                                onClick={() => setEditingIndex(null)}
                                variant="ghost"
                                size="sm"
                                className="h-10 w-10"
                                title="Collapse entry"
                              >
                                <MinusCircle className="h-6 w-6" />
                              </Button>
                            )}
                            <Button
                              onClick={() => handleDeleteEntry(index)}
                              variant="ghost"
                              size="sm"
                              className="h-10 w-10 text-red-500 hover:text-red-600"
                              title="Delete entry"
                            >
                              <XCircle className="h-6 w-6" />
                            </Button>
                          </div>
                        </div>
         
                        <div className="border p-4 rounded space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Service <span className="text-red-500">*</span></label>
                    <CustomSelect
                      value={selectedEntry!.service_id || ''}
                      onValueChange={(value) => handleServiceChange(editingIndex!, value)}
                      disabled={!isEditable}
                      className="mt-1 w-full"
                      options={services.map((service): SelectOption => ({
                        value: service.id,
                        label: service.name
                      }))}
                      placeholder="Select a service"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Tax Region {services.find(s => s.id === selectedEntry!.service_id)?.is_taxable && <span className="text-red-500">*</span>}
                    </label>
                    <CustomSelect
                      value={selectedEntry!.tax_region || ''}
                      onValueChange={(value) => handleTaxRegionChange(editingIndex!, value)}
                      disabled={!isEditable || !services.find(s => s.id === selectedEntry!.service_id)?.is_taxable}
                      className="mt-1 w-full"
                      options={taxRegions.map((region): SelectOption => ({
                        value: region.name,
                        label: region.name
                      }))}
                      placeholder="Select a tax region"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Start Time</label>
                    <Input
                      type="time"
                      value={timeInputs[`start-${editingIndex}`] || formatTimeForInput(parseISO(selectedEntry!.start_time))}
                      onChange={(e) => {
                        if (isEditable) {
                          setTimeInputs(prev => ({
                            ...prev,
                            [`start-${editingIndex}`]: e.target.value
                          }));
                        }
                      }}
                      onBlur={(e) => {
                        if (isEditable && e.target.value) {
                          const newStartTime = parseTimeToDate(e.target.value, parseISO(selectedEntry!.start_time));
                          // Don't allow start time after end time
                          if (newStartTime >= parseISO(selectedEntry!.end_time)) {
                            alert('Start time cannot be after end time');
                            // Reset to previous valid value
                            setTimeInputs(prev => ({
                              ...prev,
                              [`start-${editingIndex}`]: formatTimeForInput(parseISO(selectedEntry!.start_time))
                            }));
                            return;
                          }
                          handleStartTimeChange(editingIndex!, newStartTime);
                          setTimeInputs(prev => ({
                            ...prev,
                            [`start-${editingIndex}`]: formatTimeForInput(newStartTime)
                          }));
                        }
                      }}
                      disabled={!isEditable}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">End Time</label>
                    <Input
                      type="time"
                      value={timeInputs[`end-${editingIndex}`] || formatTimeForInput(parseISO(selectedEntry!.end_time))}
                      onChange={(e) => {
                        if (isEditable) {
                          setTimeInputs(prev => ({
                            ...prev,
                            [`end-${editingIndex}`]: e.target.value
                          }));
                        }
                      }}
                      onBlur={(e) => {
                        if (isEditable && e.target.value) {
                          const newEndTime = parseTimeToDate(e.target.value, parseISO(selectedEntry!.end_time));
                          // Don't allow end time before start time
                          if (newEndTime <= parseISO(selectedEntry!.start_time)) {
                            alert('End time cannot be before start time');
                            // Reset to previous valid value
                            setTimeInputs(prev => ({
                              ...prev,
                              [`end-${editingIndex}`]: formatTimeForInput(parseISO(selectedEntry!.end_time))
                            }));
                            return;
                          }
                          handleEndTimeChange(editingIndex!, newEndTime);
                          setTimeInputs(prev => ({
                            ...prev,
                            [`end-${editingIndex}`]: formatTimeForInput(newEndTime)
                          }));
                        }
                      }}
                      disabled={!isEditable}
                      className="mt-1"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">Duration</label>
                    <div className="flex items-center space-x-2">
                      <Input
                        type="number"
                        min="0"
                        value={durationHours}
                        onChange={(e) => {
                          const hours = Math.max(0, parseInt(e.target.value) || 0);
                          handleDurationChange(editingIndex!, hours, durationMinutes);
                        }}
                        placeholder="Hours"
                        disabled={!isEditable}
                        className="w-20"
                      />
                      <span>h</span>
                      <Input
                        type="number"
                        min="0"
                        max="59"
                        value={durationMinutes}
                        onChange={(e) => {
                          const minutes = Math.max(0, Math.min(59, parseInt(e.target.value) || 0));
                          handleDurationChange(editingIndex!, durationHours, minutes);
                        }}
                        placeholder="Minutes"
                        disabled={!isEditable}
                        className="w-20"
                      />
                      <span>m</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-4">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-gray-700">
                        {selectedEntry!.billable_duration > 0 ? 'Billable' : 'Non-billable'}
                      </span>
                      <Switch
                        checked={selectedEntry!.billable_duration > 0}
                        onCheckedChange={(checked) => handleBillableToggle(editingIndex!, checked)}
                        className="data-[state=checked]:bg-primary-500"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Notes</label>
                  <Input
                    value={selectedEntry!.notes}
                    onChange={(e) => {
                      if (isEditable) {
                        const newEntries = [...entries];
                        newEntries[editingIndex!].notes = e.target.value;
                        console.log('Updating notes:', { index: editingIndex, notes: e.target.value, newEntries });
                        setEntries(newEntries);
                      }
                    }}
                    placeholder="Notes"
                    disabled={!isEditable}
                    ref={lastNoteInputRef}
                    className="mt-1 w-full"
                  />
                </div>

                <div className="flex justify-end mt-4">
                  <Button
                    onClick={() => handleSaveEntry(index)}
                    variant="default"
                    size="default"
                    className="w-32"
                  >
                    Save
                  </Button>
                </div>
              </div>                  </div>
                    </div>
                  ) : (
                    <div className="border p-4 rounded hover:bg-gray-50 flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="flex items-center space-x-2">
                          <BsClock className="text-gray-400" />
                          <span>{formatTimeForInput(parseISO(entry.start_time))} - {formatTimeForInput(parseISO(entry.end_time))}</span>
                        </div>
                        <span className="text-gray-600">|</span>
                        <span>{services.find(s => s.id === entry.service_id)?.name || 'No service selected'}</span>
                        {entry.notes && (
                          <>
                            <span className="text-gray-600">|</span>
                            <span className="text-gray-600 truncate max-w-[200px]">{entry.notes}</span>
                          </>
                        )}
                      </div>
                      {isEditable && (
                        <div className="flex space-x-2">
                          <Button
                            onClick={() => setEditingIndex(index)}
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            onClick={() => handleDeleteEntry(index)}
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              
              {isEditable && (
                <Button 
                  onClick={() => {
                    handleAddEntry();
                    setEditingIndex(entries.length);
                  }}
                  variant="outline"
                  className="w-full flex items-center justify-center gap-2"
                  disabled={editingIndex !== null && entries[editingIndex]?.isNew}
                >
                  <Plus className="h-4 w-4" />
                  Add Entry
                </Button>
              )}
            </div>
          )}

          <DialogFooter>
            <Button onClick={handleClose} variant="outline">
              Close
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Helper functions
function formatTimeForInput(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function parseTimeToDate(timeString: string, baseDate: Date): Date {
  const [hours, minutes] = timeString.split(':').map((str): number => parseInt(str, 10));
  const newDate = new Date(baseDate);
  return setMinutes(setHours(newDate, hours || 0), minutes || 0);
}

function calculateDuration(startTime: Date, endTime: Date): number {
  return Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / 60000));
}

function validateTimeEntry(timeEntry: Omit<ITimeEntry, 'tenant'>): boolean {
  if (parseISO(timeEntry.start_time) >= parseISO(timeEntry.end_time)) {
    alert('Start time must be before end time');
    return false;
  }
  const duration = calculateDuration(parseISO(timeEntry.start_time), parseISO(timeEntry.end_time));
  if (timeEntry.billable_duration > duration) {
    alert('Billable duration cannot exceed total duration');
    return false;
  }
  return true;
}
