import { describe, expect, it } from 'vitest';

import type { DesignerComponentType, DesignerNode } from './designerStore';
import { deleteNode } from './patchOps';

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

describe('patchOps.deleteNode', () => {
  it('removes the subtree and removes the node id from its parent children list', () => {
    const parent = createNode({
      id: 'p',
      type: 'container',
      childIds: ['a', 'b'],
      children: ['a', 'b'],
    });
    const a = createNode({ id: 'a', type: 'container', parentId: 'p', childIds: ['a1'], children: ['a1'] });
    const a1 = createNode({ id: 'a1', type: 'text', parentId: 'a' });
    const b = createNode({ id: 'b', type: 'text', parentId: 'p' });

    const nodes = [parent, a, a1, b];
    const next = deleteNode(nodes, 'a');

    const nextIds = next.map((n) => n.id).sort();
    expect(nextIds).toEqual(['b', 'p']);
    expect(next.find((n) => n.id === 'p')?.children).toEqual(['b']);
  });
});
