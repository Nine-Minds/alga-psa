import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Calendar, momentLocalizer, View, NavigateAction } from 'react-big-calendar';
import { Button } from 'server/src/components/ui/Button';
import { Switch } from 'server/src/components/ui/Switch';
import { CalendarDays, Layers2 } from 'lucide-react';
import moment from 'moment';
import withDragAndDrop, { withDragAndDropProps } from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { IScheduleEntry } from 'server/src/interfaces/schedule.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { CalendarStyleProvider } from 'server/src/components/schedule/CalendarStyleProvider';
import { getEventColors } from './utils';

const localizer = momentLocalizer(moment);

const DnDCalendar = withDragAndDrop(Calendar);

interface WeeklyTechnicianScheduleGridProps {
  date: Date;
  primaryTechnicianId: string | null;
  comparisonTechnicianIds: string[];
  allTechnicians: IUserWithRoles[];
  events: IScheduleEntry[];
  onNavigate: (newDate: Date, view: string, action: string) => void;
  onViewChange: (view: string) => void;
  onComparisonChange: (technicianId: string, add: boolean) => void;
  onSelectSlot: (slotInfo: { start: Date; end: Date; slots: Date[] | string[]; action: 'select' | 'click' | 'doubleClick', resourceId?: number | string }) => void;
  onEventDrop: any;
  onEventResize: any;
  onDropFromList: (item: { workItemId: string; start: Date; end: Date; resourceId: string | number }) => void;
  onSelectEvent?: (event: IScheduleEntry, e: React.SyntheticEvent<HTMLElement>) => void;
  onSetFocus?: (technicianId: string) => void;
}

// Custom component for the sidebar with technician names
const TechnicianSidebar = ({ 
  technicians, 
  primaryTechnicianId, 
  comparisonTechnicianIds,
  onSetFocus,
  onComparisonChange
}: { 
  technicians: IUserWithRoles[]; 
  primaryTechnicianId: string | null;
  comparisonTechnicianIds: string[];
  onSetFocus?: (technicianId: string) => void;
  onComparisonChange: (technicianId: string, add: boolean) => void;
}) => {
  return (
    <div className="w-48 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto">
      {technicians.map(tech => {
        const isFocus = tech.user_id === primaryTechnicianId;
        const isComparing = comparisonTechnicianIds.includes(tech.user_id);

        return (
          <div 
            key={tech.user_id} 
            className={`h-16 mb-4 flex items-center justify-between text-[rgb(var(--color-text-700))] pl-2 rounded-md ${
              isFocus 
                ? 'bg-[rgb(var(--color-primary-200))]' 
                : isComparing 
                  ? 'bg-[rgb(var(--color-primary-50))]' 
                  : ''
            }`}
          >
            <span className="truncate">{tech.first_name} {tech.last_name}</span>
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
                  aria-label={`View week for ${tech.first_name} ${tech.last_name}`}
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
                  aria-label={`Compare ${tech.first_name} ${tech.last_name}`}
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
}) => {
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);

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
        .filter(tech => tech !== undefined) as IUserWithRoles[];
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
      onEventDrop(args);
    } else {
      console.log("Prevented drop of comparison event.");
    }
  }, [primaryTechnicianId, onEventDrop]);

  const handleEventResize = useCallback((args: any) => {
    const { event, start, end } = args;
    
    if (primaryTechnicianId && event.assigned_user_ids && event.assigned_user_ids.includes(primaryTechnicianId)) {
      onEventResize(args);
    } else {
      console.log("Prevented resize of comparison event.");
    }
  }, [primaryTechnicianId, onEventResize]);

  // Handle drop from work item list
  const handleDropFromList = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    try {
      const data = e.dataTransfer.getData('application/json');
      if (!data) {
        console.error("No data transferred");
        return;
      }
      
      const { workItemId } = JSON.parse(data);
      if (!workItemId) {
        console.error("workItemId not found in transferred data");
        return;
      }

      const rect = calendarRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      const startTime = new Date();
      startTime.setHours(9, 0, 0, 0);
      
      const endTime = new Date(startTime);
      endTime.setHours(startTime.getHours() + 1);
      
      const resourceId = primaryTechnicianId || (displayedTechnicians.length > 0 ? displayedTechnicians[0].user_id : 'unknown');
      
      onDropFromList({
        workItemId,
        start: startTime,
        end: endTime,
        resourceId
      });
    } catch (error) {
      console.error("Error handling drop from list:", error);
    }
  }, [primaryTechnicianId, displayedTechnicians, onDropFromList]);

  const draggableAccessor = useCallback((event: object) => {
    const scheduleEvent = event as IScheduleEntry;
    return primaryTechnicianId !== null && 
           scheduleEvent?.assigned_user_ids && 
           scheduleEvent.assigned_user_ids.includes(primaryTechnicianId);
  }, [primaryTechnicianId]);


  const EventComponent = useCallback(({ event }: { event: any }) => {
    const scheduleEvent = event as IScheduleEntry;
    const isPrimary = primaryTechnicianId !== null &&
                     scheduleEvent.assigned_user_ids?.includes(primaryTechnicianId);
    const isComparison = !isPrimary &&
                         comparisonTechnicianIds.length > 0 &&
                         scheduleEvent.assigned_user_ids?.some(id => comparisonTechnicianIds.includes(id));

    const workItemType = scheduleEvent.work_item_type || 'ticket';
    const { bg, text } = getEventColors(workItemType, isPrimary, isComparison);

    // Find assigned technician names for tooltip
    const assignedTechnicians = allTechnicians
      .filter(tech => scheduleEvent.assigned_user_ids?.includes(tech.user_id))
      .map(tech => `${tech.first_name} ${tech.last_name}`)
      .join(', ');

    // Format date and time for tooltip
    const startMoment = moment(scheduleEvent.scheduled_start);
    const endMoment = moment(scheduleEvent.scheduled_end);
    const formattedDate = startMoment.format('MMM D, YYYY');
    const formattedTime = `${startMoment.format('h:mm A')} - ${endMoment.format('h:mm A')}`;

    // Construct detailed tooltip
    const tooltipTitle = `${scheduleEvent.title}\nTechnician: ${assignedTechnicians || 'Unassigned'}\nDate: ${formattedDate}\nTime: ${formattedTime}`;

    return (
      <div
        className={`absolute inset-0 text-xs overflow-hidden rounded-md ${bg} ${text}`}
        onMouseEnter={() => setHoveredEventId(scheduleEvent.entry_id)}
        onMouseLeave={() => setHoveredEventId(null)}
        title={tooltipTitle}
        style={{ 
          width: '100%', 
          height: '100%',
          margin: 0,
          padding: '4px',
          border: isComparison ? '2px dashed rgb(var(--color-border-600))' : 'none'
        }}
      >
        <div className="font-semibold truncate">{scheduleEvent.title?.split(':')[0] || 'Untitled'}</div>
        <div className="truncate text-xs">{scheduleEvent.title?.split(':').slice(1).join(':').trim() || ''}</div>
      </div>
    );
  }, [primaryTechnicianId, comparisonTechnicianIds, hoveredEventId, allTechnicians]);

  return (
    <div className="h-full flex overflow-hidden" ref={calendarRef} onDragOver={(e) => e.preventDefault()} onDrop={handleDropFromList}>
      {/* Technician sidebar - show ALL technicians, not just displayed ones */}
      <TechnicianSidebar 
        technicians={allTechnicians}
        primaryTechnicianId={primaryTechnicianId}
        comparisonTechnicianIds={comparisonTechnicianIds}
        onSetFocus={onSetFocus}
        onComparisonChange={onComparisonChange}
      />
      
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
            if (onSelectEvent) {
              onSelectEvent(event as IScheduleEntry, e);
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
            event: EventComponent
          }}
          toolbar={false}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  );
};

export default WeeklyTechnicianScheduleGrid;
