import { beforeEach, describe, expect, it } from 'vitest';

import { __designerLayoutTestUtils, type DesignerNode, useInvoiceDesignerStore } from './designerStore';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => ({
  id: overrides.id ?? `node-${Math.random().toString(36).slice(2, 7)}`,
  type: overrides.type ?? 'text',
  name: overrides.name ?? 'Node',
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 120, height: 48 },
  baseSize: overrides.baseSize ?? overrides.size ?? { width: 120, height: 48 },
  canRotate: overrides.canRotate ?? false,
  allowResize: overrides.allowResize ?? true,
  rotation: overrides.rotation ?? 0,
  metadata: overrides.metadata ?? {},
  layoutPresetId: overrides.layoutPresetId,
  layout:
    overrides.layout ?? {
      mode: 'canvas',
      direction: 'column',
      gap: 0,
      padding: 0,
      justify: 'start',
      align: 'start',
      sizing: 'fixed',
    },
  parentId: overrides.parentId ?? null,
  childIds: overrides.childIds ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
});

const createBaseTree = (child: DesignerNode, sectionSize: { width: number; height: number }) => {
  const document = createNode({
    id: 'doc',
    type: 'document',
    name: 'Document',
    size: { width: 816, height: 1056 },
    baseSize: { width: 816, height: 1056 },
    childIds: ['page'],
    allowedChildren: ['page'],
    allowResize: false,
  });

  const page = createNode({
    id: 'page',
    type: 'page',
    name: 'Page',
    parentId: document.id,
    size: { width: 816, height: 1056 },
    baseSize: { width: 816, height: 1056 },
    childIds: ['section'],
    allowedChildren: ['section'],
    allowResize: false,
  });

  const section = createNode({
    id: 'section',
    type: 'section',
    name: 'Section',
    parentId: page.id,
    size: sectionSize,
    baseSize: sectionSize,
    childIds: [child.id],
    allowedChildren: ['field', 'table', 'image', 'logo', 'qr'],
  });

  return [document, page, section, child];
};

describe('designerStore updateNodeSize parent-bound clamps', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('clamps resized image dimensions to parent bounds before resolveLayout', () => {
    const image = createNode({
      id: 'image',
      type: 'image',
      parentId: 'section',
      size: { width: 120, height: 80 },
      baseSize: { width: 120, height: 80 },
      allowedChildren: [],
    });

    useInvoiceDesignerStore.getState().loadNodes(createBaseTree(image, { width: 320, height: 200 }));
    useInvoiceDesignerStore.getState().updateNodeSize('image', { width: 1200, height: 900 }, true);

    const state = useInvoiceDesignerStore.getState();
    const section = state.nodes.find((node) => node.id === 'section');
    const resizedImage = state.nodes.find((node) => node.id === 'image');

    expect(section).toBeTruthy();
    expect(resizedImage).toBeTruthy();
    if (!section || !resizedImage) return;

    expect(resizedImage.size.width).toBeLessThanOrEqual(section.size.width);
    expect(resizedImage.size.height).toBeLessThanOrEqual(section.size.height);
    expect(resizedImage.baseSize?.width).toBe(resizedImage.size.width);
    expect(resizedImage.baseSize?.height).toBe(resizedImage.size.height);
  });

  it('keeps table size parent-bounded even when solver cannot satisfy table minimums in a narrow section', () => {
    const table = createNode({
      id: 'table',
      type: 'table',
      parentId: 'section',
      size: { width: 180, height: 120 },
      baseSize: { width: 180, height: 120 },
      allowedChildren: [],
    });

    useInvoiceDesignerStore.getState().loadNodes(createBaseTree(table, { width: 200, height: 180 }));
    useInvoiceDesignerStore.getState().updateNodeSize('table', { width: 900, height: 700 }, true);

    const state = useInvoiceDesignerStore.getState();
    const section = state.nodes.find((node) => node.id === 'section');
    const resizedTable = state.nodes.find((node) => node.id === 'table');

    expect(section).toBeTruthy();
    expect(resizedTable).toBeTruthy();
    if (!section || !resizedTable) return;

    expect(resizedTable.size.width).toBeLessThanOrEqual(section.size.width);
    expect(resizedTable.size.height).toBeLessThanOrEqual(section.size.height);
    expect(resizedTable.baseSize?.width).toBe(resizedTable.size.width);
    expect(resizedTable.baseSize?.height).toBe(resizedTable.size.height);
  });

  it('does not force-stretch media cross-axis size in row layouts with align=stretch', () => {
    const image = createNode({
      id: 'image',
      type: 'image',
      parentId: 'section',
      size: { width: 160, height: 120 },
      baseSize: { width: 160, height: 120 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 0,
        padding: 0,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
      allowedChildren: [],
    });
    const [document, page, section] = createBaseTree(image, { width: 736, height: 976 });
    section.layout = {
      mode: 'flex',
      direction: 'row',
      gap: 16,
      padding: 16,
      justify: 'start',
      align: 'stretch',
      sizing: 'fixed',
    };

    const laidOut = __designerLayoutTestUtils.computeLayout([document, page, section, image]);
    const laidOutImage = laidOut.find((node) => node.id === 'image');
    expect(laidOutImage).toBeTruthy();
    if (!laidOutImage) return;

    expect(laidOutImage.size.height).toBe(120);
  });

  it('ignores aspect-ratio constraints on sections so manual height changes do not snap back', () => {
    const document = createNode({
      id: 'doc',
      type: 'document',
      name: 'Document',
      size: { width: 816, height: 1056 },
      baseSize: { width: 816, height: 1056 },
      childIds: ['page'],
      allowedChildren: ['page'],
      allowResize: false,
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
    const page = createNode({
      id: 'page',
      type: 'page',
      parentId: document.id,
      size: { width: 600, height: 600 },
      baseSize: { width: 600, height: 600 },
      childIds: ['section'],
      allowedChildren: ['section'],
      allowResize: false,
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
    const section = createNode({
      id: 'section',
      type: 'section',
      parentId: page.id,
      position: { x: 32, y: 32 },
      size: { width: 200, height: 134 },
      baseSize: { width: 200, height: 134 },
      childIds: [],
      allowedChildren: ['field', 'table', 'image', 'logo', 'qr'],
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

    useInvoiceDesignerStore.getState().loadWorkspace({
      nodes: [document, page, section],
      constraints: [
        {
          id: 'aspect-section',
          type: 'aspect-ratio',
          nodeId: 'section',
          ratio: 1.49,
          strength: 'strong',
        },
      ],
    });

    useInvoiceDesignerStore.getState().updateNodeSize('section', { width: 200, height: 320 }, true);
    const resizedSection = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'section');
    expect(resizedSection).toBeTruthy();
    if (!resizedSection) return;

    expect(resizedSection.size.height).toBeCloseTo(320, 3);
  });
});
