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

    store.moveNode('text-3', 'section-1', 1);

    const section = useInvoiceDesignerStore.getState().nodes.find((n) => n.id === 'section-1');
    expect(section?.childIds).toEqual(['text-1', 'text-3', 'text-2']);
  });

  it('moves a node across containers and inserts at the requested index', () => {
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
        childIds: ['section-a', 'section-b'],
        allowedChildren: ['section'],
      },
      {
        id: 'section-a',
        type: 'section',
        name: 'Section A',
        position: { x: 24, y: 24 },
        size: { width: 400, height: 240 },
        parentId: 'page-1',
        childIds: ['text-1', 'text-2'],
        allowedChildren: ['text'],
        layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' },
      },
      {
        id: 'section-b',
        type: 'section',
        name: 'Section B',
        position: { x: 24, y: 300 },
        size: { width: 400, height: 240 },
        parentId: 'page-1',
        childIds: ['text-3'],
        allowedChildren: ['text'],
        layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' },
      },
      {
        id: 'text-1',
        type: 'text',
        name: 'Text 1',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 32 },
        parentId: 'section-a',
        childIds: [],
        allowedChildren: [],
      },
      {
        id: 'text-2',
        type: 'text',
        name: 'Text 2',
        position: { x: 0, y: 40 },
        size: { width: 100, height: 32 },
        parentId: 'section-a',
        childIds: [],
        allowedChildren: [],
      },
      {
        id: 'text-3',
        type: 'text',
        name: 'Text 3',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 32 },
        parentId: 'section-b',
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

    store.moveNode('text-2', 'section-b', 1);

    const nextNodes = useInvoiceDesignerStore.getState().nodes;
    const sectionA = nextNodes.find((n) => n.id === 'section-a');
    const sectionB = nextNodes.find((n) => n.id === 'section-b');
    const text2 = nextNodes.find((n) => n.id === 'text-2');

    expect(text2?.parentId).toBe('section-b');
    expect(sectionA?.childIds).toEqual(['text-1']);
    expect(sectionB?.childIds).toEqual(['text-3', 'text-2']);
  });

  it('allows nesting into eligible containers and rejects ineligible nesting', () => {
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
        childIds: ['container-1', 'text-1', 'text-2'],
        allowedChildren: ['container', 'text'],
        layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' },
      },
      {
        id: 'container-1',
        type: 'container',
        name: 'Container',
        position: { x: 0, y: 0 },
        size: { width: 320, height: 160 },
        parentId: 'section-1',
        childIds: [],
        allowedChildren: ['text', 'container'],
        layout: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px' },
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

    // Eligible: text -> container.
    store.moveNode('text-1', 'container-1', 0);
    let nextNodes = useInvoiceDesignerStore.getState().nodes;
    const container = nextNodes.find((n) => n.id === 'container-1');
    const section = nextNodes.find((n) => n.id === 'section-1');
    const text1 = nextNodes.find((n) => n.id === 'text-1');
    expect(text1?.parentId).toBe('container-1');
    expect(container?.childIds).toEqual(['text-1']);
    expect(section?.childIds).toEqual(['container-1', 'text-2']);

    // Ineligible: text -> text (should be rejected, no change).
    store.moveNode('text-2', 'text-1', 0);
    nextNodes = useInvoiceDesignerStore.getState().nodes;
    const text2 = nextNodes.find((n) => n.id === 'text-2');
    expect(text2?.parentId).toBe('section-1');
  });

  it('prevents cycles when nesting containers (cannot drop into a descendant)', () => {
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
        childIds: ['container-a'],
        allowedChildren: ['container'],
        layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' },
      },
      {
        id: 'container-a',
        type: 'container',
        name: 'Container A',
        position: { x: 0, y: 0 },
        size: { width: 320, height: 160 },
        parentId: 'section-1',
        childIds: ['container-b'],
        allowedChildren: ['container'],
        layout: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px' },
      },
      {
        id: 'container-b',
        type: 'container',
        name: 'Container B',
        position: { x: 0, y: 0 },
        size: { width: 260, height: 120 },
        parentId: 'container-a',
        childIds: [],
        allowedChildren: ['container'],
        layout: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px' },
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

    // Valid by type, invalid by cycle: container-a -> container-b (descendant).
    store.moveNode('container-a', 'container-b', 0);

    const nextNodes = useInvoiceDesignerStore.getState().nodes;
    const containerA = nextNodes.find((n) => n.id === 'container-a');
    const section = nextNodes.find((n) => n.id === 'section-1');
    expect(containerA?.parentId).toBe('section-1');
    expect(section?.childIds).toEqual(['container-a']);
  });

  it('does not mutate state for invalid drops (ineligible parent)', () => {
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
        childIds: ['container-1', 'text-1'],
        allowedChildren: ['container', 'text'],
        layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' },
      },
      {
        id: 'container-1',
        type: 'container',
        name: 'Container',
        position: { x: 0, y: 0 },
        size: { width: 320, height: 160 },
        parentId: 'section-1',
        childIds: [],
        allowedChildren: ['text'],
        layout: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px' },
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

    const beforeNodes = useInvoiceDesignerStore.getState().nodes;
    const beforeHistoryIndex = useInvoiceDesignerStore.getState().historyIndex;

    // Invalid: container -> text (text is not a container parent).
    store.moveNode('container-1', 'text-1', 0);

    const afterState = useInvoiceDesignerStore.getState();
    expect(afterState.nodes).toEqual(beforeNodes);
    expect(afterState.historyIndex).toBe(beforeHistoryIndex);
  });

  it('adjusts insertion index correctly when reordering within the same parent (before/after midpoint semantics)', () => {
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
        childIds: ['a', 'b', 'c'],
        allowedChildren: ['text'],
        layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' },
      },
      {
        id: 'a',
        type: 'text',
        name: 'A',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 32 },
        parentId: 'section-1',
        childIds: [],
        allowedChildren: [],
      },
      {
        id: 'b',
        type: 'text',
        name: 'B',
        position: { x: 0, y: 40 },
        size: { width: 100, height: 32 },
        parentId: 'section-1',
        childIds: [],
        allowedChildren: [],
      },
      {
        id: 'c',
        type: 'text',
        name: 'C',
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

    // Simulate inserting "a" at index 2 (drop after "b"). This should become ["b","a","c"] after adjustment.
    store.moveNode('a', 'section-1', 2);
    const section = useInvoiceDesignerStore.getState().nodes.find((n) => n.id === 'section-1');
    expect(section?.childIds).toEqual(['b', 'a', 'c']);
  });

  it('does not write coordinate-based layout during drag-drop moves (positions remain unchanged)', () => {
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
        childIds: ['section-a', 'section-b'],
        allowedChildren: ['section'],
      },
      {
        id: 'section-a',
        type: 'section',
        name: 'Section A',
        position: { x: 24, y: 24 },
        size: { width: 400, height: 240 },
        parentId: 'page-1',
        childIds: ['text-1'],
        allowedChildren: ['text'],
        layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' },
      },
      {
        id: 'section-b',
        type: 'section',
        name: 'Section B',
        position: { x: 24, y: 300 },
        size: { width: 400, height: 240 },
        parentId: 'page-1',
        childIds: [],
        allowedChildren: ['text'],
        layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' },
      },
      {
        id: 'text-1',
        type: 'text',
        name: 'Text 1',
        position: { x: 123, y: 456 },
        size: { width: 100, height: 32 },
        parentId: 'section-a',
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

    store.moveNode('text-1', 'section-b', 0);

    const updated = useInvoiceDesignerStore.getState().nodes.find((n) => n.id === 'text-1');
    expect(updated?.position).toEqual({ x: 123, y: 456 });
  });
});
