import type { DesignerComponentType, DesignerContainerLayout } from '../state/designerStore';

/**
 * Where a dragged block lands, resolved from the pointer and the blocks' on-screen boxes.
 *
 * The rule a user can predict: the block under the pointer decides. Over a plain block,
 * the drop goes before or after it (the half of the block the pointer is in, along its
 * container's direction). Over a container, a thin band at its leading and trailing edge
 * drops beside it; anywhere else drops inside it, between the children nearest the pointer.
 */

export type DropRect = { left: number; top: number; width: number; height: number };

export type DropAxis = 'x' | 'y' | 'grid';

export type DropGeometryNode = {
  id: string;
  type: DesignerComponentType;
  parentId: string | null;
  children: string[];
  /** Child types this block accepts; empty for blocks that are not containers. */
  allowedChildren: DesignerComponentType[];
  /** Direction its children flow in. */
  axis: DropAxis;
  /** Viewport box; missing for blocks that are not rendered. */
  rect?: DropRect;
};

export type DropTarget = {
  parentId: string;
  /** Index in the parent's current children (the dragged block still counted), as `moveNode` expects. */
  index: number;
  /** The sibling the drop goes before/after, when it was chosen beside a block. */
  anchorId: string | null;
  placement: 'before' | 'after' | 'inside';
  /**
   * For drops inside a container that has other children: the sibling the block lands
   * next to, so the destination can be named ("After party-blocks").
   */
  neighbor: { id: string; side: 'before' | 'after' } | null;
  /** True when the drop would leave the block where it already is. */
  isNoop: boolean;
};

export type DropIndicatorGeometry =
  | { kind: 'line'; orientation: 'horizontal' | 'vertical'; x: number; y: number; length: number }
  | { kind: 'box'; rect: DropRect };

export type ResolveDropTargetInput = {
  pointer: { x: number; y: number };
  nodes: ReadonlyMap<string, DropGeometryNode>;
  /** The page (or other root) the canvas renders; drops never go above it. */
  rootId: string;
  /** Type of the block being dragged (an existing block or a palette item). */
  activeType: DesignerComponentType;
  /** The block being moved; it and its descendants are never targets. Null for palette drags. */
  activeId: string | null;
  canNest: (childType: DesignerComponentType, parentType: DesignerComponentType) => boolean;
};

/** Edge band (viewport px) of a container that drops beside it rather than inside it. */
export const resolveContainerEdgeBand = (extent: number): number => Math.min(12, Math.max(4, extent * 0.2));

const contains = (rect: DropRect, point: { x: number; y: number }) =>
  point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;

const centerOf = (rect: DropRect, axis: 'x' | 'y') =>
  axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;

const collectSubtree = (nodes: ReadonlyMap<string, DropGeometryNode>, id: string | null): Set<string> => {
  const result = new Set<string>();
  if (!id) return result;
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    if (result.has(current)) continue;
    result.add(current);
    nodes.get(current)?.children.forEach((child) => stack.push(child));
  }
  return result;
};

/** Deepest rendered block under the pointer, skipping the dragged subtree. */
const findHovered = (
  nodes: ReadonlyMap<string, DropGeometryNode>,
  rootId: string,
  pointer: { x: number; y: number },
  excluded: Set<string>
): DropGeometryNode | null => {
  const root = nodes.get(rootId);
  if (!root?.rect || !contains(root.rect, pointer)) return null;
  let current = root;
  for (;;) {
    // Later siblings paint on top, so search from the end.
    const next = [...current.children]
      .reverse()
      .map((id) => nodes.get(id))
      .find((child): child is DropGeometryNode => Boolean(child?.rect && !excluded.has(child.id) && contains(child.rect, pointer)));
    if (!next) return current;
    current = next;
  }
};

/** Index of the gap nearest the pointer among a container's rendered children. */
export const resolveInsideIndex = (
  container: DropGeometryNode,
  nodes: ReadonlyMap<string, DropGeometryNode>,
  pointer: { x: number; y: number }
): number => {
  const children = container.children.map((id) => nodes.get(id));
  if (container.axis === 'grid') {
    // Reading order: a child comes before the pointer when its row is above, or it is
    // on the pointer's row and to its left.
    return children.filter((child) => {
      const rect = child?.rect;
      if (!rect) return false;
      if (rect.top + rect.height <= pointer.y) return true;
      return rect.top <= pointer.y && centerOf(rect, 'x') < pointer.x;
    }).length;
  }
  const axis = container.axis;
  const position = axis === 'x' ? pointer.x : pointer.y;
  let index = 0;
  children.forEach((child, childIndex) => {
    if (child?.rect && centerOf(child.rect, axis) < position) {
      index = childIndex + 1;
    }
  });
  return index;
};

const beside = (
  anchor: DropGeometryNode,
  parent: DropGeometryNode,
  pointer: { x: number; y: number },
  forced?: 'before' | 'after'
): Omit<DropTarget, 'isNoop'> => {
  const axis = parent.axis === 'y' ? 'y' : 'x';
  const rect = anchor.rect!;
  const placement = forced ?? ((axis === 'x' ? pointer.x : pointer.y) < centerOf(rect, axis) ? 'before' : 'after');
  const anchorIndex = parent.children.indexOf(anchor.id);
  return {
    parentId: parent.id,
    index: placement === 'before' ? anchorIndex : anchorIndex + 1,
    anchorId: anchor.id,
    placement,
    neighbor: null,
  };
};

const resolveNeighbor = (
  container: DropGeometryNode,
  index: number,
  activeId: string | null
): DropTarget['neighbor'] => {
  const previous = container.children[index - 1];
  const next = container.children[index];
  if (previous && previous !== activeId) return { id: previous, side: 'after' };
  if (next && next !== activeId) return { id: next, side: 'before' };
  return null;
};

const inside = (
  container: DropGeometryNode,
  nodes: ReadonlyMap<string, DropGeometryNode>,
  pointer: { x: number; y: number },
  activeId: string | null
): Omit<DropTarget, 'isNoop'> => {
  const index = resolveInsideIndex(container, nodes, pointer);
  return { parentId: container.id, index, anchorId: null, placement: 'inside', neighbor: resolveNeighbor(container, index, activeId) };
};

const withNoop = (
  target: Omit<DropTarget, 'isNoop'>,
  nodes: ReadonlyMap<string, DropGeometryNode>,
  activeId: string | null
): DropTarget => {
  const active = activeId ? nodes.get(activeId) : undefined;
  const parent = nodes.get(target.parentId);
  const currentIndex = active && active.parentId === target.parentId && parent ? parent.children.indexOf(active.id) : -1;
  return {
    ...target,
    isNoop: currentIndex >= 0 && (target.index === currentIndex || target.index === currentIndex + 1),
  };
};

export const resolveDropTarget = ({
  pointer,
  nodes,
  rootId,
  activeType,
  activeId,
  canNest,
}: ResolveDropTargetInput): DropTarget | null => {
  const excluded = collectSubtree(nodes, activeId);
  const hovered = findHovered(nodes, rootId, pointer, excluded);
  if (!hovered) return null;

  const accepts = (node: DropGeometryNode) => node.allowedChildren.length > 0 && canNest(activeType, node.type);

  let candidate: DropGeometryNode = hovered;
  for (;;) {
    if (candidate.id === rootId) {
      return accepts(candidate) ? withNoop(inside(candidate, nodes, pointer, activeId), nodes, activeId) : null;
    }
    const parent = candidate.parentId ? nodes.get(candidate.parentId) : undefined;
    if (!parent) return null;
    const parentAccepts = accepts(parent);

    if (accepts(candidate)) {
      const rect = candidate.rect!;
      const axis = parent.axis === 'y' ? 'y' : 'x';
      const start = axis === 'x' ? rect.left : rect.top;
      const extent = axis === 'x' ? rect.width : rect.height;
      const position = axis === 'x' ? pointer.x : pointer.y;
      const band = resolveContainerEdgeBand(extent);
      if (parentAccepts && position - start <= band) {
        return withNoop(beside(candidate, parent, pointer, 'before'), nodes, activeId);
      }
      if (parentAccepts && start + extent - position <= band) {
        return withNoop(beside(candidate, parent, pointer, 'after'), nodes, activeId);
      }
      return withNoop(inside(candidate, nodes, pointer, activeId), nodes, activeId);
    }

    if (parentAccepts) {
      return withNoop(beside(candidate, parent, pointer), nodes, activeId);
    }
    // The block's own container cannot hold the dragged type: try beside the container.
    candidate = parent;
  }
};

/** The line (between siblings) or box (an empty container) that shows where a drop lands. */
export const resolveDropIndicatorGeometry = (
  target: DropTarget,
  nodes: ReadonlyMap<string, DropGeometryNode>
): DropIndicatorGeometry | null => {
  const parent = nodes.get(target.parentId);
  if (!parent?.rect) return null;
  const children = parent.children
    .map((id) => nodes.get(id))
    .filter((child): child is DropGeometryNode => Boolean(child?.rect));
  if (children.length === 0) {
    return { kind: 'box', rect: parent.rect };
  }
  const axis = parent.axis === 'y' ? 'y' : 'x';
  const ordered = parent.children.map((id) => nodes.get(id)?.rect);
  const before = target.index > 0 ? ordered[target.index - 1] : undefined;
  const after = target.index < ordered.length ? ordered[target.index] : undefined;

  const reference = after ?? before;
  if (!reference) {
    return { kind: 'box', rect: parent.rect };
  }

  if (axis === 'y') {
    const y = before && after
      ? (before.top + before.height + after.top) / 2
      : after
        ? after.top - 2
        : reference.top + reference.height + 2;
    return { kind: 'line', orientation: 'horizontal', x: reference.left, y, length: reference.width };
  }

  const x = before && after
    ? (before.left + before.width + after.left) / 2
    : after
      ? after.left - 2
      : reference.left + reference.width + 2;
  return { kind: 'line', orientation: 'vertical', x, y: reference.top, length: reference.height };
};

export const resolveLayoutAxis = (layout: DesignerContainerLayout | undefined): DropAxis => {
  if (layout?.display === 'grid') return 'grid';
  if (layout?.display === 'flex' && layout.flexDirection === 'row') return 'x';
  return 'y';
};

export type OutlineRowGeometry = {
  id: string;
  rect: DropRect;
  /** Nesting depth of the row (the page is 0). */
  depth: number;
  /** The row's children are listed under it. */
  expanded: boolean;
};

export type OutlineDropResolution = {
  target: DropTarget;
  indicator: DropIndicatorGeometry;
  /** Row of the container the block goes into (outlined while dragging). */
  containerRowId: string;
};

/** Indent of one Outline level, and of the page row, in px (matches OutlineView). */
export const OUTLINE_INDENT_PX = 12;
export const OUTLINE_BASE_PADDING_PX = 8;

/**
 * Where a block dropped on an Outline row lands: the top half of a row drops before
 * it, the bottom half after it, and the middle of a container row inside it (at the
 * end). The bottom of an expanded container drops as its first child, which is where
 * the line between it and its first child row reads.
 */
export const resolveOutlineDropTarget = ({
  pointer,
  rows,
  nodes,
  activeType,
  activeId,
  canNest,
}: {
  pointer: { x: number; y: number };
  rows: OutlineRowGeometry[];
  nodes: ReadonlyMap<string, DropGeometryNode>;
  activeType: DesignerComponentType;
  activeId: string | null;
  canNest: (childType: DesignerComponentType, parentType: DesignerComponentType) => boolean;
}): OutlineDropResolution | null => {
  const row = rows.find((candidate) => contains(candidate.rect, pointer));
  if (!row) return null;
  const excluded = collectSubtree(nodes, activeId);
  if (excluded.has(row.id)) return null;
  const node = nodes.get(row.id);
  if (!node) return null;
  const parent = node.parentId ? nodes.get(node.parentId) : undefined;
  const accepts = (candidate: DropGeometryNode | undefined) =>
    Boolean(candidate && candidate.allowedChildren.length > 0 && canNest(activeType, candidate.type));

  const lineX = (depth: number) => row.rect.left + OUTLINE_BASE_PADDING_PX + depth * OUTLINE_INDENT_PX;
  const line = (y: number, depth: number): DropIndicatorGeometry => ({
    kind: 'line',
    orientation: 'horizontal',
    x: lineX(depth),
    y,
    length: Math.max(24, row.rect.left + row.rect.width - lineX(depth)),
  });
  const relative = (pointer.y - row.rect.top) / Math.max(1, row.rect.height);
  const hasVisibleChildren = row.expanded && node.children.length > 0;

  const intoNode = (index: number, indicator: DropIndicatorGeometry): OutlineDropResolution => ({
    target: withNoop(
      { parentId: node.id, index, anchorId: null, placement: 'inside', neighbor: resolveNeighbor(node, index, activeId) },
      nodes,
      activeId
    ),
    indicator,
    containerRowId: node.id,
  });
  const besideNode = (placement: 'before' | 'after'): OutlineDropResolution | null => {
    if (!parent || !accepts(parent)) return null;
    const anchorIndex = parent.children.indexOf(node.id);
    return {
      target: withNoop(
        {
          parentId: parent.id,
          index: placement === 'before' ? anchorIndex : anchorIndex + 1,
          anchorId: node.id,
          placement,
          neighbor: null,
        },
        nodes,
        activeId
      ),
      indicator: line(placement === 'before' ? row.rect.top : row.rect.top + row.rect.height, row.depth),
      containerRowId: parent.id,
    };
  };

  if (!parent) {
    // The page row: drop at the top of the page.
    return accepts(node) ? intoNode(0, line(row.rect.top + row.rect.height, row.depth + 1)) : null;
  }
  if (accepts(node)) {
    if (relative > 0.25 && relative < 0.75) {
      return intoNode(node.children.length, { kind: 'box', rect: row.rect });
    }
    if (relative >= 0.75 && hasVisibleChildren) {
      return intoNode(0, line(row.rect.top + row.rect.height, row.depth + 1));
    }
  }
  return besideNode(relative < 0.5 ? 'before' : 'after') ?? (accepts(node) ? intoNode(node.children.length, { kind: 'box', rect: row.rect }) : null);
};
