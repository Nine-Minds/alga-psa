'use client';

import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

/** Shortest designer area worth showing; shorter windows scroll the page instead. */
export const DESIGNER_AREA_MIN_HEIGHT = 320;

const SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll', 'overlay']);

const findScrollContainer = (element: HTMLElement): HTMLElement => {
  let current = element.parentElement;
  while (current && current !== document.documentElement) {
    if (SCROLLABLE_OVERFLOW.has(window.getComputedStyle(current).overflowY)) {
      return current;
    }
    current = current.parentElement;
  }
  return document.documentElement;
};

/** Lowest point the element and the chrome under it may reach before the container scrolls. */
const visibleBottomOf = (container: HTMLElement): number => {
  if (container === document.documentElement) {
    return container.clientHeight;
  }

  const paddingBottom = Number.parseFloat(window.getComputedStyle(container).paddingBottom) || 0;
  return container.getBoundingClientRect().top + container.clientTop + container.clientHeight - paddingBottom;
};

interface FitToAvailableHeightOptions {
  /** Only measure while the host actually wants a fitted box. */
  enabled: boolean;
  /** Floor for very short windows: below this the page scrolls instead of squashing the canvas. */
  minHeight: number;
}

/**
 * Height in pixels that lets the referenced element, and the page chrome under it, end where
 * its scroll container ends, so the page does not scroll. Everything around the element is
 * measured rather than guessed, which is what keeps an editor fitting on either of its routes
 * and however its header row happens to wrap.
 */
export const useFitToAvailableHeight = (
  ref: RefObject<HTMLElement | null>,
  { enabled, minHeight }: FitToAvailableHeightOptions,
): number | null => {
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setHeight(null);
      return;
    }

    const element = ref.current;
    if (!element) {
      return;
    }

    const container = findScrollContainer(element);
    let frame = 0;

    const measure = () => {
      const target = ref.current;
      if (!target) {
        return;
      }

      const rect = target.getBoundingClientRect();
      // Lowest edge the element is responsible for: its own box plus the padding and siblings
      // every ancestor still draws under it (card padding, page padding).
      let occupiedBottom = rect.bottom;
      for (let node = target.parentElement; node && node !== container; node = node.parentElement) {
        occupiedBottom = Math.max(occupiedBottom, node.getBoundingClientRect().bottom);
      }

      const slack = visibleBottomOf(container) - occupiedBottom;
      setHeight(Math.max(Math.round(rect.height + slack), minHeight));
    };

    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('resize', scheduleMeasure);

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure);
    if (observer) {
      // Watching every box between the element and its container catches whatever grows above
      // us without a window resize: an error alert, a banner, a header row taking another line.
      observer.observe(container);
      for (let node = element.parentElement; node && node !== container; node = node.parentElement) {
        observer.observe(node);
      }
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleMeasure);
      observer?.disconnect();
    };
  }, [enabled, minHeight, ref]);

  return enabled ? height : null;
};
