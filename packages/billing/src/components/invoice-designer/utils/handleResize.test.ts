import { describe, expect, it } from 'vitest';

import type { DesignerNode } from '../state/designerStore';
import { resolveHandleResizePatch } from './handleResize';

const nodeWithStyle = (style: Record<string, unknown>): DesignerNode =>
  ({
    id: 'n1',
    type: 'container',
    props: { name: 'n1', style },
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

  it('clears the authored size when the drag rests on the content size', () => {
    expect(resolveHandleResizePatch(nodeWithStyle({ width: '190px', height: '91px' }), { width: 'auto', height: 'auto' })).toEqual([
      { path: 'style.width', value: null },
      { path: 'style.height', value: null },
    ]);
    expect(resolveHandleResizePatch(nodeWithStyle({ minWidth: '280px' }), { width: 'auto' })).toEqual([]);
  });
});
