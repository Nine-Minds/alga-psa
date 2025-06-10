'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { MouseEvent } from 'react';
import { Calendar, momentLocalizer, NavigateAction, View, ToolbarProps } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Button } from '../ui/Button';
import EntryPopup from './EntryPopup';
import { CalendarStyleProvider } from './CalendarStyleProvider';
import TechnicianSidebar from './TechnicianSidebar';
import WeeklyScheduleEvent from './WeeklyScheduleEvent';
import { getScheduleEntries, addScheduleEntry, updateScheduleEntry, deleteScheduleEntry } from 'server/src/lib/actions/scheduleActions';
import { IEditScope, IScheduleEntry } from 'server/src/interfaces/schedule.interfaces';
import { produce } from 'immer';
import { Dialog } from 'server/src/components/ui/Dialog';
import { WorkItemType, IExtendedWorkItem } from 'server/src/interfaces/workItem.interfaces';
import { useUsers } from 'server/src/hooks/useUsers';
import { getCurrentUser, getCurrentUserPermissions } from 'server/src/lib/actions/user-actions/userActions';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { WorkItemDrawer } from 'server/src/components/time-management/time-entry/time-sheet/WorkItemDrawer';
import { useDrawer } from "server/src/context/DrawerContext";
import { Trash, ChevronLeft, ChevronRight, CalendarDays, Layers, Layers2 } from 'lucide-react';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Label } from 'server/src/components/ui/Label';

const localizer = momentLocalizer(moment);

const DnDCalendar = withDragAndDrop(Calendar);

const ScheduleCalendar: React.FC = (): React.ReactElement | null => {
  const [view, setView] = useState<View>("week");
  const [events, setEvents] = useState<IScheduleEntry[]>([]);
  const [showEntryPopup, setShowEntryPopup] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<IScheduleEntry | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(new Date());
  const [focusedTechnicianId, setFocusedTechnicianId] = useState<string | null>(null);
  const [comparisonTechnicianIds, setComparisonTechnicianIds] = useState<string[]>([]);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [canModifySchedule, setCanModifySchedule] = useState<boolean>(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const { openDrawer, closeDrawer } = useDrawer();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [hasScrolled, setHasScrolled] = useState(false);
  
  // Add useEffect for auto-scrolling to working hours
  useEffect(() => {
    if (!hasScrolled && calendarRef.current && (view === 'day' || view === 'week')) {
      // Find the time slots container
      const timeSlotContainer = calendarRef.current.querySelector('.rbc-time-content');
      if (timeSlotContainer) {
        const scrollToPosition = 8 * 4 * 15;
        timeSlotContainer.scrollTop = scrollToPosition;
        setHasScrolled(true);
      }
    }
  }, [view, hasScrolled, events]);

  const handleDeleteClick = (event: IScheduleEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedEvent(event);
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = (deleteType?: IEditScope) => {
    if (selectedEvent) {
      handleDeleteEntry(selectedEvent.entry_id, deleteType);
      setShowDeleteDialog(false);
      setSelectedEvent(null);
    }
  };

  const workItemColors: Record<WorkItemType, string> = {
    ticket: 'rgb(var(--color-primary-200))',
    project_task: 'rgb(var(--color-secondary-100))',
    non_billable_category: 'rgb(var(--color-accent-100))',
    ad_hoc: 'rgb(var(--color-border-200))',
    interaction: 'rgb(220 252 231)' // Tailwind green-100
  };

  const workItemHoverColors: Record<WorkItemType, string> = {
    ticket: 'rgb(var(--color-primary-200))',
    project_task: 'rgb(var(--color-secondary-200))',
    non_billable_category: 'rgb(var(--color-accent-200))',
    ad_hoc: 'rgb(var(--color-border-300))',
    interaction: 'rgb(187 247 208)' // Tailwind green-200
  };

  const Legend = () => (
    <div className="flex justify-center space-x-4 mb-4 p-2 rounded-lg bg-opacity-50">
      {Object.entries(workItemColors).map(([type, color]): JSX.Element => (
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

  const { users: allTechnicians, loading: usersLoading, error: usersError } = useUsers();

  useEffect(() => {
    async function fetchUserDataAndPermissions() {
      const user = await getCurrentUser();
      if (user?.user_id) {
        setCurrentUserId(user.user_id);
        try {
          const fetchedPermissions = await getCurrentUserPermissions();
          setUserPermissions(fetchedPermissions);

          const canUpdate = fetchedPermissions.includes('user_schedule:update');
          setCanModifySchedule(canUpdate);

          setFocusedTechnicianId(user.user_id);
          const canReadBroadly = fetchedPermissions.some((p: string) => p === 'user_schedule:read:all' || p === 'user_schedule:update');
          // Initialize with empty comparison list
          setComparisonTechnicianIds([]);
        } catch (err: any) {
           console.error("Failed to fetch user permissions:", err);
           setError(err.message || "Failed to load permissions.");
           setUserPermissions([]);
           setComparisonTechnicianIds([]);
        }
      } else {
        setError("Failed to load current user.");
        setComparisonTechnicianIds([]);
      }
    }
    fetchUserDataAndPermissions();
  }, []);

  const canAssignOthers = useMemo(() => userPermissions.includes('user_schedule:update'), [userPermissions]);
  const canViewOthers = useMemo(() => userPermissions.some((p: string) => p === 'user_schedule:read:all' || p === 'user_schedule:update'), [userPermissions]);

  // Get all technician IDs to display (focused + comparison)
  const viewingTechnicianIds = useMemo(() => {
    const techIds = new Set<string>();
    if (focusedTechnicianId) techIds.add(focusedTechnicianId);
    comparisonTechnicianIds.forEach(id => techIds.add(id));
    return Array.from(techIds);
  }, [focusedTechnicianId, comparisonTechnicianIds]);

  const fetchEvents = useCallback(async () => {
    if (viewingTechnicianIds.length === 0) {
      setEvents([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    let rangeStart, rangeEnd;
    if (view === 'month') {
      const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      rangeStart = new Date(firstDay);
      rangeStart.setDate(1 - firstDay.getDay());
      rangeEnd = new Date(lastDay);
      rangeEnd.setDate(lastDay.getDate() + (6 - lastDay.getDay()));
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd.setHours(23, 59, 59, 999);
    } else {
      rangeStart = new Date(date);
      rangeEnd = new Date(date);
      if (view === 'week') {
        rangeStart.setDate(date.getDate() - date.getDay());
        rangeEnd.setDate(rangeStart.getDate() + 6);
      }
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd.setHours(23, 59, 59, 999);
    }

    console.log('Fetching schedule entries for technicians:', viewingTechnicianIds, {
      view,
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString()
    });

    const result = await getScheduleEntries(
      rangeStart,
      rangeEnd,
      viewingTechnicianIds
    );

    if (result.success) {
      console.log('Fetched entries:', {
        count: result.entries.length,
      });
      setEvents(result.entries);
    } else {
      console.error('Failed to fetch schedule entries:', result.error);
      setError(result.error || 'An unknown error occurred');
      setEvents([]);
    }
    setIsLoading(false);
  }, [date, view, viewingTechnicianIds]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleSelectSlot = (slotInfo: any) => {
    // For month view, adjust the start time to 8am and end time to be 15 minutes after
    let adjustedSlotInfo = { ...slotInfo };
    if (view === 'month') {
      const startDate = new Date(slotInfo.start);
      // Set the start time to 8am
      startDate.setHours(8, 0, 0, 0);
      
      const endDate = new Date(startDate);
      endDate.setMinutes(startDate.getMinutes() + 15);
      
      adjustedSlotInfo = {
        ...slotInfo,
        start: startDate,
        end: endDate
      };
    }
    
    setSelectedSlot({
      ...adjustedSlotInfo,
      defaultAssigneeId: focusedTechnicianId
    });
    setShowEntryPopup(true);
  };

  const handleDeleteEntry = async (entryId: string, deleteType?: IEditScope) => {
    try {
      const result = await deleteScheduleEntry(entryId, deleteType);
      if (result.success) {
        await fetchEvents();
      } else {
        console.error('Failed to delete entry:', result.error);
        alert('Failed to delete schedule entry: ' + result.error);
      }
    } catch (error) {
      console.error('Error deleting schedule entry:', error);
      alert('An error occurred while deleting the schedule entry');
    }
  };

  const handleSelectEvent = (event: object, e: React.SyntheticEvent<HTMLElement>) => {
    const scheduleEvent = event as IScheduleEntry;
    const target = e.target as HTMLElement;

    if (target.closest('.delete-entry-btn')) {
      e.stopPropagation();
      return;
    }

    setSelectedEvent(scheduleEvent);
    setShowEntryPopup(true);
  };

  const handleEntryPopupClose = () => {
    setShowEntryPopup(false);
    setSelectedEvent(null);
    setSelectedSlot(null);
  };

  const handleTaskUpdate = async (updated: any) => {
    await fetchEvents();
  };

  const handleScheduleUpdate = async (updated: any) => {
    await fetchEvents();
  };

  const handleEntryPopupSave = async (entryData: IScheduleEntry) => {
    try {
      console.log('Saving entry:', entryData);
      let updatedEntry;
      if (selectedEvent) {
        const entryToUpdate = {
          ...entryData,
          recurrence_pattern: entryData.recurrence_pattern || null,
          assigned_user_ids: entryData.assigned_user_ids,
          ...(selectedEvent.entry_id.includes('_') ? { original_entry_id: selectedEvent.original_entry_id } : {})
        };

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
        await fetchEvents();
      }

      setShowEntryPopup(false);
      setSelectedEvent(null);
    } catch (error) {
      console.error('Error saving schedule entry:', error);
      alert('An error occurred while saving the schedule entry');
    }
  };

  const renderEntryPopup = () => {
    if (!showEntryPopup) return null;
    return (
      <EntryPopup
        event={selectedEvent}
        slot={selectedSlot}
        onClose={handleEntryPopupClose}
        onSave={handleEntryPopupSave}
        onDelete={handleDeleteEntry}
        canAssignMultipleAgents={canAssignOthers}
        currentUserId={currentUserId ?? ''}
        canModifySchedule={canModifySchedule}
        focusedTechnicianId={focusedTechnicianId}
        canAssignOthers={canAssignOthers}
        users={usersLoading ? [] : (allTechnicians || [])}
        loading={usersLoading}
        error={usersError}
      />
    );
  };

  const handleNavigate = useCallback((newDate: Date, view: View, action: NavigateAction) => {
    const navigateAction = action === 'PREV' ? 'PREV' : action === 'NEXT' ? 'NEXT' : 'TODAY';
    setDate(newDate);
  }, [setDate]);

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
      assigned_user_ids: event.assigned_user_ids,
      ...(event.entry_id.includes('_') ? { original_entry_id: event.original_entry_id } : {})
    };
    updateEventLocally(updatedEvent);
    const result = await updateScheduleEntry(event.entry_id, updatedEvent);
    if (result.success && result.entry && (result.entry.recurrence_pattern || event.recurrence_pattern)) {
      await fetchEvents();
    } else if (!result.success) {
      console.error("Resize failed, reverting UI potentially needed or fetchEvents anyway");
      await fetchEvents();
    }
  };

  const handleEventDrop = async ({ event, start, end }: any) => {
    const updatedEvent = {
      ...event,
      scheduled_start: start,
      scheduled_end: end,
      assigned_user_ids: event.assigned_user_ids,
      ...(event.entry_id.includes('_') ? { original_entry_id: event.original_entry_id } : {})
    };
    updateEventLocally(updatedEvent);
    const result = await updateScheduleEntry(event.entry_id, updatedEvent);
    if (result.success && result.entry && (result.entry.recurrence_pattern || event.recurrence_pattern)) {
      await fetchEvents();
    } else if (!result.success) {
      console.error("Drop failed, reverting UI potentially needed or fetchEvents anyway");
      await fetchEvents();
    }
  };

  const eventStyleGetter = (event: IScheduleEntry) => {
    const isFocusedUserEvent = event.assigned_user_ids.includes(focusedTechnicianId ?? '');
    const baseColor = workItemColors[event.work_item_type] || 'rgb(var(--color-border-200))';

    const style: React.CSSProperties = {
      backgroundColor: baseColor,
      borderRadius: '6px',
      opacity: isFocusedUserEvent ? 1 : 0.6, 
      color: 'rgb(var(--color-text-900))',
      border: isFocusedUserEvent ? '2px solid rgb(var(--color-primary-500))' : 'none',
      padding: '2px 5px',
      fontWeight: 500,
      fontSize: '0.875rem',
      transition: 'opacity 0.2s, border 0.2s, background-color 0.2s',
      position: 'relative',
      overflow: 'hidden',
    };

    return {
      style,
      className: `hover:opacity-100 ${isFocusedUserEvent ? 'focused-event' : 'comparison-event'}`
    };
  };

  const EventWrapper = ({ event: calendarEvent, children }: { event: object; children?: React.ReactNode }) => {
    const event = calendarEvent as IScheduleEntry;
    const isTicketOrTask = event.work_item_type === 'ticket' || event.work_item_type === 'project_task';

    const assignedUsersDetails = useMemo(() => {
      if (!allTechnicians) return [];
      return event.assigned_user_ids
        .map(userId => allTechnicians.find(tech => tech.user_id === userId))
        .filter(user => !!user);
    }, [event.assigned_user_ids, allTechnicians]);

    const userInitials = assignedUsersDetails.map(user =>
      `${user?.first_name?.[0] ?? ''}${user?.last_name?.[0] ?? ''}`.toUpperCase()
    ).join(', ');

    const canDeleteThisEvent = canModifySchedule || (event.assigned_user_ids.length === 1 && event.assigned_user_ids[0] === currentUserId);

    return (
      <div style={{ height: '100%' }} className="relative group">
        <div className="flex flex-col h-full p-1">
          <div className="flex justify-between items-start">
            <div className={`event-title flex-grow mr-1 ${isTicketOrTask ? 'cursor-pointer hover:underline' : ''} text-xs leading-tight`}>
              {event.title}
            </div>
            {canDeleteThisEvent && (
              <Button
                id={`delete-entry-${event.entry_id}-btn`}
                variant="icon"
                size="icon"
                className="delete-entry-btn absolute top-0 right-0 p-0.5 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete Entry"
                onClick={(e) => handleDeleteClick(event, e)}
              >
                <Trash className="w-3 h-3" />
              </Button>
            )}
          </div>
          <div className="text-xs font-semibold mt-auto text-right opacity-80">
            {userInitials}
          </div>
        </div>
      </div>
    );
  };

  const handleFocusTechnicianChange = (newFocusId: string) => {
    setFocusedTechnicianId(newFocusId);
  };

  const handleComparisonChange = (technicianId: string, add: boolean) => {
    setComparisonTechnicianIds(prev => {
      if (add) {
        return [...prev, technicianId];
      } else {
        return prev.filter(id => id !== technicianId);
      }
    });
  };

  const handleResetSelections = () => {
    if (currentUserId) {
      setFocusedTechnicianId(currentUserId);
      setComparisonTechnicianIds([]);
    }
  };

  const handleSelectAll = () => {
    const techIds = allTechnicians
      ?.filter(tech => tech.user_id !== focusedTechnicianId && !tech.is_inactive)
      .map(tech => tech.user_id) || [];
    
    setComparisonTechnicianIds(techIds);
  };

  // Create a map of technician details for the event display
  const technicianMap = useMemo(() => {
    return (allTechnicians || []).reduce((map, tech) => {
      map[tech.user_id] = {
        first_name: tech.first_name || '',
        last_name: tech.last_name || ''
      };
      return map;
    }, {} as Record<string, { first_name: string; last_name: string }>);
  }, [allTechnicians]);


  const CustomToolbar = (toolbar: ToolbarProps) => {
    const { label, onNavigate, onView, view: currentView } = toolbar;

    const navigate = (action: NavigateAction) => {
      onNavigate(action);
    };

    const handleViewChange = (newView: string) => {
      onView(newView as View);
    }

    return (
      <div className="rbc-toolbar flex flex-wrap items-center justify-between p-2 mb-2 bg-[rgb(var(--color-background-100))] rounded-md shadow-sm">
        <div className="rbc-btn-group space-x-1">
          <Button
            id="dispatch-prev-button"
            variant="ghost"
            size="sm"
            onClick={() => navigate('PREV')}
            aria-label={`Previous ${currentView}`}
            className="px-3 py-1 rounded-none border-r border-[rgb(var(--color-border-200))] text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-border-100))]"
          >
            {'< Prev'}
          </Button>
          <Button id="schedule-nav-today" variant="outline" size="sm" onClick={() => navigate('TODAY')}>
            Today
          </Button>
          <Button
            id="dispatch-next-button"
            variant="ghost"
            size="sm"
            onClick={() => navigate('NEXT')}
            aria-label={`Next ${currentView}`}
            className="px-3 py-1 rounded-none border-l border-[rgb(var(--color-border-200))] text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-border-100))]"
          >
            {'Next >'}
          </Button>
        </div>

        <span className="rbc-toolbar-label text-lg font-semibold text-[rgb(var(--color-text-800))]">{label}</span>

        <div className="rbc-btn-group space-x-1">
          {(['month', 'week', 'day'] as View[]).map(v => (
            <Button
              id={`schedule-view-${v}`}
              key={v}
              variant={currentView === v ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleViewChange(v)}
              className="capitalize"
            >
              {v}
            </Button>
          ))}
        </div>
      </div>
    );
  };

  // Custom resize handler
  const handleResizeStart = useCallback((e: React.MouseEvent, event: IScheduleEntry, direction: 'top' | 'bottom') => {
    e.stopPropagation();
    
    // Only allow resize for primary events (events assigned to the focused technician)
    if (!focusedTechnicianId || !event.assigned_user_ids.includes(focusedTechnicianId)) {
      console.log("Prevented resize of comparison event.");
      return;
    }
    
    const startY = e.clientY;
    const initialStart = new Date(event.scheduled_start);
    const initialEnd = new Date(event.scheduled_end);
    
    const handleResizeMove = (moveEvent: globalThis.MouseEvent) => {
      moveEvent.preventDefault();
      
      // Calculate time difference based on vertical movement
      // Assuming 20px = 15 minutes (adjust as needed)
      const deltaY = moveEvent.clientY - startY;
      const deltaMinutes = Math.round(deltaY / 20) * 15;
      
      let newStart = new Date(initialStart);
      let newEnd = new Date(initialEnd);
      
      if (direction === 'top') {
        newStart = new Date(initialStart.getTime() + deltaMinutes * 60000);
        if (newEnd.getTime() - newStart.getTime() < 15 * 60000) {
          return; // Prevent events shorter than 15 minutes
        }
      } else {
        newEnd = new Date(initialEnd.getTime() + deltaMinutes * 60000);
        if (newEnd.getTime() - newStart.getTime() < 15 * 60000) {
          return; // Prevent events shorter than 15 minutes
        }
      }
      
      // Create a temporary updated event for UI update
      const updatedEvent = {
        ...event,
        scheduled_start: direction === 'top' ? newStart : initialStart,
        scheduled_end: direction === 'bottom' ? newEnd : initialEnd
      };
      
      // Update the event locally for immediate feedback
      updateEventLocally(updatedEvent);
    };
    
    const handleResizeEnd = async () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      
      // Get the current state of the event after resizing
      const currentEvent = events.find(e => e.entry_id === event.entry_id);
      if (currentEvent) {
        // Save the changes to the server
        const result = await updateScheduleEntry(event.entry_id, {
          ...currentEvent,
          assigned_user_ids: currentEvent.assigned_user_ids,
          ...(currentEvent.entry_id.includes('_') ? { original_entry_id: currentEvent.original_entry_id } : {})
        });
        
        if (result.success && result.entry && (result.entry.recurrence_pattern || event.recurrence_pattern)) {
          await fetchEvents();
        } else if (!result.success) {
          console.error("Resize failed, reverting UI");
          await fetchEvents();
        }
      }
    };
    
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  }, [focusedTechnicianId, events, updateEventLocally, updateScheduleEntry, fetchEvents]);

  // Event component for the calendar
  const EventComponent = useCallback(({ event }: { event: any }) => {
    const scheduleEvent = event as IScheduleEntry;
    const isPrimary = focusedTechnicianId !== null &&
                     scheduleEvent.assigned_user_ids?.includes(focusedTechnicianId);
    const isComparison = !isPrimary &&
                         comparisonTechnicianIds.length > 0 &&
                         scheduleEvent.assigned_user_ids?.some(id => comparisonTechnicianIds.includes(id));
    
    const isHovered = hoveredEventId === scheduleEvent.entry_id;
    const canDeleteThisEvent = canModifySchedule ||
                              (scheduleEvent.assigned_user_ids.length === 1 &&
                               scheduleEvent.assigned_user_ids[0] === currentUserId);

    // For month view, use a different component to show more details
    if (view === 'month') {
      const titleParts = scheduleEvent.title?.split(':') || ['Untitled'];
      const mainTitle = titleParts[0];
      
      const assignedTechnicians = scheduleEvent.assigned_user_ids?.map(userId => {
        const tech = technicianMap[userId];
        return tech ? `${tech.first_name} ${tech.last_name}` : userId;
      }).join(', ') || 'Unassigned';

      const startMoment = new Date(scheduleEvent.scheduled_start);
      const endMoment = new Date(scheduleEvent.scheduled_end);
      const formattedDate = startMoment.toLocaleDateString();
      const formattedTime = `${startMoment.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endMoment.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

      const tooltipTitle = `${scheduleEvent.title}\nScheduled for: ${assignedTechnicians}\nDate: ${formattedDate}\nTime: ${formattedTime}`;
      
      const opacity = isPrimary ? 1 : (isComparison ? 0.3 : 1);
      
      return (
        <div 
          className={`h-full w-full p-1 rounded text-xs ${isPrimary ? 'font-semibold' : ''}`}
          style={{
            backgroundColor: workItemColors[scheduleEvent.work_item_type] || 'rgb(var(--color-border-200))',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            opacity
          }}
          onClick={(e) => handleSelectEvent(scheduleEvent as unknown as object, e as unknown as React.SyntheticEvent<HTMLElement>)}
          onMouseEnter={() => setHoveredEventId(scheduleEvent.entry_id)}
          onMouseLeave={() => setHoveredEventId(null)}
          title={tooltipTitle}
        >
          {mainTitle}
        </div>
      );
    }

    return (
      <WeeklyScheduleEvent
        event={scheduleEvent}
        isHovered={isHovered}
        isPrimary={isPrimary}
        isComparison={isComparison}
        onMouseEnter={() => setHoveredEventId(scheduleEvent.entry_id)}
        onMouseLeave={() => setHoveredEventId(null)}
        onSelectEvent={(event: IScheduleEntry, e: React.MouseEvent) => {
          handleSelectEvent(event as unknown as object, e as unknown as React.SyntheticEvent<HTMLElement>);
        }}
        onDeleteEvent={(event: IScheduleEntry) => handleDeleteClick(event, new MouseEvent('click') as any)}
        onResizeStart={handleResizeStart}
        technicianMap={technicianMap}
      />
    );
  }, [view, focusedTechnicianId, comparisonTechnicianIds, hoveredEventId, canModifySchedule, currentUserId, technicianMap, handleResizeStart, handleSelectEvent]);


  return (
    <div className="h-full flex flex-col bg-[rgb(var(--color-background-50))]">
      <CalendarStyleProvider />
      <Legend />
      {/* Main content with sidebar and calendar */}
      <div className="flex-grow flex overflow-hidden">
        {/* Technician sidebar */}
        {canViewOthers && (
          <TechnicianSidebar
            technicians={allTechnicians || []}
            focusedTechnicianId={focusedTechnicianId}
            comparisonTechnicianIds={comparisonTechnicianIds}
            onSetFocus={handleFocusTechnicianChange}
            onComparisonChange={handleComparisonChange}
            onResetSelections={handleResetSelections}
            onSelectAll={handleSelectAll}
          />
        )}
        
        {/* Calendar container */}
        <div className="flex-grow relative" ref={calendarRef}>
          {isLoading && <div className="absolute inset-0 bg-white bg-opacity-50 flex items-center justify-center z-10">Loading...</div>}
          {error && <div className="absolute inset-0 bg-red-100 text-red-700 flex items-center justify-center z-10 p-4">{error}</div>}
          {/* Create a date object for 8 AM to auto-scroll to working hours */}
          {(() => {
            const scrollToTime = new Date();
            scrollToTime.setHours(8, 0, 0, 0);
            return (
              <DnDCalendar
                localizer={localizer}
                events={events}
                startAccessor={(event: object) => new Date((event as IScheduleEntry).scheduled_start)}
                endAccessor={(event: object) => new Date((event as IScheduleEntry).scheduled_end)}
                eventPropGetter={(event: object) => ({
                  style: {
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderRadius: '0px',
                    padding: '0px',
                    boxShadow: 'none',
                    color: 'inherit',
                  }
                })}
                style={{ height: '100%' }}
                view={view}
                date={date}
                scrollToTime={scrollToTime}
                onView={(newView) => setView(newView)}
                onNavigate={handleNavigate}
                selectable
                onSelectSlot={handleSelectSlot}
                onSelectEvent={handleSelectEvent}
                resizableAccessor={(event: object) => {
                  const scheduleEvent = event as IScheduleEntry;
                  return focusedTechnicianId !== null &&
                        scheduleEvent?.assigned_user_ids &&
                        scheduleEvent.assigned_user_ids.includes(focusedTechnicianId);
                }}
                draggableAccessor={(event: object) => {
                  const scheduleEvent = event as IScheduleEntry;
                  return focusedTechnicianId !== null &&
                        scheduleEvent?.assigned_user_ids &&
                        scheduleEvent.assigned_user_ids.includes(focusedTechnicianId);
                }}
                onEventResize={handleEventResize}
                onEventDrop={handleEventDrop}
                step={15}
                timeslots={4}
                components={{
                  toolbar: CustomToolbar,
                  event: EventComponent
                }}
                defaultView="week"
                views={['month', 'week', 'day']}
              />
            );
          })()}
        </div>
      </div>
      <Dialog
        isOpen={showEntryPopup}
        onClose={handleEntryPopupClose}
      >
        {renderEntryPopup()}
      </Dialog>

      <ConfirmationDialog
        className="max-w-[450px]"
        isOpen={showDeleteDialog}
        onConfirm={(value) => handleDeleteConfirm(selectedEvent?.is_recurring ? value as IEditScope : undefined)}
        onClose={() => {
          setShowDeleteDialog(false);
          setSelectedEvent(null);
        }}
        title="Delete Schedule Entry"
        message={selectedEvent?.is_recurring
          ? "Select which events to delete:"
          : "Are you sure you want to delete this schedule entry? This action cannot be undone."}
        options={selectedEvent?.is_recurring ? [
          { value: IEditScope.SINGLE, label: 'Only this event' },
          { value: IEditScope.FUTURE, label: 'This and future events' },
          { value: IEditScope.ALL, label: 'All events' }
        ] : undefined}
        confirmLabel="Delete"
      />
    </div>
  );
};

export default ScheduleCalendar;
