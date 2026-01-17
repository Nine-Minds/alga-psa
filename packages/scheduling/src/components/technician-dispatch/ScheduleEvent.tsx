import React, { useState, useRef, useEffect } from 'react';
import { Trash, ExternalLink, MoreVertical } from 'lucide-react';
import { IScheduleEntry } from 'server/src/interfaces/schedule.interfaces';
import { getEventColors } from './utils';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Button } from '@alga-psa/ui/components/Button';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@alga-psa/ui/components/DropdownMenu';

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
  const [deleteInitiatingEvent, setDeleteInitiatingEvent] = useState<React.MouseEvent | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const [isRecentlyResized, setIsRecentlyResized] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const eventRef = useRef<HTMLDivElement>(null);
  const isPrimary = true;
  const isComparison = false;
  const { bg, hover, text } = getEventColors(event.work_item_type, isPrimary, isComparison);
  
  useEffect(() => {
    if (!isResizing && isRecentlyResized) {
      const timer = setTimeout(() => {
        setIsRecentlyResized(false);
      }, 300);
      
      return () => clearTimeout(timer);
    } else if (isResizing) {
      setIsRecentlyResized(true);
    }
  }, [isResizing]);
  
  useEffect(() => {
    const checkWidth = () => {
      if (eventRef.current) {
        setIsNarrow(eventRef.current.offsetWidth < 80);
      }
    };
    
    checkWidth();
    
    const resizeObserver = new ResizeObserver(checkWidth);
    if (eventRef.current) {
      resizeObserver.observe(eventRef.current);
    }
    
    return () => {
      if (eventRef.current) {
        resizeObserver.unobserve(eventRef.current);
      }
      resizeObserver.disconnect();
    };
  }, [position.width]);

  const handleDeleteClick = (e: React.MouseEvent) => {
    setDeleteInitiatingEvent(e);
    e.stopPropagation();
    setIsConfirmDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (deleteInitiatingEvent) {
      onDelete(deleteInitiatingEvent);
    }
    setIsConfirmDeleteDialogOpen(false);
    setDeleteInitiatingEvent(null);
  };

  return (
    <div>
      <div
        ref={eventRef}
        className={`${bg} ${text} p-1 shadow-md rounded absolute
        ${!isResizing ? hover : ''}
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
          if (event.work_item_type !== 'ad_hoc' &&
              !isDragging &&
              !isResizing &&
              !isRecentlyResized &&
              !(e.target as HTMLElement).closest('.resize-handle') &&
              !(e.target as HTMLElement).closest('.delete-button') &&
              !(e.target as HTMLElement).closest('.details-button') &&
              !(e.target as HTMLElement).closest('.dropdown-trigger') &&
              !isDropdownOpen) {
            onClick();
          } else {
            e.stopPropagation();
          }
        }}
      >
        {/* Main flex container */}
        <div className="flex flex-col h-full w-full px-1 relative">
          {/* Buttons container */}
          <div className="absolute top-2 right-1" style={{ zIndex: 100 }}>
            {/* Show individual buttons if not narrow */}
            {!isNarrow && (
              <div className="flex gap-1">
              <Button
                id={`view-details-${event.entry_id}`}
                variant="icon"
                size="icon"
                className="w-4 h-4 details-button"
                onClick={(e) => {
                  if (!isResizing) {
                    e.stopPropagation();
                    onClick();
                    if (isRecentlyResized) {
                      setIsRecentlyResized(false);
                    }
                  }
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
            )}

            {/* Show dropdown menu if narrow */}
            {isNarrow && (
              <div>
              <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    id={`more-options-${event.entry_id}`}
                    variant="icon"
                    size="icon"
                    className="w-4 h-4 dropdown-trigger"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                  >
                    <MoreVertical className="w-4 h-4 pointer-events-none" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-32"
                  onCloseAutoFocus={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <DropdownMenuItem
                    onClick={(e) => {
                      if (!isResizing) {
                        e.stopPropagation();
                        setIsDropdownOpen(false); // Close dropdown
                        onClick();
                        if (isRecentlyResized) {
                          setIsRecentlyResized(false);
                        }
                      }
                    }}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View Details
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsDropdownOpen(false); // Close dropdown
                      handleDeleteClick(e);
                    }}
                  >
                    <Trash className="w-4 h-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              </div>
            )}
          </div>

          {/* Text container */}
          <div className="flex flex-col justify-center items-start text-left overflow-hidden flex-grow min-w-0 pt-1.5 px-1">
            <div className="font-bold text-sm w-full overflow-hidden whitespace-nowrap text-ellipsis">{event.title.split(':')[0]}</div>
            {event.title.split(':')[1] && (
              <div className="text-xs mt-0.5 w-full overflow-hidden whitespace-nowrap text-ellipsis">{event.title.split(':')[1]}</div>
            )}
          </div>
        </div>

        {/* Resize Handles - Remain absolutely positioned relative to the main container */}
        <div
          className="absolute top-0 bottom-0 left-0 w-1 bg-[rgb(var(--color-border-300))] cursor-ew-resize rounded-l resize-handle"
          style={{ zIndex: 150 }}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setIsRecentlyResized(true);
            onResizeStart(e, 'left');
          }}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
        ></div>
        <div
          className="absolute top-0 bottom-0 right-0 w-1 bg-[rgb(var(--color-border-300))] cursor-ew-resize rounded-r resize-handle"
          style={{ zIndex: 150 }} // Ensure handles are above buttons
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setIsRecentlyResized(true);
            onResizeStart(e, 'right');
          }}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
        ></div>
      </div>

      <ConfirmationDialog
        id={`delete-schedule-${event.entry_id}`}
        isOpen={isConfirmDeleteDialogOpen}
        onClose={() => {
          setIsConfirmDeleteDialogOpen(false);
          setDeleteInitiatingEvent(null);
        }}
        onConfirm={handleConfirmDelete}
        title="Confirm Deletion"
        message="Are you sure you want to delete this entry? This action cannot be undone."
        confirmLabel="Delete"
      />
    </div>
  );
};

export default ScheduleEvent;
