'use client';

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { IScheduleEntry } from 'server/src/interfaces/schedule.interfaces';
import { IUser } from '@shared/interfaces/user.interfaces';
import TimeHeader from './TimeHeader';
import TechnicianRow from './TechnicianRow';
import { Button } from 'server/src/components/ui/Button';
import { CalendarDays } from 'lucide-react';

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

interface DailyTechnicianScheduleGridProps {
  technicians: Omit<IUser, 'tenant'>[];
  events: Omit<IScheduleEntry, 'tenant'>[];
  selectedDate: Date;
  onDrop?: (dropEvent: DropEvent) => void;
  onResize?: (eventId: string, techId: string, newStart: Date, newEnd: Date) => void;
  onDeleteEvent?: (eventId: string) => void;
  onEventClick: (event: Omit<IScheduleEntry, 'tenant'>) => void;
  onTechnicianClick: (technicianId: string) => void;
  canEdit?: boolean;
}

const DailyTechnicianScheduleGrid: React.FC<DailyTechnicianScheduleGridProps> = ({
  technicians,
  events,
  selectedDate,
  onDrop,
  onResize,
  onDeleteEvent,
  onEventClick,
  onTechnicianClick,
  canEdit
}) => {
  const scheduleGridRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const namesColumnRef = useRef<HTMLDivElement>(null);
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
    if (!hasScrolled && gridRef.current) {
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

      // Small delay to ensure the DOM is ready
      setTimeout(scrollToBusinessHours, 100);
    }
  }, [hasScrolled]); // Run when component mounts

  const isSyncingScroll = useRef(false);

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

  const handleDelete = useCallback((e: React.MouseEvent | null, eventId: string) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
     }
      onDeleteEvent?.(eventId);
      isDraggingRef.current = false;
      dragStateRef.current = null;
      resizingRef.current = null;
      setIsDragging(false);
      setDragState(null);
      setHighlightedSlots(null);
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
        onResize?.(
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
      onResize?.(
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

      onDrop?.(dropEvent);
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

  // Combined scroll handler for the main grid
  const handleGridScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (isSyncingScroll.current) return;

    const target = e.currentTarget;
    isSyncingScroll.current = true;

    // Sync horizontal scroll with time header
    if (headerRef.current) {
      headerRef.current.scrollLeft = target.scrollLeft;
    }
    // Sync vertical scroll with names column
    if (namesColumnRef.current) {
      namesColumnRef.current.scrollTop = target.scrollTop;
    }

    requestAnimationFrame(() => {
      isSyncingScroll.current = false;
    });
  }, []);

  // Scroll handler for the names column (if scrolled directly)
  const handleNamesScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (isSyncingScroll.current) return;

    const target = e.currentTarget;
    isSyncingScroll.current = true;

    // Sync vertical scroll with main grid
    if (gridRef.current) {
      gridRef.current.scrollTop = target.scrollTop;
    }

    requestAnimationFrame(() => {
      isSyncingScroll.current = false;
    });
  }, []);

  // Scroll handler for the header (if scrolled directly - less likely)
  const handleHeaderScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (isSyncingScroll.current) return;

    const target = e.currentTarget;
    isSyncingScroll.current = true;

    // Sync horizontal scroll with main grid
    if (gridRef.current) {
      gridRef.current.scrollLeft = target.scrollLeft;
    }

    requestAnimationFrame(() => {
      isSyncingScroll.current = false;
    });
  }, []);


  return (
    <div className="h-full flex flex-col overflow-hidden" onClick={() => setIsGridFocused(true)} tabIndex={0} ref={scheduleGridRef}>
      {/* Header row */}
      <div className="flex flex-shrink-0">
        {/* Empty corner cell */}
        {canEdit && <div className="w-48 flex-shrink-0 h-8 bg-white z-20"></div>}
        {/* Time header - scrolls horizontally */}
        <div className="overflow-x-auto overflow-y-hidden flex-1 scrollbar-hide" ref={headerRef} onScroll={handleHeaderScroll}>
          <div style={{ minWidth: '2880px' }}>
            <TimeHeader timeSlots={timeSlots} />
          </div>
        </div>
      </div>

      {/* Body content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Technician names column - only visible for users with edit permissions */}
        {canEdit && (
          <div className="w-48 flex-shrink-0 bg-white z-10 overflow-y-auto overflow-x-hidden scrollbar-hide" ref={namesColumnRef} onScroll={handleNamesScroll}>
            {technicians.map((tech) => (
              <div
                key={tech.user_id}
                className={`h-16 mb-4 flex items-center justify-between pl-2 pr-2 ${tech.is_inactive ? 'text-[rgb(var(--color-text-300))] opacity-75' : 'text-[rgb(var(--color-text-600))]'}`}
              >
                <span className={`truncate ${tech.is_inactive ? 'text-[rgb(var(--color-text-400))]' : ''}`}>{tech.first_name} {tech.last_name}</span>
                <Button
                  id={`view-week-${tech.user_id}`}
                  variant="ghost"
                  size="sm"
                  onClick={() => onTechnicianClick(tech.user_id)}
                  tooltipText="View Week"
                  tooltip={true}
                  aria-label={`View week for ${tech.first_name} ${tech.last_name}${tech.is_inactive ? ' (Inactive)' : ''}`}
                >
                  <CalendarDays className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Grid content - scrolls both horizontally and vertically */}
        <div className="flex-1 overflow-auto" ref={gridRef} onScroll={handleGridScroll}>
          <div style={{ minWidth: '2880px' }}>
            {technicians.map((tech) => (
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
                      onDrop?.({
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
                  onEventClick={onEventClick}
                  onTechnicianClick={onTechnicianClick}
                />
                ))}
            </div>
          </div>
        </div>
      </div>
  );
};

export default DailyTechnicianScheduleGrid;
