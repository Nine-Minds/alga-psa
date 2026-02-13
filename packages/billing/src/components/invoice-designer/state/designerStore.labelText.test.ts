import { beforeEach, describe, expect, it } from 'vitest';

import type { DesignerNode } from './designerStore';
import { clampNodeSizeToPracticalMinimum, useInvoiceDesignerStore } from './designerStore';

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

const seedLabelWorkspace = () => {
  const document = createNode({
    id: 'doc',
    type: 'document',
    name: 'Document',
    size: { width: 816, height: 1056 },
    baseSize: { width: 816, height: 1056 },
    parentId: null,
    childIds: ['page'],
    allowedChildren: ['page'],
    allowResize: false,
    canRotate: false,
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
    name: 'Page 1',
    parentId: 'doc',
    position: { x: 0, y: 0 },
    size: { width: 816, height: 1056 },
    baseSize: { width: 816, height: 1056 },
    childIds: ['section'],
    allowedChildren: ['section'],
    allowResize: false,
    canRotate: false,
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
    name: 'Header',
    parentId: 'page',
    position: { x: 40, y: 40 },
    size: { width: 736, height: 220 },
    baseSize: { width: 736, height: 220 },
    childIds: ['container'],
    allowedChildren: ['container', 'label', 'field', 'text'],
    layout: {
      mode: 'flex',
      direction: 'column',
      gap: 12,
      padding: 16,
      justify: 'start',
      align: 'stretch',
      sizing: 'fixed',
    },
  });
  const container = createNode({
    id: 'container',
    type: 'container',
    name: 'Container',
    parentId: 'section',
    position: { x: 16, y: 16 },
    size: { width: 400, height: 120 },
    baseSize: { width: 400, height: 120 },
    childIds: ['label'],
    allowedChildren: ['label', 'field', 'text'],
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
  const label = createNode({
    id: 'label',
    type: 'label',
    name: 'label 12',
    parentId: 'container',
    position: { x: 24, y: 24 },
    size: { width: 160, height: 40 },
    baseSize: { width: 160, height: 40 },
    childIds: [],
    allowedChildren: [],
    metadata: { text: 'Label' },
  });

  useInvoiceDesignerStore.getState().loadWorkspace({
    nodes: [document, page, section, container, label],
    constraints: [],
    snapToGrid: true,
    gridSize: 8,
    showGuides: true,
    showRulers: true,
    canvasScale: 1,
  });
};

describe('designerStore label text authority', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
    seedLabelWorkspace();
  });

  it('syncs label node name from metadata.text updates', () => {
    useInvoiceDesignerStore.getState().setNodeProp('label', 'metadata.text', 'INVOICE', true);
    const label = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'label');
    expect(label?.name).toBe('INVOICE');
    expect(label?.metadata?.text).toBe('INVOICE');
  });

  it('syncs label metadata.text from name updates', () => {
    useInvoiceDesignerStore.getState().setNodeProp('label', 'name', 'DUE DATE', true);
    const label = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'label');
    expect(label?.name).toBe('DUE DATE');
    expect(label?.metadata?.text).toBe('DUE DATE');
  });

  it('preserves synced label text after position/size commits', () => {
    const store = useInvoiceDesignerStore.getState();
    store.setNodeProp('label', 'metadata.text', 'INVOICE', true);
    store.setNodeProp('label', 'position.x', 24, false);
    store.setNodeProp('label', 'position.y', 24, true);
    const nodeBefore = store.nodesById['label'];
    expect(nodeBefore).toBeTruthy();
    if (!nodeBefore) return;

    const clamped = clampNodeSizeToPracticalMinimum(nodeBefore.type, { width: 160, height: 40 });
    const rounded = { width: Math.round(clamped.width), height: Math.round(clamped.height) };
    store.setNodeProp('label', 'size.width', rounded.width, false);
    store.setNodeProp('label', 'size.height', rounded.height, false);
    store.setNodeProp('label', 'baseSize.width', rounded.width, false);
    store.setNodeProp('label', 'baseSize.height', rounded.height, false);
    store.setNodeProp('label', 'style.width', `${rounded.width}px`, false);
    store.setNodeProp('label', 'style.height', `${rounded.height}px`, true);

    const label = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'label');
    expect(label?.name).toBe('INVOICE');
    expect(label?.metadata?.text).toBe('INVOICE');
  });

  it('syncs label node name and metadata.text from metadata.label for legacy nodes', () => {
    const store = useInvoiceDesignerStore.getState();
    store.setNodeProp('label', 'metadata.text', '', false);
    store.setNodeProp('label', 'metadata.label', 'Billing Contact', true);

    const label = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'label');
    expect(label?.name).toBe('Billing Contact');
    expect(label?.metadata?.text).toBe('Billing Contact');
    expect(label?.metadata?.label).toBe('Billing Contact');
  });
});
