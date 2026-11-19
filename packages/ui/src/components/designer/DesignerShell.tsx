'use client';

/**
 * The frame every designer draws inside: a toolbar, a collapsible left pane, a canvas, and a
 * collapsible, resizable inspector. It owns layout and nothing else — it never learns what a
 * canvas holds, so a dashboard or report designer reuses it with a different canvas.
 *
 * LEVERAGE: pattern designer-three-pane-shell — the workflow designer and the invoice designer
 * each hand-roll this arrangement; they are not moved here, but a third one should not.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import {
  clampDesignerSidebarWidth,
  getDesignerSidebarWidthFromDrag,
  toggleDesignerSidebarWidth,
} from './designerSidebarSizing';

/** How wide the canvas renders its content, for previewing a responsive layout. */
export type DesignerPreviewWidth = 'desktop' | 'mobile';

export interface DesignerShellProps {
  /** Prefix for the shell's element ids. */
  idPrefix: string;
  toolbar: React.ReactNode;
  leftPane?: React.ReactNode;
  inspector?: React.ReactNode;
  /** Width of the inspector in px; the shell clamps it to the shared min/max. */
  inspectorWidth?: number;
  onInspectorWidthChange?: (width: number) => void;
  /** Accessible name for the resize handle. */
  inspectorResizeLabel?: string;
  children: React.ReactNode;
  className?: string;
  /** Rendered below the toolbar, across the full width (a restore-draft banner, an error). */
  banner?: React.ReactNode;
}

export function DesignerShell({
  idPrefix,
  toolbar,
  leftPane,
  inspector,
  inspectorWidth = 420,
  onInspectorWidthChange,
  inspectorResizeLabel,
  children,
  className,
  banner,
}: DesignerShellProps): React.ReactElement {
  const dragState = useRef<{ startWidth: number; startClientX: number } | null>(null);

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const state = dragState.current;
      if (!state || !onInspectorWidthChange) return;
      onInspectorWidthChange(
        getDesignerSidebarWidthFromDrag(state.startWidth, state.startClientX, event.clientX)
      );
    },
    [onInspectorWidthChange]
  );

  const handlePointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  const clampedWidth = clampDesignerSidebarWidth(inspectorWidth);

  return (
    <div
      id={idPrefix}
      className={`flex h-full min-h-0 flex-col bg-[rgb(var(--color-background))] ${className ?? ''}`.trim()}
    >
      <div
        id={`${idPrefix}-toolbar`}
        className="flex min-h-[3.25rem] shrink-0 items-center gap-2 border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-3"
      >
        {toolbar}
      </div>
      {banner}
      <div className="flex min-h-0 flex-1 items-stretch">
        {leftPane ? (
          <div id={`${idPrefix}-left-pane`} className="flex min-h-0 shrink-0 flex-col py-3 pl-3">
            {leftPane}
          </div>
        ) : null}
        <main
          id={`${idPrefix}-canvas`}
          className="min-w-0 flex-1 overflow-y-auto"
        >
          {children}
        </main>
        {inspector ? (
          <div className="flex min-h-0 shrink-0">
            <div
              id={`${idPrefix}-inspector-resize`}
              role="separator"
              aria-orientation="vertical"
              aria-label={inspectorResizeLabel}
              tabIndex={onInspectorWidthChange ? 0 : -1}
              className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[rgb(var(--color-border-300))] focus:outline-none focus-visible:bg-[rgb(var(--color-primary-400))]"
              onPointerDown={(event) => {
                if (!onInspectorWidthChange) return;
                dragState.current = { startWidth: clampedWidth, startClientX: event.clientX };
              }}
              onDoubleClick={() => onInspectorWidthChange?.(toggleDesignerSidebarWidth(clampedWidth))}
              onKeyDown={(event) => {
                if (!onInspectorWidthChange) return;
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  onInspectorWidthChange(clampDesignerSidebarWidth(clampedWidth + 16));
                } else if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  onInspectorWidthChange(clampDesignerSidebarWidth(clampedWidth - 16));
                }
              }}
            />
            <aside
              id={`${idPrefix}-inspector`}
              style={{ width: clampedWidth }}
              className="flex min-h-0 flex-col overflow-y-auto border-l border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]"
            >
              {inspector}
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default DesignerShell;
