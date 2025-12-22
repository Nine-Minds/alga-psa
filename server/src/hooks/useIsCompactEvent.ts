import { useEffect, useState, useRef, RefObject } from 'react';
import { IScheduleEntry } from 'server/src/interfaces/schedule.interfaces';

/**
 * Custom hook to determine if an event should use compact styling
 * based on its duration and rendered height
 * 
 * @param event - The schedule entry event
 * @param eventRef - Reference to the event's DOM element
 * @returns Object containing compact event state and styling classes
 */
export function useIsCompactEvent(
  event: IScheduleEntry,
  eventRef: RefObject<HTMLDivElement | null>
) {
  const [isShort, setIsShort] = useState(false);
  const isShortRef = useRef(false);

  // Calculate event duration in minutes
  const eventDuration = Math.floor(
    (new Date(event.scheduled_end).getTime() - 
     new Date(event.scheduled_start).getTime()) / (1000 * 60)
  );
  
  // Event is compact if it's 15 minutes or less, or if rendered height is small
  const isCompact = isShort || eventDuration <= 15;

  // Monitor element height
  useEffect(() => {
    const checkHeight = () => {
      if (eventRef.current) {
        const currentIsShort = eventRef.current.offsetHeight < 40;
        if (currentIsShort !== isShortRef.current) {
          isShortRef.current = currentIsShort;
          setIsShort(currentIsShort);
        }
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
  }, [eventRef]);

  return {
    isCompact,
    eventDuration,
    // Provide consistent class names for compact events
    compactClasses: {
      text: isCompact ? 'text-[10px]' : 'text-xs',
      button: isCompact ? 'w-3 h-3' : 'w-4 h-4',
      buttonGap: isCompact ? 'gap-0.5' : 'gap-1',
      buttonContainer: isCompact ? 'gap-0.5 pr-0.5 pt-0.5' : 'gap-1 mt-0.5',
      padding: isCompact ? '2px' : '4px',
      fontSize: isCompact ? '9px' : '12px',
      lineHeight: isCompact ? '1.1' : '1.5'
    }
  };
}