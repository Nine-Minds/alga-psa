import React from 'react';
import { Calendar, momentLocalizer, Views, View, NavigateAction, EventPropGetter } from 'react-big-calendar';
import moment from 'moment';
import withDragAndDrop, { withDragAndDropProps } from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { IScheduleEntry } from 'server/src/interfaces/schedule.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { CalendarStyleProvider } from 'server/src/components/schedule/CalendarStyleProvider';

const localizer = momentLocalizer(moment);
const DnDCalendar = withDragAndDrop(Calendar);

interface WeeklyDispatchCalendarProps {
  date: Date;
  primaryTechnicianId: string | null;
  comparisonTechnicianIds: string[];
  allTechnicians: IUserWithRoles[];
  events: IScheduleEntry[];
  onNavigate: (newDate: Date, view: View, action: NavigateAction) => void;
  onViewChange: (view: View) => void;
  onComparisonChange: (technicianId: number, add: boolean) => void;
  onSelectSlot: (slotInfo: { start: Date; end: Date; slots: Date[] | string[]; action: 'select' | 'click' | 'doubleClick', resourceId?: number | string }) => void;
  onEventDrop: withDragAndDropProps<IScheduleEntry, object>['onEventDrop'];
  onEventResize: withDragAndDropProps<IScheduleEntry, object>['onEventResize'];
  onDropFromList?: (item: { event: IScheduleEntry; start: Date; end: Date }) => void;
  onSelectEvent?: (event: IScheduleEntry, e: React.SyntheticEvent<HTMLElement>) => void;
}

const WeeklyDispatchCalendar: React.FC<WeeklyDispatchCalendarProps> = ({
  date,
  primaryTechnicianId,
  comparisonTechnicianIds,
  allTechnicians,
  events,
  onNavigate,
  onViewChange,
  onSelectSlot,
  onEventDrop,
  onEventResize,
  onDropFromList,
  onSelectEvent,
}) => {

  const resources = React.useMemo(() => {
    const technicianUuids = [primaryTechnicianId, ...comparisonTechnicianIds].filter(id => id !== null) as string[];
    // Ensure primary technician is always first in the resource list for consistent column order
    const sortedUuids = technicianUuids.sort((a, b) => {
        if (a === primaryTechnicianId) return -1;
        if (b === primaryTechnicianId) return 1;
        return 0; // Keep original order for comparison techs otherwise
    });
    return sortedUuids
        .map(uuid => allTechnicians.find(tech => tech.user_id === uuid))
        .filter(tech => tech !== undefined) as IUserWithRoles[];
  }, [primaryTechnicianId, comparisonTechnicianIds, allTechnicians]);

  const eventPropGetter: EventPropGetter<IScheduleEntry> = (event, start, end, isSelected) => {
    let style: React.CSSProperties = {
        // Base styles are now handled by CalendarStyleProvider
    };

    const isComparisonOnly =
      primaryTechnicianId !== null &&
      event.assigned_user_ids?.length > 0 &&
      !event.assigned_user_ids.includes(primaryTechnicianId) &&
      event.assigned_user_ids.some(id => comparisonTechnicianIds.includes(id));

    if (isComparisonOnly) {
      style = {
        ...style,
        backgroundColor: 'rgb(var(--color-border-200))', // Use theme variable for background
        color: 'rgb(var(--color-text-600))', // Use theme variable for text
        opacity: 0.7,
        border: '1px dashed rgb(var(--color-border-300))', // Add a subtle border
      };
    } else {
         // Explicitly set primary event background if needed, otherwise rely on global style
         style.backgroundColor = 'rgb(var(--color-primary-500))';
         style.color = 'white'; // Assuming primary events should have white text
    }

    // Placeholder for disabling drag/resize on comparison events
    // if (isComparisonOnly) {
    //   // Logic to disable DnD will be added here
    // }

    return { style };
  };

  const handleEventDrop: withDragAndDropProps<IScheduleEntry, object>['onEventDrop'] = (args) => {
    console.log("Dropped:", args);
    if (onEventDrop) {
        const isPrimaryEvent = primaryTechnicianId !== null && args.event.assigned_user_ids?.includes(primaryTechnicianId);
        const targetResourceId = args.resourceId;

        // Allow drop only if it's a primary event OR if dropping onto the primary technician's column
        if (isPrimaryEvent || targetResourceId === primaryTechnicianId) {
            // TODO: Add logic to potentially reassign user if dropped onto primary column
            onEventDrop(args);
        } else {
            console.log("Prevented drop of comparison event onto another comparison column.");
        }
    }
  };

   const handleEventResize: withDragAndDropProps<IScheduleEntry, object>['onEventResize'] = (args) => {
    console.log("Resized:", args);
     if (onEventResize) {
        const isPrimaryEvent = primaryTechnicianId !== null && args.event.assigned_user_ids?.includes(primaryTechnicianId);
        if (isPrimaryEvent) {
            onEventResize(args);
        } else {
             console.log("Prevented resize of comparison event.");
        }
    }
   }

  return (
    <div style={{ height: 'calc(100vh - 200px)' }}>
      <CalendarStyleProvider /> {/* Render the style provider */}
      <DnDCalendar
        localizer={localizer}
        events={events}
        startAccessor={(event: any) => (event as IScheduleEntry).scheduled_start}
        endAccessor={(event: any) => (event as IScheduleEntry).scheduled_end}
        allDayAccessor={(event: any) => !!(event as IScheduleEntry).is_recurring}
        titleAccessor={(event: any) => (event as IScheduleEntry).title}
        resourceIdAccessor={(resource: any) => (resource as IUserWithRoles).user_id}
        resourceTitleAccessor={(resource: any) => {
            const tech = resource as IUserWithRoles;
            return `${tech.first_name} ${tech.last_name}`;
        }}
        resources={resources}
        step={15}
        timeslots={4}
        defaultView={Views.WEEK}
        views={[Views.WEEK]}
        view={Views.WEEK}
        date={date}
        onNavigate={onNavigate}
        onView={() => onViewChange(Views.WEEK)}
        selectable={true}
        onSelectSlot={onSelectSlot}
        onSelectEvent={onSelectEvent as any}
        eventPropGetter={eventPropGetter as any}
        onEventDrop={handleEventDrop as any}
        onEventResize={handleEventResize as any}
        resizable
      />
    </div>
  );
};

export default WeeklyDispatchCalendar;