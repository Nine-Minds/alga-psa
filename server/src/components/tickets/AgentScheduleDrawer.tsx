'use client';

import React, { useEffect, useState } from 'react';
import { Calendar, momentLocalizer, View, CalendarProps, EventProps as BigCalendarEventProps } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { useSession } from 'next-auth/react';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { getScheduleEntries } from 'server/src/lib/actions/scheduleActions';
import { findUserById } from 'server/src/lib/actions/user-actions/userActions';
import { IScheduleEntry } from 'server/src/interfaces/schedule.interfaces';
import { IUser, IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { CalendarStyleProvider } from '../schedule/CalendarStyleProvider';
import { WorkItemType, IExtendedWorkItem } from 'server/src/interfaces/workItem.interfaces';
import { useDrawer } from "server/src/context/DrawerContext";
import { getEventColors } from 'server/src/components/technician-dispatch/utils';
import EntryPopup from 'server/src/components/schedule/EntryPopup';

const localizer = momentLocalizer(moment);
const DnDCalendar = withDragAndDrop(Calendar as React.ComponentType<CalendarProps<IScheduleEntry>>);

// Define color schemes for different work item types
const workItemColors: Record<WorkItemType, string> = {
  ticket: 'rgb(var(--color-primary-200))',
  project_task: 'rgb(var(--color-secondary-100))',
  non_billable_category: 'rgb(var(--color-accent-100))',
  ad_hoc: 'rgb(var(--color-border-200))'
};

const workItemHoverColors: Record<WorkItemType, string> = {
  ticket: 'rgb(var(--color-primary-300))',
  project_task: 'rgb(var(--color-secondary-200))',
  non_billable_category: 'rgb(var(--color-accent-200))',
  ad_hoc: 'rgb(var(--color-border-300))'
};

// Custom CSS to adjust the calendar display
const customCalendarStyle = `
  <style>
    /* Make the calendar title more prominent */
    .rbc-toolbar-label {
      font-size: 1.25rem !important;
      font-weight: 600 !important;
    }
    
    /* Ensure the calendar takes full width */
    .flex-grow.relative {
      width: 100% !important;
    }
    
    /* Hide the technician sidebar if it exists */
    .w-64.flex-shrink-0.bg-white {
      display: none !important;
    }
    
    /* Calendar container */
    .rbc-calendar {
      height: 100% !important;
    }
    
    /* Month view specific styles */
    .rbc-month-view {
      height: 100% !important;
    }
    
    .rbc-month-row {
      min-height: 100px !important;
    }
    
    /* Ensure month cells are visible */
    .rbc-month-view .rbc-month-row .rbc-row-content {
      height: auto !important;
      min-height: 80px !important;
    }
    
    /* Hide the default event label to prevent duplicate time display */
    .rbc-event-label {
      display: none !important;
    }
    
    /* Ensure events fill their container properly */
    .rbc-event-content {
      width: 100% !important;
      height: 100% !important;
    }
  </style>
`;

interface AgentScheduleDrawerProps {
  agentId: string;
}

const AgentScheduleDrawer: React.FC<AgentScheduleDrawerProps> = ({
  agentId
}) => {
  const { data: session } = useSession();
  const [events, setEvents] = useState<IScheduleEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(new Date());
  const [view, setView] = useState<View>('day');
  const [agentName, setAgentName] = useState<string>('');
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const { openDrawer, closeDrawer } = useDrawer();
  const [selectedScheduleEntry, setSelectedScheduleEntry] = useState<IScheduleEntry | null>(null);
  const [currentAgentDetails, setCurrentAgentDetails] = useState<IUserWithRoles | null>(null);

  // Event component for different calendar views
  const EventComponent = ({ event }: BigCalendarEventProps<IScheduleEntry>) => {
    const scheduleEvent = event;
    const isHovered = hoveredEventId === scheduleEvent.entry_id;
    
    // Format date and time for tooltip
    const startMoment = new Date(scheduleEvent.scheduled_start);
    const endMoment = new Date(scheduleEvent.scheduled_end);
    const formattedDate = startMoment.toLocaleDateString();
    const formattedTime = `${startMoment.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endMoment.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    // Construct detailed tooltip
    const tooltipTitle = `${scheduleEvent.title}\nDate: ${formattedDate}\nTime: ${formattedTime}`;
    
    // Get base and hover colors based on work item type
    const baseColor = workItemColors[scheduleEvent.work_item_type as WorkItemType] || workItemColors.ad_hoc;
    const hoverColor = workItemHoverColors[scheduleEvent.work_item_type as WorkItemType] || workItemHoverColors.ad_hoc;
    
    // Handle click directly in the component to ensure it captures all events
    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      
      // Call our handler directly
      if (session?.user?.id) {
        handleCalendarEventSelect(scheduleEvent);
      }
    };
    
    // For month view, use a more compact display
    if (view === 'month') {
      return (
        <div
          className="h-full w-full rounded text-xs cursor-pointer"
          style={{
            backgroundColor: isHovered ? hoverColor : baseColor,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            padding: '1px 3px',
            transition: 'background-color 0.2s'
          }}
          onClick={handleClick}
          onMouseEnter={() => setHoveredEventId(scheduleEvent.entry_id)}
          onMouseLeave={() => setHoveredEventId(null)}
          title={tooltipTitle}
        >
          <div className="font-semibold truncate text-[10px]">{scheduleEvent.title}</div>
        </div>
      );
    }
    
    // For day and week views
    return (
      <div
        className="h-full w-full p-1 rounded text-xs cursor-pointer"
        style={{
          backgroundColor: isHovered ? hoverColor : baseColor,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          transition: 'background-color 0.2s'
        }}
        onClick={handleClick}
        onMouseEnter={() => setHoveredEventId(scheduleEvent.entry_id)}
        onMouseLeave={() => setHoveredEventId(null)}
        title={tooltipTitle}
      >
        <div className="font-semibold truncate">{scheduleEvent.title}</div>
        <div className="text-xs opacity-80 truncate">{formattedTime}</div>
      </div>
    );
  };

  // Handler for when a calendar event is selected
  const handleCalendarEventSelect = (scheduleEvent: IScheduleEntry) => {
    console.log('Event selected:', scheduleEvent.title, scheduleEvent.work_item_type);
    
    if (session?.user?.id) {
      setSelectedScheduleEntry(scheduleEvent);
      openDrawer(
        <EntryPopup
          event={scheduleEvent}
          onClose={closeDrawer}
          onSave={(entryData) => {
            console.log('AgentScheduleDrawer: EntryPopup save:', entryData);
            closeDrawer();
            // Re-fetch events
            const fetchEntries = async () => {
                let startDate = new Date(date);
                let endDate = new Date(date);
                if (view === 'day') {
                    startDate.setHours(0, 0, 0, 0);
                    endDate.setHours(23, 59, 59, 999);
                } else if (view === 'week') {
                    startDate.setDate(date.getDate() - date.getDay());
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(startDate);
                    endDate.setDate(startDate.getDate() + 6);
                    endDate.setHours(23, 59, 59, 999);
                } else if (view === 'month') {
                    startDate = new Date(date.getFullYear(), date.getMonth(), 1);
                    endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
                    endDate.setHours(23, 59, 59, 999);
                }
                const result = await getScheduleEntries(startDate, endDate, [agentId]);
                if (result.success && result.entries) {
                    setEvents(result.entries);
                } else {
                    setError(result.error || 'Failed to re-fetch schedule entries after save');
                }
            };
            fetchEntries();
          }}
          onDelete={(entryId, deleteType) => {
            console.log('AgentScheduleDrawer: EntryPopup delete:', entryId, deleteType);
            closeDrawer();
             const fetchEntries = async () => {
                let startDate = new Date(date);
                let endDate = new Date(date);
                if (view === 'day') {
                    startDate.setHours(0, 0, 0, 0);
                    endDate.setHours(23, 59, 59, 999);
                } else if (view === 'week') {
                    startDate.setDate(date.getDate() - date.getDay());
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(startDate);
                    endDate.setDate(startDate.getDate() + 6);
                    endDate.setHours(23, 59, 59, 999);
                } else if (view === 'month') {
                    startDate = new Date(date.getFullYear(), date.getMonth(), 1);
                    endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
                    endDate.setHours(23, 59, 59, 999);
                }
                const result = await getScheduleEntries(startDate, endDate, [agentId]);
                if (result.success && result.entries) {
                    setEvents(result.entries);
                } else {
                    setError(result.error || 'Failed to re-fetch schedule entries after delete');
                }
            };
            fetchEntries();
          }}
          canAssignMultipleAgents={false}
          users={currentAgentDetails ? [currentAgentDetails] : []}
          currentUserId={session.user.id}
          canModifySchedule={false}
          focusedTechnicianId={agentId}
          canAssignOthers={false}
          isInDrawer={true}
          viewOnly={true}
        />
      );
    }
  };

  // Fetch agent details and schedule entries
  useEffect(() => {
    const fetchAgentDetails = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        // Fetch agent details to get the name using the action
        try {
          const userData = await findUserById(agentId);
          if (userData) {
            setAgentName(`Schedule of ${userData.first_name} ${userData.last_name}`);
            setCurrentAgentDetails({
              ...userData,
              roles: (userData as IUserWithRoles).roles || [],
            });
          } else {
            console.error('User not found');
            setAgentName('Agent Schedule');
            setCurrentAgentDetails(null);
          }
        } catch (error) {
          console.error('Failed to fetch agent details:', error);
          setAgentName('Agent Schedule');
          setCurrentAgentDetails(null);
        }
        
        // Calculate date range based on current view
        let startDate = new Date(date);
        let endDate = new Date(date);
        
        if (view === 'day') {
          startDate.setHours(0, 0, 0, 0);
          endDate.setHours(23, 59, 59, 999);
        } else if (view === 'week') {
          startDate.setDate(date.getDate() - date.getDay()); // Start of week (Sunday)
          startDate.setHours(0, 0, 0, 0);
          endDate = new Date(startDate);
          endDate.setDate(startDate.getDate() + 6); // End of week (Saturday)
          endDate.setHours(23, 59, 59, 999);
        } else if (view === 'month') {
          startDate = new Date(date.getFullYear(), date.getMonth(), 1);
          endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
          endDate.setHours(23, 59, 59, 999);
        }
        
        // Fetch schedule entries for this agent
        const result = await getScheduleEntries(startDate, endDate, [agentId]);
        
        if (result.success && result.entries) {
          setEvents(result.entries);
        } else {
          setError(result.error || 'Failed to fetch schedule entries');
        }
      } catch (err) {
        console.error('Error fetching agent data:', err);
        setError('An error occurred while fetching the agent data');
        setCurrentAgentDetails(null);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchAgentDetails();
  }, [agentId, date, view]);

  // Navigation functions
  const goToToday = () => {
    setDate(new Date());
  };
  
  const goToPrev = () => {
    const newDate = new Date(date);
    if (view === 'day') {
      newDate.setDate(date.getDate() - 1);
    } else if (view === 'week') {
      newDate.setDate(date.getDate() - 7);
    } else if (view === 'month') {
      newDate.setMonth(date.getMonth() - 1);
    }
    setDate(newDate);
  };
  
  const goToNext = () => {
    const newDate = new Date(date);
    if (view === 'day') {
      newDate.setDate(date.getDate() + 1);
    } else if (view === 'week') {
      newDate.setDate(date.getDate() + 7);
    } else if (view === 'month') {
      newDate.setMonth(date.getMonth() + 1);
    }
    setDate(newDate);
  };

  // Handle view change
  const handleViewChange = (newView: View) => {
    setView(newView);
  };

  // Custom toolbar to show the agent's name as the title
  const CustomToolbar = ({ onView }: any) => {
    return (
      <div className="rbc-toolbar">
        <span className="rbc-btn-group">
          <button 
            type="button" 
            onClick={goToPrev}
            className="px-3 py-1 bg-white border border-gray-300 rounded-l-md hover:bg-gray-100"
          >
            {'< Prev'}
          </button>
          <button 
            type="button" 
            onClick={goToToday}
            className="px-3 py-1 bg-white border-t border-b border-gray-300 hover:bg-gray-100"
          >
            Today
          </button>
          <button 
            type="button" 
            onClick={goToNext}
            className="px-3 py-1 bg-white border border-gray-300 rounded-r-md hover:bg-gray-100"
          >
            {'Next >'}
          </button>
        </span>
        <span className="rbc-toolbar-label">{agentName || 'Agent Schedule'}</span>
        <span className="rbc-btn-group">
          <button 
            type="button" 
            onClick={() => {
              setView('month');
              onView('month');
            }}
            className={`px-3 py-1 border border-gray-300 rounded-l-md ${view === 'month' ? 'bg-blue-500 text-white' : 'bg-white hover:bg-gray-100'}`}
          >
            Month
          </button>
          <button 
            type="button" 
            onClick={() => {
              setView('week');
              onView('week');
            }}
            className={`px-3 py-1 border-t border-b border-gray-300 ${view === 'week' ? 'bg-blue-500 text-white' : 'bg-white hover:bg-gray-100'}`}
          >
            Week
          </button>
          <button 
            type="button" 
            onClick={() => {
              setView('day');
              onView('day');
            }}
            className={`px-3 py-1 border border-gray-300 rounded-r-md ${view === 'day' ? 'bg-blue-500 text-white' : 'bg-white hover:bg-gray-100'}`}
          >
            Day
          </button>
        </span>
      </div>
    );
  };

  function Spinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
    const sizeClass = size === "sm" ? "h-4 w-4" : size === "md" ? "h-8 w-8" : "h-12 w-12";
    return (
      <div className={`animate-spin rounded-full border-2 border-gray-300 border-t-blue-600 ${sizeClass}`}></div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Inject custom CSS */}
      <div dangerouslySetInnerHTML={{ __html: customCalendarStyle }} />
      <CalendarStyleProvider />
      
      {/* Calendar component */}
      <div className="h-full p-4">
        <DnDCalendar
          localizer={localizer}
          events={events}
          startAccessor={(event: any) => new Date(event.scheduled_start)}
          endAccessor={(event: any) => new Date(event.scheduled_end)}
          style={{ height: '100%' }}
          defaultView="day"
          views={['month', 'week', 'day']}
          view={view}
          date={date}
          onNavigate={(action) => {
            // This is handled by our custom toolbar buttons
            console.log('Calendar navigation:', action);
          }}
          onView={(newView) => setView(newView as View)}
          onSelectEvent={handleCalendarEventSelect}
          selectable={false}
          components={{
            toolbar: CustomToolbar,
            event: EventComponent
          }}
          eventPropGetter={(event: IScheduleEntry) => {
            return {
              style: {
                backgroundColor: 'transparent',
                borderRadius: '4px',
                color: 'rgb(var(--color-text-900))',
                border: 'none',
                padding: 0,
                margin: 0
              }
            };
          }}
          draggableAccessor={() => false}
          resizableAccessor={() => false}
          onSelectSlot={() => {}}
        />
      </div>
    </div>
  );
};

export default AgentScheduleDrawer;
