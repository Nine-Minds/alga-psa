'use client';

import React, { useEffect, useState } from 'react';
import { Calendar, momentLocalizer } from 'react-big-calendar';
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
import { WorkItemDrawer } from 'server/src/components/time-management/time-entry/time-sheet/WorkItemDrawer';
import { getEventColors } from 'server/src/components/technician-dispatch/utils';

const localizer = momentLocalizer(moment);
const DnDCalendar = withDragAndDrop(Calendar);

// Custom CSS to hide the technician sidebar and adjust the calendar display
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
    
    /* Adjust calendar event styling */
    .rbc-event {
      background-color: rgb(var(--color-primary-200)) !important;
      border-radius: 4px !important;
      padding: 2px 5px !important;
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
    
    /* Make sure events in month view are visible */
    .rbc-month-view .rbc-event {
      padding: 2px 5px !important;
      margin: 1px 0 !important;
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
  const [view, setView] = useState<'day' | 'week' | 'month'>('day');
  const [agentName, setAgentName] = useState<string>('');
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const { openDrawer, closeDrawer } = useDrawer();
  
  // Event component for the calendar
  const EventComponent = ({ event }: { event: any }) => {
    const scheduleEvent = event as IScheduleEntry;
    const isHovered = hoveredEventId === scheduleEvent.entry_id;
    const isTicketOrTask = scheduleEvent.work_item_type === 'ticket' || scheduleEvent.work_item_type === 'project_task';
    
    // Format date and time for tooltip
    const startMoment = new Date(scheduleEvent.scheduled_start);
    const endMoment = new Date(scheduleEvent.scheduled_end);
    const formattedDate = startMoment.toLocaleDateString();
    const formattedTime = `${startMoment.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endMoment.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    // Construct detailed tooltip
    const tooltipTitle = `${scheduleEvent.title}\nDate: ${formattedDate}\nTime: ${formattedTime}`;
    
    // Handle click on event
    const handleEventClick = () => {
      if (isTicketOrTask && scheduleEvent.work_item_id) {
        // Open drawer with work item details
        const workItem = {
          work_item_id: scheduleEvent.work_item_id,
          type: scheduleEvent.work_item_type,
          name: scheduleEvent.title,
          title: scheduleEvent.title,
          description: scheduleEvent.notes || '',
          startTime: new Date(scheduleEvent.scheduled_start),
          endTime: new Date(scheduleEvent.scheduled_end),
          scheduled_start: new Date(scheduleEvent.scheduled_start).toISOString(),
          scheduled_end: new Date(scheduleEvent.scheduled_end).toISOString(),
          users: scheduleEvent.assigned_user_ids.map(id => ({ user_id: id })),
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
      }
    };
    
    // Get colors based on work item type
    const { bg, hover, text } = getEventColors(scheduleEvent.work_item_type || 'ad_hoc', true, false);
    
    return (
      <div 
        className={`h-full w-full p-1 rounded text-xs cursor-pointer ${text}`}
        style={{
          backgroundColor: isHovered 
            ? hover.includes('primary') ? 'rgb(var(--color-primary-300))' 
            : hover.includes('secondary') ? 'rgb(var(--color-secondary-200))' 
            : hover.includes('accent') ? 'rgb(var(--color-accent-200))' 
            : 'rgb(var(--color-border-300))'
            : bg.includes('primary') ? 'rgb(var(--color-primary-200))' 
            : bg.includes('secondary') ? 'rgb(var(--color-secondary-100))' 
            : bg.includes('accent') ? 'rgb(var(--color-accent-100))' 
            : 'rgb(var(--color-border-200))',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          transition: 'background-color 0.2s'
        }}
        onClick={handleEventClick}
        onMouseEnter={() => setHoveredEventId(scheduleEvent.entry_id)}
        onMouseLeave={() => setHoveredEventId(null)}
        title={tooltipTitle}
      >
        <div className="font-semibold truncate">{scheduleEvent.title}</div>
        <div className="text-xs opacity-80 truncate">{formattedTime}</div>
      </div>
    );
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
          } else {
            console.error('User not found');
            setAgentName('Agent Schedule');
          }
        } catch (error) {
          console.error('Failed to fetch agent details:', error);
          setAgentName('Agent Schedule');
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
  const handleViewChange = (newView: 'day' | 'week' | 'month') => {
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
            Back
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
            Next
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
          onView={(newView) => setView(newView as 'day' | 'week' | 'month')}
          components={{
            toolbar: CustomToolbar,
            event: EventComponent
          }}
          eventPropGetter={(event: any) => {
            const { bg } = getEventColors(event.work_item_type || 'ad_hoc', true, false);
            // Convert Tailwind class to actual color
            let backgroundColor = 'rgb(var(--color-border-200))';
            if (bg.includes('primary')) {
              backgroundColor = 'rgb(var(--color-primary-200))';
            } else if (bg.includes('secondary')) {
              backgroundColor = 'rgb(var(--color-secondary-100))';
            } else if (bg.includes('accent')) {
              backgroundColor = 'rgb(var(--color-accent-100))';
            }
            
            return {
              style: {
                backgroundColor,
                borderRadius: '4px',
                color: 'rgb(var(--color-text-900))',
                border: 'none',
                transition: 'background-color 0.2s'
              }
            };
          }}
          draggableAccessor={() => false} // Disable dragging
          resizableAccessor={() => false} // Disable resizing
        />
      </div>
    </div>
  );
};

export default AgentScheduleDrawer;
