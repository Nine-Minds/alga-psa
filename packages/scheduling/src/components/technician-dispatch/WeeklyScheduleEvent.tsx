import React, { useState, useRef, useEffect } from 'react';
import { Trash, ExternalLink, MoreVertical } from 'lucide-react';
import { IScheduleEntry } from '@alga-psa/types';
import { getEventColors } from './utils';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Button } from '@alga-psa/ui/components/Button';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@alga-psa/ui/components/DropdownMenu';
import { useIsCompactEvent } from '@alga-psa/ui/hooks';

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
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const eventRef = useRef<HTMLDivElement>(null);
  const isNarrowRef = useRef(false);
  
  // Use the compact event hook
  const { isCompact, compactClasses } = useIsCompactEvent(event, eventRef);

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
      const initialIsNarrow = initialWidth < 80;
      isNarrowRef.current = initialIsNarrow;
      setIsNarrow(initialIsNarrow);
    }
    
    let resizeTimeoutId: number | null = null;
    
    const handleResize = () => {
      if (resizeTimeoutId) {
        window.clearTimeout(resizeTimeoutId);
      }
      
      resizeTimeoutId = window.setTimeout(() => {
        if (eventRef.current) {
          const currentWidth = eventRef.current.offsetWidth;
          const currentIsNarrow = currentWidth < 80;
          
          if (currentIsNarrow !== isNarrowRef.current) {
            isNarrowRef.current = currentIsNarrow;
            setIsNarrow(currentIsNarrow);
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

  // Check if this is a private event that the user doesn't own
  const isPrivateEvent = event.is_private;
  const isCreator = isPrimary && event.assigned_user_ids?.length === 1;
  const isPrivateNonOwner = isPrivateEvent && !isCreator;

  // Construct detailed tooltip - show limited info for private events
  const tooltipTitle = isPrivateNonOwner
    ? `Busy\nStart: ${formatDateTime(startMoment)}\nEnd: ${formatDateTime(endMoment)}`
    : `${event.title}\nAssigned to: ${assignedTechnicians}\nStart: ${formatDateTime(startMoment)}\nEnd: ${formatDateTime(endMoment)}`;

  return (
    <div
      ref={eventRef}
      className={`absolute inset-0 ${compactClasses.text} overflow-hidden rounded-md ${bg} ${text}`}
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
        padding: compactClasses.padding,
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
      <div className="absolute top-2 right-1" style={{ zIndex: 200 }}>
          {/* Show individual buttons if not narrow and not a private event or user is creator */}
          {!isNarrow && (
            <div className={`flex ${compactClasses.buttonGap}`}>
              <Button
                id={`view-details-${event.entry_id}`}
                variant="icon"
                size="icon"
                className={`${compactClasses.button} details-button`}
                onClick={handleViewDetails}
                title="View Details"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <ExternalLink className={`${compactClasses.button} pointer-events-none`} />
              </Button>

              <Button
                id={`delete-entry-${event.entry_id}`}
                variant="icon"
                size="icon"
                className={`${compactClasses.button} delete-button`}
                onClick={handleDeleteClick}
                title="Delete schedule entry"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <Trash className={`${compactClasses.button} pointer-events-none`} />
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
                    className={`${compactClasses.button} dropdown-trigger`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                  >
                    <MoreVertical className={`${compactClasses.button} pointer-events-none`} />
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
      <div className="pt-1.5 px-1">
        {isCompact ? (
          // For short events, show text with minimal padding
          <div className="flex items-center">
            <div className={`font-medium truncate flex-1 ${compactClasses.text}`}>
              {isPrivateNonOwner ? "Busy" : (event.title?.split(':')[0] || 'Untitled')}
            </div>
          </div>
        ) : (
          // For normal events, show two lines
          <>
            <div className="font-semibold truncate text-sm">
              {isPrivateNonOwner ? "Busy" : (event.title?.split(':')[0] || 'Untitled')}
            </div>
            {!isPrivateNonOwner && event.title?.split(':').slice(1).join(':').trim() && (
              <div className="truncate text-xs mt-0.5">
                {event.title?.split(':').slice(1).join(':').trim()}
              </div>
            )}
          </>
        )}
      </div>

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
