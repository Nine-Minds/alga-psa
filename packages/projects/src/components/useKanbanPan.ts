'use client';

import { useEffect, useRef, type RefObject } from 'react';

const PAN_THRESHOLD = 5;
const INTERACTIVE_SELECTOR =
  '[draggable="true"], button, a, input, select, textarea, [role="scrollbar"], [data-kanban-scrollbar-thumb]';

/**
 * Attaches Figma/Miro-style click-and-drag panning to a Kanban scroll container.
 *
 * Horizontal panning uses the container's native scrollLeft.
 * Vertical panning uses the container's native scrollTop, which is naturally
 * clamped by the browser so panning can never drift past the content edges.
 *
 * Interactive elements (draggable cards, buttons, inputs, the custom scrollbar thumb)
 * are excluded so native HTML5 drag-and-drop and clicks keep working.
 */
export function useKanbanPan(containerRef: RefObject<HTMLDivElement | null>, enabled = true): void {
  const stateRef = useRef({
    active: false,
    hasMoved: false,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const state = stateRef.current;

    const setPanningCursor = (panning: boolean) => {
      if (panning) {
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      } else {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    const cleanupPanning = () => {
      state.active = false;
      setPanningCursor(false);
      document.body.classList.remove('kanban-panning');
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (event: MouseEvent) => {
      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;

      if (!state.active) {
        if (Math.abs(deltaX) < PAN_THRESHOLD && Math.abs(deltaY) < PAN_THRESHOLD) {
          return;
        }
        state.active = true;
        state.hasMoved = true;
        setPanningCursor(true);
        document.body.classList.add('kanban-panning');
      }

      event.preventDefault();

      // Horizontal: native scroll
      container.scrollLeft = state.startScrollLeft - deltaX;

      // Vertical: native scroll, naturally clamped to the content bounds
      container.scrollTop = state.startScrollTop - deltaY;
    };

    const handleMouseUp = () => {
      cleanupPanning();
      if (state.hasMoved) {
        setTimeout(() => { state.hasMoved = false; }, 0);
      }
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;

      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(INTERACTIVE_SELECTOR)) return;

      state.active = false;
      state.hasMoved = false;
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.startScrollLeft = container.scrollLeft;
      state.startScrollTop = container.scrollTop;

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    };

    const handleClickCapture = (event: MouseEvent) => {
      if (state.hasMoved) {
        event.stopPropagation();
        event.preventDefault();
        state.hasMoved = false;
      }
    };

    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('click', handleClickCapture, true);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('click', handleClickCapture, true);
      cleanupPanning();
    };
  }, [containerRef, enabled]);
}
