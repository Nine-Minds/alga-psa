import { describe, expect, it } from 'vitest';

import type { DesignerNode } from './designerStore';
import { __designerLayoutTestUtils } from './designerStore';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => {
  const { parentId, childIds, allowedChildren } = overrides;
  return {
    id: overrides.id ?? 'node-' + Math.random().toString(36).slice(2, 7),
    type: overrides.type ?? 'text',
    name: overrides.name ?? 'Node',
    position: overrides.position ?? { x: 0, y: 0 },
    size: overrides.size ?? { width: 100, height: 40 },
    baseSize: overrides.baseSize ?? overrides.size ?? { width: 100, height: 40 },
    canRotate: overrides.canRotate ?? true,
    allowResize: overrides.allowResize ?? true,
    rotation: overrides.rotation ?? 0,
    metadata: overrides.metadata ?? {},
    layoutPresetId: overrides.layoutPresetId,
    layout: overrides.layout,
    parentId: parentId ?? null,
    childIds: childIds ?? [],
    allowedChildren: allowedChildren ?? [],
  };
};

describe('designerStore computeLayout', () => {
  it('caps hug width to parent inner width', () => {
    const document = createNode({
      id: 'doc',
      type: 'document',
      size: { width: 816, height: 1056 },
      childIds: ['page'],
      allowedChildren: ['page'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 0,
        padding: 0,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });
    const page = createNode({
      id: 'page',
      type: 'page',
      parentId: document.id,
      size: { width: 816, height: 1056 },
      childIds: ['section'],
      allowedChildren: ['section'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 32,
        padding: 40,
        justify: 'start',
        align: 'stretch',
        sizing: 'hug',
      },
    });
    const section = createNode({
      id: 'section',
      type: 'section',
      parentId: page.id,
      size: { width: 320, height: 180 },
      childIds: ['left', 'right'],
      layout: {
        mode: 'flex',
        direction: 'row',
        gap: 16,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'hug',
      },
    });
    const left = createNode({
      id: 'left',
      type: 'text',
      parentId: section.id,
      size: { width: 900, height: 80 },
    });
    const right = createNode({
      id: 'right',
      type: 'text',
      parentId: section.id,
      size: { width: 900, height: 80 },
    });

    const laidOut = __designerLayoutTestUtils.computeLayout([document, page, section, left, right]);
    const laidOutSection = laidOut.find((node) => node.id === section.id);

    expect(laidOutSection).toBeTruthy();
    if (!laidOutSection) return;

    expect(laidOutSection.size.width).toBeLessThanOrEqual(736);
  });
});

