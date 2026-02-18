import { beforeEach, describe, expect, it } from 'vitest';

import type { DesignerNode } from './designerStore';
import { clampNodeSizeToPracticalMinimum, useInvoiceDesignerStore } from './designerStore';
import { getNodeMetadata, getNodeName } from '../utils/nodeProps';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => ({
  id: overrides.id ?? `node-${Math.random().toString(36).slice(2, 7)}`,
  type: overrides.type ?? 'text',
  props: overrides.props ?? ({ name: 'Node', metadata: {} } as any),
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 120, height: 48 },
  baseSize: overrides.baseSize ?? overrides.size ?? { width: 120, height: 48 },
  canRotate: overrides.canRotate ?? false,
  allowResize: overrides.allowResize ?? true,
  rotation: overrides.rotation ?? 0,
  layoutPresetId: overrides.layoutPresetId,
  parentId: overrides.parentId ?? null,
  children: overrides.children ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
});

const seedLabelWorkspace = () => {
  const document = createNode({
    id: 'doc',
    type: 'document',
    props: {
      name: 'Document',
      metadata: {},
      layout: { display: 'flex', flexDirection: 'column', gap: '0px', padding: '0px' },
      style: { width: '816px', height: '1056px' },
    },
    size: { width: 816, height: 1056 },
    baseSize: { width: 816, height: 1056 },
    parentId: null,
    children: ['page'],
    allowedChildren: ['page'],
    allowResize: false,
    canRotate: false,
  });
  const page = createNode({
    id: 'page',
    type: 'page',
    props: {
      name: 'Page 1',
      metadata: {},
      layout: { display: 'flex', flexDirection: 'column', gap: '32px', padding: '40px' },
      style: { width: '816px', height: '1056px' },
    },
    parentId: 'doc',
    position: { x: 0, y: 0 },
    size: { width: 816, height: 1056 },
    baseSize: { width: 816, height: 1056 },
    children: ['section'],
    allowedChildren: ['section'],
    allowResize: false,
    canRotate: false,
  });
  const section = createNode({
    id: 'section',
    type: 'section',
    props: {
      name: 'Header',
      metadata: {},
      layout: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px' },
      style: { width: '736px', height: '220px' },
    },
    parentId: 'page',
    position: { x: 40, y: 40 },
    size: { width: 736, height: 220 },
    baseSize: { width: 736, height: 220 },
    children: ['container'],
    allowedChildren: ['container', 'label', 'field', 'text'],
  });
  const container = createNode({
    id: 'container',
    type: 'container',
    props: {
      name: 'Container',
      metadata: {},
      layout: { display: 'grid', gap: '0px', padding: '0px' },
      style: { width: '400px', height: '120px' },
    },
    parentId: 'section',
    position: { x: 16, y: 16 },
    size: { width: 400, height: 120 },
    baseSize: { width: 400, height: 120 },
    children: ['label'],
    allowedChildren: ['label', 'field', 'text'],
  });
  const label = createNode({
    id: 'label',
    type: 'label',
    props: { name: 'label 12', metadata: { text: 'Label' } },
    parentId: 'container',
    position: { x: 24, y: 24 },
    size: { width: 160, height: 40 },
    baseSize: { width: 160, height: 40 },
    children: [],
    allowedChildren: [],
  });

  useInvoiceDesignerStore.getState().loadNodes([document, page, section, container, label]);
};

describe('designerStore label text authority', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
    seedLabelWorkspace();
  });

  it('syncs label props.name from metadata.text updates', () => {
    useInvoiceDesignerStore.getState().setNodeProp('label', 'metadata.text', 'INVOICE', true);
    const label = useInvoiceDesignerStore.getState().nodesById['label'];
    expect(label).toBeTruthy();
    if (!label) return;

    expect(getNodeName(label)).toBe('INVOICE');
    expect((getNodeMetadata(label) as any).text).toBe('INVOICE');
  });

  it('syncs label metadata.text from name updates', () => {
    useInvoiceDesignerStore.getState().setNodeProp('label', 'name', 'DUE DATE', true);
    const label = useInvoiceDesignerStore.getState().nodesById['label'];
    expect(label).toBeTruthy();
    if (!label) return;

    expect(getNodeName(label)).toBe('DUE DATE');
    expect((getNodeMetadata(label) as any).text).toBe('DUE DATE');
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

    const label = store.nodesById['label'];
    expect(getNodeName(label)).toBe('INVOICE');
    expect((getNodeMetadata(label) as any).text).toBe('INVOICE');
  });

  it('syncs label props.name and metadata.text from metadata.label for legacy nodes', () => {
    const store = useInvoiceDesignerStore.getState();
    store.setNodeProp('label', 'metadata.text', '', false);
    store.setNodeProp('label', 'metadata.label', 'Billing Contact', true);

    const label = store.nodesById['label'];
    expect(getNodeName(label)).toBe('Billing Contact');
    expect((getNodeMetadata(label) as any).text).toBe('Billing Contact');
    expect((getNodeMetadata(label) as any).label).toBe('Billing Contact');
  });
});

