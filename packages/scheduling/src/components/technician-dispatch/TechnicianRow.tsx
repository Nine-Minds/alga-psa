import React from 'react';
import { IScheduleEntry } from '@alga-psa/types';
import { IUser } from '@shared/interfaces/user.interfaces';
import TimeSlot from './TimeSlot';
import ScheduleEvent from './ScheduleEvent';

interface HighlightedSlot {
  techId: string;
  timeSlot: string;
}

interface TechnicianRowProps {
  tech: Omit<IUser, 'tenant'>;
  timeSlots: string[];
  events: Omit<IScheduleEntry, 'tenant'>[];
  selectedDate: Date;
  highlightedSlots: Set<HighlightedSlot> | null;
  isDragging: boolean;
  dragState: any;
  hoveredEventId: string | null;
  isResizing: boolean;
  getEventPosition: (event: Omit<IScheduleEntry, 'tenant'>) => { left: string; width: string };
  onTimeSlotMouseOver: (e: React.MouseEvent, timeSlot: string, techId: string) => void;
  onTimeSlotDragOver: (e: React.DragEvent, timeSlot: string, techId: string) => void;
  onDrop: (e: React.DragEvent, timeSlot: string, techId: string) => void;
  onEventMouseDown: (e: React.MouseEvent, event: Omit<IScheduleEntry, 'tenant'>) => void;
  onEventDelete: (e: React.MouseEvent, eventId: string) => void;
  onEventResizeStart: (e: React.MouseEvent, event: Omit<IScheduleEntry, 'tenant'>, direction: 'left' | 'right') => void;
  onEventClick: (event: Omit<IScheduleEntry, 'tenant'>) => void;
  onTechnicianClick: (technicianId: string) => void;
}

const TechnicianRow: React.FC<TechnicianRowProps> = ({
  tech,
  timeSlots,
  events,
  selectedDate,
  highlightedSlots,
  isDragging,
  dragState,
  hoveredEventId,
  getEventPosition,
  onTimeSlotMouseOver,
  onTimeSlotDragOver,
  onDrop,
  onEventMouseDown,
  onEventDelete,
  onEventResizeStart,
  isResizing,
  onEventClick,
  onTechnicianClick,
}) => {
  return (
    <div
      className="technician-row relative h-16 border border-[rgb(var(--color-border-200))] min-w-[2880px] mb-4"
      data-tech-id={tech.user_id}
    >
      <div className="grid grid-cols-96 h-full" style={{ width: '2880px' }}>
        {timeSlots.map((timeSlot, index): React.JSX.Element => {
          const isHourBoundary = index % 4 === 0;
          const isHighlighted = Array.from(highlightedSlots || []).some(
            (slot) => slot.timeSlot === timeSlot && slot.techId === tech.user_id
          );
          const hour = parseInt(timeSlot);
          const isWorkingHour = hour >= 8 && hour < 17;
          
          return (
            <TimeSlot
              key={timeSlot}
              timeSlot={timeSlot}
              isHourBoundary={isHourBoundary}
              isHighlighted={isHighlighted}
              isWorkingHour={isWorkingHour}
              onMouseOver={(e) => onTimeSlotMouseOver(e, timeSlot, tech.user_id)}
              onDragOver={(e) => onTimeSlotDragOver(e, timeSlot, tech.user_id)}
              onDrop={(e) => onDrop(e, timeSlot, tech.user_id)}
            />
          );
        })}
      </div>

      {events
        .filter(
          (event) =>
            event.assigned_user_ids.includes(tech.user_id) &&
            new Date(event.scheduled_start).toDateString() === selectedDate.toDateString()
        )
        .map((event): React.JSX.Element => {
          const isDraggingThis = isDragging && dragState?.sourceId === event.entry_id;
          const effectiveEvent = isDraggingThis
            ? {
              ...event,
              scheduled_start: dragState.currentStart,
              scheduled_end: dragState.currentEnd,
              assigned_user_ids: [dragState.currentTechId]
            }
            : event;

          return (
            <ScheduleEvent
              key={event.entry_id}
              event={effectiveEvent}
              position={getEventPosition(effectiveEvent)}
              isDragging={isDraggingThis}
              isHovered={hoveredEventId === event.entry_id}
              onMouseDown={(e) => onEventMouseDown(e, event)}
              onMouseEnter={() => {}}  // This will be handled by parent component
              onMouseLeave={() => {}}  // This will be handled by parent component
              onDelete={(e) => onEventDelete(e, event.entry_id)}
              onResizeStart={(e, direction) => onEventResizeStart(e, event, direction)}
              isResizing={false} 
              onClick={() => onEventClick(event)}
            />
          );
        })}
    </div>
  );
};

export default TechnicianRow;
