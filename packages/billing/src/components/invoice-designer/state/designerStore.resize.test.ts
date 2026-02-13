import { beforeEach, describe, expect, it } from 'vitest';

import { clampNodeSizeToPracticalMinimum, useInvoiceDesignerStore } from './designerStore';
import type { DesignerNode } from './designerStore';
import { getNodeStyle } from '../utils/nodeProps';

type LegacyNodeInput = {
  id: string;
  type: DesignerNode['type'];
  name: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  parentId: string | null;
  childIds: string[];
  allowedChildren: DesignerNode['allowedChildren'];
  metadata?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  style?: Record<string, unknown>;
};

const materializeNodes = (nodes: LegacyNodeInput[]): DesignerNode[] =>
  nodes.map((node) => ({
    id: node.id,
    type: node.type,
    props: {
      name: node.name,
      ...(node.metadata ? { metadata: node.metadata } : {}),
      ...(node.layout ? { layout: node.layout } : {}),
      ...(node.style ? { style: node.style } : {}),
    },
    position: node.position,
    size: node.size,
    parentId: node.parentId,
    children: node.childIds,
    allowedChildren: node.allowedChildren,
  }));

describe('designerStore (resize)', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  const resizeViaSetNodeProp = (nodeId: string, size: { width: number; height: number }, commit = true) => {
    const store = useInvoiceDesignerStore.getState();
    const node = store.nodesById[nodeId];
    expect(node).toBeTruthy();
    if (!node) return;

    const clamped = clampNodeSizeToPracticalMinimum(node.type, size);
    const rounded = { width: Math.round(clamped.width), height: Math.round(clamped.height) };

    store.setNodeProp(nodeId, 'size.width', rounded.width, false);
    store.setNodeProp(nodeId, 'size.height', rounded.height, false);
    store.setNodeProp(nodeId, 'baseSize.width', rounded.width, false);
    store.setNodeProp(nodeId, 'baseSize.height', rounded.height, false);
    store.setNodeProp(nodeId, 'style.width', `${rounded.width}px`, false);
    store.setNodeProp(nodeId, 'style.height', `${rounded.height}px`, commit);
  };

  it('resizing an image writes pixel sizing props (px) into node.style', () => {
    const nodes: DesignerNode[] = materializeNodes([
      {
        id: 'doc-1',
        type: 'document',
        name: 'Document',
        position: { x: 0, y: 0 },
        size: { width: 816, height: 1056 },
        parentId: null,
        childIds: ['page-1'],
        allowedChildren: ['page'],
      },
      {
        id: 'page-1',
        type: 'page',
        name: 'Page 1',
        position: { x: 0, y: 0 },
        size: { width: 816, height: 1056 },
        parentId: 'doc-1',
        childIds: ['section-1'],
        allowedChildren: ['section'],
      },
      {
        id: 'section-1',
        type: 'section',
        name: 'Section',
        position: { x: 24, y: 24 },
        size: { width: 400, height: 240 },
        parentId: 'page-1',
        childIds: ['image-1'],
        allowedChildren: ['image'],
      },
      {
        id: 'image-1',
        type: 'image',
        name: 'Image',
        position: { x: 0, y: 0 },
        size: { width: 120, height: 80 },
        parentId: 'section-1',
        childIds: [],
        allowedChildren: [],
        style: { width: '50%', height: 'auto' },
      },
    ]);

    const store = useInvoiceDesignerStore.getState();
    store.loadWorkspace({
      nodes,
      snapToGrid: false,
      gridSize: 8,
      showGuides: false,
      showRulers: false,
      canvasScale: 1,
    });

    resizeViaSetNodeProp('image-1', { width: 333.4, height: 222.2 }, true);

    const updated = useInvoiceDesignerStore.getState().nodes.find((n) => n.id === 'image-1');
    expect(updated?.size).toEqual({ width: 333, height: 222 });
    expect(updated).toBeTruthy();
    if (!updated) return;
    expect(getNodeStyle(updated)?.width).toBe('333px');
    expect(getNodeStyle(updated)?.height).toBe('222px');
  });

  it('resizing a section writes pixel sizing props (px) into node.style', () => {
    const nodes: DesignerNode[] = materializeNodes([
      {
        id: 'doc-1',
        type: 'document',
        name: 'Document',
        position: { x: 0, y: 0 },
        size: { width: 816, height: 1056 },
        parentId: null,
        childIds: ['page-1'],
        allowedChildren: ['page'],
      },
      {
        id: 'page-1',
        type: 'page',
        name: 'Page 1',
        position: { x: 0, y: 0 },
        size: { width: 816, height: 1056 },
        parentId: 'doc-1',
        childIds: ['section-1'],
        allowedChildren: ['section'],
      },
      {
        id: 'section-1',
        type: 'section',
        name: 'Section',
        position: { x: 24, y: 24 },
        size: { width: 400, height: 240 },
        parentId: 'page-1',
        childIds: [],
        allowedChildren: ['text'],
        style: { width: 'auto', height: 'auto' },
      },
    ]);

    const store = useInvoiceDesignerStore.getState();
    store.loadWorkspace({
      nodes,
      snapToGrid: false,
      gridSize: 8,
      showGuides: false,
      showRulers: false,
      canvasScale: 1,
    });

    resizeViaSetNodeProp('section-1', { width: 512.1, height: 301.6 }, true);

    const updated = useInvoiceDesignerStore.getState().nodes.find((n) => n.id === 'section-1');
    expect(updated?.size).toEqual({ width: 512, height: 302 });
    expect(updated).toBeTruthy();
    if (!updated) return;
    expect(getNodeStyle(updated)?.width).toBe('512px');
    expect(getNodeStyle(updated)?.height).toBe('302px');
  });

  it('drag-resize overwrites non-px sizing strings to px values', () => {
    const nodes: DesignerNode[] = materializeNodes([
      {
        id: 'doc-1',
        type: 'document',
        name: 'Document',
        position: { x: 0, y: 0 },
        size: { width: 816, height: 1056 },
        parentId: null,
        childIds: ['page-1'],
        allowedChildren: ['page'],
      },
      {
        id: 'page-1',
        type: 'page',
        name: 'Page 1',
        position: { x: 0, y: 0 },
        size: { width: 816, height: 1056 },
        parentId: 'doc-1',
        childIds: ['section-1'],
        allowedChildren: ['section'],
      },
      {
        id: 'section-1',
        type: 'section',
        name: 'Section',
        position: { x: 24, y: 24 },
        size: { width: 400, height: 240 },
        parentId: 'page-1',
        childIds: ['image-1'],
        allowedChildren: ['image'],
      },
      {
        id: 'image-1',
        type: 'image',
        name: 'Image',
        position: { x: 0, y: 0 },
        size: { width: 120, height: 80 },
        parentId: 'section-1',
        childIds: [],
        allowedChildren: [],
        style: { width: '50%', height: 'auto' },
      },
    ]);

    const store = useInvoiceDesignerStore.getState();
    store.loadWorkspace({
      nodes,
      snapToGrid: false,
      gridSize: 8,
      showGuides: false,
      showRulers: false,
      canvasScale: 1,
    });

    resizeViaSetNodeProp('image-1', { width: 200, height: 100 }, true);

    const updated = useInvoiceDesignerStore.getState().nodes.find((n) => n.id === 'image-1');
    expect(updated).toBeTruthy();
    if (!updated) return;
    expect(getNodeStyle(updated)?.width).toBe('200px');
    expect(getNodeStyle(updated)?.height).toBe('100px');
  });
});
