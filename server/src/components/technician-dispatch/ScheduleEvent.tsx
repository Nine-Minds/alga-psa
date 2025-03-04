import React from 'react';
import { Trash } from 'lucide-react';
import { IScheduleEntry } from 'server/src/interfaces/schedule.interfaces';
import { getEventColors } from './utils';

interface ScheduleEventProps {
  event: Omit<IScheduleEntry, 'tenant'>;
  position: { left: string; width: string };
  isDragging: boolean;
  isHovered: boolean;
  isResizing: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent, direction: 'left' | 'right') => void;
}

const ScheduleEvent: React.FC<ScheduleEventProps> = ({
  event,
  position,
  isDragging,
  isHovered,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
  onDelete,
  onResizeStart,
  isResizing,
}) => {
  const colors = getEventColors(event.work_item_type);

  return (
    <div
      className={`text-xs ${colors.bg} ${colors.text} p-1 shadow-md rounded absolute 
        ${!isResizing ? colors.hover : ''}
        ${isDragging ? 'opacity-70 shadow-lg' : ''}
        ${isResizing ? 'cursor-ew-resize pointer-events-none' : 'cursor-move'}`}
      style={{
        left: position.left,
        width: position.width,
        top: '0px',
        height: '100%',
        zIndex: isDragging ? 1000 : 50,
        pointerEvents: isDragging ? 'none' : 'auto'
      }}
      onMouseDown={onMouseDown}
      onMouseEnter={() => !isResizing && onMouseEnter()}
      onMouseLeave={() => !isResizing && onMouseLeave()}
    >
      <div className="font-bold relative left-4">{event.title.split(':')[0]}</div>
      <div className="relative left-4">{event.title.split(':')[1]}</div>
      <button
        className="absolute top-1 right-2 w-4 h-4 text-[rgb(var(--color-text-300))] 
          hover:text-[rgb(var(--color-text-600))] transition-colors delete-button"
        onClick={onDelete}
        title="Delete schedule entry"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ zIndex: 1000 }}
      >
        <Trash className="w-4 h-4 pointer-events-none" />
      </button>
      <div
        className="absolute top-0 bottom-0 left-0 w-2 bg-[rgb(var(--color-border-300))] cursor-ew-resize rounded-l resize-handle"
        onMouseDown={(e) => {
          e.stopPropagation();
          onResizeStart(e, 'left');
        }}
      ></div>
      <div
        className="absolute top-0 bottom-0 right-0 w-2 bg-[rgb(var(--color-border-300))] cursor-ew-resize rounded-r resize-handle"
        onMouseDown={(e) => {
          e.stopPropagation();
          onResizeStart(e, 'right');
        }}
      ></div>
    </div>
  );
};

export default ScheduleEvent;
