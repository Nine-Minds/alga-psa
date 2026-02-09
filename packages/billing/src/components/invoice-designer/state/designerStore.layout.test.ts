import { describe, expect, it } from 'vitest';

import type { DesignerNode } from './designerStore';
import { __designerLayoutTestUtils, __designerResolveLayoutTestUtils } from './designerStore';

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

  it('clamps field height to at least 40 during local flex reflow', () => {
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
      childIds: ['row-section'],
      allowedChildren: ['section'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 24,
        padding: 40,
        justify: 'start',
        align: 'stretch',
        sizing: 'hug',
      },
    });
    const rowSection = createNode({
      id: 'row-section',
      type: 'section',
      parentId: page.id,
      size: { width: 600, height: 28 },
      childIds: ['field'],
      layout: {
        mode: 'flex',
        direction: 'row',
        gap: 8,
        padding: 8,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });
    const field = createNode({
      id: 'field',
      type: 'field',
      parentId: rowSection.id,
      size: { width: 160, height: 18 },
      layout: {
        mode: 'canvas',
        direction: 'column',
        gap: 0,
        padding: 0,
        justify: 'start',
        align: 'start',
        sizing: 'fixed',
      },
    });

    const laidOut = __designerLayoutTestUtils.computeLayout([document, page, rowSection, field]);
    const laidOutField = laidOut.find((node) => node.id === 'field');

    expect(laidOutField).toBeTruthy();
    if (!laidOutField) return;

    expect(laidOutField.size.height).toBeGreaterThanOrEqual(40);
  });
});

describe('designerStore resolveLayout hard minimum clamps', () => {
  const createBaseTree = (overrides: { child: DesignerNode; sectionSize?: { width: number; height: number } }) => {
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
      childIds: ['notes'],
      allowedChildren: ['section'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 24,
        padding: 40,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });
    const notes = createNode({
      id: 'notes',
      type: 'section',
      parentId: page.id,
      size: overrides.sectionSize ?? { width: 320, height: 160 },
      childIds: [overrides.child.id],
      layout: {
        mode: 'canvas',
        direction: 'column',
        gap: 0,
        padding: 0,
        justify: 'start',
        align: 'start',
        sizing: 'fixed',
      },
    });

    return [document, page, notes, overrides.child];
  };

  it('clamps collapsed field height after resolveLayout (200x1 -> >=40)', () => {
    const field = createNode({
      id: 'field',
      type: 'field',
      parentId: 'notes',
      position: { x: 16, y: 16 },
      size: { width: 200, height: 1 },
      baseSize: { width: 200, height: 1 },
      layout: {
        mode: 'canvas',
        direction: 'column',
        gap: 0,
        padding: 0,
        justify: 'start',
        align: 'start',
        sizing: 'fixed',
      },
    });

    const { nodes } = __designerResolveLayoutTestUtils.resolveLayout(createBaseTree({ child: field }), []);
    const resolvedField = nodes.find((node) => node.id === 'field');

    expect(resolvedField).toBeTruthy();
    if (!resolvedField) return;

    expect(resolvedField.size.width).toBeGreaterThanOrEqual(120);
    expect(resolvedField.size.height).toBeGreaterThanOrEqual(40);
  });

  it('clamps collapsed field width after resolveLayout (1x48 -> >=120)', () => {
    const field = createNode({
      id: 'field',
      type: 'field',
      parentId: 'notes',
      position: { x: 16, y: 16 },
      size: { width: 1, height: 48 },
      baseSize: { width: 1, height: 48 },
      layout: {
        mode: 'canvas',
        direction: 'column',
        gap: 0,
        padding: 0,
        justify: 'start',
        align: 'start',
        sizing: 'fixed',
      },
    });

    const { nodes } = __designerResolveLayoutTestUtils.resolveLayout(createBaseTree({ child: field }), []);
    const resolvedField = nodes.find((node) => node.id === 'field');

    expect(resolvedField).toBeTruthy();
    if (!resolvedField) return;

    expect(resolvedField.size.width).toBeGreaterThanOrEqual(120);
    expect(resolvedField.size.height).toBeGreaterThanOrEqual(40);
  });

  it('clamps collapsed signature height after resolveLayout (280x1 -> >=96)', () => {
    const signature = createNode({
      id: 'signature',
      type: 'signature',
      parentId: 'notes',
      position: { x: 16, y: 16 },
      size: { width: 280, height: 1 },
      baseSize: { width: 280, height: 1 },
      layout: {
        mode: 'canvas',
        direction: 'column',
        gap: 0,
        padding: 0,
        justify: 'start',
        align: 'start',
        sizing: 'fixed',
      },
    });

    const { nodes } = __designerResolveLayoutTestUtils.resolveLayout(createBaseTree({ child: signature }), []);
    const resolvedSignature = nodes.find((node) => node.id === 'signature');

    expect(resolvedSignature).toBeTruthy();
    if (!resolvedSignature) return;

    expect(resolvedSignature.size.width).toBeGreaterThanOrEqual(180);
    expect(resolvedSignature.size.height).toBeGreaterThanOrEqual(96);
  });
});
