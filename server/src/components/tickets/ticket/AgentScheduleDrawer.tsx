'use client';

import React, { useEffect, useState, useRef } from 'react';
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
import { CalendarStyleProvider } from 'server/src/components/schedule/CalendarStyleProvider';
import { AgentScheduleDrawerStyles } from './AgentScheduleDrawerStyles';
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
  ad_hoc: 'rgb(var(--color-border-200))',
  interaction: 'rgb(220 252 231)', // Tailwind green-100
  appointment_request: 'rgb(254 205 211)' // Tailwind rose-200
};

const workItemHoverColors: Record<WorkItemType, string> = {
  ticket: 'rgb(var(--color-primary-300))',
  project_task: 'rgb(var(--color-secondary-200))',
  non_billable_category: 'rgb(var(--color-accent-200))',
  ad_hoc: 'rgb(var(--color-border-300))',
  interaction: 'rgb(187 247 208)', // Tailwind green-200
  appointment_request: 'rgb(253 164 175)' // Tailwind rose-300
};


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
  const [hasScrolled, setHasScrolled] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [previousView, setPreviousView] = useState<View>('day');

  // Add useEffect for auto-scrolling to working hours
  useEffect(() => {
    if (!hasScrolled && calendarRef.current && (view === 'day' || view === 'week')) {
      // Wait for the calendar to fully render
      setTimeout(() => {
        // Find the time slots container
        const timeSlotContainer = calendarRef.current?.querySelector('.rbc-time-content');
        if (timeSlotContainer) {
          // Calculate scroll position based on the actual height of time slots
          const timeSlots = timeSlotContainer.querySelectorAll('.rbc-timeslot-group');
          if (timeSlots.length > 0) {
            // Get the height of a single time slot
            const slotHeight = timeSlots[0].clientHeight;
            // Scroll to 8 AM (8 slots from the top)
            timeSlotContainer.scrollTop = 8 * slotHeight;
            console.log('Auto-scrolled to 8 AM, position:', 8 * slotHeight);
          } else {
            // Fallback to a fixed value if we can't determine the slot height
            timeSlotContainer.scrollTop = 320; // Approximate height for 8 hours
          }
          setHasScrolled(true);
        }
      }, 500); // Longer delay to ensure the calendar is fully rendered
    }
  }, [view, hasScrolled, events]);

  // Event component for different calendar views
  const EventComponent = ({ event }: BigCalendarEventProps<IScheduleEntry>) => {
    const scheduleEvent = event;
    const isHovered = hoveredEventId === scheduleEvent.entry_id;
    
    // Format date and time for tooltip
    const startMoment = new Date(scheduleEvent.scheduled_start);
    const endMoment = new Date(scheduleEvent.scheduled_end);
    const formattedDate = startMoment.toLocaleDateString();
    const formattedTime = `${startMoment.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endMoment.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    // Check if this is a private event that the user doesn't own
    const isPrivateEvent = scheduleEvent.is_private;
    const isCreator = session?.user?.id === agentId &&
                     scheduleEvent.assigned_user_ids?.length === 1 &&
                     scheduleEvent.assigned_user_ids[0] === session?.user?.id;
    const isPrivateNonOwner = isPrivateEvent && !isCreator;
    
    // Construct detailed tooltip - show limited info for private events
    const tooltipTitle = isPrivateNonOwner
      ? `Busy\nDate: ${formattedDate}\nTime: ${formattedTime}`
      : `${scheduleEvent.title}\nDate: ${formattedDate}\nTime: ${formattedTime}`;
    
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
          <div className="font-semibold truncate text-[10px]">
            {isPrivateNonOwner ? "Busy" : scheduleEvent.title}
          </div>
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
        <div className="font-semibold truncate">
          {isPrivateNonOwner ? "Busy" : scheduleEvent.title}
        </div>
        <div className="text-xs opacity-80 truncate">{formattedTime}</div>
      </div>
    );
  };

  // Entry details skeleton component
  const EntryDetailsSkeleton = () => (
    <div className="h-full w-full p-4 animate-pulse">
      <div className="h-8 w-3/4 bg-gray-200 rounded mb-4"></div>
      <div className="h-6 w-1/2 bg-gray-200 rounded mb-2"></div>
      <div className="h-6 w-1/3 bg-gray-200 rounded mb-4"></div>
      
      <div className="h-px w-full bg-gray-200 my-4"></div>
      
      <div className="h-6 w-1/4 bg-gray-200 rounded mb-2"></div>
      <div className="h-24 w-full bg-gray-200 rounded mb-4"></div>
      
      <div className="h-6 w-1/4 bg-gray-200 rounded mb-2"></div>
      <div className="h-12 w-full bg-gray-200 rounded mb-4"></div>
      
      <div className="h-px w-full bg-gray-200 my-4"></div>
      
      <div className="flex justify-end space-x-2 mt-4">
        <div className="h-8 w-20 bg-gray-200 rounded"></div>
        <div className="h-8 w-20 bg-gray-200 rounded"></div>
      </div>
    </div>
  );

  // Handler for when a calendar event is selected
  const handleCalendarEventSelect = (scheduleEvent: IScheduleEntry) => {
    console.log('Event selected:', scheduleEvent.title, scheduleEvent.work_item_type);
    
    if (session?.user?.id) {
      // Check if this is a private event that the user doesn't own
      const isPrivateEvent = scheduleEvent.is_private;
      const isCreator = session?.user?.id === agentId &&
                       scheduleEvent.assigned_user_ids?.length === 1 &&
                       scheduleEvent.assigned_user_ids[0] === session?.user?.id;
      const isPrivateNonOwner = isPrivateEvent && !isCreator;
      
      setSelectedScheduleEntry(scheduleEvent);
      
      // Store the current view before navigating to details
      const currentView = view;
      setPreviousView(currentView);
      
      // Open the entry popup directly without showing skeleton first
      openDrawer(
        <EntryPopup
          event={scheduleEvent}
          onClose={() => {
            // Restore the previous view immediately when closing
            setView(currentView);
            closeDrawer();
          }}
          onSave={(entryData) => {
            console.log('AgentScheduleDrawer: EntryPopup save:', entryData);
            
            // Restore view and close drawer
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
            
            // Restore view and close drawer
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

  // Navigation functions with loading state
  const goToToday = () => {
    // Show loading state before changing date
    setIsLoading(true);
    setHasScrolled(false);
    setDate(new Date());
  };
  
  const goToPrev = () => {
    // Show loading state before changing date
    setIsLoading(true);
    setHasScrolled(false);
    
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
    // Show loading state before changing date
    setIsLoading(true);
    setHasScrolled(false);
    
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
    // Show loading state before changing view
    setIsLoading(true);
    setHasScrolled(false);
    setView(newView);
    // Also update the previous view so it's preserved if we navigate away
    setPreviousView(newView);
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
        <span className="rbc-toolbar-label">
          <div>{agentName || 'Agent Schedule'}</div>
          {view === 'day' && (
            <div className="text-sm font-normal">
              {date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          )}
        </span>
        <span className="rbc-btn-group">
          <button 
            type="button" 
            onClick={() => {
              handleViewChange('month');
              onView('month');
            }}
            className={`px-3 py-1 border border-gray-300 rounded-l-md ${view === 'month' ? 'bg-blue-500 text-white' : 'bg-white hover:bg-gray-100'}`}
          >
            Month
          </button>
          <button 
            type="button" 
            onClick={() => {
              handleViewChange('week');
              onView('week');
            }}
            className={`px-3 py-1 border-t border-b border-gray-300 ${view === 'week' ? 'bg-blue-500 text-white' : 'bg-white hover:bg-gray-100'}`}
          >
            Week
          </button>
          <button 
            type="button" 
            onClick={() => {
              handleViewChange('day');
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

// Simple skeleton loader component for the calendar
function CalendarSkeleton() {
  return (
    <div className="h-full w-full animate-pulse">
      {/* Toolbar skeleton */}
      <div className="flex justify-between items-center p-4 mb-4">
        <div className="flex space-x-2">
          <div className="h-8 w-20 bg-gray-200 rounded"></div>
          <div className="h-8 w-16 bg-gray-200 rounded"></div>
          <div className="h-8 w-20 bg-gray-200 rounded"></div>
        </div>
        <div className="h-8 w-48 bg-gray-200 rounded"></div>
        <div className="flex space-x-2">
          <div className="h-8 w-20 bg-gray-200 rounded"></div>
          <div className="h-8 w-16 bg-gray-200 rounded"></div>
          <div className="h-8 w-16 bg-gray-200 rounded"></div>
        </div>
      </div>
      
      {/* Calendar content skeleton */}
      <div className="border rounded bg-white h-[calc(100%-60px)]">
        {/* Calendar header */}
        <div className="border-b p-2">
          <div className="flex">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex-1 p-1">
                <div className="h-6 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        </div>
        
        {/* Calendar body */}
        <div className="h-[calc(100%-40px)] overflow-auto">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex border-b">
              <div className="w-16 p-2 border-r">
                <div className="h-4 w-12 bg-gray-200 rounded"></div>
              </div>
              <div className="flex-1 p-2">
                <div className="h-8 bg-gray-200 rounded mb-2"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Spinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "sm" ? "h-4 w-4" : size === "md" ? "h-8 w-8" : "h-12 w-12";
  return (
    <div className={`animate-spin rounded-full border-2 border-gray-300 border-t-blue-600 ${sizeClass}`}></div>
  );
}

if (isLoading) {
  return (
    <div className="flex flex-col h-full">
      <AgentScheduleDrawerStyles />
      <CalendarStyleProvider />
      <div className="h-full p-4">
        <CalendarSkeleton />
      </div>
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

  // Create a date object for 8 AM to auto-scroll to working hours
  const scrollToTime = new Date();
  scrollToTime.setHours(8, 0, 0, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Inject custom CSS */}
      <AgentScheduleDrawerStyles />
      <CalendarStyleProvider />
      
      {/* Calendar component with fixed header and scrollable content */}
      <div className="h-full flex flex-col" ref={calendarRef}>
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
          scrollToTime={scrollToTime} // Auto-scroll to 8 AM
          onNavigate={(action) => {
            // This is handled by our custom toolbar buttons
            console.log('Calendar navigation:', action);
          }}
          onView={(newView) => handleViewChange(newView as View)}
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
