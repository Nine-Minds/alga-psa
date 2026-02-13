import { describe, expect, it } from 'vitest';

import type { DesignerComponentType, DesignerNode } from './designerStore';
import { moveNode } from './patchOps';

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

describe('patchOps.moveNode', () => {
  it('reorders within the same parent', () => {
    const parent = createNode({
      id: 'p',
      type: 'container',
      childIds: ['a', 'b', 'c'],
      children: ['a', 'b', 'c'],
    });
    const a = createNode({ id: 'a', type: 'text', parentId: 'p' });
    const b = createNode({ id: 'b', type: 'text', parentId: 'p' });
    const c = createNode({ id: 'c', type: 'text', parentId: 'p' });

    const nodes = [parent, a, b, c];
    const next = moveNode(nodes, 'b', 'p', 3);

    expect(next.find((n) => n.id === 'p')?.childIds).toEqual(['a', 'c', 'b']);
    expect(next.find((n) => n.id === 'b')?.parentId).toBe('p');
  });

  it('re-parents across parents at the requested index', () => {
    const p1 = createNode({ id: 'p1', type: 'container', childIds: ['a'], children: ['a'] });
    const p2 = createNode({ id: 'p2', type: 'container', childIds: ['x'], children: ['x'] });
    const a = createNode({ id: 'a', type: 'text', parentId: 'p1' });
    const x = createNode({ id: 'x', type: 'text', parentId: 'p2' });

    const nodes = [p1, p2, a, x];
    const next = moveNode(nodes, 'a', 'p2', 0);

    expect(next.find((n) => n.id === 'p1')?.childIds).toEqual([]);
    expect(next.find((n) => n.id === 'p2')?.childIds).toEqual(['a', 'x']);
    expect(next.find((n) => n.id === 'a')?.parentId).toBe('p2');
  });

  it('prevents cycles when moving into a descendant', () => {
    const parent = createNode({ id: 'p', type: 'container', childIds: ['c'], children: ['c'] });
    const child = createNode({ id: 'c', type: 'container', parentId: 'p', childIds: [], children: [] });

    const nodes = [parent, child];
    const next = moveNode(nodes, 'p', 'c', 0);

    expect(next).toBe(nodes);
  });
});

