'use client'

import React, { useEffect, useRef } from 'react';
import { IScheduleEntry } from 'server/src/interfaces/schedule.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { Trash, CalendarDays } from 'lucide-react';
import { WorkItemType } from 'server/src/interfaces/workItem.interfaces';
import { useIsCompactEvent } from 'server/src/hooks/useIsCompactEvent';

interface WeeklyScheduleEventProps {
  event: IScheduleEntry;
  isHovered: boolean;
  isPrimary: boolean;
  isComparison: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onSelectEvent: (event: IScheduleEntry, e: React.MouseEvent) => void;
  onDeleteEvent: (event: IScheduleEntry) => void;
  onResizeStart: (e: React.MouseEvent, event: IScheduleEntry, direction: 'top' | 'bottom') => void;
  technicianMap?: Record<string, { first_name: string; last_name: string }>;
}

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
  appointment_request: 'rgb(251 113 133)' // Tailwind rose-400
};

const WeeklyScheduleEvent: React.FC<WeeklyScheduleEventProps> = ({
  event,
  isHovered,
  isPrimary,
  isComparison,
  onMouseEnter,
  onMouseLeave,
  onSelectEvent,
  onDeleteEvent,
  onResizeStart,
  technicianMap = {}
}) => {
  const eventRef = useRef<HTMLDivElement>(null);

  // Check if event spans multiple days
  const isMultiDay = React.useMemo(() => {
    const start = new Date(event.scheduled_start);
    const end = new Date(event.scheduled_end);
    return start.toDateString() !== end.toDateString();
  }, [event.scheduled_start, event.scheduled_end]);

  
  // Use the compact event hook
  const { isCompact, compactClasses } = useIsCompactEvent(event, eventRef);
  
  useEffect(() => {
    if (eventRef.current && isComparison) {
      const parentElement = eventRef.current.closest('.rbc-event');
      if (parentElement) {
        const labels = parentElement.querySelectorAll('.rbc-event-label');
        labels.forEach(label => {
          (label as HTMLElement).style.display = 'none';
        });
      }
    }
  }, [isComparison]);

  const baseColor = workItemColors[event.work_item_type] || 'rgb(var(--color-border-200))';
  const hoverColor = workItemHoverColors[event.work_item_type] || 'rgb(var(--color-border-300))';
  
  const backgroundColor = isHovered ? hoverColor : baseColor;
  const opacity = isPrimary ? 1 : (isComparison ? 0.6 : 1);
  
  // Determine text color based on background color
  const textColor = event.work_item_type === 'ticket' ? 'text-primary-950' : 'text-gray-950';

  // Find assigned technician names for tooltip
  const assignedTechnicians = event.assigned_user_ids?.map(userId => {
    const tech = technicianMap[userId];
    return tech ? `${tech.first_name} ${tech.last_name}` : 'Unknown';
  }).join(', ') || 'Unassigned';

  // Format date and time for tooltip
  const startMoment = new Date(event.scheduled_start);
  const endMoment = new Date(event.scheduled_end);

  // Format start and end date/time
  const formatDateTime = (date: Date) => {
    return date.toLocaleString([], {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Construct detailed tooltip
  const tooltipTitle = `${event.title}\nScheduled for: ${assignedTechnicians}\nStart: ${formatDateTime(startMoment)}\nEnd: ${formatDateTime(endMoment)}${isMultiDay ? ' (Multi-day)' : ''}`;

  const titleParts = event.title?.split(':') || ['Untitled'];
  const mainTitle = titleParts[0];
  const subtitle = titleParts.slice(1).join(':').trim();

  // Check if we should show continuation indicator
  const [showContinuationIndicator, setShowContinuationIndicator] = React.useState(false);

  React.useEffect(() => {
    if (eventRef.current) {
      const parentElement = eventRef.current.closest('.rbc-event');
      const isContinuation = parentElement?.classList.contains('rbc-event-continues-prior') || false;
      setShowContinuationIndicator(isContinuation);
    }
  }, []);

  return (
    <div
      ref={eventRef}
      className={`absolute inset-0 ${compactClasses.text} overflow-hidden rounded-md ${textColor} group`}
      style={{
        backgroundColor,
        opacity,
        width: isComparison ? 'calc(100% - 20px)' : '100%',
        height: '100%',
        minHeight: isMultiDay ? '30px' : undefined,
        margin: 0,
        padding: compactClasses.padding,
        border: isComparison ? '1px dashed rgb(var(--color-border-600))' : 'none',
        outline: 'none'
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => onSelectEvent(event, e)}
      title={tooltipTitle}
      tabIndex={-1}
    >
      {/* Top resize handle */}
      {isPrimary && (
        <div
          className="absolute top-0 left-0 right-0 h-1 bg-[rgb(var(--color-border-300))] cursor-ns-resize rounded-t resize-handle"
          style={{ zIndex: 150 }}
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart(e, event, 'top');
          }}
        ></div>
      )}
      
      {/* Bottom resize handle */}
      {isPrimary && (
        <div
          className="absolute bottom-0 left-0 right-0 h-1 bg-[rgb(var(--color-border-300))] cursor-ns-resize rounded-b resize-handle"
          style={{ zIndex: 150 }}
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart(e, event, 'bottom');
          }}
        ></div>
      )}

      <div className="absolute top-2 right-1" style={{ zIndex: 200 }}>
        {isPrimary && (
          <Button
            id={`delete-entry-${event.entry_id}-btn`}
            variant="icon"
            size="icon"
            className={`${compactClasses.button} delete-button`}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteEvent(event);
            }}
            title="Delete Entry"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Trash className={`${compactClasses.button} pointer-events-none`} />
          </Button>
        )}
      </div>

      {/* Only display the title, not any time information */}
      <div className="pt-1.5 px-1">
        {isCompact ? (
          // For short events, show text with minimal padding
          <div className="flex items-center">
            {showContinuationIndicator && (
              <span className="text-[10px] mr-1 opacity-60" title="Continues from previous week">...</span>
            )}
            {isMultiDay && !showContinuationIndicator && (
              <CalendarDays className="w-3 h-3 mr-1 opacity-70 flex-shrink-0" />
            )}
            <div className="font-medium truncate flex-1 text-xs">
              {mainTitle.length > 15 && showContinuationIndicator ? mainTitle.substring(0, 12) + '...' : mainTitle}
            </div>
          </div>
        ) : (
          // For normal events, show two lines
          <>
            <div className="font-semibold truncate flex items-center text-sm">
              {showContinuationIndicator && (
                <span className="text-xs mr-1 opacity-60" title="Continues from previous week">...</span>
              )}
              {isMultiDay && !showContinuationIndicator && (
                <CalendarDays className="w-3.5 h-3.5 mr-1 opacity-70 flex-shrink-0"/>
              )}
              <span className="truncate">
                {mainTitle.length > 20 && showContinuationIndicator ? mainTitle.substring(0, 17) + '...' : mainTitle}
              </span>
            </div>
            {subtitle && !showContinuationIndicator && <div className="truncate text-xs mt-0.5">{subtitle}</div>}
          </>
        )}
      </div>
    </div>
  );
};

export default WeeklyScheduleEvent;
