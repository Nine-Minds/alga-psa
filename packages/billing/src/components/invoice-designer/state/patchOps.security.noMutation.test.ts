import { describe, expect, it } from 'vitest';

import type { DesignerNode } from './designerStore';
import { setNodeProp, unsetNodeProp } from './patchOps';

const createNode = (): DesignerNode => ({
  id: 'a',
  type: 'text',
  props: { name: 'Node A', metadata: { label: 'X' } },
  position: { x: 0, y: 0 },
  size: { width: 100, height: 40 },
  baseSize: { width: 100, height: 40 },
  rotation: 0,
  canRotate: false,
  allowResize: true,
  parentId: null,
  children: [],
  allowedChildren: [],
});

describe('patchOps security (no mutation on rejection)', () => {
  it('returns the original nodes and node references for rejected set', () => {
    const node = createNode();
    const nodes = [node];
    const next = setNodeProp(nodes, 'a', 'props.__proto__.polluted', 'yes');
    expect(next).toBe(nodes);
    expect(next[0]).toBe(node);
  });

  it('returns the original nodes and node references for rejected unset', () => {
    const node = createNode();
    const nodes = [node];
    const next = unsetNodeProp(nodes, 'a', 'props.constructor.polluted');
    expect(next).toBe(nodes);
    expect(next[0]).toBe(node);
  });
});
