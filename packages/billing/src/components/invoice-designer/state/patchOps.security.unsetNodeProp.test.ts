import { describe, expect, it } from 'vitest';

import type { DesignerNode } from './designerStore';
import { unsetNodeProp } from './patchOps';

describe('patchOps security (unsetNodeProp)', () => {
  it('rejects prototype/constructor path segments and performs a safe no-op', () => {
    expect(({} as any).polluted).toBeUndefined();

    const node: DesignerNode = {
      id: 'a',
      type: 'text',
      props: { name: 'Node A' },
      position: { x: 0, y: 0 },
      size: { width: 100, height: 40 },
      baseSize: { width: 100, height: 40 },
      rotation: 0,
      canRotate: false,
      allowResize: true,
      parentId: null,
      children: [],
      allowedChildren: [],
    };

    const nodes = [node];
    const nextPrototype = unsetNodeProp(nodes, 'a', 'props.prototype.polluted');
    const nextConstructor = unsetNodeProp(nodes, 'a', 'props.constructor.polluted');

    expect(nextPrototype).toBe(nodes);
    expect(nextConstructor).toBe(nodes);
    expect(({} as any).polluted).toBeUndefined();
  });
});
