'use client';

import { useEffect, useRef, type RefObject } from 'react';

const PAN_THRESHOLD = 5;
const INTERACTIVE_SELECTOR =
  '[draggable="true"], button, a, input, select, textarea, [role="scrollbar"], [data-kanban-scrollbar-thumb]';

/**
 * Attaches Figma/Miro-style click-and-drag panning to a Kanban scroll container.
 *
 * Both horizontal and vertical panning are applied directly to the container's
 * scrollLeft / scrollTop, so the entire board moves as a single canvas.
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

    const cleanupPanning = () => {
      state.active = false;
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
        document.body.classList.add('kanban-panning');
      }

      event.preventDefault();
      container.scrollLeft = state.startScrollLeft - deltaX;
      container.scrollTop = state.startScrollTop - deltaY;
    };

    const handleMouseUp = () => {
      cleanupPanning();
      // Reset hasMoved asynchronously so the synchronous click event (if any)
      // still sees it as true, but it doesn't stay stuck when mouseup fires
      // outside the container (where no click event follows).
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
