import { describe, expect, it } from 'vitest';

import type { DesignerNode } from '../state/designerStore';
import { resolveHandleResizePatch } from './handleResize';

const nodeWithStyle = (style: Record<string, unknown>, metadata?: Record<string, unknown>): DesignerNode =>
  ({
    id: 'n1',
    type: 'container',
    props: { name: 'n1', style, ...(metadata ? { metadata } : {}) },
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    baseSize: { width: 100, height: 100 },
    parentId: 'page',
    children: [],
    allowedChildren: [],
  }) as unknown as DesignerNode;

describe('resolveHandleResizePatch', () => {
  it('writes a fixed width and only the dragged dimension', () => {
    expect(resolveHandleResizePatch(nodeWithStyle({ width: '300px' }), { width: 180.4 })).toEqual([
      { path: 'style.width', value: '180px' },
      { path: 'size.width', value: 180 },
      { path: 'baseSize.width', value: 180 },
    ]);
  });

  it('edits the minimum of a content-sized block, since the minimum is what sizes it', () => {
    expect(resolveHandleResizePatch(nodeWithStyle({ minWidth: '420px' }), { width: 280 })).toEqual([
      { path: 'style.minWidth', value: '280px' },
    ]);
    expect(resolveHandleResizePatch(nodeWithStyle({ width: 'auto', minHeight: '40px' }), { height: 64 })).toEqual([
      { path: 'style.minHeight', value: '64px' },
    ]);
  });

  it('lowers a minimum (or raises a maximum) that would stop a fixed block reaching the dragged size', () => {
    expect(resolveHandleResizePatch(nodeWithStyle({ width: '500px', minWidth: '420px' }), { width: 300 })).toEqual([
      { path: 'style.width', value: '300px' },
      { path: 'style.minWidth', value: '300px' },
      { path: 'size.width', value: 300 },
      { path: 'baseSize.width', value: 300 },
    ]);
    expect(resolveHandleResizePatch(nodeWithStyle({ maxWidth: '200px' }), { width: 260 })).toEqual([
      { path: 'style.width', value: '260px' },
      { path: 'style.maxWidth', value: '260px' },
      { path: 'size.width', value: 260 },
      { path: 'baseSize.width', value: 260 },
    ]);
  });

  it('writes both dimensions for a corner drag', () => {
    const paths = resolveHandleResizePatch(nodeWithStyle({}), { width: 120, height: 48 }).map((patch) => patch.path);
    expect(paths).toEqual(['style.width', 'size.width', 'baseSize.width', 'style.height', 'size.height', 'baseSize.height']);
  });

  it("marks a dimension content-sized when the drag rests on the content size", () => {
    expect(resolveHandleResizePatch(nodeWithStyle({ width: '190px', height: '91px' }), { width: 'auto', height: 'auto' })).toEqual([
      { path: 'style.width', value: 'auto' },
      { path: 'style.height', value: 'auto' },
    ]);
    // A minimum that sizes the block is authored; it stays.
    const patches = resolveHandleResizePatch(nodeWithStyle({ minWidth: '280px' }), { width: 'auto' });
    expect(patches).toEqual([{ path: 'style.width', value: 'auto' }]);
    // Already content-sized: nothing to write (and no undo step).
    expect(resolveHandleResizePatch(nodeWithStyle({ width: 'auto' }), { width: 'auto' })).toEqual([]);
  });

  describe("'auto' after a px resize leaves no effective min size", () => {
    type Patch = ReturnType<typeof resolveHandleResizePatch>[number];
    const applyPatches = (node: DesignerNode, patches: Patch[]): DesignerNode => {
      const next = JSON.parse(JSON.stringify(node));
      for (const { path, value } of patches) {
        const [root, key] = path.split('.');
        const target = root === 'style' ? (next.props.style ??= {}) : next[root];
        if (value === null) delete target[key];
        else target[key] = value;
      }
      return next;
    };
    // What DesignCanvas keys the flow min-size fallback on: no authored width/height
    // (or an explicit 'auto'/content size) and no authored min.
    const style = (node: DesignerNode) => (node.props as any).style as Record<string, unknown>;

    const cases: Array<[string, Record<string, unknown> | undefined]> = [
      ['a session-created node', undefined],
      ['an AST-imported node', { __astImported: true, __astHadWidth: true, __astHadHeight: true }],
    ];

    it.each(cases)('%s', (_label, metadata) => {
      const fresh = nodeWithStyle({ width: '120px', height: '60px' }, metadata);
      const resized = applyPatches(fresh, resolveHandleResizePatch(fresh, { width: 172, height: 90 }));
      expect(style(resized)).toMatchObject({ width: '172px', height: '90px' });
      expect(resized.size).toEqual({ width: 172, height: 90 });

      const reset = applyPatches(resized, resolveHandleResizePatch(resized, { width: 'auto', height: 'auto' }));
      // An explicit content-size marker (so the canvas never falls back to node.size)...
      expect(style(reset).width).toBe('auto');
      expect(style(reset).height).toBe('auto');
      // ...and no min size of any kind.
      expect(style(reset).minWidth).toBeUndefined();
      expect(style(reset).minHeight).toBeUndefined();
      // Metadata is untouched: the marker lives in style alone.
      expect((reset.props as any).metadata).toEqual(metadata);
    });

    it('also holds when the block had no authored size yet (flow node with only legacy size)', () => {
      const fresh = nodeWithStyle({}, { __astImported: true, __astHadWidth: false, __astHadHeight: false });
      const reset = applyPatches(fresh, resolveHandleResizePatch(fresh, { width: 'auto', height: 'auto' }));
      expect(style(reset)).toMatchObject({ width: 'auto', height: 'auto' });
    });
  });
});
