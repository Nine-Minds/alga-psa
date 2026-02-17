import { describe, expect, it } from 'vitest';

import type { DesignerComponentType, DesignerNode } from './designerStore';
import { setNodeProp } from './patchOps';

const createNode = (overrides: Partial<DesignerNode> & { id: string; type: DesignerComponentType }): DesignerNode => ({
  id: overrides.id,
  type: overrides.type,
  props: overrides.props ?? { name: overrides.id },
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 100, height: 40 },
  baseSize: overrides.baseSize ?? overrides.size ?? { width: 100, height: 40 },
  rotation: overrides.rotation ?? 0,
  canRotate: overrides.canRotate ?? false,
  allowResize: overrides.allowResize ?? true,
  layoutPresetId: overrides.layoutPresetId,
  parentId: overrides.parentId ?? null,
  children: overrides.children ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
});

describe('patchOps.setNodeProp', () => {
  it('updates deep dot-paths immutably without mutating previous references', () => {
    const style = Object.freeze({ width: '10px', height: '20px' });
    const props = Object.freeze({ name: 'Node A', style });
    const nodeA = createNode({ id: 'a', type: 'text', props });
    const nodeB = createNode({ id: 'b', type: 'text', props: { name: 'Node B' } });

    const nodes = Object.freeze([nodeA, nodeB]) as unknown as DesignerNode[];

    const next = setNodeProp(nodes, 'a', 'props.style.width', '320px');

    expect(next).not.toBe(nodes);
    expect(next[0]).not.toBe(nodeA);
    expect(next[1]).toBe(nodeB);

    // Original references are not mutated.
    expect((nodeA.props as any).style.width).toBe('10px');

    // Updated value is present in the next state.
    expect((next[0].props as any).style.width).toBe('320px');
    expect((next[0].props as any).style.height).toBe('20px');

    // Structural sharing: only the path chain is replaced.
    expect(next[0].props).not.toBe(nodeA.props);
    expect((next[0].props as any).style).not.toBe((nodeA.props as any).style);
  });
});
