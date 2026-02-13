import { describe, expect, it } from 'vitest';

import type { DesignerComponentType, DesignerNode } from './designerStore';
import { unsetNodeProp } from './patchOps';

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
  children: overrides.children ?? [],
  childIds: overrides.childIds ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
  layout: overrides.layout,
  style: overrides.style,
});

describe('patchOps.unsetNodeProp', () => {
  it('removes deep dot-paths and cleans up empty objects', () => {
    const style = Object.freeze({ width: '10px' });
    const props = Object.freeze({ name: 'Node A', style });
    const nodeA = createNode({ id: 'a', type: 'text', props });
    const nodes = [nodeA];

    const next = unsetNodeProp(nodes, 'a', 'props.style.width');

    expect(next).not.toBe(nodes);
    expect(next[0]).not.toBe(nodeA);

    // style should be removed once empty, but props.name should remain.
    expect((next[0].props as any).name).toBe('Node A');
    expect('style' in (next[0].props as any)).toBe(false);

    // Original object graph not mutated.
    expect((nodeA.props as any).style.width).toBe('10px');
  });

  it('returns the same nodes reference when the path does not exist', () => {
    const nodeA = createNode({ id: 'a', type: 'text', props: { name: 'Node A' } });
    const nodes = [nodeA];

    const next = unsetNodeProp(nodes, 'a', 'props.style.width');

    expect(next).toBe(nodes);
  });

  it('splices leaf array index unsets (no undefined holes)', () => {
    const nodeA = createNode({
      id: 'a',
      type: 'text',
      props: {
        name: 'Node A',
        metadata: {
          items: ['a', 'b', 'c'],
        },
      } as any,
    });
    const nodes = [nodeA];

    const next = unsetNodeProp(nodes, 'a', 'props.metadata.items.1');

    expect((next[0].props as any).metadata.items).toEqual(['a', 'c']);
    expect((next[0].props as any).metadata.items.length).toBe(2);
    expect((next[0].props as any).metadata.items.includes(undefined)).toBe(false);
  });

  it('unsets nested properties inside array elements without splicing the element itself', () => {
    const nodeA = createNode({
      id: 'a',
      type: 'text',
      props: {
        name: 'Node A',
        metadata: {
          rows: [{ a: 1, b: 2 }, { a: 3 }],
        },
      } as any,
    });
    const nodes = [nodeA];

    const next = unsetNodeProp(nodes, 'a', 'props.metadata.rows.0.a');

    expect((next[0].props as any).metadata.rows).toEqual([{ b: 2 }, { a: 3 }]);
    expect((next[0].props as any).metadata.rows.length).toBe(2);
  });
});
