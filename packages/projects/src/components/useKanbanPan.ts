'use client';

import { useEffect, useRef, type RefObject } from 'react';

const PAN_THRESHOLD = 5;
const INTERACTIVE_SELECTOR =
  '[draggable="true"], button, a, input, select, textarea, [role="scrollbar"], [data-kanban-scrollbar-thumb]';

/**
 * Attaches Figma/Miro-style click-and-drag panning to a Kanban scroll container.
 *
 * Horizontal panning uses the container's native scrollLeft.
 * Vertical panning uses scrollTop when the board overflows, otherwise
 * applies a CSS translateY on the board so panning always feels responsive.
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
    startTranslateY: 0,
    useTranslateY: false,
    board: null as HTMLElement | null,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const state = stateRef.current;

    /** Current translateY offset persisted across drags. */
    let translateY = 0;

    const getBoard = (): HTMLElement | null =>
      container.querySelector('[data-kanban-board]') as HTMLElement | null;

    const applyTranslateY = (offset: number) => {
      const board = state.board ?? getBoard();
      if (!board) return;
      translateY = offset;
      board.style.transform = offset === 0 ? '' : `translateY(${offset}px)`;
    };

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

      // Horizontal: native scroll
      container.scrollLeft = state.startScrollLeft - deltaX;

      // Vertical: native scroll when possible, otherwise translateY
      if (state.useTranslateY) {
        const raw = state.startTranslateY + deltaY;
        // Clamp: can only pull board upward (reveal lower content), min 0 means no
        // downward shift past origin.
        applyTranslateY(Math.min(0, raw));
      } else {
        container.scrollTop = state.startScrollTop - deltaY;
      }
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

      const canScrollVertically = container.scrollHeight > container.clientHeight;

      state.active = false;
      state.hasMoved = false;
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.startScrollLeft = container.scrollLeft;
      state.startScrollTop = container.scrollTop;
      state.useTranslateY = !canScrollVertically;
      state.startTranslateY = translateY;
      state.board = getBoard();

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

    /** Reset translateY on native scroll / wheel so the two don't fight. */
    const handleScroll = () => {
      if (translateY !== 0 && container.scrollHeight > container.clientHeight) {
        applyTranslateY(0);
      }
    };

    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('click', handleClickCapture, true);
    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('click', handleClickCapture, true);
      container.removeEventListener('scroll', handleScroll);
      applyTranslateY(0);
      cleanupPanning();
    };
  }, [containerRef, enabled]);
}
