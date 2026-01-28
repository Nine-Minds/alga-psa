'use client';

import { useEffect, useMemo, useState, useRef } from 'react';

export type CompactEventClasses = {
  text: string;
  textTitle: string;
  textSubtitle: string;
  padding: string;
  button: string;
  buttonGap: string;
  buttonContainer: string;
  fontSize: string;
  lineHeight: string;
};

export type CompactEventState = {
  isCompact: boolean;
  eventDuration: number;
  compactClasses: CompactEventClasses;
};

/**
 * Event with scheduled times for duration calculation
 */
export interface ScheduledEvent {
  scheduled_start: string | Date;
  scheduled_end: string | Date;
}

/**
 * Options for the useIsCompactEvent hook
 */
export interface UseIsCompactEventOptions {
  /** When true, locks the compact state to prevent changes during resize/drag */
  isLocked?: boolean;
}

/**
 * Determines whether a calendar event should render in "compact" mode, based on:
 * 1. Event duration (15 minutes or less triggers compact mode)
 * 2. Rendered height of the event element (< 40px triggers compact mode)
 *
 * Returns both the boolean and a set of Tailwind utility class fragments for consistent styling.
 */
export function useIsCompactEvent(
  event?: ScheduledEvent | unknown,
  eventRef?: React.RefObject<HTMLElement | null>,
  options?: UseIsCompactEventOptions
): CompactEventState {
  const [isShort, setIsShort] = useState(false);
  const isShortRef = useRef(false);
  const lockedCompactRef = useRef<boolean | null>(null);

  // Calculate event duration in minutes
  const eventDuration = useMemo(() => {
    if (!event || typeof event !== 'object') return 60; // Default to 1 hour if no event
    const scheduledEvent = event as ScheduledEvent;
    if (!scheduledEvent.scheduled_start || !scheduledEvent.scheduled_end) return 60;

    return Math.floor(
      (new Date(scheduledEvent.scheduled_end).getTime() -
       new Date(scheduledEvent.scheduled_start).getTime()) / (1000 * 60)
    );
  }, [event]);

  // Calculate raw compact state
  const rawIsCompact = isShort || eventDuration <= 15;

  // Lock/unlock compact state based on options
  useEffect(() => {
    if (options?.isLocked) {
      // Lock the current compact state when resize/drag starts
      if (lockedCompactRef.current === null) {
        lockedCompactRef.current = rawIsCompact;
      }
    } else {
      // Unlock when resize/drag ends
      lockedCompactRef.current = null;
    }
  }, [options?.isLocked, rawIsCompact]);

  // Use locked state during resize, otherwise use calculated state
  const isCompact = options?.isLocked && lockedCompactRef.current !== null
    ? lockedCompactRef.current
    : rawIsCompact;

  // Monitor element height
  useEffect(() => {
    const checkHeight = () => {
      if (eventRef?.current) {
        const currentIsShort = eventRef.current.offsetHeight < 40;
        if (currentIsShort !== isShortRef.current) {
          isShortRef.current = currentIsShort;
          setIsShort(currentIsShort);
        }
      }
    };

    checkHeight();

    if (!eventRef?.current || typeof ResizeObserver === 'undefined') {
      return;
    }

    const element = eventRef.current;
    const observer = new ResizeObserver(checkHeight);
    observer.observe(element);

    return () => observer.disconnect();
  }, [eventRef]);

  const compactClasses = useMemo<CompactEventClasses>(() => {
    // Match original release/0.16.0 styling
    return isCompact
      ? {
          text: 'text-[10px]',
          textTitle: 'text-[10px]',
          textSubtitle: 'text-[9px]',
          padding: 'p-0.5',
          button: 'w-3 h-3',
          buttonGap: 'gap-0.5',
          buttonContainer: 'gap-0.5 pr-0.5 pt-0.5',
          fontSize: '9px',
          lineHeight: '1.1'
        }
      : {
          text: 'text-xs',
          textTitle: 'text-xs',
          textSubtitle: 'text-[10px]',
          padding: 'p-1',
          button: 'w-4 h-4',
          buttonGap: 'gap-1',
          buttonContainer: 'gap-1 mt-0.5',
          fontSize: '12px',
          lineHeight: '1.5'
        };
  }, [isCompact]);

  return { isCompact, eventDuration, compactClasses };
}
