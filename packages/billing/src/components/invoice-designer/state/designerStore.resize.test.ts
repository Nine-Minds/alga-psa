import { beforeEach, describe, expect, it } from 'vitest';

import { useInvoiceDesignerStore } from './designerStore';
import type { DesignerNode } from './designerStore';

describe('designerStore (resize)', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('resizing an image writes pixel sizing props (px) into node.style', () => {
    const nodes: DesignerNode[] = [
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
    ];

    const store = useInvoiceDesignerStore.getState();
    store.loadWorkspace({
      nodes,
      snapToGrid: false,
      gridSize: 8,
      showGuides: false,
      showRulers: false,
      canvasScale: 1,
    });

    store.updateNodeSize('image-1', { width: 333.4, height: 222.2 }, true);

    const updated = useInvoiceDesignerStore.getState().nodes.find((n) => n.id === 'image-1');
    expect(updated?.size).toEqual({ width: 333, height: 222 });
    expect(updated?.style?.width).toBe('333px');
    expect(updated?.style?.height).toBe('222px');
  });

  it('resizing a section writes pixel sizing props (px) into node.style', () => {
    const nodes: DesignerNode[] = [
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
    ];

    const store = useInvoiceDesignerStore.getState();
    store.loadWorkspace({
      nodes,
      snapToGrid: false,
      gridSize: 8,
      showGuides: false,
      showRulers: false,
      canvasScale: 1,
    });

    store.updateNodeSize('section-1', { width: 512.1, height: 301.6 }, true);

    const updated = useInvoiceDesignerStore.getState().nodes.find((n) => n.id === 'section-1');
    expect(updated?.size).toEqual({ width: 512, height: 302 });
    expect(updated?.style?.width).toBe('512px');
    expect(updated?.style?.height).toBe('302px');
  });
});
