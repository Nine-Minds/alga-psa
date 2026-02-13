import { beforeEach, describe, expect, it } from 'vitest';

import { useInvoiceDesignerStore } from './designerStore';
import type { DesignerNode } from './designerStore';

describe('designerStore (flow drag-drop state updates)', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('reorders within the same container deterministically (parent.childIds)', () => {
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
        childIds: ['text-1', 'text-2', 'text-3'],
        allowedChildren: ['text'],
        layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' },
      },
      {
        id: 'text-1',
        type: 'text',
        name: 'Text 1',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 32 },
        parentId: 'section-1',
        childIds: [],
        allowedChildren: [],
      },
      {
        id: 'text-2',
        type: 'text',
        name: 'Text 2',
        position: { x: 0, y: 40 },
        size: { width: 100, height: 32 },
        parentId: 'section-1',
        childIds: [],
        allowedChildren: [],
      },
      {
        id: 'text-3',
        type: 'text',
        name: 'Text 3',
        position: { x: 0, y: 80 },
        size: { width: 100, height: 32 },
        parentId: 'section-1',
        childIds: [],
        allowedChildren: [],
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

    store.moveNodeToParentAtIndex('text-3', 'section-1', 1);

    const section = useInvoiceDesignerStore.getState().nodes.find((n) => n.id === 'section-1');
    expect(section?.childIds).toEqual(['text-1', 'text-3', 'text-2']);
  });
});

