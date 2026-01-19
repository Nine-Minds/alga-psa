'use client';

import { useEffect, useMemo, useState } from 'react';

export type CompactEventClasses = {
  text: string;
  padding: string;
  button: string;
};

export type CompactEventState = {
  isCompact: boolean;
  compactClasses: CompactEventClasses;
};

/**
 * Determines whether a calendar event should render in "compact" mode, based on viewport
 * width and (optionally) the rendered height of the event element.
 *
 * Some scheduling components expect both the boolean and a set of Tailwind-ish utility
 * class fragments for consistent styling.
 */
export function useIsCompactEvent(
  _event?: unknown,
  eventRef?: React.RefObject<HTMLElement>
): CompactEventState {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsCompact(window.innerWidth < 768);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!eventRef?.current || typeof ResizeObserver === 'undefined') {
      return;
    }

    const element = eventRef.current;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      // When events get very short vertically (e.g., < ~28px), switch to compact rendering.
      const height = entry.contentRect?.height ?? 0;
      if (height > 0) {
        setIsCompact((prev) => (window.innerWidth < 768 ? true : (height < 28 ? true : prev)));
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [eventRef]);

  const compactClasses = useMemo<CompactEventClasses>(() => {
    return isCompact
      ? { text: 'text-xs leading-tight', padding: 'p-1', button: 'h-5 w-5' }
      : { text: 'text-sm', padding: 'p-2', button: 'h-6 w-6' };
  }, [isCompact]);

  return { isCompact, compactClasses };
}
