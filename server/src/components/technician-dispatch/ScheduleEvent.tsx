import React, { useState } from 'react';
import { Trash, ExternalLink } from 'lucide-react';
import { IScheduleEntry } from 'server/src/interfaces/schedule.interfaces';
import { getEventColors } from './utils';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Button } from 'server/src/components/ui/Button';

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
  onClick: () => void;
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
  onClick,
}) => {
  const [isConfirmDeleteDialogOpen, setIsConfirmDeleteDialogOpen] = useState(false);
  const colors = getEventColors(event.work_item_type);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsConfirmDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    onDelete(null as any);
    setIsConfirmDeleteDialogOpen(false);
  };

  return (
    <>
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
      onClick={(e) => {
        if (event.work_item_type !== 'ad_hoc' && !isDragging && !isResizing && !(e.target as HTMLElement).closest('.resize-handle') && !(e.target as HTMLElement).closest('.delete-button') && !(e.target as HTMLElement).closest('.details-button')) {
          onClick();
        }
      }}
    >
      {/* Container for text */}
      <div className="flex flex-col justify-center items-start h-full text-left px-2">
        <div className="font-bold">{event.title.split(':')[0]}</div>
        <div>{event.title.split(':')[1]}</div>
      </div>

      {/* Container for top-right buttons */}
      <div className="absolute top-1 right-1 flex gap-1" style={{ zIndex: 1000 }}>
        <Button
          id={`view-details-${event.entry_id}`}
          variant="icon"
          size="icon"
          className="w-4 h-4 details-button"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          title="View Details"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <ExternalLink className="w-4 h-4 pointer-events-none" />
        </Button>

        <Button
          id={`delete-entry-${event.entry_id}`}
          variant="icon"
          size="icon"
          className="w-4 h-4 delete-button"
          onClick={handleDeleteClick}
          title="Delete schedule entry"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Trash className="w-4 h-4 pointer-events-none" />
        </Button>
      </div>

      {/* Resize Handles */}
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

      <ConfirmationDialog
        id={`delete-schedule-${event.entry_id}`}
        isOpen={isConfirmDeleteDialogOpen}
        onClose={() => setIsConfirmDeleteDialogOpen(false)}
        onConfirm={handleConfirmDelete}
        title="Confirm Deletion"
        message="Are you sure you want to delete this entry? This action cannot be undone."
        confirmLabel="Delete"
      />
    </>
  );
};

export default ScheduleEvent;
