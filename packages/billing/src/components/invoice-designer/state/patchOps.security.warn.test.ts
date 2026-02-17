import { describe, expect, it, vi } from 'vitest';

import type { DesignerNode } from './designerStore';
import { setNodeProp } from './patchOps';

describe('patchOps security (rejection feedback)', () => {
  it('emits a developer-visible console warning when a patch is rejected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

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

    expect(next).toBe(nodes);
    expect(warn).toHaveBeenCalled();

    const [message, meta] = warn.mock.calls[0] ?? [];
    expect(String(message)).toContain('rejected patch');
    expect(meta).toMatchObject({ nodeId: 'a', path: 'props.__proto__.polluted' });

    warn.mockRestore();
  });
});
