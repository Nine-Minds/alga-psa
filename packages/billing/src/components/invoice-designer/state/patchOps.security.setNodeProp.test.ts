import { describe, expect, it } from 'vitest';

import type { DesignerNode } from './designerStore';
import { setNodeProp } from './patchOps';

describe('patchOps security (setNodeProp)', () => {
  it('rejects __proto__ path segments and cannot pollute Object.prototype', () => {
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
    const next = setNodeProp(nodes, 'a', 'props.__proto__.polluted', 'yes');

    // Safe no-op: no mutation and no prototype pollution.
    expect(next).toBe(nodes);
    expect(({} as any).polluted).toBeUndefined();
  });
});
