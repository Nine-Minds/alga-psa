import React from 'react';
import { Calendar, momentLocalizer, Views, View, NavigateAction, EventPropGetter, Components, ResourceHeaderProps } from 'react-big-calendar'; // Added Components, ResourceHeaderProps
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
  onDropFromList: (item: { workItemId: string; start: Date; end: Date; resourceId: string | number }) => void;
  onSelectEvent?: (event: IScheduleEntry, e: React.SyntheticEvent<HTMLElement>) => void;
}

const CustomResourceHeader: React.FC<ResourceHeaderProps> = ({ label }) => {
    return <div>{label}</div>;
};


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
    let style: React.CSSProperties = {};

    const isPrimaryEvent = primaryTechnicianId !== null && event.assigned_user_ids?.includes(primaryTechnicianId);

    if (isPrimaryEvent) {
      style = {
        ...style,
        backgroundColor: 'rgb(var(--color-primary-500))',
        color: 'white',
        opacity: 1,
        border: '1px solid rgb(var(--color-primary-600))',
      };
    } else {
      // Style for comparison technicians' events
      style = {
        ...style,
        backgroundColor: 'rgb(var(--color-gray-300))',
        color: 'rgb(var(--color-gray-700))',
        opacity: 0.7,
        border: '1px dashed rgb(var(--color-gray-400))',
      };
    }

    return { style };
  };

  const handleEventDrop: withDragAndDropProps<IScheduleEntry, object>['onEventDrop'] = (args) => {
    if (onEventDrop) {
        const isPrimaryEvent = primaryTechnicianId !== null && args.event.assigned_user_ids?.includes(primaryTechnicianId);
        if (isPrimaryEvent) {
            onEventDrop(args);
        } else {
            console.log("Prevented drop of comparison event.");
        }
    }
  };

   const handleEventResize: withDragAndDropProps<IScheduleEntry, object>['onEventResize'] = (args) => {
     if (onEventResize) {
        const isPrimaryEvent = primaryTechnicianId !== null && args.event.assigned_user_ids?.includes(primaryTechnicianId);
        if (isPrimaryEvent) {
            onEventResize(args);
        } else {
             console.log("Prevented resize of comparison event.");
        }
    }
   }

   const draggableAccessor = (event: object) => {
       const scheduleEvent = event as IScheduleEntry;
       return primaryTechnicianId !== null && !!scheduleEvent.assigned_user_ids?.includes(primaryTechnicianId);
   };

   const resizableAccessor = (event: object) => {
       const scheduleEvent = event as IScheduleEntry;
       return primaryTechnicianId !== null && !!scheduleEvent.assigned_user_ids?.includes(primaryTechnicianId);
   };

   const handleDropFromList = (e: React.DragEvent<HTMLDivElement>) => {
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

           const placeholderStart = new Date();
           const placeholderEnd = moment(placeholderStart).add(1, 'hour').toDate();
           const placeholderResourceId = primaryTechnicianId || (resources.length > 0 ? resources[0].user_id : 'unknown'); // Default to primary or first resource

           onDropFromList({
               workItemId,
               start: placeholderStart,
               end: placeholderEnd,
               resourceId: placeholderResourceId
           });

       } catch (error) {
           console.error("Error handling drop from list:", error);
       }
   };

  return (
    <div
        style={{ height: 'calc(100vh - 200px)' }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropFromList}
    >
      <CalendarStyleProvider />
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
        draggableAccessor={draggableAccessor}
        resizableAccessor={resizableAccessor}
        components={{
            resourceHeader: CustomResourceHeader
        }}
        toolbar={false}
      />
    </div>
  );
};

export default WeeklyDispatchCalendar;