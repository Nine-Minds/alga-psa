import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import { designerNodeSelector as nodeSelector } from '../utils/canvasDom';
import type { HandleResizeValue } from '../utils/handleResize';

export type ResizeHandle = 'e' | 'w' | 's' | 'se' | 'sw';

/** Clears the authored size along the given dimensions, back to sizing by content. */
export type HandleResetSize = (nodeId: string, dimensions: { width: boolean; height: boolean }) => void;

/** A dragged size in designer px, or `'auto'` when it rests on the block's content size. */
export type HandleResize = (
  nodeId: string,
  size: { width?: HandleResizeValue; height?: HandleResizeValue },
  commit: boolean
) => void;

type SelectionAdornerProps = {
  nodeId: string;
  /** The artboard the adorner is drawn in; block boxes are measured relative to it. */
  artboard: HTMLElement | null;
  canvasScale: number;
  /** Which handles the block supports (dividers and spacers only resize along one side). */
  handles: ResizeHandle[];
  onResize: HandleResize;
  onResetSize: HandleResetSize;
  /** Changes whenever the canvas content may have moved, so the frame is re-measured. */
  layoutKey: unknown;
  /** Reports the block's box in designer px (the rulers highlight it). */
  onFrameChange?: (frame: Frame | null) => void;
};

export type Frame = { left: number; top: number; width: number; height: number };

const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  e: 'ew-resize',
  w: 'ew-resize',
  s: 'ns-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize',
};

/** On-screen size of a handle's grab area and grip, independent of zoom. */
const HIT_PX = 14;

const GRIP_PX = 8;

/**
 * How long a freshly selected block's handles stay dormant after the selecting press is
 * released. It covers the platform double-click interval (500ms on Windows, the usual
 * default elsewhere), so the second press of a double-click on the block's edge still
 * reaches the block (inline text edit) instead of a handle (size reset).
 * Trade-off: grabbing a handle within this window of selecting a block drags the block's
 * body instead of resizing it.
 */
export const HANDLE_ARM_DELAY_MS = 500;
/** Screen px within which a resize snaps to the block's content (auto) size. */
const AUTO_DETENT_PX = 6;

/**
 * The block's content size along one dimension: its box with the authored size
 * removed. Measured synchronously (style restored before paint), in designer px.
 */
const measureContentSize = (element: HTMLElement, dimension: 'width' | 'height', scale: number): number => {
  const previous = element.style[dimension];
  element.style[dimension] = '';
  const rect = element.getBoundingClientRect();
  element.style[dimension] = previous;
  return Math.round((dimension === 'width' ? rect.width : rect.height) / scale);
};

/**
 * Resize handles for the selected block, drawn in a layer above every block so a
 * handle is never covered by the block's content, clipped by an image frame, or
 * confused with a neighbour's. Dragging a handle resizes by exactly the pointer's
 * movement at any zoom, along the dragged side only.
 */
export const SelectionAdorner: React.FC<SelectionAdornerProps> = ({
  nodeId,
  artboard,
  canvasScale,
  handles,
  onResize,
  onResetSize,
  layoutKey,
  onFrameChange,
}) => {
  const { t } = useTranslation('msp/invoicing');
  const [frame, setFrame] = useState<Frame | null>(null);
  const [readout, setReadout] = useState<{ width: number; height: number; widthAuto: boolean; heightAuto: boolean } | null>(null);
  const resizingRef = useRef(false);
  // Handles are drawn above the block, so on the press that selects a block (and a
  // double-click's second press) they would take the pointer from the block: the release
  // lands on a handle, the "click" retargets to the canvas and deselects, and a double-click
  // runs the size reset instead of text edit. They stay dormant (pointer-events: none) for
  // each new selection until the selecting press is released and the double-click interval
  // has passed. Keyed by block id, so a selection change disarms in the same render.
  const [armedNodeId, setArmedNodeId] = useState<string | null>(null);
  const armed = armedNodeId === nodeId;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        stopListening();
        setArmedNodeId(nodeId);
      }, HANDLE_ARM_DELAY_MS);
    };
    // The adorner mounts during the selecting press, before its release: the interval
    // restarts at the release. A selection made without a press (layers panel, keyboard)
    // has no release to wait for and arms HANDLE_ARM_DELAY_MS after mounting.
    const stopListening = () => {
      window.removeEventListener('pointerup', schedule, true);
      window.removeEventListener('pointercancel', schedule, true);
    };
    window.addEventListener('pointerup', schedule, true);
    window.addEventListener('pointercancel', schedule, true);
    schedule();
    return () => {
      stopListening();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [nodeId]);

  const measure = useCallback(() => {
    if (!artboard) return;
    const element = artboard.querySelector<HTMLElement>(nodeSelector(nodeId));
    if (!element) {
      setFrame(null);
      return;
    }
    const base = artboard.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const next = {
      left: (rect.left - base.left) / canvasScale,
      top: (rect.top - base.top) / canvasScale,
      width: rect.width / canvasScale,
      height: rect.height / canvasScale,
    };
    setFrame((current) =>
      current &&
      Math.abs(current.left - next.left) < 0.5 &&
      Math.abs(current.top - next.top) < 0.5 &&
      Math.abs(current.width - next.width) < 0.5 &&
      Math.abs(current.height - next.height) < 0.5
        ? current
        : next
    );
  }, [artboard, canvasScale, nodeId]);

  useLayoutEffect(() => {
    measure();
  }, [measure, layoutKey]);

  useLayoutEffect(() => {
    onFrameChange?.(frame);
  }, [frame, onFrameChange]);

  useLayoutEffect(() => () => onFrameChange?.(null), [onFrameChange]);

  useLayoutEffect(() => {
    if (!artboard || typeof ResizeObserver === 'undefined') return;
    const element = artboard.querySelector<HTMLElement>(nodeSelector(nodeId));
    const observer = new ResizeObserver(() => measure());
    observer.observe(artboard);
    if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [artboard, measure, nodeId, layoutKey]);

  const startResize = (handle: ResizeHandle) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !frame || !armed) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = Math.round(frame.width);
    const startHeight = Math.round(frame.height);
    const changesWidth = handle !== 's';
    const changesHeight = handle === 's' || handle === 'se' || handle === 'sw';
    const element = artboard?.querySelector<HTMLElement>(nodeSelector(nodeId)) ?? null;
    const contentWidth = changesWidth && element ? measureContentSize(element, 'width', canvasScale) : null;
    const contentHeight = changesHeight && element ? measureContentSize(element, 'height', canvasScale) : null;
    const detent = AUTO_DETENT_PX / canvasScale;
    const snap = (value: number, content: number | null): HandleResizeValue =>
      content !== null && content > 0 && Math.abs(value - content) <= detent ? 'auto' : value;
    let latest: { width?: HandleResizeValue; height?: HandleResizeValue } | null = null;
    resizingRef.current = true;

    const handleMove = (moveEvent: PointerEvent) => {
      // Like a drag, a resize starts once the pointer has really moved.
      if (!latest && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 3) return;
      const dx = (moveEvent.clientX - startX) / canvasScale;
      const dy = (moveEvent.clientY - startY) / canvasScale;
      const rawWidth = changesWidth ? Math.max(8, Math.round(handle.includes('w') ? startWidth - dx : startWidth + dx)) : undefined;
      const rawHeight = changesHeight ? Math.max(8, Math.round(startHeight + dy)) : undefined;
      const width = rawWidth === undefined ? undefined : snap(rawWidth, contentWidth);
      const height = rawHeight === undefined ? undefined : snap(rawHeight, contentHeight);
      if (latest && latest.width === width && latest.height === height) return;
      latest = { width, height };
      setReadout({
        width: width === 'auto' ? contentWidth ?? startWidth : width ?? startWidth,
        height: height === 'auto' ? contentHeight ?? startHeight : height ?? startHeight,
        widthAuto: width === 'auto',
        heightAuto: height === 'auto',
      });
      onResize(nodeId, latest, false);
    };
    const finish = () => {
      window.removeEventListener('pointermove', handleMove, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      resizingRef.current = false;
      setReadout(null);
      // A press without movement changes nothing (and adds no undo step).
      if (latest) {
        onResize(nodeId, latest, true);
        // The release would otherwise "click" the canvas and clear the selection.
        const swallowClick = (clickEvent: MouseEvent) => clickEvent.stopPropagation();
        window.addEventListener('click', swallowClick, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallowClick, { capture: true }), 0);
      }
    };
    window.addEventListener('pointermove', handleMove, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
  };

  if (!frame) return null;
  const inverse = 1 / canvasScale;
  const hit = HIT_PX * inverse;
  const grip = GRIP_PX * inverse;

  const handleBox = (handle: ResizeHandle): React.CSSProperties => {
    const { width, height } = frame;
    // Side handles span the edge between the corner handles, but never shrink below a
    // comfortable grab length: on a short block they stay centred on the edge (overlapping
    // the corners rather than leaving a dead spot).
    const sideLength = (edge: number) => Math.max(edge - hit, hit * 2);
    const sideHeight = sideLength(height);
    const sideWidth = sideLength(width);
    switch (handle) {
      case 'e':
        return { left: width - hit / 2, top: (height - sideHeight) / 2, width: hit, height: sideHeight };
      case 'w':
        return { left: -hit / 2, top: (height - sideHeight) / 2, width: hit, height: sideHeight };
      case 's':
        return { left: (width - sideWidth) / 2, top: height - hit / 2, width: sideWidth, height: hit };
      case 'se':
        return { left: width - hit / 2, top: height - hit / 2, width: hit, height: hit };
      case 'sw':
        return { left: -hit / 2, top: height - hit / 2, width: hit, height: hit };
    }
  };

  return (
    <div
      className="pointer-events-none absolute z-50"
      style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}
      data-automation-id="designer-selection-adorner"
    >
      {handles.map((handle) => (
        <div
          key={handle}
          role="presentation"
          className="group absolute flex items-center justify-center"
          style={{
            ...handleBox(handle),
            cursor: HANDLE_CURSOR[handle],
            touchAction: 'none',
            // The adorner root is pointer-events: none; only armed handles take the pointer.
            pointerEvents: armed ? 'auto' : 'none',
          }}
          data-armed={armed ? 'true' : 'false'}
          onPointerDown={startResize(handle)}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => {
            event.stopPropagation();
            // Only a block that was already selected before this gesture resets its size.
            if (!armed) return;
            onResetSize(nodeId, { width: handle !== 's', height: handle === 's' || handle === 'se' || handle === 'sw' });
          }}
          title={t('designer.resize.handleHint', { defaultValue: 'Drag to resize · double-click to size to content' })}
          data-automation-id={`designer-resize-handle-${handle}`}
        >
          <span
            className={clsx(
              'block border border-primary-500 bg-white shadow-sm group-hover:bg-primary-500 dark:bg-slate-900',
              handle === 'se' || handle === 'sw' ? 'rounded-sm' : 'rounded-full'
            )}
            style={
              handle === 'e' || handle === 'w'
                ? { width: grip * 0.75, height: Math.min(grip * 2.5, Math.max(grip, frame.height / 3)) }
                : handle === 's'
                  ? { width: Math.min(grip * 2.5, Math.max(grip, frame.width / 3)), height: grip * 0.75 }
                  : { width: grip, height: grip }
            }
          />
        </div>
      ))}
      {readout && (
        <div
          className="absolute whitespace-nowrap rounded bg-slate-900 px-1.5 py-0.5 font-mono text-white shadow"
          style={{
            left: frame.width / 2,
            top: frame.height + 10 * inverse,
            transform: 'translateX(-50%)',
            fontSize: 11 * inverse,
          }}
          data-automation-id="designer-resize-readout"
        >
          {readout.widthAuto ? t('designer.resize.autoValue', { defaultValue: 'Auto ({{value}})', value: readout.width }) : readout.width}
          {' × '}
          {readout.heightAuto ? t('designer.resize.autoValue', { defaultValue: 'Auto ({{value}})', value: readout.height }) : readout.height}
        </div>
      )}
    </div>
  );
};
