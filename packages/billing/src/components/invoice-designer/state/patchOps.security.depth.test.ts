import { describe, expect, it } from 'vitest';

import type { DesignerNode } from './designerStore';
import { setNodeProp } from './patchOps';

describe('patchOps security (reserved segments at any depth)', () => {
  it('rejects reserved segments nested inside deeper paths', () => {
    expect(({} as any).polluted).toBeUndefined();

    const node: DesignerNode = {
      id: 'a',
      type: 'text',
      name: 'Node A',
      props: { name: 'Node A', metadata: { safe: true } },
      position: { x: 0, y: 0 },
      size: { width: 100, height: 40 },
      baseSize: { width: 100, height: 40 },
      rotation: 0,
      canRotate: false,
      allowResize: true,
      metadata: {},
      parentId: null,
      children: [],
      childIds: [],
      allowedChildren: [],
    };

    const nodes = [node];
    const next = setNodeProp(nodes, 'a', 'props.metadata.__proto__.polluted', 'yes');

    expect(next).toBe(nodes);
    expect(({} as any).polluted).toBeUndefined();
  });
});

