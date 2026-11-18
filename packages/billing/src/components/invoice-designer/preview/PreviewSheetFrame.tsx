'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { PREVIEW_SHEET_CLASS } from '../../../lib/invoice-template-ast/previewSheet';
import {
  computePreviewSheetScale,
  readPreviewSheetMetrics,
  type PreviewZoomMode,
} from './previewSheetScale';

/** Body padding the server's screen-only sheet CSS puts around the sheet, per side. */
const SHEET_GUTTER_PX = 24;
/** Height budget a label is fitted into, and the fixed height of an unframed document preview. */
const FIT_HEIGHT_PX = 640;

interface PreviewSheetFrameProps {
  html: string;
  title: string;
  zoomMode: PreviewZoomMode;
  /** Reports the applied scale (for the zoom control's label), or null when the HTML has no sheet. */
  onScaleChange?: (scale: number | null) => void;
  automationId?: string;
}

/**
 * The authoritative preview iframe. For a label the server draws the markup on a sheet the size of the
 * printed cell; this frame zooms that sheet (fit or 100%) and sizes itself to the result, so a 4 x 2 in
 * label shows as a label instead of a speck in the corner of a full-width page. HTML without a sheet (a
 * full-page document) keeps the plain fixed-height frame.
 */
export function PreviewSheetFrame({ html, title, zoomMode, onScaleChange, automationId }: PreviewSheetFrameProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [frameHeight, setFrameHeight] = useState<number>(FIT_HEIGHT_PX);
  const [hasSheet, setHasSheet] = useState(false);
  const onScaleChangeRef = useRef(onScaleChange);
  onScaleChangeRef.current = onScaleChange;

  const layout = useCallback(() => {
    const iframe = iframeRef.current;
    const container = containerRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !container || !doc?.documentElement) return;

    const sheet = doc.querySelector<HTMLElement>(`.${PREVIEW_SHEET_CLASS}`);
    const metrics = readPreviewSheetMetrics(sheet);
    if (sheet && metrics) {
      const scale = computePreviewSheetScale(
        metrics,
        {
          widthPx: container.clientWidth - SHEET_GUTTER_PX * 2,
          heightPx: FIT_HEIGHT_PX - SHEET_GUTTER_PX * 2,
        },
        zoomMode,
      );
      // CSS zoom (not transform) so the scaled sheet takes up its scaled size and the frame can measure it.
      sheet.style.setProperty('zoom', String(scale));
      onScaleChangeRef.current?.(scale);
      setHasSheet(true);
    } else {
      // Unframed document (or not loaded yet): the fixed-height white frame the preview always had.
      onScaleChangeRef.current?.(null);
      setHasSheet(false);
      setFrameHeight(FIT_HEIGHT_PX);
      return;
    }
    // Measure the body, not the root: the root's scrollHeight never drops below the frame's own height,
    // so a frame sized from it could grow (100%) but never shrink back (fit).
    const root = doc.documentElement;
    const horizontalScrollbarPx = root.scrollWidth > root.clientWidth ? 18 : 0;
    const contentHeight = doc.body ? Math.ceil(doc.body.getBoundingClientRect().height) + horizontalScrollbarPx : 0;
    if (contentHeight > 0) {
      setFrameHeight(contentHeight);
    }
  }, [zoomMode]);
  // Observers outlive renders, so they call the CURRENT layout (current zoom mode), never a stale one.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Re-lay out when the zoom mode changes (the iframe document stays loaded).
  useEffect(() => {
    layout();
  }, [layout, html]);

  // Re-fit when the pane resizes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => layoutRef.current());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Each srcdoc load is a fresh document: lay it out, and re-fit when it grows (late images, fonts).
  // The observer dies with the document it watches.
  const handleLoad = useCallback(() => {
    layoutRef.current();
    const frameWindow = iframeRef.current?.contentWindow as (Window & { ResizeObserver?: typeof ResizeObserver }) | null;
    const body = iframeRef.current?.contentDocument?.body;
    if (frameWindow?.ResizeObserver && body) {
      new frameWindow.ResizeObserver(() => layoutRef.current()).observe(body);
    }
  }, []);

  return (
    <div ref={containerRef} className="w-full">
      <iframe
        ref={iframeRef}
        title={title}
        srcDoc={html}
        onLoad={handleLoad}
        style={{ height: frameHeight }}
        className={`block w-full border-0${hasSheet ? '' : ' bg-white'}`}
        data-automation-id={automationId}
      />
    </div>
  );
}
