'use client'

import React from 'react';
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
  ad_hoc: 'rgb(var(--color-border-200))'
};

const workItemHoverColors: Record<WorkItemType, string> = {
  ticket: 'rgb(var(--color-primary-300))',
  project_task: 'rgb(var(--color-secondary-200))',
  non_billable_category: 'rgb(var(--color-accent-200))',
  ad_hoc: 'rgb(var(--color-border-300))'
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
  technicianMap
}) => {
  const baseColor = workItemColors[event.work_item_type] || 'rgb(var(--color-border-200))';
  const hoverColor = workItemHoverColors[event.work_item_type] || 'rgb(var(--color-border-300))';
  
  const backgroundColor = isHovered ? hoverColor : baseColor;
  const opacity = isPrimary ? 1 : (isComparison ? 0.6 : 1);
  const border = isPrimary ? '2px solid rgb(var(--color-primary-500))' : 'none';
  
  const isTicketOrTask = event.work_item_type === 'ticket' || event.work_item_type === 'project_task';
  
  const assignedUsersText = event.assigned_user_ids
    .map(userId => {
      const tech = technicianMap?.[userId];
      return tech ? `${tech.first_name[0]}${tech.last_name[0]}` : '';
    })
    .filter(Boolean)
    .join(', ');

  // Determine text color based on background color
  const textColor = event.work_item_type === 'ticket' ? 'text-primary-950' : 'text-gray-950';

  return (
    <div
      className={`absolute inset-0 text-xs overflow-hidden rounded-md ${textColor}`}
      style={{
        backgroundColor,
        opacity,
        width: isComparison ? 'calc(100% - 20px)' : '100%',
        height: '100%',
        margin: 0,
        padding: '4px',
        border: isComparison ? '1px dashed rgb(var(--color-border-600))' : 'none',
        outline: 'none'
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => onSelectEvent(event, e)}
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

      <div className="flex justify-end gap-1 mt-0.5" style={{ zIndex: 200 }}>
        {isPrimary && (
          <Button
            id={`delete-entry-${event.entry_id}-btn`}
            variant="icon"
            size="icon"
            className="w-4 h-4 delete-button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteEvent(event);
            }}
            title="Delete Entry"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Trash className="w-4 h-4 pointer-events-none" />
          </Button>
        )}
      </div>

      <div className="font-semibold truncate">{event.title?.split(':')[0] || 'Untitled'}</div>
      <div className="truncate text-xs">{event.title?.split(':').slice(1).join(':').trim() || ''}</div>
      
      <div className="text-xs font-semibold mt-auto text-right opacity-80">
        {assignedUsersText}
      </div>
    </div>
  );
};

export default WeeklyScheduleEvent;