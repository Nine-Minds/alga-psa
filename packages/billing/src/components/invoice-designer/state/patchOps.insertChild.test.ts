import { describe, expect, it } from 'vitest';

import type { DesignerComponentType, DesignerNode } from './designerStore';
import { insertChild } from './patchOps';

const createNode = (overrides: Partial<DesignerNode> & { id: string; type: DesignerComponentType }): DesignerNode => ({
  id: overrides.id,
  type: overrides.type,
  name: overrides.name ?? overrides.id,
  props: overrides.props ?? { name: overrides.name ?? overrides.id },
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 100, height: 40 },
  baseSize: overrides.baseSize ?? overrides.size ?? { width: 100, height: 40 },
  rotation: overrides.rotation ?? 0,
  canRotate: overrides.canRotate ?? false,
  allowResize: overrides.allowResize ?? true,
  metadata: overrides.metadata,
  layoutPresetId: overrides.layoutPresetId,
  parentId: overrides.parentId ?? null,
  children: overrides.children ?? overrides.childIds ?? [],
  childIds: overrides.childIds ?? overrides.children ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
  layout: overrides.layout,
  style: overrides.style,
});

describe('patchOps.insertChild', () => {
  it('inserts at index and preserves existing order deterministically', () => {
    const parent = createNode({
      id: 'p',
      type: 'container',
      childIds: ['a', 'b'],
      children: ['a', 'b'],
      allowedChildren: ['text'],
    });
    const childA = createNode({ id: 'a', type: 'text', parentId: 'p' });
    const childB = createNode({ id: 'b', type: 'text', parentId: 'p' });
    const childC = createNode({ id: 'c', type: 'text', parentId: null });

    const nodes = [parent, childA, childB, childC];
    const next = insertChild(nodes, 'p', 'c', 1);

    const nextParent = next.find((n) => n.id === 'p');
    const nextChild = next.find((n) => n.id === 'c');

    expect(nextParent?.children).toEqual(['a', 'c', 'b']);
    // Legacy `childIds` is not canonical and must not be written during mutations.
    expect(nextParent?.childIds).toEqual(['a', 'b']);
    expect(nextChild?.parentId).toBe('p');
  });

  it('clamps out-of-range indexes', () => {
    const parent = createNode({
      id: 'p',
      type: 'container',
      childIds: ['a', 'b'],
      children: ['a', 'b'],
      allowedChildren: ['text'],
    });
    const childA = createNode({ id: 'a', type: 'text', parentId: 'p' });
    const childB = createNode({ id: 'b', type: 'text', parentId: 'p' });
    const childC = createNode({ id: 'c', type: 'text', parentId: null });

    const nodes = [parent, childA, childB, childC];
    const next = insertChild(nodes, 'p', 'c', 999);

    expect(next.find((n) => n.id === 'p')?.children).toEqual(['a', 'b', 'c']);
    // Legacy `childIds` should remain untouched (no dual-source-of-truth writes).
    expect(next.find((n) => n.id === 'p')?.childIds).toEqual(['a', 'b']);
  });

  it('uses canonical `children` as the source of truth (does not rely on `childIds`)', () => {
    const parent = createNode({
      id: 'p',
      type: 'container',
      // Deliberately inconsistent legacy vs canonical fields.
      children: ['a', 'b'],
      childIds: [],
      allowedChildren: ['text'],
    });
    const childA = createNode({ id: 'a', type: 'text', parentId: 'p' });
    const childB = createNode({ id: 'b', type: 'text', parentId: 'p' });

    const nodes = [parent, childA, childB];
    const next = insertChild(nodes, 'p', 'b', 0);

    // `b` already exists in canonical `children`, so this should be a safe no-op even though legacy `childIds` is empty.
    expect(next).toBe(nodes);
  });
});
