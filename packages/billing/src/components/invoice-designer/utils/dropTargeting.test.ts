import { describe, expect, it } from 'vitest';

import type { DesignerComponentType } from '../state/designerStore';
import {
  resolveDropIndicatorGeometry,
  resolveDropTarget,
  resolveOutlineDropTarget,
  type DropGeometryNode,
  type OutlineRowGeometry,
  type DropRect,
} from './dropTargeting';

const CONTAINER_TYPES: DesignerComponentType[] = ['section', 'container', 'text', 'field', 'totals'];

type Spec = {
  id: string;
  type?: DesignerComponentType;
  axis?: DropGeometryNode['axis'];
  rect: DropRect;
  children?: Spec[];
};

const build = (root: Spec): Map<string, DropGeometryNode> => {
  const nodes = new Map<string, DropGeometryNode>();
  const visit = (spec: Spec, parentId: string | null) => {
    const type = spec.type ?? (spec.children ? 'container' : 'text');
    nodes.set(spec.id, {
      id: spec.id,
      type,
      parentId,
      children: (spec.children ?? []).map((child) => child.id),
      allowedChildren: type === 'container' || type === 'page' ? CONTAINER_TYPES : [],
      axis: spec.axis ?? 'y',
      rect: spec.rect,
    });
    spec.children?.forEach((child) => visit(child, spec.id));
  };
  visit(root, null);
  return nodes;
};

const r = (left: number, top: number, width: number, height: number): DropRect => ({ left, top, width, height });

// page (column) > [header (row) > [brand (column) > [logo, name], meta], cards (row) > [from, billTo], table]
const nodes = build({
  id: 'page',
  type: 'page',
  rect: r(0, 0, 800, 1000),
  children: [
    {
      id: 'header',
      axis: 'x',
      rect: r(20, 20, 760, 120),
      children: [
        { id: 'brand', rect: r(20, 20, 200, 120), children: [{ id: 'logo', type: 'field', rect: r(20, 20, 200, 60) }, { id: 'name', rect: r(20, 90, 200, 40) }] },
        { id: 'meta', rect: r(500, 20, 280, 120), children: [] },
      ],
    },
    {
      id: 'cards',
      axis: 'x',
      rect: r(20, 200, 760, 140),
      children: [
        { id: 'from', rect: r(20, 200, 250, 140), children: [{ id: 'fromLabel', rect: r(32, 212, 220, 20) }, { id: 'fromName', rect: r(32, 240, 220, 20) }] },
        { id: 'billTo', rect: r(300, 200, 250, 140), children: [{ id: 'billToLabel', rect: r(312, 212, 220, 20) }] },
      ],
    },
    { id: 'table', rect: r(20, 400, 760, 200) },
  ],
});

const canNest = (child: DesignerComponentType, parent: DesignerComponentType) =>
  (parent === 'page' || parent === 'container') && child !== 'page';

const resolve = (x: number, y: number, activeId: string | null, activeType: DesignerComponentType = 'container') =>
  resolveDropTarget({ pointer: { x, y }, nodes, rootId: 'page', activeId, activeType, canNest });

describe('resolveDropTarget', () => {
  it('drops beside a container when the pointer is in its leading edge band', () => {
    // Pointer just inside the left edge of `from`, dragging billTo: reorder, not nest.
    expect(resolve(24, 300, 'billTo')).toMatchObject({ parentId: 'cards', index: 0, placement: 'before', anchorId: 'from' });
  });

  it('drops inside a container away from its edges, between the nearest children', () => {
    expect(resolve(140, 236, 'billToLabel', 'text')).toMatchObject({ parentId: 'from', index: 1, placement: 'inside' });
  });

  it('drops in a page gap at that gap, not at the end of the page', () => {
    // Between cards (ends 340) and table (starts 400), dragging header.
    expect(resolve(400, 370, 'header')).toMatchObject({ parentId: 'page', index: 2, placement: 'inside' });
  });

  it('names the sibling an inside drop lands next to, skipping the dragged block', () => {
    expect(resolve(400, 370, 'header')?.neighbor).toEqual({ id: 'cards', side: 'after' });
    // Gap right after the dragged block itself: name the block on the other side.
    expect(resolve(400, 370, 'cards')?.neighbor).toEqual({ id: 'table', side: 'before' });
    expect(resolve(640, 80, 'name', 'text')?.neighbor).toBeNull();
  });

  it('drops before or after a plain block by the half of it the pointer is in', () => {
    expect(resolve(100, 34, 'fromName', 'text')).toMatchObject({ parentId: 'brand', index: 0, placement: 'before', anchorId: 'logo' });
    expect(resolve(100, 125, 'fromName', 'text')).toMatchObject({ parentId: 'brand', index: 2, placement: 'after', anchorId: 'name' });
  });

  it('uses the horizontal halves for blocks in a row container', () => {
    // Over `meta` (an empty container) near its trailing edge in the header row.
    expect(resolve(776, 80, 'brand')).toMatchObject({ parentId: 'header', index: 2, placement: 'after', anchorId: 'meta' });
  });

  it('never targets the dragged block or its descendants', () => {
    // Pointer over from's own child while dragging from: resolves against what is underneath.
    const target = resolve(140, 222, 'from');
    expect(target?.parentId).not.toBe('from');
    expect(target).toMatchObject({ parentId: 'cards' });
  });

  it('marks drops that leave the block where it is', () => {
    expect(resolve(266, 300, 'billTo')?.isNoop).toBe(true);
    expect(resolve(24, 300, 'billTo')?.isNoop).toBe(false);
  });

  it('returns null outside the page', () => {
    expect(resolve(900, 300, 'billTo')).toBeNull();
  });

  it('moves up to the nearest container that accepts the dragged type', () => {
    // Pages accept pages in no case; a page-type drag over a leaf finds nothing.
    expect(resolve(100, 34, null, 'page')).toBeNull();
  });
});

describe('resolveDropIndicatorGeometry', () => {
  it('draws a vertical line between siblings of a row container', () => {
    const target = resolve(24, 300, 'billTo')!;
    expect(resolveDropIndicatorGeometry(target, nodes)).toEqual({ kind: 'line', orientation: 'vertical', x: 18, y: 200, length: 140 });
  });

  it('draws a horizontal line midway in the gap of a column container', () => {
    const target = resolve(400, 370, 'header')!;
    expect(resolveDropIndicatorGeometry(target, nodes)).toEqual({ kind: 'line', orientation: 'horizontal', x: 20, y: 370, length: 760 });
  });

  it('outlines an empty container', () => {
    const target = resolve(640, 80, 'name', 'text')!;
    expect(target).toMatchObject({ parentId: 'meta', placement: 'inside' });
    expect(resolveDropIndicatorGeometry(target, nodes)).toEqual({ kind: 'box', rect: r(500, 20, 280, 120) });
  });
});

describe('resolveOutlineDropTarget', () => {
  // Rows 20px tall in tree order; every container expanded.
  const order: Array<[string, number]> = [
    ['page', 0], ['header', 1], ['brand', 2], ['logo', 3], ['name', 3], ['meta', 2],
    ['cards', 1], ['from', 2], ['fromLabel', 3], ['fromName', 3], ['billTo', 2], ['billToLabel', 3], ['table', 1],
  ];
  const rows: OutlineRowGeometry[] = order.map(([id, depth], index) => ({
    id,
    depth,
    expanded: true,
    rect: r(0, index * 20, 260, 20),
  }));
  const rowY = (id: string, fraction: number) => order.findIndex(([rowId]) => rowId === id) * 20 + 20 * fraction;
  const outline = (id: string, fraction: number, activeId: string, activeType: DesignerComponentType = 'container') =>
    resolveOutlineDropTarget({ pointer: { x: 100, y: rowY(id, fraction) }, rows, nodes, activeId, activeType, canNest });

  it('drops before a row from its top half and after it from its bottom half', () => {
    expect(outline('fromName', 0.2, 'billToLabel', 'text')?.target).toMatchObject({ parentId: 'from', index: 1, placement: 'before' });
    expect(outline('fromName', 0.8, 'billToLabel', 'text')?.target).toMatchObject({ parentId: 'from', index: 2, placement: 'after' });
  });

  it('drops into a container row from its middle, at the end, outlining the row', () => {
    const resolved = outline('from', 0.5, 'table');
    expect(resolved?.target).toMatchObject({ parentId: 'from', index: 2, placement: 'inside' });
    expect(resolved?.indicator).toEqual({ kind: 'box', rect: r(0, rowY('from', 0), 260, 20) });
    expect(resolved?.containerRowId).toBe('from');
  });

  it('drops as the first child from the bottom of an expanded container row, indented a level', () => {
    const resolved = outline('cards', 0.9, 'table');
    expect(resolved?.target).toMatchObject({ parentId: 'cards', index: 0, placement: 'inside' });
    expect(resolved?.indicator).toMatchObject({ kind: 'line', y: rowY('cards', 1), x: 8 + 2 * 12 });
  });

  it('ignores rows of the dragged block and its children', () => {
    expect(outline('fromLabel', 0.5, 'from')).toBeNull();
    expect(outline('from', 0.5, 'from')).toBeNull();
  });
});
