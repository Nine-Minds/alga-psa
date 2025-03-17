'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@radix-ui/react-dialog';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Switch } from 'server/src/components/ui/Switch';
import { ExternalLink } from 'lucide-react';
import { useDrawer } from "server/src/context/DrawerContext";
import { WorkItemDrawer } from 'server/src/components/time-management/time-entry/time-sheet/WorkItemDrawer';
import { format, isWeekend, addYears } from 'date-fns';
import { IScheduleEntry, IRecurrencePattern, IEditScope } from 'server/src/interfaces/schedule.interfaces';
import { AddWorkItemDialog } from 'server/src/components/time-management/time-entry/time-sheet/AddWorkItemDialog';
import { IWorkItem, IExtendedWorkItem } from 'server/src/interfaces/workItem.interfaces';
import { getWorkItemById } from 'server/src/lib/actions/workItemActions';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import SelectedWorkItem from 'server/src/components/time-management/time-entry/time-sheet/SelectedWorkItem';
import UserPicker from 'server/src/components/ui/UserPicker';
import { DateTimePicker } from 'server/src/components/ui/DateTimePicker';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';

interface EntryPopupProps {
  event: IScheduleEntry | null;
  slot?: {
    start: Date | string;
    end: Date | string;
  };
  onClose: () => void;
  onSave: (entryData: Omit<IScheduleEntry, 'tenant'> & { updateType?: string }) => void;
  onDelete?: (entryId: string, deleteType?: IEditScope) => void;
  canAssignMultipleAgents: boolean;
  users: IUserWithRoles[];
  currentUserId: string;
  loading?: boolean;
  isInDrawer?: boolean;
  error?: string | null;
}

const EntryPopup: React.FC<EntryPopupProps> = ({ 
  event, 
  slot, 
  onClose, 
  onSave,
  onDelete,
  canAssignMultipleAgents,
  users,
  currentUserId,
  loading = false,
  isInDrawer = false,
  error = null
}) => {
  const [entryData, setEntryData] = useState<Omit<IScheduleEntry, 'tenant'>>(() => {
    if (event) {
      return {
        ...event,
        scheduled_start: new Date(event.scheduled_start),
        scheduled_end: new Date(event.scheduled_end),
        assigned_user_ids: event.assigned_user_ids,
      };
    } else if (slot) {
      return {
        entry_id: '',
        title: '',
        scheduled_start: new Date(slot.start),
        scheduled_end: new Date(slot.end),
        notes: '',
        created_at: new Date(),
        updated_at: new Date(),
        work_item_id: null,
        status: 'scheduled',
        work_item_type: 'ad_hoc',
        assigned_user_ids: [currentUserId],
      };
    } else {
      return {
        entry_id: '',
        title: '',
        scheduled_start: new Date(),
        scheduled_end: new Date(),
        notes: '',
        created_at: new Date(),
        updated_at: new Date(),
        work_item_id: null,
        status: 'scheduled',
        work_item_type: 'ad_hoc',
        assigned_user_ids: [currentUserId],
      };
    }
  });
  const [selectedWorkItem, setSelectedWorkItem] = useState<Omit<IWorkItem, 'tenant'> | null>(null);
  const [recurrencePattern, setRecurrencePattern] = useState<IRecurrencePattern | null>(null);
  const [isEditingWorkItem, setIsEditingWorkItem] = useState(false);
  const [availableWorkItems, setAvailableWorkItems] = useState<IWorkItem[]>([]);

  // Fetch available work items when dialog opens
  useEffect(() => {
    if (isEditingWorkItem) {
      const fetchWorkItems = async () => {
        try {
          if (!entryData.work_item_id || !entryData.work_item_type) {
            setAvailableWorkItems([]);
            return;
          }

          // Get work items for the current time period
          const items = await getWorkItemById(entryData.work_item_id, entryData.work_item_type);
          if (items) {
            setAvailableWorkItems([items]);
          } else {
            setAvailableWorkItems([]);
            alert('No work items found for the selected period');
          }
        } catch (error) {
          console.error('Error fetching work items:', error);
          setAvailableWorkItems([]);
          alert('Failed to fetch work items. Please try again.');
        }
      };

      fetchWorkItems();
    }
  }, [isEditingWorkItem, entryData.work_item_id, entryData.work_item_type]);

  useEffect(() => {
    const initializeData = () => {
      if (event) {
        setEntryData({
          ...event,
          scheduled_start: new Date(event.scheduled_start),
          scheduled_end: new Date(event.scheduled_end),
          assigned_user_ids: event.assigned_user_ids,
          work_item_id: event.work_item_id,
        });

        // Load recurrence pattern if it exists
        if (event.recurrence_pattern) {
          setRecurrencePattern({
            ...event.recurrence_pattern,
            startDate: new Date(event.recurrence_pattern.startDate),
            endDate: event.recurrence_pattern.endDate ? new Date(event.recurrence_pattern.endDate) : undefined,
          });
        }

        // Fetch work item information if editing an existing entry
        if (event.work_item_id && event.work_item_type !== 'ad_hoc') {
          getWorkItemById(event.work_item_id, event.work_item_type).then((workItem) => {
            if (workItem) {
              setSelectedWorkItem(workItem);
            }
          });
        }
      } else if (slot) {
        setEntryData({
          entry_id: '',
          title: '',
          scheduled_start: new Date(slot.start),
          scheduled_end: new Date(slot.end),
          notes: '',
          created_at: new Date(),
          updated_at: new Date(),
          work_item_id: null,
          status: 'scheduled',
          work_item_type: 'ad_hoc',
          assigned_user_ids: [currentUserId],
        });
      }
    };

    initializeData();
  }, [event, slot]);

  const recurrenceOptions = [
    { value: 'none', label: 'None' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'yearly', label: 'Yearly' }
  ];

  const endTypeOptions = [
    { value: 'never', label: 'Never' },
    { value: 'date', label: 'On Date' },
    { value: 'count', label: 'After' }
  ];

   // US Federal Holidays for the next year (can be tied to company location later to apply holidays from different countries)
   const getHolidays = (startDate: Date): Date[] => {
    const year = startDate.getFullYear();
    const nextYear = addYears(startDate, 1);
    
    return [
      // New Year's Day
      new Date(year, 0, 1),
      new Date(nextYear.getFullYear(), 0, 1),
      // Memorial Day (last Monday in May)
      new Date(year, 4, 31 - new Date(year, 4, 31).getDay()),
      // Independence Day
      new Date(year, 6, 4),
      // Labor Day (first Monday in September)
      new Date(year, 8, 1 + (8 - new Date(year, 8, 1).getDay()) % 7),
      // Thanksgiving (fourth Thursday in November)
      new Date(year, 10, 1 + (11 - new Date(year, 10, 1).getDay()) % 7 + 21),
      // Christmas
      new Date(year, 11, 25)
    ];
  };

  const handleRecurrenceChange = (value: string) => {
    if (value === 'none') {
      setRecurrencePattern(null);
    } else {
      const isDaily = value === 'daily';
      setRecurrencePattern(prev => ({
        frequency: value as IRecurrencePattern['frequency'],
        interval: 1,
        startDate: entryData.scheduled_start,
        endDate: undefined,
        count: undefined,
        workdaysOnly: isDaily ? true : undefined,
        // If daily and workdays only, add holidays to exceptions
        exceptions: isDaily ? getHolidays(entryData.scheduled_start) : undefined,
        // For daily workday events, set daysOfWeek to Mon-Fri (0-4 since RRule uses 0-based index for weekdays)
        daysOfWeek: isDaily ? [0, 1, 2, 3, 4] : undefined
      }));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setEntryData((prev) => ({
      ...prev,
      [name]: name === 'scheduled_start' || name === 'scheduled_end' ? new Date(value) : value,
    }));
  };

  const handleWorkItemSelect = (workItem: IWorkItem | null) => {
    setSelectedWorkItem(workItem);
    setEntryData(prev => ({
      ...prev,
      work_item_id: workItem ? workItem.work_item_id : null,
      title: workItem ? workItem.name : prev.title,
      work_item_type: workItem?.type || 'ad_hoc'
    }));
    setIsEditingWorkItem(false);
  };

  const handleEndTypeChange = (value: string) => {
    setRecurrencePattern(prev => {
      if (prev === null) return null;
      return {
        ...prev,
        endDate: value === 'date' ? new Date() : undefined,
        count: value === 'count' ? 1 : undefined
      };
    });
  };

  const handleAssignedUsersChange = (userIds: string[]) => {
    setEntryData(prev => ({
      ...prev,
      assigned_user_ids: userIds,
    }));
  };

  const [showRecurrenceDialog, setShowRecurrenceDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [pendingUpdateData, setPendingUpdateData] = useState<Omit<IScheduleEntry, 'tenant'>>();

  const handleSave = () => {
    // Validate required fields and dates
    if (!entryData.title) {
      alert('Title is required');
      return;
    }

    // Validate dates
    const startDate = new Date(entryData.scheduled_start);
    const endDate = new Date(entryData.scheduled_end);

    if (isNaN(startDate.getTime())) {
      alert('Start date is invalid');
      return;
    }

    if (isNaN(endDate.getTime())) {
      alert('End date is invalid');
      return;
    }

    if (endDate <= startDate) {
      alert('End date must be after start date');
      return;
    }

    // Validate recurrence pattern dates if present
    if (recurrencePattern) {
      // Validate interval
      if (!Number.isInteger(recurrencePattern.interval) || recurrencePattern.interval < 1) {
        alert('Recurrence interval must be a positive whole number');
        return;
      }

      // Validate count if specified
      if (recurrencePattern.count !== undefined) {
        if (!Number.isInteger(recurrencePattern.count) || recurrencePattern.count < 1) {
          alert('Number of occurrences must be a positive whole number');
          return;
        }
      }

      // Validate end date if specified
      if (recurrencePattern.endDate) {
        const patternEndDate = new Date(recurrencePattern.endDate);
        if (isNaN(patternEndDate.getTime())) {
          alert('Recurrence end date is invalid');
          return;
        }
        if (patternEndDate <= startDate) {
          alert('Recurrence end date must be after start date');
          return;
        }
      }
    }

    // Prepare entry data
    const savedEntryData = {
      ...entryData,
      recurrence_pattern: recurrencePattern || null,
      work_item_id: entryData.work_item_type === 'ad_hoc' ? null : entryData.work_item_id,
      status: entryData.status || 'scheduled',
      assigned_user_ids: Array.isArray(entryData.assigned_user_ids) ? entryData.assigned_user_ids : []
    };

    // Show recurrence options only for existing recurring events
    if (event?.is_recurring) {
      setPendingUpdateData(savedEntryData);
      setShowRecurrenceDialog(true);
    } else {
      onSave(savedEntryData);
    }
  };

  return (
    <Dialog open={true}>
      <DialogContent className={`bg-white p-4 rounded-lg h-auto flex flex-col transition-all duration-300 overflow-y-auto z-10
      ${isInDrawer ? 
        'w-fit max-w-[90vw] shadow-none' : 
        'fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 max-w-[95vw] w-[600px] min-w-[300px] max-h-[90vh] shadow-lg'
        }`}
      >
       <div className="shrink-0 pb-4 border-b flex justify-between items-center">
        <DialogTitle className="text-xl font-bold">
          {event ? 'Edit Entry' : 'New Entry'}
        </DialogTitle>
        <div className="flex gap-2">
          {event && event.work_item_type && (event.work_item_type === 'ticket' || event.work_item_type === 'project_task') && event.work_item_id && (
            <OpenDrawerButton event={event} />
          )}
          {event && onDelete && (
            <Button
              id="delete-entry-btn"
              onClick={() => setShowDeleteDialog(true)}
              variant="destructive"
              size="sm"
            >
              Delete Entry
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto space-y-4 p-1">
        <div className="min-w-0">
          <div className="relative">
            <SelectedWorkItem
              workItem={selectedWorkItem}
              onEdit={() => setIsEditingWorkItem(true)}
            />
            <AddWorkItemDialog
              isOpen={isEditingWorkItem}
              onClose={() => setIsEditingWorkItem(false)}
              onAdd={(workItem) => {
                handleWorkItemSelect(workItem);
                setIsEditingWorkItem(false);
              }}
              availableWorkItems={availableWorkItems}
            />
          </div>
          </div>
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700">
              Title
            </label>
            <Input
              id="title"
              name="title"
              value={entryData.title}
              onChange={handleInputChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
            />
          </div>
          {canAssignMultipleAgents && (
            <div>
              <label htmlFor="assigned_users" className="block text-sm font-medium text-gray-700 mb-1">
                Assigned Users
              </label>
            <UserPicker
              value={entryData.assigned_user_ids?.[0] || currentUserId}
              onValueChange={(userId) => handleAssignedUsersChange([userId])}
              users={users}
              disabled={loading}
            />
            </div>
          )}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">Start</label>
              <DateTimePicker
                id="scheduled_start"
                value={entryData.scheduled_start}
                onChange={(date) => {
                  setEntryData(prev => ({
                    ...prev,
                    scheduled_start: date
                  }));
                }}
                className="mt-1"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">End</label>
              <DateTimePicker
                id="scheduled_end"
                value={entryData.scheduled_end}
                onChange={(date) => {
                  setEntryData(prev => ({
                    ...prev,
                    scheduled_end: date
                  }));
                }}
                className="mt-1"
                minDate={entryData.scheduled_start}
              />
            </div>
          </div>
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
              Notes
            </label>
            <TextArea
              id="notes"
              name="notes"
              value={entryData.notes}
              onChange={handleInputChange}
              rows={3}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
            />
          </div>
        </div>
        <div className="space-y-4">
          <div className="relative z-10">
            <CustomSelect
              label="Recurrence"
              value={recurrencePattern?.frequency || 'none'}
              onValueChange={handleRecurrenceChange}
              options={recurrenceOptions}
            />
          </div>
        </div>
        {recurrencePattern && (
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1">
                <label htmlFor="interval" className="block text-sm font-medium text-gray-700">
                  Interval
                </label>
                <Input
                  id="interval"
                  type="number"
                  value={recurrencePattern.interval}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    if (value < 1) {
                      alert('Interval must be a positive number');
                      return;
                    }
                    if (value > 100) {
                      alert('Maximum interval is 100');
                      return;
                    }
                    setRecurrencePattern(prev => {
                      if (prev === null) return null;
                      return { ...prev, interval: value };
                    });
                  }}
                  min={1}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
                />
              </div>
              <div className="flex-1">
                <CustomSelect
                  label="End"
                  value={recurrencePattern.endDate ? 'date' : recurrencePattern.count ? 'count' : 'never'}
                  onValueChange={handleEndTypeChange}
                  options={endTypeOptions}
                />
              </div>
            </div>
            {recurrencePattern.endDate && (
              <div>
                <label htmlFor="endDate" className="block text-sm font-medium text-gray-700">
                  End Date
                </label>
                <input
                  type="date"
                  id="endDate"
                  value={format(recurrencePattern.endDate, 'yyyy-MM-dd')}
                  onChange={(e) => setRecurrencePattern(prev => {
                    if (prev === null) return null;
                    return { ...prev, endDate: new Date(e.target.value) };
                  })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
                />
              </div>
            )}
            {recurrencePattern.count && (
              <div>
                <label htmlFor="count" className="block text-sm font-medium text-gray-700">
                  Occurrences
                </label>
                <Input
                  id="count"
                  type="number"
                  value={recurrencePattern.count}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    if (value < 1) {
                      alert('Number of occurrences must be a positive number');
                      return;
                    }
                    if (value > 100) {
                      alert('Maximum number of occurrences is 100');
                      return;
                    }
                    setRecurrencePattern(prev => {
                      if (prev === null) return null;
                      return { ...prev, count: value };
                    });
                  }}
                  min={1}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
                />
              </div>
            )}
            {recurrencePattern.frequency === 'daily' && (
              <div className="flex items-center gap-2">
                <Switch
                  id="workdays-only"
                  checked={recurrencePattern.workdaysOnly ?? true}
                  onCheckedChange={(checked) => setRecurrencePattern(prev => {
                    if (prev === null) return null;
                    return {
                      ...prev,
                      workdaysOnly: checked,
                      // Update daysOfWeek and excludeDates based on the switch
                      daysOfWeek: checked ? [0, 1, 2, 3, 4] : undefined,
                      exceptions: checked ? getHolidays(entryData.scheduled_start) : undefined
                    };
                  })}
                  label="Workdays only (Mon-Fri, excluding holidays)"
                />
              </div>
            )}
          </div>
        )}
      <div className="mt-6 flex justify-end space-x-3">
        <Button id="cancel-entry-btn" onClick={onClose} variant="outline">
          Cancel
        </Button>
        <Button id="save-entry-btn" onClick={handleSave}>Save</Button>
      </div>
      </DialogContent>
      
        <ConfirmationDialog
          className="max-w-[450px]"
          isOpen={showDeleteDialog}
          onConfirm={(value) => {
            if (event && onDelete) {
              onDelete(event.entry_id, event.is_recurring ? value as IEditScope : undefined);
              onClose();
            }
          }}
          onClose={() => setShowDeleteDialog(false)}
          title="Delete Schedule Entry"
          message={event?.is_recurring 
            ? "Select which events to delete:"
            : "Are you sure you want to delete this schedule entry? This action cannot be undone."}
          options={event?.is_recurring ? [
            { value: IEditScope.SINGLE, label: 'Only this event' },
            { value: IEditScope.FUTURE, label: 'This and future events' },
            { value: IEditScope.ALL, label: 'All events' }
          ] : undefined}
          confirmLabel="Delete"
        />

        <ConfirmationDialog
          className="max-w-[450px]"
          isOpen={showRecurrenceDialog}
        onClose={() => setShowRecurrenceDialog(false)}
        onConfirm={async (updateType) => {
          if (pendingUpdateData) {
            onSave({...pendingUpdateData, updateType: updateType as IEditScope});
            setShowRecurrenceDialog(false);
          }
        }}
          title="Apply Changes To"
          message="Select which events to update:"
          options={[
            { value: IEditScope.SINGLE, label: 'Only this event' },
            { value: IEditScope.FUTURE, label: 'This and future events' },
            { value: IEditScope.ALL, label: 'All events' }
          ]}
          id="recurrence-edit-dialog"
        />
    </Dialog>
  );
};

// Component for the Open Drawer button
const OpenDrawerButton = ({ event }: { event: IScheduleEntry }) => {
  const { openDrawer, closeDrawer } = useDrawer();

  const handleOpenDrawer = () => {
    const workItem = {
      work_item_id: event.work_item_id || '',
      type: event.work_item_type,
      name: event.title,
      title: event.title,
      description: event.notes || '',
      startTime: new Date(event.scheduled_start),
      endTime: new Date(event.scheduled_end),
      scheduled_start: new Date(event.scheduled_start).toISOString(),
      scheduled_end: new Date(event.scheduled_end).toISOString(),
      users: event.assigned_user_ids.map(id => ({ user_id: id })),
      tenant: event.tenant,
      is_billable: true
    } as IExtendedWorkItem;

    openDrawer(
      <div className="h-full">
        <WorkItemDrawer
          workItem={workItem}
          onClose={closeDrawer}
          onTaskUpdate={async () => {}}
          onScheduleUpdate={async () => {}}
        />
      </div>
    );
  };

  return (
    <Button
      id="open-drawer-btn"
      onClick={handleOpenDrawer}
      variant="outline"
      size="sm"
      className="flex items-center gap-1"
    >
      <ExternalLink className="w-4 h-4" />
      <span>Details</span>
    </Button>
  );
};

export default EntryPopup;
