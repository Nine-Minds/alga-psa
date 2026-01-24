 import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Calendar, momentLocalizer, View, NavigateAction } from 'react-big-calendar';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { CalendarDays, Layers, Layers2, XCircle } from 'lucide-react';
import WeeklyScheduleEvent from './WeeklyScheduleEvent';
import moment from 'moment';
import withDragAndDrop, { withDragAndDropProps } from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { IScheduleEntry } from '@alga-psa/types';
import { IUser } from '@shared/interfaces/user.interfaces';
import { CalendarStyleProvider } from '@alga-psa/scheduling/components/schedule/CalendarStyleProvider';
import { isWorkingHour } from './utils';

const localizer = momentLocalizer(moment);

const DnDCalendar = withDragAndDrop(Calendar);

interface WeeklyTechnicianScheduleGridProps {
  date: Date;
  primaryTechnicianId: string | null;
  comparisonTechnicianIds: string[];
  allTechnicians: IUser[];
  events: IScheduleEntry[];
  onNavigate: (newDate: Date, view: string, action: string) => void;
  onViewChange: (view: string) => void;
  onComparisonChange: (technicianId: string, add: boolean) => void;
  onSelectSlot: (slotInfo: { start: Date; end: Date; slots: Date[] | string[]; action: 'select' | 'click' | 'doubleClick', resourceId?: number | string }) => void;
  onEventDrop: any;
  onEventResize?: any;
  onDropFromList?: (item: { workItemId: string; start: Date; end: Date; resourceId: string | number }) => void;
  onSelectEvent?: (event: IScheduleEntry, e: React.SyntheticEvent<HTMLElement>) => void;
  onSetFocus?: (technicianId: string) => void;
  onResetSelections?: () => void;
  onSelectAll?: () => void;
  onDeleteEvent?: (eventId: string) => void;
  canEdit?: boolean;
}

// Custom component for the sidebar with technician names
const TechnicianSidebar = ({ 
  technicians, 
  primaryTechnicianId, 
  comparisonTechnicianIds,
  onSetFocus,
  onComparisonChange,
  onResetSelections,
  onSelectAll
}: { 
  technicians: IUser[];
  primaryTechnicianId: string | null;
  comparisonTechnicianIds: string[];
  onSetFocus?: (technicianId: string) => void;
  onComparisonChange: (technicianId: string, add: boolean) => void;
  onResetSelections?: () => void;
  onSelectAll?: () => void;
}) => {
  return (
    <div className="w-64 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto">
      <div className="p-2 border-gray-200">
        <div className="flex justify-center gap-1">
          <Button
            id="select-all-button"
            variant="outline"
            size="sm"
            onClick={onSelectAll}
            className="text-xs px-2 py-1 h-7"
          >
            <Layers className="h-4 w-4 mr-1" />
            Compare All
          </Button>
          <Button
            id="reset-selections-button"
            variant="outline"
            size="sm"
            onClick={onResetSelections}
            className="text-xs px-2 py-1 h-7"
            disabled={!primaryTechnicianId && comparisonTechnicianIds.length === 0}
          >
            <XCircle className="h-4 w-4 mr-1" />
            Clear All
          </Button>
        </div>
      </div>
      {technicians.map(tech => {
        const isFocus = tech.user_id === primaryTechnicianId;
        const isComparing = comparisonTechnicianIds.includes(tech.user_id);

        return (
          <div 
            key={tech.user_id} 
            className={`h-16 mb-4 flex items-center justify-between pl-2 rounded-md ${
              isFocus 
                ? 'bg-[rgb(var(--color-primary-200))]' 
                : isComparing 
                  ? 'bg-[rgb(var(--color-primary-50))]' 
                  : ''
            } ${tech.is_inactive ? 'text-[rgb(var(--color-text-300))] opacity-75' : 'text-[rgb(var(--color-text-600))]'}`}
          >
            <span className={`truncate ${tech.is_inactive ? 'text-[rgb(var(--color-text-400))]' : ''}`}>{tech.first_name} {tech.last_name}</span>
            <div className="flex items-center flex-shrink-0">
              {!isFocus && (
                <Button
                  id={`view-week-${tech.user_id}`}
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (onSetFocus) {
                      onSetFocus(tech.user_id);
                    }
                  }}
                  tooltipText="View Week"
                  tooltip={true}
                  aria-label={`View week for ${tech.first_name} ${tech.last_name}${tech.is_inactive ? ' (Inactive)' : ''}`}
                >
                  <CalendarDays className="h-4 w-4" />
                </Button>
              )}
              {!isFocus && (
                <Button
                  id={`compare-tech-${tech.user_id}`}
                  variant={isComparing ? "default" : "ghost"}
                  size="sm"
                  onClick={() => onComparisonChange(tech.user_id, !isComparing)}
                  tooltipText={isComparing ? "Stop Comparing" : "Compare"}
                  tooltip={true}
                  aria-label={`Compare ${tech.first_name} ${tech.last_name}${tech.is_inactive ? ' (Inactive)' : ''}`}
                >
                  <Layers2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const WeeklyTechnicianScheduleGrid: React.FC<WeeklyTechnicianScheduleGridProps> = ({
  date,
  primaryTechnicianId,
  comparisonTechnicianIds,
  allTechnicians,
  events,
  onNavigate,
  onViewChange,
  onSelectSlot,
  onComparisonChange,
  onEventDrop,
  onEventResize,
  onDropFromList,
  onSelectEvent,
  onSetFocus,
  onDeleteEvent,
  onResetSelections,
  onSelectAll,
  canEdit,
}) => {
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [hasScrolled, setHasScrolled] = useState(false);
  
  // Auto-scroll to business hours when the calendar loads
  useEffect(() => {
    if (!hasScrolled && calendarRef.current) {
      const scrollToBusinessHours = () => {
        const timeGridContainer = calendarRef.current?.querySelector('.rbc-time-content');
        if (timeGridContainer) {
          const pixelsPerHour = 121;
          const scrollToHour = 8;
          const scrollPosition = scrollToHour * pixelsPerHour;
          
          timeGridContainer.scrollTo({
            top: scrollPosition,
            behavior: 'smooth'
          });
          setHasScrolled(true);
        }
      };
      
      setTimeout(scrollToBusinessHours, 100);
    }
  }, [hasScrolled]);

  // Get the technicians to display
  const displayedTechnicians = useMemo(() => {
    const technicianUuids = [primaryTechnicianId, ...comparisonTechnicianIds].filter(id => id !== null) as string[];
    const sortedUuids = technicianUuids.sort((a, b) => {
        if (a === primaryTechnicianId) return -1;
        if (b === primaryTechnicianId) return 1;
        return 0;
    });
    return sortedUuids
        .map(uuid => allTechnicians.find(tech => tech.user_id === uuid))
        .filter(tech => tech !== undefined) as IUser[];
  }, [primaryTechnicianId, comparisonTechnicianIds, allTechnicians]);

  const filteredEvents = useMemo(() => {
    const techIds = new Set(displayedTechnicians.map(tech => tech.user_id));
    return events.filter(event => 
      event.assigned_user_ids.some(id => techIds.has(id))
    );
  }, [events, displayedTechnicians]);

  const eventPropGetter = useCallback((event: IScheduleEntry) => {
    const isPrimaryEvent = primaryTechnicianId !== null &&
                          event.assigned_user_ids?.includes(primaryTechnicianId);

    const isComparisonEvent = !isPrimaryEvent &&
                              comparisonTechnicianIds.length > 0 &&
                              event.assigned_user_ids?.some(id => comparisonTechnicianIds.includes(id));

    const opacity = isPrimaryEvent ? 1 : (isComparisonEvent ? 0.3 : 1);

    const style: React.CSSProperties = {
      opacity,
      backgroundColor: 'transparent',
      border: 'none',
      borderRadius: '0px',
      padding: '0px',
      boxShadow: 'none',
      color: 'inherit',
    };

    return { style };
  }, [primaryTechnicianId, comparisonTechnicianIds]);

  const handleEventDrop = useCallback((args: any) => {
    const { event, start, end, resourceId } = args;
    
    if (primaryTechnicianId && event.assigned_user_ids && event.assigned_user_ids.includes(primaryTechnicianId)) {
      const assignedUserIds = resourceId
        ? (Array.isArray(resourceId)
            ? resourceId.filter((id: string | null | undefined) => id !== null && id !== undefined)
            : [resourceId].filter((id: string | null | undefined) => id !== null && id !== undefined))
        : event.assigned_user_ids.filter((id: string | null | undefined) => id !== null && id !== undefined);
      
      const finalAssignedUserIds = assignedUserIds.length > 0
        ? assignedUserIds
        : [primaryTechnicianId];
      
      const updatedEvent = {
        ...event,
        assigned_user_ids: finalAssignedUserIds
      };
      
      onEventDrop?.({
        ...args,
        event: updatedEvent
      });
    } else {
      console.log("Prevented drop of comparison event.");
    }
  }, [primaryTechnicianId, onEventDrop]);

  const handleEventResize = useCallback((args: any) => {
    const { event, start, end } = args;
    
    if (primaryTechnicianId && event.assigned_user_ids && event.assigned_user_ids.includes(primaryTechnicianId)) {
      onEventResize?.(args);
    } else {
      console.log("Prevented resize of comparison event.");
    }
  }, [primaryTechnicianId, onEventResize]);

  const handleResizeStart = useCallback((e: React.MouseEvent, event: IScheduleEntry, direction: 'top' | 'bottom') => {
    e.stopPropagation();
    
    if (!primaryTechnicianId || !event.assigned_user_ids.includes(primaryTechnicianId)) {
      console.log("Prevented resize of comparison event.");
      return;
    }
    
    const startY = e.clientY;
    const initialStart = new Date(event.scheduled_start);
    const initialEnd = new Date(event.scheduled_end);
    
    const handleResizeMove = (moveEvent: MouseEvent) => {
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
          return;
        }
      } else {
        newEnd = new Date(initialEnd.getTime() + deltaMinutes * 60000);
        if (newEnd.getTime() - newStart.getTime() < 15 * 60000) {
          return;
        }
      }
      
      onEventResize?.({
        event,
        start: direction === 'top' ? newStart : initialStart,
        end: direction === 'bottom' ? newEnd : initialEnd
      });
    };
    
    const handleResizeEnd = (finalEvent: MouseEvent) => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      
      // Calculate final position and save
      const deltaY = finalEvent.clientY - startY;
      const deltaMinutes = Math.round(deltaY / 20) * 15;
      
      let finalStart = new Date(initialStart);
      let finalEnd = new Date(initialEnd);
      
      if (direction === 'top') {
        finalStart = new Date(initialStart.getTime() + deltaMinutes * 60000);
        if (finalEnd.getTime() - finalStart.getTime() < 15 * 60000) {
          return; // Don't save if too short
        }
      } else {
        finalEnd = new Date(initialEnd.getTime() + deltaMinutes * 60000);
        if (finalEnd.getTime() - finalStart.getTime() < 15 * 60000) {
          return; // Don't save if too short
        }
      }
      
      // Call onEventResize with final values to persist the change
      onEventResize?.({
        event,
        start: finalStart,
        end: finalEnd
      });
    };
    
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  }, [primaryTechnicianId, onEventResize]);

  // Handle drop from work item list
  const handleDropFromList = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    try {
      // Try to get data from both formats
      let workItemId: string | null = null;
      
      // First try application/json format
      const jsonData = e.dataTransfer.getData('application/json');
      if (jsonData) {
        try {
          const parsed = JSON.parse(jsonData);
          workItemId = parsed.workItemId;
        } catch (jsonError) {
          console.error("Error parsing JSON data:", jsonError);
        }
      }
      
      // If that fails, try text/plain format
      if (!workItemId) {
        workItemId = e.dataTransfer.getData('text/plain');
      }
      
      if (!workItemId) {
        console.error("No workItemId found in transferred data");
        return;
      }

      const calendarRect = calendarRef.current?.getBoundingClientRect();
      if (!calendarRect) return;
      
      const calendarDOMNode = calendarRef.current?.querySelector('.rbc-time-view');
      if (!calendarDOMNode) return;
      
      const calendarViewRect = calendarDOMNode.getBoundingClientRect();
      
      const dayCells = calendarDOMNode.querySelectorAll('.rbc-day-slot');
      if (!dayCells || dayCells.length === 0) return;
      
      let targetDayCell: Element | null = null;
      let targetDayCellIndex = -1;
      
      for (let i = 0; i < dayCells.length; i++) {
        const cellRect = dayCells[i].getBoundingClientRect();
        if (
          e.clientX >= cellRect.left &&
          e.clientX <= cellRect.right
        ) {
          targetDayCell = dayCells[i];
          targetDayCellIndex = i;
          break;
        }
      }
      
      if (!targetDayCell || targetDayCellIndex === -1) {
        console.error("Could not determine day for drop");
        return;
      }
      
      const startOfWeek = moment(date).startOf('week').toDate();
      const dropDate = new Date(startOfWeek);
      dropDate.setDate(dropDate.getDate() + targetDayCellIndex);
      
      const cellRect = targetDayCell.getBoundingClientRect();
      const cellHeight = cellRect.height;
      const relativeY = e.clientY - cellRect.top;
      
      const totalSlots = 24 * 4;
      const slotHeight = cellHeight / totalSlots;
      const slotIndex = Math.floor(relativeY / slotHeight);
      
      const hours = Math.floor(slotIndex / 4);
      const minutes = (slotIndex % 4) * 15;
      
      const startTime = new Date(dropDate);
      startTime.setHours(hours, minutes, 0, 0);
      
      // Set end time to 1 hour later
      const endTime = new Date(startTime);
      endTime.setHours(startTime.getHours() + 1);
      
      // Use primary technician or first displayed technician
      const resourceId = primaryTechnicianId ||
        (displayedTechnicians.length > 0 ? displayedTechnicians[0].user_id : 'unknown');
      
      console.log(`Dropping workitem at ${startTime.toLocaleString()} (day ${targetDayCellIndex}, hour ${hours}, minute ${minutes})`);
      
      onDropFromList?.({
        workItemId,
        start: startTime,
        end: endTime,
        resourceId
      });
    } catch (error) {
      console.error("Error handling drop from list:", error);
    }
  }, [primaryTechnicianId, displayedTechnicians, onDropFromList, date]);

  const draggableAccessor = useCallback((event: object) => {
    const scheduleEvent = event as IScheduleEntry;
    
    // Check if the event is private and the user is not the creator
    const isPrivateEvent = scheduleEvent.is_private;
    const isCreator = primaryTechnicianId !== null &&
                     scheduleEvent?.assigned_user_ids &&
                     scheduleEvent.assigned_user_ids.length === 1 &&
                     scheduleEvent.assigned_user_ids[0] === primaryTechnicianId;
    
    // If the event is private and the user is not the creator, it cannot be dragged
    if (isPrivateEvent && !isCreator) {
      return false;
    }
    
    return primaryTechnicianId !== null &&
           scheduleEvent?.assigned_user_ids &&
           scheduleEvent.assigned_user_ids.includes(primaryTechnicianId);
  }, [primaryTechnicianId]);


  const handleDeleteEvent = useCallback((eventToDelete: IScheduleEntry) => {
    onDeleteEvent?.(eventToDelete.entry_id);
  }, [onDeleteEvent]);

  const technicianMap = useMemo(() => {
    return allTechnicians.reduce((map, tech) => {
      map[tech.user_id] = {
        first_name: tech.first_name || '',
        last_name: tech.last_name || ''
      };
      return map;
    }, {} as Record<string, { first_name: string; last_name: string }>);
  }, [allTechnicians]);

  const TimeSlotWrapper = useCallback((props: any) => {
    if (props.value) {
      const hour = props.value.getHours();
      const isWorkHour = isWorkingHour(hour);
      
      return (
        <div className={`${!isWorkHour ? 'bg-[rgb(var(--color-border-100))]' : ''}`}>
          {props.children}
        </div>
      );
    }
    
    return <div>{props.children}</div>;
  }, []);
  
  const EventComponent = useCallback(({ event }: { event: any }) => {
    const scheduleEvent = event as IScheduleEntry;
    const isPrimary = primaryTechnicianId !== null &&
                     scheduleEvent.assigned_user_ids?.includes(primaryTechnicianId);
    const isComparison = !isPrimary &&
                         comparisonTechnicianIds.length > 0 &&
                         scheduleEvent.assigned_user_ids?.some(id => comparisonTechnicianIds.includes(id));
    
    const isHovered = hoveredEventId === scheduleEvent.entry_id;

    return (
      <WeeklyScheduleEvent
        event={scheduleEvent}
        isHovered={isHovered}
        isPrimary={isPrimary}
        isComparison={isComparison}
        onMouseEnter={() => setHoveredEventId(scheduleEvent.entry_id)}
        onMouseLeave={() => setHoveredEventId(null)}
        onSelectEvent={(event, e) => {
          if (onSelectEvent) {
            onSelectEvent(event, e as unknown as React.SyntheticEvent<HTMLElement>);
          }
        }}
        onDeleteEvent={handleDeleteEvent}
        onResizeStart={handleResizeStart}
        technicianMap={technicianMap}
      />
    );
  }, [primaryTechnicianId, comparisonTechnicianIds, hoveredEventId, onSelectEvent, handleDeleteEvent, handleResizeStart, technicianMap]);

  return (
    <div className="h-full flex overflow-hidden" ref={calendarRef} onDragOver={(e) => e.preventDefault()} onDrop={handleDropFromList}>
      {/* Technician sidebar - only show when user has edit permissions */}
      {canEdit && (
        <TechnicianSidebar 
          technicians={allTechnicians}
          primaryTechnicianId={primaryTechnicianId}
          comparisonTechnicianIds={comparisonTechnicianIds}
          onSetFocus={onSetFocus}
          onComparisonChange={onComparisonChange}
          onResetSelections={onResetSelections}
          onSelectAll={onSelectAll}
        />
      )}
      
      {/* Calendar */}
      <div className="flex-1 overflow-hidden">
        <CalendarStyleProvider />
        <DnDCalendar
          localizer={localizer}
          events={filteredEvents}
          startAccessor={(event: any) => {
            const scheduleEvent = event as IScheduleEntry;
            return scheduleEvent?.scheduled_start || new Date();
          }}
          endAccessor={(event: any) => {
            const scheduleEvent = event as IScheduleEntry;
            return scheduleEvent?.scheduled_end || new Date();
          }}
          allDayAccessor={(event: any) => {
            const scheduleEvent = event as IScheduleEntry;
            const start = new Date(scheduleEvent.scheduled_start);
            const end = new Date(scheduleEvent.scheduled_end);

            // Check if event spans multiple days
            const isMultiDay = start.toDateString() !== end.toDateString();

            // Place multi-day events in the all-day section
            // They will maintain their visual height of 30px via CSS
            return isMultiDay;
          }}
          titleAccessor={(event: any) => {
            const scheduleEvent = event as IScheduleEntry;
            return scheduleEvent?.title || 'Untitled Event';
          }}
          view="week"
          views={["week"]}
          date={date}
          onNavigate={(newDate, view, action) => onNavigate(newDate, view as string, action as string)}
          selectable={true}
          onSelectSlot={onSelectSlot}
          onSelectEvent={(event, e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.dropdown-trigger') || 
                target.closest('.dropdown-menu-content') ||
                target.closest('[role="menu"]') ||
                target.closest('[data-radix-popper-content-wrapper]')) {
              e.stopPropagation();
              return;
            }
            
            if (onSelectEvent) {
              onSelectEvent(event as IScheduleEntry, e as unknown as React.SyntheticEvent<HTMLElement>);
            }
          }}
          eventPropGetter={(event) => eventPropGetter(event as IScheduleEntry)}
          onEventDrop={handleEventDrop}
          onEventResize={handleEventResize}
          draggableAccessor={draggableAccessor}
          resizableAccessor={draggableAccessor}
          step={15}
          timeslots={4}
          components={{
            event: EventComponent,
            timeSlotWrapper: TimeSlotWrapper
          }}
          toolbar={false}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  );
};

export default WeeklyTechnicianScheduleGrid;
