'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, momentLocalizer, NavigateAction, View } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Button } from '../ui/Button';
import EntryPopup from './EntryPopup';
import { getCurrentUserScheduleEntries, addScheduleEntry, updateScheduleEntry, deleteScheduleEntry } from '../../lib/actions/scheduleActions';
import { IScheduleEntry } from '../../interfaces/schedule.interfaces';
import { produce } from 'immer';
import { Dialog } from '@radix-ui/react-dialog';
import { WorkItemType } from '../../interfaces/workItem.interfaces';
import { useUsers } from '../../hooks/useUsers';
import { getCurrentUser } from '../../lib/actions/user-actions/userActions';
import { IUserWithRoles } from '../../interfaces/auth.interfaces';

const localizer = momentLocalizer(moment);

const DnDCalendar = withDragAndDrop(Calendar);

const ScheduleCalendar: React.FC = () => {
  const [view, setView] = useState<View>("week");
  const [events, setEvents] = useState<IScheduleEntry[]>([]);
  const [showEntryPopup, setShowEntryPopup] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<IScheduleEntry | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(new Date());

  const workItemColors: Record<WorkItemType, string> = {
    ticket: 'rgb(var(--color-primary-100))',
    project_task: 'rgb(var(--color-secondary-100))',
    non_billable_category: 'rgb(var(--color-accent-100))',
    ad_hoc: 'rgb(var(--color-border-200))'
  };

  const workItemHoverColors: Record<WorkItemType, string> = {
    ticket: 'rgb(var(--color-primary-200))',
    project_task: 'rgb(var(--color-secondary-200))',
    non_billable_category: 'rgb(var(--color-accent-200))',
    ad_hoc: 'rgb(var(--color-border-300))'
  };

  const Legend = () => (
    <div className="flex justify-center space-x-4 mb-4 p-2 rounded-lg bg-opacity-50">
      {Object.entries(workItemColors).map(([type, color]):JSX.Element => (
        <div key={type} className="flex items-center">
          <div
            className="w-4 h-4 mr-2 rounded"
            style={{ backgroundColor: color }}
          ></div>
          <span className="capitalize text-sm font-medium text-[rgb(var(--color-text-900))]">
            {type === 'ad_hoc' ? 'Ad-hoc Entry' : type.replace('_', ' ')}
          </span>
        </div>
      ))}
    </div>
  );

  const { users, loading: usersLoading, error: usersError } = useUsers();
  const [currentUserRoles, setCurrentUserRoles] = useState<string[]>([]);

  // Fetch current user's roles on mount
  useEffect(() => {
    async function fetchUserRoles() {
      const user = await getCurrentUser();
      if (user?.roles) {
        setCurrentUserRoles(user.roles.map(role => role.role_name));
      }
    }
    fetchUserRoles();
  }, []);

  // Check if user can assign multiple agents
  const canAssignMultipleAgents = currentUserRoles.some((role: string) => 
    ['admin', 'manager'].includes(role.toLowerCase())
  );

  const fetchEvents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    // Calculate date range based on current view
    let rangeStart, rangeEnd;
    
    if (view === 'month') {
      // For month view, include the entire visible range (which might span multiple months)
      const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      
      // Adjust for days from previous/next month that are visible
      rangeStart = new Date(firstDay);
      rangeStart.setDate(1 - firstDay.getDay()); // Start from the first day of the week
      
      rangeEnd = new Date(lastDay);
      rangeEnd.setDate(lastDay.getDate() + (6 - lastDay.getDay())); // End on the last day of the week
      
      // Set times to include full days
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd.setHours(23, 59, 59, 999);
    } else {
      // For week/day views, use the exact visible range
      rangeStart = new Date(date);
      rangeEnd = new Date(date);
      
      if (view === 'week') {
        rangeStart.setDate(date.getDate() - date.getDay());
        rangeEnd.setDate(rangeStart.getDate() + 6);
      }
      
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd.setHours(23, 59, 59, 999);
    }
    
    console.log('Fetching schedule entries:', { 
      view,
      rangeStart: rangeStart.toISOString(), 
      rangeEnd: rangeEnd.toISOString() 
    });
    
    const result = await getCurrentUserScheduleEntries(rangeStart, rangeEnd);
    if (result.success) {
      console.log('Fetched entries:', {
        count: result.entries.length,
        entries: result.entries.map(e => ({
          id: e.entry_id,
          title: e.title,
          type: e.work_item_type,
          start: e.scheduled_start,
          end: e.scheduled_end
        }))
      });
      setEvents(result.entries);
    } else {
      console.error('Failed to fetch schedule entries:', result.error);
      setError(result.error || 'An unknown error occurred');
    }
    setIsLoading(false);
  }, [date, view]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleSelectSlot = (slotInfo: any) => {
    setSelectedSlot(slotInfo);
    setShowEntryPopup(true);
  };

  const handleSelectEvent = (event: object) => {
    setSelectedEvent(event as IScheduleEntry);
    setShowEntryPopup(true);
  };

  const handleEntryPopupClose = () => {
    setShowEntryPopup(false);
    setSelectedEvent(null);
    setSelectedSlot(null);
  };

  const handleEntryPopupSave = async (entryData: IScheduleEntry) => {
    try {
      console.log('Saving entry:', entryData);
      let updatedEntry;
      if (selectedEvent) {
        // Ensure we're using the correct entry ID and maintaining virtual instance relationship
        const entryToUpdate = {
          ...entryData,
          recurrence_pattern: entryData.recurrence_pattern || null,
          assigned_user_ids: entryData.assigned_user_ids,
          // Only preserve original_entry_id if this is actually a virtual instance
          ...(selectedEvent.entry_id.includes('_') ? { original_entry_id: selectedEvent.original_entry_id } : {})
        };
        
        // Use the virtual instance's ID if it exists, otherwise use the master entry's ID
        const entryId = selectedEvent.entry_id;
        const result = await updateScheduleEntry(entryId, entryToUpdate);
        if (result.success && result.entry) {
          updatedEntry = result.entry;
          console.log('Updated entry:', updatedEntry);
        } else {
          console.error('Failed to update entry:', result.error);
          alert('Failed to update schedule entry: ' + result.error);
          return;
        }
      } else {
        const result = await addScheduleEntry({
          ...entryData,
          recurrence_pattern: entryData.recurrence_pattern || null,
        });
        if (result.success && result.entry) {
          updatedEntry = result.entry;
          console.log('Added new entry:', updatedEntry);
        } else {
          console.error('Failed to add entry:', result.error);
          alert('Failed to add schedule entry: ' + result.error);
          return;
        }
      }

      if (updatedEntry) {
        // Always refresh events to ensure we have the latest data
        await fetchEvents();
      }

      setShowEntryPopup(false);
      setSelectedEvent(null);
    } catch (error) {
      console.error('Error saving schedule entry:', error);
      alert('An error occurred while saving the schedule entry');
    }
  };

  // Pass canAssignMultipleAgents to EntryPopup
  const renderEntryPopup = () => {
    if (!showEntryPopup) return null;
    return (
      <EntryPopup
        event={selectedEvent}
        slot={selectedSlot}
        onClose={handleEntryPopupClose}
        onSave={handleEntryPopupSave}
        canAssignMultipleAgents={canAssignMultipleAgents}
        users={usersLoading ? [] : (users || [])}
        loading={usersLoading}
        error={usersError}
      />
    );
  };

  const handleNavigate = useCallback((newDate: Date, view: View, action: NavigateAction) => {
    const navigateAction = action === 'PREV' ? 'PREV' : action === 'NEXT' ? 'NEXT' : 'TODAY';
    setDate(newDate);
  }, []);

  const goToToday = () => {
    setDate(new Date());
  };

  const goBack = () => {
    const newDate = new Date(date);
    if (view === 'month') {
      newDate.setMonth(date.getMonth() - 1);
    } else {
      newDate.setDate(date.getDate() - 7);
    }
    setDate(newDate);
  };

  const goNext = () => {
    const newDate = new Date(date);
    if (view === 'month') {
      newDate.setMonth(date.getMonth() + 1);
    } else {
      newDate.setDate(date.getDate() + 7);
    }
    setDate(newDate);
  };

  const updateEventLocally = (updatedEvent: IScheduleEntry) => {
    setEvents(produce(draft => {
      const index = draft.findIndex(e => e.entry_id === updatedEvent.entry_id);
      if (index !== -1) {
        draft[index] = updatedEvent;
      }
    }));
  };

  const handleEventResize = async ({ event, start, end }: any) => {
    const updatedEvent = { 
      ...event, 
      scheduled_start: start, 
      scheduled_end: end,
      assigned_user_ids: event.assigned_user_ids, // Preserve assigned users
      // Only preserve original_entry_id if this is a virtual instance
      ...(event.entry_id.includes('_') ? { original_entry_id: event.original_entry_id } : {})
    };
    
    // Update locally first for immediate feedback
    updateEventLocally(updatedEvent);
    
    // Update in the database
    const result = await updateScheduleEntry(event.entry_id, updatedEvent);
    
    // If this is a recurring entry or was a recurring entry, refresh all events
    if (result.success && result.entry && (result.entry.recurrence_pattern || event.recurrence_pattern)) {
      await fetchEvents();
    }
  };

  const handleEventDrop = async ({ event, start, end }: any) => {
    const updatedEvent = { 
      ...event, 
      scheduled_start: start, 
      scheduled_end: end,
      assigned_user_ids: event.assigned_user_ids, // Preserve assigned users
      // Only preserve original_entry_id if this is a virtual instance
      ...(event.entry_id.includes('_') ? { original_entry_id: event.original_entry_id } : {})
    };
    
    // Update locally first for immediate feedback
    updateEventLocally(updatedEvent);
    
    // Update in the database
    const result = await updateScheduleEntry(event.entry_id, updatedEvent);
    
    // If this is a recurring entry or was a recurring entry, refresh all events
    if (result.success && result.entry && (result.entry.recurrence_pattern || event.recurrence_pattern)) {
      await fetchEvents();
    }
  };

  const eventStyleGetter = (event: IScheduleEntry) => {
    const style: React.CSSProperties = {
      backgroundColor: workItemColors[event.work_item_type],
      borderRadius: '6px',
      opacity: 1,
      color: 'rgb(var(--color-text-900))',
      border: 'none',
      padding: '2px 5px',
      fontWeight: 500,
      fontSize: '0.875rem',
      transition: 'background-color 0.2s'
    };

    return {
      style,
      className: 'hover:bg-[' + workItemHoverColors[event.work_item_type] + ']'
    };
  };

  return (
    <div className="h-screen flex flex-col">
      <style jsx global>{`
        .rbc-current-time-indicator {
          background-color: rgb(var(--color-secondary-500)) !important;
        }
        .rbc-calendar {
          font-family: inherit;
        }
        .rbc-header {
          display: flex;
          align-items: center;
          padding: 10px;
          font-weight: 600;
          font-size: 0.875rem;
          color: rgb(var(--color-text-700));
          background: rgb(var(--color-border-50));
          border-bottom: 1px solid rgb(var(--color-border-200));
        }
        .rbc-off-range-bg {
          background-color: rgb(var(--color-border-100));
        }
        .rbc-today {
          background-color: rgb(var(--color-primary-100)) !important;
        }
        .rbc-button-link {
          padding: 10px;
        }
        .rbc-event {
          padding: 4px 8px;
          border-radius: 6px;
          border: none;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          transition: background-color 0.2s;
          position: relative;
        }
        .rbc-event-label {
          font-size: 0.75rem;
        }
        .rbc-toolbar button {
          color: rgb(var(--color-text-700));
          border: 1px solid rgb(var(--color-border-200));
          border-radius: 6px;
          padding: 8px 12px;
          font-weight: 500;
        }
        .rbc-toolbar button:hover {
          background-color: rgb(var(--color-border-100));
        }
        .rbc-toolbar button.rbc-active {
          background-color: rgb(var(--color-primary-500));
          color: white;
          border-color: rgb(var(--color-primary-600));
        }
        .rbc-time-content {
          border-top: 1px solid rgb(var(--color-border-200));
          position: relative;
        }
        .rbc-timeslot-group {
          min-height: 60px;
          border-bottom: 1px solid rgb(var(--color-border-200));
        }
        .rbc-time-slot {
          color: rgb(var(--color-text-600));
          border-top: 1px solid rgb(var(--color-border-200));
        }
        .rbc-time-column {
          position: relative;
          border-left: 1px solid rgb(var(--color-border-200));
        }
        .rbc-day-slot .rbc-time-slot {
          border-top: 1px solid rgb(var(--color-border-200));
          position: relative;
        }
        .rbc-time-view {
          border: 1px solid rgb(var(--color-border-200));
        }
        .rbc-allday-cell {
          border-bottom: 1px solid rgb(var(--color-border-200));
        }
        .rbc-time-header.rbc-overflowing {
          border-right: 1px solid rgb(var(--color-border-200));
        }
        .rbc-time-header-content {
          border-left: 1px solid rgb(var(--color-border-200));
        }
        .rbc-day-slot .rbc-events-container {
          margin-right: 0;
        }
        .rbc-time-content > * + * > * {
          border-left: 1px solid rgb(var(--color-border-200));
        }
        .rbc-timeslot-group {
          display: flex;
          flex-direction: column;
          border-bottom: 1px solid rgb(var(--color-border-200));
        }
        .rbc-time-slot {
          flex: 1;
          min-height: 30px;
          border-top: 1px solid rgb(var(--color-border-200));
        }
        .rbc-events-container {
          position: relative;
        }
        .rbc-time-gutter {
          position: relative;
        }
        .rbc-day-slot {
          position: relative;
        }
        .rbc-day-slot::after {
          content: '';
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          width: 1px;
          background: rgb(var(--color-border-200));
        }
      `}</style>
      <Legend />
      <div className="flex-grow">
        <DnDCalendar
          localizer={localizer}
          events={events}
          startAccessor={(event: object) => new Date((event as IScheduleEntry).scheduled_start)}
          endAccessor={(event: object) => new Date((event as IScheduleEntry).scheduled_end)}
          titleAccessor={(event: object) => (event as IScheduleEntry).title}
          eventPropGetter={(event: object) => eventStyleGetter(event as IScheduleEntry)}
          style={{ height: '100%' }}
          view={view}
          date={date}
          onView={(newView) => setView(newView)}
          onNavigate={handleNavigate}
          selectable
          onSelectSlot={handleSelectSlot}
          onSelectEvent={handleSelectEvent}
          resizable
          onEventResize={handleEventResize}
          onEventDrop={handleEventDrop}
          step={30}
          timeslots={2}
        />
      </div>
      <Dialog open={showEntryPopup} onOpenChange={setShowEntryPopup}>
        {renderEntryPopup()}
      </Dialog>
    </div>
  );
};

export default ScheduleCalendar;
