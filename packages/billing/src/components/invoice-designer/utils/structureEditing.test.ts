import { describe, expect, it } from 'vitest';
import { getAllowedChildrenForType } from '../schema/componentSchema';
import type { DesignerComponentType, DesignerNode } from '../state/designerStore';
import {
  copySubtree,
  resolveInsertionTarget,
  resolveMoveIntoTarget,
  resolveMoveOutTarget,
  resolveReorderTarget,
} from './structureEditing';

const node = (id: string, type: DesignerComponentType, parentId: string | null, children: string[] = []): DesignerNode => ({
  id,
  type,
  props: { name: id },
  position: { x: 0, y: 0 },
  size: { width: 100, height: 40 },
  parentId,
  children,
  allowedChildren: getAllowedChildrenForType(type),
});

// doc > page > [section(title, box(name, address)), divider]
const fixture = (): DesignerNode[] => [
  node('doc', 'document', null, ['page']),
  node('page', 'page', 'doc', ['section', 'divider']),
  node('section', 'section', 'page', ['title', 'box']),
  node('title', 'text', 'section'),
  node('box', 'container', 'section', ['name', 'address']),
  node('name', 'text', 'box'),
  node('address', 'text', 'box'),
  node('divider', 'divider', 'page'),
];

describe('resolveInsertionTarget', () => {
  it('appends to the page when nothing or the page is selected', () => {
    expect(resolveInsertionTarget(fixture(), null, 'divider')).toEqual({ parentId: 'page', index: 2 });
    expect(resolveInsertionTarget(fixture(), 'page', 'container')).toEqual({ parentId: 'page', index: 2 });
  });

  it('puts new blocks inside a selected container that accepts them', () => {
    expect(resolveInsertionTarget(fixture(), 'box', 'text')).toEqual({ parentId: 'box', index: 2 });
  });

  it('puts new blocks right after a selected leaf', () => {
    expect(resolveInsertionTarget(fixture(), 'name', 'field')).toEqual({ parentId: 'box', index: 1 });
  });

  it('puts new blocks after a selected container when placement is "after"', () => {
    expect(resolveInsertionTarget(fixture(), 'box', 'text', 'after')).toEqual({ parentId: 'section', index: 2 });
    expect(resolveInsertionTarget(fixture(), 'section', 'divider', 'after')).toEqual({ parentId: 'page', index: 1 });
  });

  it('climbs to the nearest ancestor that accepts the block when the parent does not', () => {
    // Sections only live on the page, so a section next to a deeply selected text lands after its top-level ancestor.
    expect(resolveInsertionTarget(fixture(), 'name', 'section')).toEqual({ parentId: 'page', index: 1 });
  });
});

describe('reorder and reparent targets', () => {
  it('moves earlier and later within the parent, in moveNode pre-removal coordinates', () => {
    expect(resolveReorderTarget(fixture(), 'address', -1)).toEqual({ parentId: 'box', index: 0 });
    expect(resolveReorderTarget(fixture(), 'name', 1)).toEqual({ parentId: 'box', index: 2 });
    expect(resolveReorderTarget(fixture(), 'name', -1)).toBeNull();
    expect(resolveReorderTarget(fixture(), 'address', 1)).toBeNull();
  });

  it('moves out of the parent to right after it', () => {
    expect(resolveMoveOutTarget(fixture(), 'name')).toEqual({ parentId: 'section', index: 2 });
    // Leaving the page is not a move.
    expect(resolveMoveOutTarget(fixture(), 'divider')).toBeNull();
  });

  it('moves into the nearest earlier sibling container that accepts it', () => {
    expect(resolveMoveIntoTarget(fixture(), 'divider')).toEqual({ parentId: 'section', index: 2 });
    expect(resolveMoveIntoTarget(fixture(), 'title')).toBeNull();
  });
});

describe('copySubtree', () => {
  it('captures the node and its descendants in order, but never the page or document', () => {
    const payload = copySubtree(fixture(), 'box');
    expect(payload?.rootId).toBe('box');
    expect(payload?.nodes.map((entry) => entry.id)).toEqual(['box', 'name', 'address']);
    expect(copySubtree(fixture(), 'page')).toBeNull();
  });
});
