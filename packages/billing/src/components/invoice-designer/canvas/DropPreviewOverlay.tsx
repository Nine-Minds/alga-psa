import React from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import type { DropPreview } from '../hooks/useDropTargeting';
import type { DropRect } from '../utils/dropTargeting';
import { DESIGNER_CANVAS_SELECTOR, designerNodeSelector } from '../utils/canvasDom';

/** A static snapshot of the dragged block, shown under the pointer. */
export type DragGhost = {
  element: HTMLElement;
  /** On-screen size of the block. */
  width: number;
  height: number;
  /** Canvas zoom the block was shown at (the copy is laid out unzoomed). */
  zoom: number;
};

const GHOST_MAX_WIDTH = 220;
const GHOST_MAX_HEIGHT = 120;

/** Snapshots a block as it looks on the canvas (ids stripped so the copy is inert). */
export const captureDragGhost = (nodeId: string): DragGhost | null => {
  if (typeof document === 'undefined') return null;
  const artboard = document.querySelector<HTMLElement>(DESIGNER_CANVAS_SELECTOR);
  const source = artboard?.querySelector<HTMLElement>(designerNodeSelector(nodeId));
  if (!artboard || !source) return null;
  const rect = source.getBoundingClientRect();
  const zoom = artboard.offsetWidth > 0 ? artboard.getBoundingClientRect().width / artboard.offsetWidth : 1;
  const element = source.cloneNode(true) as HTMLElement;
  [element, ...Array.from(element.querySelectorAll<HTMLElement>('*'))].forEach((node) => {
    node.removeAttribute('id');
    Array.from(node.attributes)
      .filter((attribute) => attribute.name.startsWith('data-'))
      .forEach((attribute) => node.removeAttribute(attribute.name));
  });
  Object.assign(element.style, {
    position: 'static',
    width: `${rect.width / zoom}px`,
    height: `${rect.height / zoom}px`,
    margin: '0',
  });
  return { element, width: rect.width, height: rect.height, zoom };
};

const GhostSnapshot: React.FC<{ ghost: DragGhost }> = ({ ghost }) => {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren(ghost.element);
    return () => host.replaceChildren();
  }, [ghost]);
  const fit = Math.min(1, GHOST_MAX_WIDTH / Math.max(1, ghost.width), GHOST_MAX_HEIGHT / Math.max(1, ghost.height));
  return (
    <div style={{ width: ghost.width * fit, height: ghost.height * fit, overflow: 'hidden' }}>
      <div ref={hostRef} style={{ transform: `scale(${ghost.zoom * fit})`, transformOrigin: 'top left' }} />
    </div>
  );
};

type DropPreviewOverlayProps = {
  preview: DropPreview | null;
  /** Name of the block (or palette item) being dragged. */
  dragLabel: string;
  /** Layer name for a block id. */
  getName: (nodeId: string) => string;
  /** Snapshot of the dragged block, carried under the pointer. */
  ghost?: DragGhost | null;
};

const LINE_THICKNESS = 3;
const CHIP_WIDTH = 220;
const CHIP_GAP = 12;

/**
 * Beside the receiving container, level with the pointer, so the chip never covers the
 * rows being aimed at; next to the pointer when there is no room either side.
 */
const resolveChipPosition = (
  pointer: { x: number; y: number },
  container: DropRect | null,
  clip: DropRect,
  /** Height of the ghost under the pointer, which the chip goes below. */
  ghostHeight = 0
): { style: React.CSSProperties; atPointer: boolean } => {
  const top = pointer.y - 12;
  if (container) {
    const right = container.left + container.width + CHIP_GAP;
    if (right + CHIP_WIDTH <= clip.left + clip.width) return { style: { left: right, top }, atPointer: false };
    const left = container.left - CHIP_GAP - CHIP_WIDTH;
    if (left >= clip.left) return { style: { left, top, width: CHIP_WIDTH, textAlign: 'right' }, atPointer: false };
  }
  return { style: { left: pointer.x + 18, top: pointer.y + 20 + (ghostHeight ? ghostHeight + 4 : 0) }, atPointer: true };
};

/**
 * What a drop will do, drawn over the canvas while dragging: the receiving container
 * outlined, a line where the block will land, and a chip at the cursor that says it.
 * Viewport-fixed, so it is never clipped by the canvas or covered by the blocks.
 */
export const DropPreviewOverlay: React.FC<DropPreviewOverlayProps> = ({ preview, dragLabel, getName, ghost = null }) => {
  const { t } = useTranslation('msp/invoicing');
  if (!preview || typeof document === 'undefined') return null;
  const { target, indicator, containerRect, pointer, clipRect } = preview;
  // Marks are drawn in a layer clipped to the visible canvas, offset to its origin.
  const clip = clipRect ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const ghostFit = ghost
    ? Math.min(1, GHOST_MAX_WIDTH / Math.max(1, ghost.width), GHOST_MAX_HEIGHT / Math.max(1, ghost.height))
    : 0;
  const chip = resolveChipPosition(pointer, containerRect, clip, ghost ? ghost.height * ghostFit : 0);
  const ox = clip.left;
  const oy = clip.top;

  const destination = !target
    ? t('designer.dragPreview.noTarget', { defaultValue: 'Outside the page — release to cancel' })
    : target.isNoop
      ? t('designer.dragPreview.noChange', { defaultValue: 'Stays where it is' })
      : target.placement === 'inside' && target.neighbor
        ? target.neighbor.side === 'after'
          ? t('designer.dragPreview.after', { defaultValue: 'After {{block}}', block: getName(target.neighbor.id) })
          : t('designer.dragPreview.before', { defaultValue: 'Before {{block}}', block: getName(target.neighbor.id) })
      : target.placement === 'inside'
        ? t('designer.dragPreview.inside', { defaultValue: 'Into {{container}}', container: getName(target.parentId) })
        : target.placement === 'before'
          ? t('designer.dragPreview.before', { defaultValue: 'Before {{block}}', block: getName(target.anchorId ?? '') })
          : t('designer.dragPreview.after', { defaultValue: 'After {{block}}', block: getName(target.anchorId ?? '') });

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[1000]" data-automation-id="designer-drop-preview">
      <div className="absolute overflow-hidden" style={{ left: clip.left, top: clip.top, width: clip.width, height: clip.height }}>
      {target && containerRect && (
        <div
          className="absolute rounded-md border-2 border-dashed border-primary-500/80 bg-primary-500/5"
          style={{
            left: containerRect.left - ox - 2,
            top: containerRect.top - oy - 2,
            width: containerRect.width + 4,
            height: containerRect.height + 4,
          }}
          data-automation-id="designer-drop-preview-container"
        >
          <span className="absolute left-0 top-0 -translate-y-full whitespace-nowrap rounded bg-primary-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {getName(target.parentId)}
          </span>
        </div>
      )}
      {target && !target.isNoop && indicator?.kind === 'line' && (
        <div
          className="absolute rounded-full bg-primary-500 shadow-[0_0_0_1px_white]"
          style={
            indicator.orientation === 'horizontal'
              ? { left: indicator.x - ox, top: indicator.y - oy - LINE_THICKNESS / 2, width: indicator.length, height: LINE_THICKNESS }
              : { left: indicator.x - ox - LINE_THICKNESS / 2, top: indicator.y - oy, width: LINE_THICKNESS, height: indicator.length }
          }
          data-automation-id="designer-drop-preview-line"
          data-orientation={indicator.orientation}
        />
      )}
      {target && !target.isNoop && indicator?.kind === 'box' && (
        <div
          className="absolute rounded-md bg-primary-500/15"
          style={{ left: indicator.rect.left - ox, top: indicator.rect.top - oy, width: indicator.rect.width, height: indicator.rect.height }}
          data-automation-id="designer-drop-preview-box"
        />
      )}
      </div>
      {ghost && (
        // What is being dragged travels with the pointer; where it goes is told beside the container.
        <div
          className="absolute rounded-md opacity-60 shadow-lg ring-1 ring-primary-500/60"
          style={{ left: pointer.x + 12, top: pointer.y + 12 }}
          data-automation-id="designer-drop-preview-ghost"
        >
          <GhostSnapshot ghost={ghost} />
        </div>
      )}
      {!ghost && !chip.atPointer && (
        <div
          className="absolute max-w-[140px] truncate rounded bg-slate-900/85 px-1.5 py-0.5 text-[10px] font-medium text-white shadow"
          style={{ left: pointer.x + 14, top: pointer.y + 14 }}
          data-automation-id="designer-drop-preview-cursor"
        >
          {dragLabel}
        </div>
      )}
      <div
        className={clsx(
          'absolute max-w-[220px] rounded-md border px-2 py-1 text-[11px] leading-tight shadow-lg',
          target
            ? 'border-slate-200 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
            : 'border-destructive/40 bg-white text-destructive dark:bg-slate-800'
        )}
        style={chip.style}
        data-automation-id="designer-drop-preview-chip"
      >
        <div className="truncate font-semibold">{dragLabel}</div>
        <div className="truncate">{destination}</div>
      </div>
    </div>,
    document.body
  );
};
