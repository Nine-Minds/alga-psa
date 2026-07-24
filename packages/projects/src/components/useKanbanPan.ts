'use client';

import { useEffect, useRef, type RefObject } from 'react';

const PAN_THRESHOLD = 5;
// Vertical rubber-band limit (px) for the translateY fallback used when the
// board has no native scroll overflow. Bounding it — and always snapping back
// to 0 on mouseup — is what stops repeated drags from drifting the board
// off-screen.
const RUBBER_BAND_LIMIT = 64;
const INTERACTIVE_SELECTOR =
  '[draggable="true"], button, a, input, select, textarea, [role="scrollbar"], [data-kanban-scrollbar-thumb]';

/**
 * Attaches Figma/Miro-style click-and-drag panning to a Kanban scroll container.
 *
 * Horizontal panning uses the container's native scrollLeft.
 * Vertical panning uses scrollTop when the board overflows, otherwise applies
 * a bounded, rubber-banded CSS translateY on the board so dragging still
 * feels responsive. The translateY always snaps back to 0 on mouseup, so
 * offsets can never accumulate across drags.
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
    useTranslateY: false,
    board: null as HTMLElement | null,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const state = stateRef.current;

    const getBoard = (): HTMLElement | null =>
      container.querySelector('[data-kanban-board]') as HTMLElement | null;

    const applyTranslateY = (offset: number, animate = false) => {
      const board = state.board ?? getBoard();
      if (!board) return;
      board.style.transition = animate ? 'transform 0.15s ease-out' : '';
      board.style.transform = offset === 0 ? '' : `translateY(${offset}px)`;
    };

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

      // Vertical: native scroll when possible, otherwise a bounded rubber-band
      // translateY so dragging still feels responsive when the board has no
      // overflow of its own.
      if (state.useTranslateY) {
        const raw = deltaY;
        const clamped = Math.max(-RUBBER_BAND_LIMIT, Math.min(RUBBER_BAND_LIMIT, raw));
        applyTranslateY(clamped);
      } else {
        container.scrollTop = state.startScrollTop - deltaY;
      }
    };

    const handleMouseUp = () => {
      // Always snap the translateY offset back to 0 so it can never persist
      // (and accumulate) across drags.
      if (state.useTranslateY) {
        applyTranslateY(0, true);
      }
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
      state.board = state.useTranslateY ? getBoard() : null;

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
      applyTranslateY(0);
      cleanupPanning();
    };
  }, [containerRef, enabled]);
}
