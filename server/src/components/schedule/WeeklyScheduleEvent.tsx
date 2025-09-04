'use client'

import React, { useEffect, useRef } from 'react';
import { IScheduleEntry } from 'server/src/interfaces/schedule.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { Trash } from 'lucide-react';
import { WorkItemType } from 'server/src/interfaces/workItem.interfaces';

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
  interaction: 'rgb(220 252 231)' // Tailwind green-100
};

const workItemHoverColors: Record<WorkItemType, string> = {
  ticket: 'rgb(var(--color-primary-300))',
  project_task: 'rgb(var(--color-secondary-200))',
  non_billable_category: 'rgb(var(--color-accent-200))',
  ad_hoc: 'rgb(var(--color-border-300))',
  interaction: 'rgb(187 247 208)' // Tailwind green-200
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
  const [isShort, setIsShort] = React.useState(false);
  
  // Calculate event duration in minutes
  const eventDuration = Math.floor((new Date(event.scheduled_end).getTime() - new Date(event.scheduled_start).getTime()) / (1000 * 60));
  
  useEffect(() => {
    const checkHeight = () => {
      if (eventRef.current) {
        setIsShort(eventRef.current.offsetHeight < 40);
      }
    };
    
    checkHeight();
    
    const resizeObserver = new ResizeObserver(checkHeight);
    if (eventRef.current) {
      resizeObserver.observe(eventRef.current);
    }
    
    return () => {
      if (eventRef.current) {
        resizeObserver.unobserve(eventRef.current);
      }
      resizeObserver.disconnect();
    };
  }, []);
  
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
  const border = isPrimary ? '2px solid rgb(var(--color-primary-500))' : 'none';
  
  const isTicketOrTask = event.work_item_type === 'ticket' || event.work_item_type === 'project_task';
  
  // Determine text color based on background color
  const textColor = event.work_item_type === 'ticket' ? 'text-primary-950' : 'text-gray-950';

  // Find assigned technician names for tooltip
  const assignedTechnicians = event.assigned_user_ids?.map(userId => {
    const tech = technicianMap[userId];
    return tech ? `${tech.first_name} ${tech.last_name}` : userId;
  }).join(', ') || 'Unassigned';

  // Format date and time for tooltip
  const startMoment = new Date(event.scheduled_start);
  const endMoment = new Date(event.scheduled_end);
  const formattedDate = startMoment.toLocaleDateString();
  const formattedTime = `${startMoment.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endMoment.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  // Construct detailed tooltip
  const tooltipTitle = `${event.title}\nScheduled for: ${assignedTechnicians}\nDate: ${formattedDate}\nTime: ${formattedTime}`;

  const titleParts = event.title?.split(':') || ['Untitled'];
  const mainTitle = titleParts[0];
  const subtitle = titleParts.slice(1).join(':').trim();

  return (
    <div
      ref={eventRef}
      className={`absolute inset-0 ${isShort || eventDuration <= 15 ? 'text-[10px]' : 'text-xs'} overflow-hidden rounded-md ${textColor}`}
      style={{
        backgroundColor,
        opacity,
        width: isComparison ? 'calc(100% - 20px)' : '100%',
        height: '100%',
        margin: 0,
        padding: isShort || eventDuration <= 15 ? '2px' : '4px',
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

      <div className={`flex justify-end ${isShort || eventDuration <= 15 ? 'gap-0.5 pr-0.5 pt-0.5' : 'gap-1 mt-0.5'}`} style={{ zIndex: 200 }}>
        {isPrimary && (
          <Button
            id={`delete-entry-${event.entry_id}-btn`}
            variant="icon"
            size="icon"
            className={`${isShort || eventDuration <= 15 ? 'w-3 h-3' : 'w-4 h-4'} delete-button`}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteEvent(event);
            }}
            title="Delete Entry"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Trash className={`${isShort || eventDuration <= 15 ? 'w-3 h-3' : 'w-4 h-4'} pointer-events-none`} />
          </Button>
        )}
      </div>

      {/* Only display the title, not any time information */}
      {isShort || eventDuration <= 15 ? (
        // For short events, show text with minimal padding
        <div className="flex items-center px-0.5 pb-0.5">
          <div className="font-medium truncate flex-1" style={{ fontSize: '9px', lineHeight: '1.1' }}>
            {mainTitle}
          </div>
        </div>
      ) : (
        // For normal events, show two lines
        <>
          <div className="font-semibold truncate">{mainTitle}</div>
          {subtitle && <div className="truncate text-xs">{subtitle}</div>}
        </>
      )}
    </div>
  );
};

export default WeeklyScheduleEvent;
