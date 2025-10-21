'use client';

import React, { useState, useEffect } from 'react';
import { Dialog } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { DatePicker } from 'server/src/components/ui/DatePicker';import { TextArea } from 'server/src/components/ui/TextArea';
import { Switch } from 'server/src/components/ui/Switch';
import { ExternalLink } from 'lucide-react';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
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

const EntryPopupContext = React.createContext<EntryPopupProps | null>(null);

interface EntryPopupProps {
  event: IScheduleEntry | null;
  slot?: {
    start: Date | string;
    end: Date | string;
    assigned_user_ids?: string[];
    defaultAssigneeId?: string;
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
  // New props for multi-user schedule logic
  canModifySchedule: boolean;
  focusedTechnicianId: string | null;
  canAssignOthers: boolean; // Derived from user_schedule:update permission in parent
  viewOnly?: boolean;
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
  error = null,
  // Destructure new props
  canModifySchedule,
  focusedTechnicianId,
  canAssignOthers,
  viewOnly = false
}) => {
  const [entryData, setEntryData] = useState<Omit<IScheduleEntry, 'tenant'>>(() => {
    if (event) {
      return {
        ...event,
        scheduled_start: new Date(event.scheduled_start),
        scheduled_end: new Date(event.scheduled_end),
        assigned_user_ids: event.assigned_user_ids,
        is_private: event.is_private || false,
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
        // Use assigned_user_ids from slot if provided, otherwise default to focused technician or current user
        assigned_user_ids: slot.assigned_user_ids || (focusedTechnicianId ? [focusedTechnicianId] : [currentUserId]),
        is_private: false,
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
        // Default to focused technician if available, otherwise current user
        assigned_user_ids: focusedTechnicianId ? [focusedTechnicianId] : [currentUserId],
        is_private: false,
      };
    }
  });
  const [selectedWorkItem, setSelectedWorkItem] = useState<Omit<IWorkItem, 'tenant'> | null>(null);
  const [recurrencePattern, setRecurrencePattern] = useState<IRecurrencePattern | null>(null);
  const [isEditingWorkItem, setIsEditingWorkItem] = useState(false);
  const [availableWorkItems, setAvailableWorkItems] = useState<IWorkItem[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

    // Determine mode and permissions
    const isEditing = !!event;
    const isCurrentUserSoleAssignee = isEditing && event.assigned_user_ids?.length === 1 && event.assigned_user_ids[0] === currentUserId;
    const isPrivateEvent = isEditing && event.is_private;
    
    const canEditFields = viewOnly ? false : (
      !isEditing ||
      (canModifySchedule && (!isPrivateEvent || isCurrentUserSoleAssignee)) ||
      isCurrentUserSoleAssignee
    );
    
    // User can modify assignment if they have the specific permission (passed as canAssignOthers)
    // AND the entry is not private OR they are the creator
    const canModifyAssignment = viewOnly ? false : (
      canAssignOthers && (!isPrivateEvent || isCurrentUserSoleAssignee)
    );
    
    // Add a message to display when a user can't edit a private event
    const privateEventMessage = isPrivateEvent && !isCurrentUserSoleAssignee ?
      "This is a private entry. Only the creator can view or edit details." : null;
  
    // Fetch available work items when dialog opens
  useEffect(() => {
    if (isEditingWorkItem) {
      const fetchWorkItems = async () => {
        try {
          // For existing work items, fetch them
          if (selectedWorkItem && selectedWorkItem.work_item_id && selectedWorkItem.type && selectedWorkItem.type !== 'ad_hoc') {
            const items = await getWorkItemById(selectedWorkItem.work_item_id, selectedWorkItem.type);
            if (items) {
              setAvailableWorkItems([items]);
            } else {
              setAvailableWorkItems([]);
            }
          } else if (entryData.work_item_id && entryData.work_item_type && entryData.work_item_type !== 'ad_hoc') {
            const items = await getWorkItemById(entryData.work_item_id, entryData.work_item_type);
            if (items) {
              setAvailableWorkItems([items]);
            } else {
              setAvailableWorkItems([]);
            }
          } else {
            // For ad-hoc or no work item, clear the list
            setAvailableWorkItems([]);
          }
        } catch (error) {
          console.error('Error fetching work items:', error);
          setAvailableWorkItems([]);
          // Don't set validation errors here as it interrupts the user flow
        }
      };

      fetchWorkItems();
    } else {
      // Clear available work items when not editing to prevent stale data
      setAvailableWorkItems([]);
    }
  }, [isEditingWorkItem, selectedWorkItem, entryData.work_item_id, entryData.work_item_type]);

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
          assigned_user_ids: slot.assigned_user_ids || (focusedTechnicianId ? [focusedTechnicianId] : [currentUserId]),
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

   // US Federal Holidays for the next year (can be tied to client location later to apply holidays from different countries)
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
    clearErrorIfSubmitted();
    setEntryData((prev) => ({
      ...prev,
      [name]: name === 'scheduled_start' || name === 'scheduled_end' ? new Date(value) : value,
    }));
  };

  const handleWorkItemSelect = (workItem: IWorkItem | null) => {
    clearErrorIfSubmitted();
    setSelectedWorkItem(workItem);
    setEntryData(prev => ({
      ...prev,
      work_item_id: workItem ? workItem.work_item_id : null,
      title: workItem ? workItem.name : prev.title,
      work_item_type: workItem?.type || 'ad_hoc'
    }));
    // Clear available work items to prevent stale data
    setAvailableWorkItems([]);
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
    clearErrorIfSubmitted();
    setEntryData(prev => {
      // If the selected user is not the current user, set is_private to false
      const isPrivate = userIds.length === 1 && userIds[0] === currentUserId ? prev.is_private : false;
      
      return {
        ...prev,
        assigned_user_ids: userIds,
        is_private: isPrivate
      };
    });
  };

  const [showRecurrenceDialog, setShowRecurrenceDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [pendingUpdateData, setPendingUpdateData] = useState<Omit<IScheduleEntry, 'tenant'>>();

  const handleDeleteConfirm = (selected?: string) => {
    if (event && onDelete) {
      const deleteType = event.is_recurring ? (selected as IEditScope) : undefined;
      onDelete(event.entry_id, deleteType);
    }
    setShowDeleteDialog(false);
    onClose();
  };

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const handleSave = () => {
    if (!canEditFields && isEditing) return;
    
    setHasAttemptedSubmit(true);
    const errors: string[] = [];
    
    // Validate required fields
    if (!entryData.title?.trim() && entryData.work_item_type === 'ad_hoc') {
      errors.push('Title is required for ad-hoc entries');
    }
    if (!entryData.scheduled_start) {
      errors.push('Start date/time');
    }
    if (!entryData.scheduled_end) {
      errors.push('End date/time');
    }
    if (!entryData.assigned_user_ids || entryData.assigned_user_ids.length === 0) {
      errors.push('At least one assigned user');
    }
    
    // Validate dates
    const startDate = new Date(entryData.scheduled_start);
    const endDate = new Date(entryData.scheduled_end);

    if (isNaN(startDate.getTime())) {
      errors.push('Start date is invalid');
    }

    if (isNaN(endDate.getTime())) {
      errors.push('End date is invalid');
    }

    if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && endDate <= startDate) {
      errors.push('End date must be after start date');
    }
    
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    setValidationErrors([]);

    // Validate recurrence pattern dates if present
    if (recurrencePattern) {
      // Validate interval
      if (!Number.isInteger(recurrencePattern.interval) || recurrencePattern.interval < 1) {
        errors.push('Recurrence interval must be a positive whole number');
      }

      // Validate count if specified
      if (recurrencePattern.count !== undefined) {
        if (!Number.isInteger(recurrencePattern.count) || recurrencePattern.count < 1) {
          errors.push('Number of occurrences must be a positive whole number');
        }
      }

      // Validate end date if specified
      if (recurrencePattern.endDate) {
        const patternEndDate = new Date(recurrencePattern.endDate);
        if (isNaN(patternEndDate.getTime())) {
          errors.push('Recurrence end date is invalid');
        } else if (patternEndDate <= startDate) {
          errors.push('Recurrence end date must be after start date');
        }
      }
    }
    
    // Check if we have any recurrence errors
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
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

  // Create the content of the form
  const content = (
    <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className={`bg-white p-4 rounded-lg h-auto flex flex-col transition-all duration-300 overflow-y-auto z-10
    ${isInDrawer ? 
      'w-fit max-w-[90vw] shadow-none' : 
      'max-w-[95vw] w-auto min-w-[300px] max-h-[90vh] shadow-none'
      }`} noValidate
    >
      <div className="shrink-0 pb-4 border-b flex justify-between items-center">
        {isInDrawer && (
          <h2 className="text-xl font-bold">
            {viewOnly ? 'View Entry' : (event ? 'Edit Entry' : 'New Entry')}
          </h2>
        )}
        <div className={`flex gap-2 ${!isInDrawer ? 'ml-auto' : ''}`}>
          {event && event.work_item_type && (event.work_item_type === 'ticket' || event.work_item_type === 'project_task' || event.work_item_type === 'interaction') && event.work_item_id && (
            <OpenDrawerButton event={event} />
          )}
          {/* Only show delete button if not a private event or user is creator */}
          {event && onDelete && !viewOnly && (!event.is_private || isCurrentUserSoleAssignee) && (
            <Button
              id="delete-entry-btn"
              onClick={() => setShowDeleteDialog(true)}
              type="button"
              variant="destructive"
              size="sm"
            >
              Delete Entry
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto space-y-4 p-1">
        {hasAttemptedSubmit && validationErrors.length > 0 && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              <p className="font-medium mb-2">Please fill in the required fields:</p>
              <ul className="list-disc list-inside space-y-1">
                {validationErrors.map((err, index) => (
                  <li key={index}>{err}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {/* Display message for private events */}
        {privateEventMessage && (
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-yellow-700">
                  {privateEventMessage}
                </p>
              </div>
            </div>
          </div>
        )}
        <div className="min-w-0">
          <div className="relative">
            {viewOnly ? (
              <div className="flex justify-between items-center p-2">
                {selectedWorkItem ? (
                  <div>
                    <div className="font-medium">{selectedWorkItem.name}</div>
                    <div className="text-sm text-gray-500 capitalize">{selectedWorkItem.type.replace('_', ' ')}</div>
                  </div>
                ) : (
                  <span className="font-bold text-black">Ad-hoc entry (no work item)</span>
                )}
              </div>
            ) : (
              <SelectedWorkItem
                workItem={selectedWorkItem}
                onEdit={(e?: React.MouseEvent) => {
                  if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                  setIsEditingWorkItem(true);
                }}
              />
            )}
            {isEditingWorkItem && (
              <AddWorkItemDialog
                isOpen={isEditingWorkItem}
                onClose={() => {
                  setIsEditingWorkItem(false);
                  setAvailableWorkItems([]);
                }}
                onAdd={(workItem) => {
                  handleWorkItemSelect(workItem);
                }}
                availableWorkItems={availableWorkItems}
              />
            )}
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
              className=""
              disabled={!canEditFields} // Disable based on permissions
            />
          </div>
          <div className="flex gap-4 items-start">
            {canAssignMultipleAgents && (
              <div className="flex-1">
                <label htmlFor="assigned_users" className="block text-sm font-medium text-gray-700 mb-1">
                  Assigned Users *
                </label>
                <UserPicker
                  value={entryData.assigned_user_ids?.[0] || currentUserId}
                  onValueChange={(userId) => handleAssignedUsersChange([userId])}
                  users={users}
                  // Disable if loading OR if user lacks permission to assign others
                  disabled={loading || !canModifyAssignment}
                />
              </div>
            )}
            {/* Only show private switch if the selected user is the current user */}
            {entryData.assigned_user_ids?.length === 1 && entryData.assigned_user_ids[0] === currentUserId && (
              <div className="flex-1 flex items-end">
                <Switch
                  id="is-private"
                  checked={entryData.is_private || false}
                  onCheckedChange={(checked) => {
                    setEntryData(prev => ({
                      ...prev,
                      is_private: checked
                    }));
                  }}
                  label="Private entry (not visible to other users)"
                  disabled={!canEditFields}
                />
              </div>
            )}
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">Start *</label>
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
                disabled={!canEditFields} // Disable based on permissions
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">End *</label>
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
                disabled={!canEditFields} // Disable based on permissions
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
              className=""
              disabled={!canEditFields} // Disable based on permissions
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
              disabled={!canEditFields} // Disable based on permissions
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
                    if (value < 1 || value > 100) {
                      // Don't update if out of range
                      return;
                    }
                    setRecurrencePattern(prev => {
                      if (prev === null) return null;
                      return { ...prev, interval: value };
                    });
                  }}
                  min={1}
                  max={100}
                  className=""
                  disabled={!canEditFields} // Disable based on permissions
                />
              </div>
              <div className="flex-1">
                <CustomSelect
                  label="End"
                  value={recurrencePattern.endDate ? 'date' : recurrencePattern.count ? 'count' : 'never'}
                  onValueChange={handleEndTypeChange}
                  options={endTypeOptions}
                  disabled={!canEditFields} // Disable based on permissions
                />
              </div>
            </div>
            {recurrencePattern.endDate && (
              <div>
                <label htmlFor="endDate" className="block text-sm font-medium text-gray-700">
                  End Date
                </label>
                <Input
                  type="date"
                  id="endDate"
                  value={recurrencePattern.endDate ? format(recurrencePattern.endDate, 'yyyy-MM-dd') : ''}
                  onChange={(e) => setRecurrencePattern(prev => {
                    if (prev === null) return null;
                    return { ...prev, endDate: new Date(e.target.value) };
                  })}
                  className=""
                  disabled={!canEditFields} // Disable based on permissions
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
                    if (value < 1 || value > 100) {
                      // Don't update if out of range
                      return;
                    }
                    setRecurrencePattern(prev => {
                      if (prev === null) return null;
                      return { ...prev, count: value };
                    });
                  }}
                  min={1}
                  max={100}
                  className=""
                  disabled={!canEditFields} // Disable based on permissions
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
                  disabled={!canEditFields} // Disable based on permissions
                />
              </div>
            )}
          </div>
        )}
      <div className="mt-6 flex justify-end space-x-3">
        {/* Only show Cancel/Close button if not in a drawer, since the drawer will have its own close button */}
        {!isInDrawer && (
          <Button id="cancel-entry-btn" onClick={onClose} variant="outline">
            Cancel
          </Button>
        )}
        {viewOnly ? (
          <Button
            id="close-entry-btn"
            onClick={onClose}
          >
            Close
          </Button>
        ) : (
          <Button
            id="save-entry-btn"
            type="submit"
            className={`${
              (entryData.work_item_type === 'ad_hoc' && !entryData.title?.trim()) || 
              !entryData.scheduled_start || 
              !entryData.scheduled_end || 
              entryData.assigned_user_ids.length === 0 
                ? 'opacity-50' : ''
            }`}
            // Disable save only if editing AND user lacks permission to edit these fields
            disabled={isEditing && !canEditFields}
          >
            Save
          </Button>
        )}
      </div>
    </form>
  );

  // Provide the context value to child components
  const contextValue: EntryPopupProps = {
    event,
    slot,
    onClose,
    onSave,
    onDelete,
    canAssignMultipleAgents,
    users,
    currentUserId,
    loading,
    isInDrawer,
    error,
    canModifySchedule,
    focusedTechnicianId,
    canAssignOthers,
    viewOnly
  };

  // When already in a drawer or dialog context, don't wrap in another Dialog
  const shouldWrapInDialog = !isInDrawer;

  if (!shouldWrapInDialog) {
    return (
      <EntryPopupContext.Provider value={contextValue}>
        {content}
      </EntryPopupContext.Provider>
    );
  }

  return (
    <Dialog
      isOpen={true}
      onClose={onClose}
      hideCloseButton={false}
      title={viewOnly ? 'View Entry' : (event ? 'Edit Entry' : 'New Entry')}
    >
      <EntryPopupContext.Provider value={contextValue}>
        {content}
      </EntryPopupContext.Provider>
      
      <ConfirmationDialog
        className="max-w-[450px]"
        isOpen={showDeleteDialog}
        onConfirm={handleDeleteConfirm}
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
  // Get access to the parent component's props
  const parentProps = React.useContext(EntryPopupContext);

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

    // Close the current popup first if not in a drawer
    if (parentProps && !parentProps.isInDrawer) {
      parentProps.onClose();
    }
    
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
