import { beforeEach, describe, expect, it } from 'vitest';

import type { DesignerNode } from './designerStore';
import { useInvoiceDesignerStore } from './designerStore';
import { buildPairConstraint } from '../utils/constraints';

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

const seedWorkspace = (constraints: ReturnType<typeof buildPairConstraint>[] = []) => {
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
    name: 'Page',
    parentId: 'doc',
    size: { width: 816, height: 1056 },
    baseSize: { width: 816, height: 1056 },
    childIds: ['section'],
    allowedChildren: ['section'],
    allowResize: false,
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

  const section = createNode({
    id: 'section',
    type: 'section',
    name: 'Section',
    parentId: 'page',
    size: { width: 360, height: 220 },
    baseSize: { width: 360, height: 220 },
    childIds: ['a', 'b', 'c'],
    allowedChildren: ['container', 'field', 'label', 'text'],
    layout: {
      mode: 'flex',
      direction: 'row',
      gap: 20,
      padding: 10,
      justify: 'start',
      align: 'start',
      sizing: 'fixed',
    },
  });

  const a = createNode({
    id: 'a',
    type: 'label',
    name: 'A',
    parentId: 'section',
    size: { width: 60, height: 40 },
    baseSize: { width: 60, height: 40 },
    childIds: [],
    allowedChildren: [],
    metadata: { text: 'A' },
  });

  const b = createNode({
    id: 'b',
    type: 'label',
    name: 'B',
    parentId: 'section',
    size: { width: 60, height: 40 },
    baseSize: { width: 60, height: 40 },
    childIds: [],
    allowedChildren: [],
    metadata: { text: 'B' },
  });

  const c = createNode({
    id: 'c',
    type: 'label',
    name: 'C',
    parentId: 'section',
    size: { width: 60, height: 40 },
    baseSize: { width: 60, height: 40 },
    childIds: [],
    allowedChildren: [],
    metadata: { text: 'C' },
  });

  useInvoiceDesignerStore.getState().loadWorkspace({
    nodes: [document, page, section, a, b, c],
    constraints,
    snapToGrid: true,
    gridSize: 8,
    showGuides: true,
    showRulers: true,
    canvasScale: 1,
  });
};

const getNode = (id: string) => {
  const node = useInvoiceDesignerStore.getState().nodes.find((entry) => entry.id === id);
  if (!node) {
    throw new Error(`Missing node ${id}`);
  }
  return node;
};

describe('designerStore layout mode toggle', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
    seedWorkspace();
  });

  it('reflows children back into stack order when switching canvas back to flex', () => {
    const store = useInvoiceDesignerStore.getState();

    store.setLayoutMode('section', 'canvas');
    store.setNodePosition('a', { x: 250, y: 90 }, true);
    store.setNodePosition('b', { x: 10, y: 130 }, true);
    store.setNodePosition('c', { x: 160, y: 20 }, true);

    expect(getNode('a').position.x).toBeGreaterThan(180);
    expect(getNode('b').position.y).toBeGreaterThan(100);
    expect(getNode('c').position.x).toBeGreaterThan(120);

    store.setLayoutMode('section', 'flex');

    expect(getNode('a').position).toEqual({ x: 10, y: 10 });
    expect(getNode('b').position).toEqual({ x: 110, y: 10 });
    expect(getNode('c').position).toEqual({ x: 210, y: 10 });
  });

  it('reflows children back into stack order even when prior pair constraints exist', () => {
    useInvoiceDesignerStore.getState().resetWorkspace();
    seedWorkspace([buildPairConstraint('align-left', 'a', 'b')]);

    const store = useInvoiceDesignerStore.getState();

    store.setLayoutMode('section', 'canvas');
    store.setNodePosition('a', { x: 250, y: 90 }, true);
    store.setNodePosition('b', { x: 10, y: 130 }, true);
    store.setNodePosition('c', { x: 160, y: 20 }, true);

    store.setLayoutMode('section', 'flex');

    expect(getNode('a').position).toEqual({ x: 10, y: 10 });
    expect(getNode('b').position).toEqual({ x: 110, y: 10 });
    expect(getNode('c').position).toEqual({ x: 210, y: 10 });
    expect(useInvoiceDesignerStore.getState().constraints).toEqual([]);
  });
});
