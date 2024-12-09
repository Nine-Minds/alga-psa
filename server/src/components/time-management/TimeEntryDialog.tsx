'use client'

import { useState, useEffect, useRef } from 'react';
import { TaxRegion } from '@/types/types.d';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import CustomSelect, { SelectOption } from '@/components/ui/CustomSelect';
import { ITimeEntry, ITimeEntryWithWorkItem, ITimePeriod } from '@/interfaces/timeEntry.interfaces';
import { IWorkItem } from '@/interfaces/workItem.interfaces';
import { BsClock } from 'react-icons/bs';
import { fetchCompanyTaxRateForWorkItem, fetchServicesForTimeEntry, fetchTaxRegions } from '@/lib/actions/timeEntryActions';
import { formatISO, parseISO, setHours, setMinutes, addMinutes } from 'date-fns';
import { Switch } from '../ui/Switch';

interface TimeEntryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (timeEntry: Omit<ITimeEntry, 'tenant'>) => void;
  workItem: Omit<IWorkItem, 'tenant'>;
  date: Date;
  existingEntries?: ITimeEntryWithWorkItem[];
  timePeriod: ITimePeriod;
  isEditable: boolean;
  defaultStartTime?: Date;
  defaultEndTime?: Date;
  defaultTaxRegion?: string;
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
  timePeriod,
  isEditable,
  defaultStartTime,
  defaultEndTime,
  defaultTaxRegion,
}: TimeEntryDialogProps) {
  const [entries, setEntries] = useState<Omit<ITimeEntry, 'tenant'>[]>([]);
  const [selectedEntryIndex, setSelectedEntryIndex] = useState(0);
  const [services, setServices] = useState<Service[]>([]);
  const lastNoteInputRef = useRef<HTMLInputElement>(null);
  const [totalDurations, setTotalDurations] = useState<number[]>([]);
  const [taxRegions, setTaxRegions] = useState<TaxRegion[]>([]);
  const [timeInputs, setTimeInputs] = useState<{ [key: string]: string }>({});
  const [shouldFocusNotes, setShouldFocusNotes] = useState(false);
  const [isBillable, setIsBillable] = useState<boolean[]>([]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [fetchedServices, fetchedTaxRegions] = await Promise.all([
          fetchServicesForTimeEntry(),
          fetchTaxRegions()
        ]);
        setServices(fetchedServices);
        setTaxRegions(fetchedTaxRegions);
      } catch (error) {
        console.error('Error loading data:', error);
      }
    };
    loadData();
  }, []);

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
        newEntries = existingEntries.map(({ tenant, ...rest }): Omit<ITimeEntry, 'tenant'> => {
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
      }

    if (defaultStartTime && defaultEndTime) {
      const newEntry: Omit<ITimeEntry, 'tenant'> = {
        work_item_id: workItem.work_item_id,
        start_time: formatISO(defaultStartTime),
        end_time: formatISO(defaultEndTime),
        billable_duration: calculateDuration(defaultStartTime, defaultEndTime),
        work_item_type: workItem.type,
        notes: '',
        entry_id: '',
        user_id: '',
        created_at: formatISO(new Date()),
        updated_at: formatISO(new Date()),
        approval_status: 'DRAFT',
        service_id: '',
        tax_region: defaultTaxRegion || defaultTaxRegionFromCompany || ''
      };

      newEntries.push(newEntry);
    }

    if (newEntries.length === 0) {
      const emptyEntry: Omit<ITimeEntry, 'tenant'> = {
        work_item_id: workItem.work_item_id,
        start_time: formatISO(new Date(date)),
        end_time: formatISO(new Date(date)),
        billable_duration: 0,
        work_item_type: workItem.type,
        notes: '',
        entry_id: '',
        user_id: '',
        created_at: formatISO(new Date()),
        updated_at: formatISO(new Date()),
        approval_status: 'DRAFT',
        service_id: '',
        tax_region: defaultTaxRegion || ''
      };
      newEntries.push(emptyEntry);
    }

    setEntries(newEntries);
    setIsBillable(newEntries.map((entry): boolean => entry.billable_duration > 0));
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
    setTotalDurations(newTotalDurations);
  }, [entries]);

  const handleAddEntry = () => {
    if (isEditable) {
      const newEntry: Omit<ITimeEntry, 'tenant'> = {
        work_item_id: workItem.work_item_id,
        start_time: formatISO(new Date(date)),
        end_time: formatISO(new Date(date)),
        billable_duration: 0,
        work_item_type: workItem.type,
        notes: '',
        entry_id: '',
        user_id: '',
        created_at: formatISO(new Date()),
        updated_at: formatISO(new Date()),
        approval_status: 'DRAFT',
        service_id: '',
        tax_region: defaultTaxRegion || ''
      };
      setEntries([...entries, newEntry]);
      setIsBillable([...isBillable, false]);
      setSelectedEntryIndex(entries.length);
      setShouldFocusNotes(true);
      setTimeout(() => {
        if (lastNoteInputRef.current) {
          lastNoteInputRef.current.focus();
        }
      }, 0);
    }
  };

  const handleSave = () => {
    if (isEditable) {
      // Filter out empty entries (entries without a service_id)
      const filledEntries = entries.filter(entry => entry.service_id);

      // Validate only the filled entries
      const allFilledEntriesValid = filledEntries.every(entry => {
        const selectedService = services.find(s => s.id === entry.service_id);
        // Only require tax region if the service is taxable
        if (selectedService?.is_taxable && !entry.tax_region) {
          alert('Please select a tax region for taxable services');
          return false;
        }
        return validateTimeEntry(entry);
      });

      if (allFilledEntriesValid) {
        filledEntries.forEach(entry => {
          onSave(entry);
        });
        onClose();
      }
    }
  };

  const handleStartTimeChange = (index: number, newStartTime: Date) => {
    if (isEditable) {
      const newEntries = [...entries];
      newEntries[index].start_time = formatISO(newStartTime);
      const duration = calculateDuration(newStartTime, parseISO(newEntries[index].end_time));

      // Update billable duration if entry is billable
      if (isBillable[index]) {
        newEntries[index].billable_duration = duration;
      }

      setEntries(newEntries);
    }
  };

  const handleEndTimeChange = (index: number, newEndTime: Date) => {
    if (isEditable) {
      const newEntries = [...entries];
      newEntries[index].end_time = formatISO(newEndTime);
      const duration = calculateDuration(parseISO(newEntries[index].start_time), newEndTime);

      // Update billable duration if entry is billable
      if (isBillable[index]) {
        newEntries[index].billable_duration = duration;
      }

      setEntries(newEntries);
    }
  };

  const handleTaxRegionChange = (index: number, value: string) => {
    if (isEditable) {
      const newEntries = [...entries];
      newEntries[index].tax_region = value;
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
      
      setEntries(newEntries);
    }
  };

  const handleBillableToggle = (index: number, checked: boolean) => {
    if (isEditable) {
      const newEntries = [...entries];
      const newIsBillable = [...isBillable];
      newIsBillable[index] = checked;

      // Update billable duration based on toggle
      if (checked) {
        newEntries[index].billable_duration = calculateDuration(
          parseISO(newEntries[index].start_time),
          parseISO(newEntries[index].end_time)
        );
      } else {
        newEntries[index].billable_duration = 0;
      }

      setEntries(newEntries);
      setIsBillable(newIsBillable);
    }
  };

  const handleDurationChange = (index: number, hours: number, minutes: number) => {
    if (isEditable) {
      const newEntries = [...entries];
      const startTime = parseISO(newEntries[index].start_time);
      const newEndTime = addMinutes(startTime, hours * 60 + minutes);

      newEntries[index].end_time = formatISO(newEndTime);

      // Update billable duration if entry is billable
      if (isBillable[index]) {
        newEntries[index].billable_duration = hours * 60 + minutes;
      }

      setEntries(newEntries);

      // Update time input to match new end time
      setTimeInputs(prev => ({
        ...prev,
        [`end-${index}`]: formatTimeForInput(newEndTime)
      }));
    }
  };


  const selectedEntry = entries[selectedEntryIndex];
  const totalDuration = totalDurations[selectedEntryIndex] || 0;
  const durationHours = Math.floor(totalDuration / 60);
  const durationMinutes = totalDuration % 60;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg p-6 w-full max-w-4xl">
          <div className="flex justify-between items-center mb-4">
            <Dialog.Title className="text-lg font-semibold">
              Edit Time Entries for {workItem.name}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="text-gray-400 hover:text-gray-500"
                type="button"
                aria-label="Close"
              >
                ×
              </button>
            </Dialog.Close>
          </div>

          <div className="mb-4">
            <div className="flex items-center space-x-4">
              <CustomSelect
                value={selectedEntryIndex.toString()}
                onValueChange={(value) => setSelectedEntryIndex(parseInt(value))}
                className="w-64"
                options={entries.map((entry, index): SelectOption => ({
                  value: index.toString(),
                  label: `Entry ${index + 1}${entry.service_id ? ` - ${services.find(s => s.id === entry.service_id)?.name || ''}` : ''}`
                }))}
              />
              {isEditable && (
                <Button 
                  onClick={handleAddEntry}
                  variant="default"
                  className='mb-4'
                >
                  Add Entry
                </Button>
              )}
            </div>
          </div>

          {selectedEntry && (
            <div className="space-y-6 my-4">
              <div className="border p-4 rounded space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Service <span className="text-red-500">*</span></label>
                    <CustomSelect
                      value={selectedEntry.service_id || ''}
                      onValueChange={(value) => handleServiceChange(selectedEntryIndex, value)}
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
                      Tax Region {services.find(s => s.id === selectedEntry.service_id)?.is_taxable && <span className="text-red-500">*</span>}
                    </label>
                    <CustomSelect
                      value={selectedEntry.tax_region || ''}
                      onValueChange={(value) => handleTaxRegionChange(selectedEntryIndex, value)}
                      disabled={!isEditable || !services.find(s => s.id === selectedEntry.service_id)?.is_taxable}
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
                      value={timeInputs[`start-${selectedEntryIndex}`] || formatTimeForInput(parseISO(selectedEntry.start_time))}
                      onChange={(e) => {
                        if (isEditable) {
                          setTimeInputs(prev => ({
                            ...prev,
                            [`start-${selectedEntryIndex}`]: e.target.value
                          }));
                        }
                      }}
                      onBlur={(e) => {
                        if (isEditable && e.target.value) {
                          const newStartTime = parseTimeToDate(e.target.value, parseISO(selectedEntry.start_time));
                          handleStartTimeChange(selectedEntryIndex, newStartTime);
                          setTimeInputs(prev => ({
                            ...prev,
                            [`start-${selectedEntryIndex}`]: formatTimeForInput(newStartTime)
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
                      value={timeInputs[`end-${selectedEntryIndex}`] || formatTimeForInput(parseISO(selectedEntry.end_time))}
                      onChange={(e) => {
                        if (isEditable) {
                          setTimeInputs(prev => ({
                            ...prev,
                            [`end-${selectedEntryIndex}`]: e.target.value
                          }));
                        }
                      }}
                      onBlur={(e) => {
                        if (isEditable && e.target.value) {
                          const newEndTime = parseTimeToDate(e.target.value, parseISO(selectedEntry.end_time));
                          handleEndTimeChange(selectedEntryIndex, newEndTime);
                          setTimeInputs(prev => ({
                            ...prev,
                            [`end-${selectedEntryIndex}`]: formatTimeForInput(newEndTime)
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
                          handleDurationChange(selectedEntryIndex, hours, durationMinutes);
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
                          handleDurationChange(selectedEntryIndex, durationHours, minutes);
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
                        {isBillable[selectedEntryIndex] ? 'Billable' : 'Non-billable'}
                      </span>
                      <Switch
                        checked={isBillable[selectedEntryIndex]}
                        onCheckedChange={(checked) => handleBillableToggle(selectedEntryIndex, checked)}
                        className="data-[state=checked]:bg-primary-500"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Notes</label>
                  <Input
                    value={selectedEntry.notes}
                    onChange={(e) => {
                      if (isEditable) {
                        const newEntries = [...entries];
                        newEntries[selectedEntryIndex].notes = e.target.value;
                        setEntries(newEntries);
                      }
                    }}
                    placeholder="Notes"
                    disabled={!isEditable}
                    ref={lastNoteInputRef}
                    className="mt-1 w-full"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-2 mt-6">
            <Button 
              onClick={onClose}
              variant="outline"
            >
              Cancel
            </Button>
            {isEditable && (
              <Button 
                onClick={handleSave}
                variant="default"
              >
                Save All
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
