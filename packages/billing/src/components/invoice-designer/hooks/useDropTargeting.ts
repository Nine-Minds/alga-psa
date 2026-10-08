import { useCallback, useEffect, useRef, useState } from 'react';

import type { DesignerComponentType, DesignerNode } from '../state/designerStore';
import { useInvoiceDesignerStore } from '../state/designerStore';
import { canNestWithinParent } from '../schema/componentSchema';
import { getNodeLayout } from '../utils/nodeProps';
import {
  resolveDropIndicatorGeometry,
  resolveDropTarget,
  resolveLayoutAxis,
  resolveOutlineDropTarget,
  type OutlineRowGeometry,
  type DropGeometryNode,
  type DropIndicatorGeometry,
  type DropRect,
  type DropTarget,
} from '../utils/dropTargeting';
import {
  DESIGNER_CANVAS_SELECTOR,
  DESIGNER_CANVAS_VIEWPORT_SELECTOR,
  DESIGNER_NODE_ID_ATTRIBUTE,
  DESIGNER_OUTLINE_DEPTH_ATTRIBUTE,
  DESIGNER_OUTLINE_EXPANDED_ATTRIBUTE,
  DESIGNER_OUTLINE_NODE_ID_ATTRIBUTE,
  DESIGNER_OUTLINE_PANE_ATTRIBUTE,
} from '../utils/canvasDom';

export type DropTargetingSubject = {
  /** Type the drop has to be valid for. */
  type: DesignerComponentType;
  /** The existing block being moved; null for palette drags. */
  nodeId: string | null;
};

export type DropPreview = {
  pointer: { x: number; y: number };
  target: DropTarget | null;
  indicator: DropIndicatorGeometry | null;
  /** Box of the container the drop goes into. */
  containerRect: DropRect | null;
  /** Visible canvas area; drop marks outside it are hidden. */
  clipRect: DropRect | null;
  /** Where the pointer is: over the canvas, or over the Outline pane (whose rows are tightly stacked). */
  surface?: 'canvas' | 'outline';
};

const toRect = (rect: DOMRect): DropRect => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });

const resolveRootNode = (nodes: DesignerNode[]): DesignerNode | undefined => {
  const documentNode = nodes.find((node) => node.type === 'document' && node.parentId === null);
  return (
    (documentNode ? nodes.find((node) => node.type === 'page' && node.parentId === documentNode.id) : undefined) ??
    nodes.find((node) => node.type === 'page')
  );
};

/** Reads every block's on-screen box from the canvas DOM. */
export const measureDropGeometry = (
  nodes: DesignerNode[],
  root: ParentNode = document
): { rootId: string; geometry: Map<string, DropGeometryNode>; viewport: DropRect | null } | null => {
  const page = resolveRootNode(nodes);
  const artboard = root.querySelector<HTMLElement>(DESIGNER_CANVAS_SELECTOR);
  if (!page || !artboard) return null;

  const rects = new Map<string, DropRect>();
  artboard.querySelectorAll<HTMLElement>(`[${DESIGNER_NODE_ID_ATTRIBUTE}]`).forEach((element) => {
    const id = element.getAttribute(DESIGNER_NODE_ID_ATTRIBUTE);
    if (id) rects.set(id, toRect(element.getBoundingClientRect()));
  });
  rects.set(page.id, toRect(artboard.getBoundingClientRect()));

  const geometry = new Map<string, DropGeometryNode>();
  nodes.forEach((node) => {
    if (node.type === 'document') return;
    geometry.set(node.id, {
      id: node.id,
      type: node.type,
      parentId: node.id === page.id ? null : node.parentId,
      children: node.children,
      allowedChildren: node.allowedChildren,
      axis: resolveLayoutAxis(getNodeLayout(node)),
      rect: rects.get(node.id),
    });
  });
  const viewport = artboard.closest<HTMLElement>(DESIGNER_CANVAS_VIEWPORT_SELECTOR);
  return { rootId: page.id, geometry, viewport: viewport ? toRect(viewport.getBoundingClientRect()) : null };
};

const containsPoint = (rect: DropRect, point: { x: number; y: number }) =>
  point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;

/** Outline rows on screen, in tree order. */
export const measureOutlineRows = (pane: ParentNode): Map<string, OutlineRowGeometry> => {
  const rows = new Map<string, OutlineRowGeometry>();
  pane.querySelectorAll<HTMLElement>(`[${DESIGNER_OUTLINE_NODE_ID_ATTRIBUTE}]`).forEach((element) => {
    const id = element.getAttribute(DESIGNER_OUTLINE_NODE_ID_ATTRIBUTE);
    if (!id) return;
    rows.set(id, {
      id,
      rect: toRect(element.getBoundingClientRect()),
      depth: Number(element.getAttribute(DESIGNER_OUTLINE_DEPTH_ATTRIBUTE) ?? 0),
      expanded: element.getAttribute(DESIGNER_OUTLINE_EXPANDED_ATTRIBUTE) === 'true',
    });
  });
  return rows;
};

/**
 * Tracks the pointer during a drag and resolves, every frame, where a drop would land.
 * The preview drives the on-canvas indicator; `resolveFinal` gives the drop on release.
 */
export const useDropTargeting = (subject: DropTargetingSubject | null) => {
  const [preview, setPreview] = useState<DropPreview | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const compute = useCallback(
    (pointer: { x: number; y: number }): DropPreview | null => {
      if (!subject) return null;
      const measured = measureDropGeometry(useInvoiceDesignerStore.getState().nodes);
      if (!measured) return { pointer, target: null, indicator: null, containerRect: null, clipRect: null };

      // Over the Outline, the drop is placed in the tree.
      const outlinePane = document.querySelector<HTMLElement>(`[${DESIGNER_OUTLINE_PANE_ATTRIBUTE}]`);
      const outlineRect = outlinePane ? toRect(outlinePane.getBoundingClientRect()) : null;
      if (outlinePane && outlineRect && containsPoint(outlineRect, pointer)) {
        const rows = measureOutlineRows(outlinePane);
        const resolved = resolveOutlineDropTarget({
          pointer,
          rows: [...rows.values()],
          nodes: measured.geometry,
          activeType: subject.type,
          activeId: subject.nodeId,
          canNest: canNestWithinParent,
        });
        return {
          pointer,
          target: resolved?.target ?? null,
          indicator: resolved?.indicator ?? null,
          containerRect: resolved ? rows.get(resolved.containerRowId)?.rect ?? null : null,
          clipRect: outlineRect,
          surface: 'outline',
        };
      }

      // Blocks scrolled out of view (behind the panels) are not drop targets: the pointer
      // has to be over the visible canvas, or the drop is cancelled.
      const viewport = measured.viewport;
      const insideViewport =
        !viewport ||
        (pointer.x >= viewport.left &&
          pointer.x <= viewport.left + viewport.width &&
          pointer.y >= viewport.top &&
          pointer.y <= viewport.top + viewport.height);
      const target = !insideViewport ? null : resolveDropTarget({
        pointer,
        nodes: measured.geometry,
        rootId: measured.rootId,
        activeType: subject.type,
        activeId: subject.nodeId,
        canNest: canNestWithinParent,
      });
      return {
        pointer,
        target,
        indicator: target ? resolveDropIndicatorGeometry(target, measured.geometry) : null,
        containerRect: target ? measured.geometry.get(target.parentId)?.rect ?? null : null,
        clipRect: measured.viewport,
      };
    },
    [subject]
  );

  const seedPointer = useCallback((pointer: { x: number; y: number } | null) => {
    pointerRef.current = pointer;
  }, []);

  useEffect(() => {
    if (!subject) {
      setPreview(null);
      return;
    }
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (pointerRef.current) setPreview(compute(pointerRef.current));
      });
    };
    const handlePointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      schedule();
    };
    // Auto-scroll moves the blocks under a still pointer.
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('scroll', schedule, true);
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [compute, subject]);

  const resolveFinal = useCallback(
    () => (pointerRef.current ? compute(pointerRef.current) : null),
    [compute]
  );

  return { preview, resolveFinal, seedPointer };
};
