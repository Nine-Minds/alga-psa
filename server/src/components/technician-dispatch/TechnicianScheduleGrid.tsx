'use client';

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { IScheduleEntry } from 'server/src/interfaces/schedule.interfaces';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import TimeHeader from './TimeHeader';
import TechnicianRow from './TechnicianRow';

// Discriminated union type for drop events
interface WorkItemDrop {
  type: 'workItem';
  workItemId: string;
  techId: string;
  startTime: Date;
}

interface EventDrop {
  type: 'scheduleEntry';
  eventId: string;
  techId: string;
  startTime: Date;
}

type DropEvent = WorkItemDrop | EventDrop;

interface DragState {
  sourceId: string;
  sourceType: 'workItem' | 'scheduleEntry';
  originalStart: Date;
  originalEnd: Date;
  currentStart: Date;
  currentEnd: Date;
  currentTechId: string;
  clickOffset15MinIntervals: number;
}

interface HighlightedSlot {
  techId: string;
  timeSlot: string;
}

interface TechnicianScheduleGridProps {
  technicians: Omit<IUser, 'tenant'>[];
  events: Omit<IScheduleEntry, 'tenant'>[];
  selectedDate: Date;
  onDrop: (dropEvent: DropEvent) => void;
  onResize: (eventId: string, techId: string, newStart: Date, newEnd: Date) => void;
  onDeleteEvent: (eventId: string) => void;
}

const TechnicianScheduleGrid: React.FC<TechnicianScheduleGridProps> = ({
  technicians,
  events,
  selectedDate,
  onDrop,
  onResize,
  onDeleteEvent
}) => {
  const scheduleGridRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [totalWidth, setTotalWidth] = useState<number>(0);
  const resizeTimeoutRef = useRef<NodeJS.Timeout>();
  const isDraggingRef = useRef(false);
  const dragStateRef = useRef<DragState | null>(null);
  const latestResizeRef = useRef<{
    eventId: string;
    techId: string;
    newStart: Date;
    newEnd: Date;
  } | null>(null);

  const resizingRef = useRef<{
    eventId: string,
    techId: string,
    startX: number,
    initialStart: Date,
    initialEnd: Date,
    resizeDirection: 'left' | 'right'
  } | null>(null);

  const [localEvents, setLocalEvents] = useState<Omit<IScheduleEntry, 'tenant'>[]>(events);
  const [isDragging, setIsDragging] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [isGridFocused, setIsGridFocused] = useState(false);
  const [highlightedSlots, setHighlightedSlots] = useState<Set<HighlightedSlot> | null>(null);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);

  useEffect(() => {
    setLocalEvents(events);
  }, [events]);

  useEffect(() => {
    const handleResize = () => {
      if (scheduleGridRef.current) {
        setTotalWidth(scheduleGridRef.current.offsetWidth);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const [hasScrolled, setHasScrolled] = useState(false);

  useEffect(() => {
    if (!hasScrolled && events.length > 0 && gridRef.current) {
      const scrollToBusinessHours = () => {
        const pixelsPerHour = 120; // 4 slots * 30px each
        const scrollToHour = 8;
        const scrollPosition = scrollToHour * pixelsPerHour;
        
        gridRef.current?.scrollTo({
          left: scrollPosition,
          behavior: 'smooth'
        });
        setHasScrolled(true);
      };

      scrollToBusinessHours();
    }
  }, [events, hasScrolled]); // Only run when events load and haven't scrolled yet

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (scheduleGridRef.current && !scheduleGridRef.current.contains(e.target as Node)) {
        setIsGridFocused(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  const handleDelete = useCallback((e: React.MouseEvent, eventId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this schedule entry?')) {
      onDeleteEvent(eventId);
      isDraggingRef.current = false;
      dragStateRef.current = null;
      resizingRef.current = null;
      setIsDragging(false);
      setDragState(null);
      setHighlightedSlots(null);
    }
  }, [onDeleteEvent]);

  const handleResizeStart = useCallback((e: React.MouseEvent, event: Omit<IScheduleEntry, 'tenant'>, direction: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();

    resizingRef.current = {
      eventId: event.entry_id,
      techId: event.assigned_user_ids[0], // Use first assigned user
      startX: e.clientX,
      initialStart: new Date(event.scheduled_start),
      initialEnd: new Date(event.scheduled_end),
      resizeDirection: direction
    };

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  }, []);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!resizingRef.current || !scheduleGridRef.current) return;

    const { eventId, techId, startX, initialStart, initialEnd, resizeDirection } = resizingRef.current;
    const deltaX = e.clientX - startX;

    // Fixed width for 24 hours (2880px = 24 hours * 4 slots/hour * 30px per slot)
    const totalWidth = 2880;
    const minutesPerPixel = (24 * 60) / totalWidth;
    const deltaMinutes = deltaX * minutesPerPixel;

    // Round to nearest 15 minutes
    const roundedMinutes = Math.round(deltaMinutes / 15) * 15;

    let newStart = new Date(initialStart);
    let newEnd = new Date(initialEnd);

    if (resizeDirection === 'left') {
      newStart = new Date(initialStart.getTime() + roundedMinutes * 60000);
      
      // Prevent invalid resizing
      if (newStart >= newEnd || (newEnd.getTime() - newStart.getTime()) < 900000) {
        return;
      }
    } else {
      newEnd = new Date(initialEnd.getTime() + roundedMinutes * 60000);
      
      // Prevent invalid resizing
      if (newEnd <= newStart || (newEnd.getTime() - newStart.getTime()) < 900000) {
        return;
      }
    }

    // Prevent resizing outside the 24-hour window
    const dayStart = new Date(selectedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(selectedDate);
    dayEnd.setHours(24, 0, 0, 0);

    if (newStart < dayStart || newEnd > dayEnd) {
      return;
    }

    // Store the latest values for the resize operation
    latestResizeRef.current = { eventId, techId, newStart, newEnd };

    // Use requestAnimationFrame for visual updates only
    requestAnimationFrame(() => {
      setLocalEvents(prevEvents =>
        prevEvents.map((event): Omit<IScheduleEntry, 'tenant'> => {
          if (event.entry_id === eventId) {
            return {
              ...event,
              scheduled_start: resizeDirection === 'left' ? newStart : event.scheduled_start,
              scheduled_end: resizeDirection === 'right' ? newEnd : event.scheduled_end
            };
          }
          return event;
        })
      );

      // Immediately call onResize with the latest values
      if (latestResizeRef.current) {
        onResize(
          latestResizeRef.current.eventId,
          latestResizeRef.current.techId,
          latestResizeRef.current.newStart,
          latestResizeRef.current.newEnd
        );
      }
    });
  }, [totalWidth, onResize, selectedDate]);

  const handleResizeEnd = useCallback(() => {
    if (latestResizeRef.current) {
      onResize(
        latestResizeRef.current.eventId,
        latestResizeRef.current.techId,
        latestResizeRef.current.newStart,
        latestResizeRef.current.newEnd
      );
      latestResizeRef.current = null;
    }

    resizingRef.current = null;

    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
  }, [handleResizeMove, onResize]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current || !dragStateRef.current || !scheduleGridRef.current) return;
  }, []);

  const handleMouseUp = useCallback((e: MouseEvent | React.DragEvent<Element>) => {
    if (dragStateRef.current) {
      let dropEvent: DropEvent;

      if (dragStateRef.current.sourceType === 'workItem') {
        dropEvent = {
          type: 'workItem',
          workItemId: dragStateRef.current.sourceId,
          techId: dragStateRef.current.currentTechId,
          startTime: dragStateRef.current.currentStart
        };
      } else {
        dropEvent = {
          type: 'scheduleEntry',
          eventId: dragStateRef.current.sourceId,
          techId: dragStateRef.current.currentTechId,
          startTime: dragStateRef.current.currentStart
        };
      }

      onDrop(dropEvent);
    }

    isDraggingRef.current = false;
    dragStateRef.current = null;
    setIsDragging(false);
    setDragState(null);
    setHighlightedSlots(new Set<HighlightedSlot>());

    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp as unknown as (e: MouseEvent) => void);
  }, [onDrop, handleMouseMove]);

  const handleMouseDown = useCallback((e: React.MouseEvent, event: Omit<IScheduleEntry, 'tenant'>) => {
    if ((e.target as HTMLElement).closest('.delete-button') ||
      (e.target as HTMLElement).classList.contains('resize-handle')) {
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clickPositionX = e.clientX - rect.left;

    const eventDuration = new Date(event.scheduled_end).getTime() - new Date(event.scheduled_start).getTime();
    const totalSlots = eventDuration / (15 * 60 * 1000);
    const slotWidth = rect.width / totalSlots;

    const clickOffset15MinIntervals = Math.floor(clickPositionX / slotWidth);

    const newDragState: DragState = {
      sourceId: event.entry_id,
      sourceType: 'scheduleEntry',
      originalStart: new Date(event.scheduled_start),
      originalEnd: new Date(event.scheduled_end),
      currentStart: new Date(event.scheduled_start),
      currentEnd: new Date(event.scheduled_end),
      currentTechId: event.assigned_user_ids[0], // Use first assigned user
      clickOffset15MinIntervals
    };

    isDraggingRef.current = true;
    dragStateRef.current = newDragState;

    setIsDragging(true);
    setDragState(newDragState);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove, handleMouseUp]);

  const generate15MinuteSlots = useCallback((): string[] => {
    const slots: string[] = [];
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
      }
    }
    return slots;
  }, []);

  const handleTimeSlotMouseOver = useCallback((e: React.MouseEvent, timeSlot: string, techId: string) => {
    if (!isDraggingRef.current || !dragStateRef.current) return;

    const [hours, minutes] = timeSlot.split(':').map(Number);
    const slotTime = new Date(selectedDate);
    slotTime.setHours(hours, minutes, 0, 0);

    if (dragStateRef.current.sourceType === 'workItem') {
      const slotsToHighlight = new Set<HighlightedSlot>();
      for (let i = 0; i < 4; i++) {
        const slotDate = new Date(slotTime.getTime() + (i * 15 * 60 * 1000));
        const slotHour = slotDate.getHours().toString().padStart(2, '0');
        const slotMinute = slotDate.getMinutes().toString().padStart(2, '0');
        slotsToHighlight.add({
          techId,
          timeSlot: `${slotHour}:${slotMinute}`
        });
      }

      setHighlightedSlots(slotsToHighlight);

      dragStateRef.current = {
        ...dragStateRef.current,
        currentStart: slotTime,
        currentEnd: new Date(slotTime.getTime() + 60 * 60 * 1000),
        currentTechId: techId
      };
      setDragState(dragStateRef.current);
      return;
    }

    const newStartTime = new Date(slotTime.getTime() -
      dragStateRef.current.clickOffset15MinIntervals * 15 * 60 * 1000);

    const duration = dragStateRef.current.originalEnd.getTime() -
      dragStateRef.current.originalStart.getTime();
    const newEndTime = new Date(newStartTime.getTime() + duration);

    if (newStartTime.getHours() < 0 || newEndTime.getHours() >= 24) {
      return;
    }

    const slotsToHighlight = new Set<HighlightedSlot>();
    let currentTime = new Date(newStartTime);
    while (currentTime < newEndTime) {
      const slotHour = currentTime.getHours().toString().padStart(2, '0');
      const slotMinute = currentTime.getMinutes().toString().padStart(2, '0');
      slotsToHighlight.add({
        techId,
        timeSlot: `${slotHour}:${slotMinute}`
      });
      currentTime = new Date(currentTime.getTime() + 15 * 60 * 1000);
    }

    setHighlightedSlots(slotsToHighlight);

    dragStateRef.current = {
      ...dragStateRef.current,
      currentStart: newStartTime,
      currentEnd: newEndTime,
      currentTechId: techId
    };

    setDragState(dragStateRef.current);

    setLocalEvents(prevEvents =>
      prevEvents.map((event): Omit<IScheduleEntry, 'tenant'> => {
        if (event.entry_id === dragStateRef.current?.sourceId) {
          return {
            ...event,
            scheduled_start: newStartTime,
            scheduled_end: newEndTime,
            assigned_user_ids: [techId] // Update to use assigned_user_ids
          };
        }
        return event;
      })
    );
  }, [selectedDate]);

  const getEventPosition = useCallback((event: Omit<IScheduleEntry, 'tenant'>) => {
    const startTime = new Date(event.scheduled_start);
    const endTime = new Date(event.scheduled_end);

    const startMinutesTotal = startTime.getHours() * 60 + startTime.getMinutes();
    const endMinutesTotal = endTime.getHours() * 60 + endTime.getMinutes();

    const startPercent = (startMinutesTotal / (24 * 60)) * 100;
    const durationMinutes = endMinutesTotal - startMinutesTotal;
    const widthPercent = (durationMinutes / (24 * 60)) * 100;

    return { left: `${startPercent}%`, width: `${widthPercent}%` };
  }, []);

  const timeSlots = useMemo(() => generate15MinuteSlots(), [generate15MinuteSlots]);

  return (
    <div
      className="grid grid-cols-[auto,1fr] gap-4 h-full"
      onClick={() => setIsGridFocused(true)}
      tabIndex={0}
      ref={scheduleGridRef}
    >
      <div className="space-y-4">
        <div className="h-8"></div>
        {technicians.map((tech): JSX.Element => (
          <div key={tech.user_id} className="h-16 flex items-center text-[rgb(var(--color-text-700))]">
            {tech.first_name} {tech.last_name}
          </div>
        ))}
      </div>
      <div className="relative" style={{overflow: "hidden"}}>
        <div className="overflow-auto" ref={gridRef} style={{ scrollBehavior: 'smooth' }}>
          <div style={{ minWidth: '2880px' }}>
            <TimeHeader timeSlots={timeSlots} />
            <div>
          {technicians.map((tech): JSX.Element => (
            <TechnicianRow
              key={tech.user_id}
              tech={tech}
              timeSlots={timeSlots}
              events={localEvents}
              selectedDate={selectedDate}
              highlightedSlots={highlightedSlots}
              isDragging={isDragging}
              dragState={dragState}
              hoveredEventId={!isDragging && !resizingRef.current?.eventId ? hoveredEventId : null}
              isResizing={!!resizingRef.current}
              getEventPosition={getEventPosition}
              onTimeSlotMouseOver={handleTimeSlotMouseOver}
              onTimeSlotDragOver={(e, timeSlot, techId) => {
                e.preventDefault();
                e.stopPropagation();
                const workItemId = e.dataTransfer.types.includes('text/plain');
                if (workItemId) {
                  isDraggingRef.current = true;
                  dragStateRef.current = {
                    sourceId: e.dataTransfer.getData('text/plain'),
                    sourceType: 'workItem',
                    originalStart: new Date(),
                    originalEnd: new Date(),
                    currentStart: new Date(),
                    currentEnd: new Date(),
                    currentTechId: techId,
                    clickOffset15MinIntervals: 0
                  };
                  setIsDragging(true);
                  setDragState(dragStateRef.current);
                  handleTimeSlotMouseOver(e, timeSlot, techId);
                }
              }}
              onDrop={(e, timeSlot, techId) => {
                e.preventDefault();
                e.stopPropagation();
                const workItemId = e.dataTransfer.getData('text/plain');
                if (workItemId) {
                  const [hours, minutes] = timeSlot.split(':').map(Number);
                  const dropTime = new Date(selectedDate);
                  dropTime.setHours(hours, minutes, 0, 0);
                  onDrop({
                    type: 'workItem',
                    workItemId,
                    techId,
                    startTime: dropTime
                  });
                } else {
                  handleMouseUp(e);
                }
              }}
              onEventMouseDown={handleMouseDown}
              onEventDelete={handleDelete}
              onEventResizeStart={handleResizeStart}
            />
          ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TechnicianScheduleGrid;
