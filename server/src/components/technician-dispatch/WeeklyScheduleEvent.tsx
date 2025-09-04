import React, { useState, useRef, useEffect } from 'react';
import { Trash, ExternalLink, MoreVertical } from 'lucide-react';
import { IScheduleEntry } from 'server/src/interfaces/schedule.interfaces';
import { getEventColors } from './utils';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Button } from 'server/src/components/ui/Button';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from 'server/src/components/ui/DropdownMenu';

interface WeeklyScheduleEventProps {
  event: IScheduleEntry;
  isHovered: boolean;
  isPrimary: boolean;
  isComparison: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onSelectEvent: (event: IScheduleEntry, e: React.SyntheticEvent<HTMLElement>) => void;
  onDeleteEvent: (event: IScheduleEntry) => void;
  onResizeStart?: (e: React.MouseEvent, event: IScheduleEntry, direction: 'top' | 'bottom') => void;
  technicianMap?: Record<string, { first_name: string; last_name: string }>;
}

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
  technicianMap = {},
}) => {
  const [isConfirmDeleteDialogOpen, setIsConfirmDeleteDialogOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const [isShort, setIsShort] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const eventRef = useRef<HTMLDivElement>(null);
  const isNarrowRef = useRef(false);
  const isShortRef = useRef(false);
  
  // Calculate event duration in minutes
  const eventDuration = Math.floor((new Date(event.scheduled_end).getTime() - new Date(event.scheduled_start).getTime()) / (1000 * 60));

  const handleMouseLeave = () => {
    if (!isDropdownOpen) {
      onMouseLeave();
    }
  };
  
  
  const workItemType = event.work_item_type || 'ticket';
  const { bg, text } = getEventColors(workItemType, isPrimary, isComparison);

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

  useEffect(() => {
    if (eventRef.current) {
      const initialWidth = eventRef.current.offsetWidth;
      const initialHeight = eventRef.current.offsetHeight;
      const initialIsNarrow = initialWidth < 80;
      const initialIsShort = initialHeight < 40;
      isNarrowRef.current = initialIsNarrow;
      isShortRef.current = initialIsShort;
      setIsNarrow(initialIsNarrow);
      setIsShort(initialIsShort);
    }
    
    let resizeTimeoutId: number | null = null;
    
    const handleResize = () => {
      if (resizeTimeoutId) {
        window.clearTimeout(resizeTimeoutId);
      }
      
      resizeTimeoutId = window.setTimeout(() => {
        if (eventRef.current) {
          const currentWidth = eventRef.current.offsetWidth;
          const currentHeight = eventRef.current.offsetHeight;
          const currentIsNarrow = currentWidth < 80;
          const currentIsShort = currentHeight < 40;
          
          if (currentIsNarrow !== isNarrowRef.current) {
            isNarrowRef.current = currentIsNarrow;
            setIsNarrow(currentIsNarrow);
          }
          
          if (currentIsShort !== isShortRef.current) {
            isShortRef.current = currentIsShort;
            setIsShort(currentIsShort);
          }
        }
      }, 100);
    };
    
    const resizeObserver = new ResizeObserver(handleResize);
    
    if (eventRef.current) {
      resizeObserver.observe(eventRef.current);
    }
    
    return () => {
      if (resizeTimeoutId) {
        window.clearTimeout(resizeTimeoutId);
      }
      
      if (eventRef.current) {
        resizeObserver.unobserve(eventRef.current);
      }
      resizeObserver.disconnect();
    };
  }, []); // Empty dependency array - only run on mount

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsConfirmDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    onDeleteEvent(event);
    setIsConfirmDeleteDialogOpen(false);
  };

  const handleViewDetails = (e: React.MouseEvent<Element, MouseEvent>) => {
    e.stopPropagation();
    onSelectEvent(event, e as unknown as React.SyntheticEvent<HTMLElement>);
  };

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

  // Check if this is a private event that the user doesn't own
  const isPrivateEvent = event.is_private;
  const isCreator = isPrimary && event.assigned_user_ids?.length === 1;
  const isPrivateNonOwner = isPrivateEvent && !isCreator;
  
  // Construct detailed tooltip - show limited info for private events
  const tooltipTitle = isPrivateNonOwner
    ? `Busy\nDate: ${formattedDate}\nTime: ${formattedTime}`
    : `${event.title}\nAssigned to: ${assignedTechnicians}\nDate: ${formattedDate}\nTime: ${formattedTime}`;

  return (
    <div
      ref={eventRef}
      className={`absolute inset-0 ${isShort || eventDuration <= 15 ? 'text-[10px]' : 'text-xs'} overflow-hidden rounded-md ${bg} ${text}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={handleMouseLeave}
      title={tooltipTitle}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('.details-button') &&
            !(e.target as HTMLElement).closest('.delete-button') &&
            !(e.target as HTMLElement).closest('.resize-handle')) {
          e.stopPropagation();
        }
      }}
      style={{
        width: isComparison ? 'calc(100% - 20px)' : '100%',
        height: '100%',
        margin: 0,
        padding: isShort || eventDuration <= 15 ? '2px' : '4px',
        border: isComparison ? '1px dashed rgb(var(--color-border-600))' : 'none',
        outline: 'none'
      }}
      tabIndex={-1}
    >
      {/* Top resize handle - only show if not a private event or user is creator */}
      {onResizeStart && !isPrivateNonOwner && (
        <div
          className="absolute top-0 left-0 right-0 h-1 bg-[rgb(var(--color-border-300))] cursor-ns-resize rounded-t resize-handle"
          style={{ zIndex: 150 }}
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart(e, event, 'top');
          }}
        ></div>
      )}
      
      {/* Bottom resize handle - only show if not a private event or user is creator */}
      {onResizeStart && !isPrivateNonOwner && (
        <div
          className="absolute bottom-0 left-0 right-0 h-1 bg-[rgb(var(--color-border-300))] cursor-ns-resize rounded-b resize-handle"
          style={{ zIndex: 150 }}
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart(e, event, 'bottom');
          }}
        ></div>
      )}
      {/* Buttons container - only show if not a private event or user is creator */}
      {!isPrivateNonOwner && (
      <div className={`flex justify-end ${isShort || eventDuration <= 15 ? 'gap-0.5 pr-0.5 pt-0.5' : 'gap-1 mt-0.5'}`} style={{ zIndex: 200 }}>
          {/* Show individual buttons if not narrow and not a private event or user is creator */}
          {!isNarrow && (
            <div className={`flex ${isShort || eventDuration <= 15 ? 'gap-0.5' : 'gap-1'}`}>
              <Button
                id={`view-details-${event.entry_id}`}
                variant="icon"
                size="icon"
                className={`${isShort || eventDuration <= 15 ? 'w-3 h-3' : 'w-4 h-4'} details-button`}
                onClick={handleViewDetails}
                title="View Details"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <ExternalLink className={`${isShort || eventDuration <= 15 ? 'w-3 h-3' : 'w-4 h-4'} pointer-events-none`} />
              </Button>

              <Button
                id={`delete-entry-${event.entry_id}`}
                variant="icon"
                size="icon"
                className={`${isShort || eventDuration <= 15 ? 'w-3 h-3' : 'w-4 h-4'} delete-button`}
                onClick={handleDeleteClick}
                title="Delete schedule entry"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <Trash className={`${isShort || eventDuration <= 15 ? 'w-3 h-3' : 'w-4 h-4'} pointer-events-none`} />
              </Button>
            </div>
          )}

          {/* Show dropdown menu if narrow and not a private event or user is creator */}
          {isNarrow && !isPrivateNonOwner && (
            <div>
              <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    id={`more-options-${event.entry_id}`}
                    variant="icon"
                    size="icon"
                    className={`${isShort || eventDuration <= 15 ? 'w-3 h-3' : 'w-4 h-4'} dropdown-trigger`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                  >
                    <MoreVertical className={`${isShort || eventDuration <= 15 ? 'w-3 h-3' : 'w-4 h-4'} pointer-events-none`} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  sideOffset={5}
                  className="w-32 z-[9999]"
                  onCloseAutoFocus={(e) => {
                    e.preventDefault();
                  }}
                >
                  <DropdownMenuItem 
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsDropdownOpen(false);
                      handleViewDetails(e);
                    }}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View Details
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsDropdownOpen(false);
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
      )}

      {/* Event content - show limited info for private events */}
      {isShort || eventDuration <= 15 ? (
        // For short events, show text with minimal padding
        <div className="flex items-center px-0.5 pb-0.5">
          <div className="font-medium truncate flex-1" style={{ fontSize: '9px', lineHeight: '1.1' }}>
            {isPrivateNonOwner ? "Busy" : (event.title?.split(':')[0] || 'Untitled')}
          </div>
        </div>
      ) : (
        // For normal events, show two lines
        <>
          <div className="font-semibold truncate">
            {isPrivateNonOwner ? "Busy" : (event.title?.split(':')[0] || 'Untitled')}
          </div>
          <div className="truncate text-xs">
            {isPrivateNonOwner ? "" : (event.title?.split(':').slice(1).join(':').trim() || '')}
          </div>
        </>
      )}

      {/* Confirmation Dialog for Delete */}
      <ConfirmationDialog
        id={`delete-schedule-${event.entry_id}`}
        isOpen={isConfirmDeleteDialogOpen}
        onClose={() => {
          setIsConfirmDeleteDialogOpen(false);
        }}
        onConfirm={() => {
          handleConfirmDelete();
        }}
        title="Confirm Deletion"
        message="Are you sure you want to delete this entry? This action cannot be undone."
        confirmLabel="Delete"
      />
    </div>
  );
};

export default WeeklyScheduleEvent;
