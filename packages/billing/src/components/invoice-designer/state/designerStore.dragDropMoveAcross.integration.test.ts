import { beforeEach, describe, expect, it } from 'vitest';

import { useInvoiceDesignerStore } from './designerStore';

describe('drag-drop move across containers (unified tree integration)', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('moves a node across containers by updating unified children arrays and enforces schema nesting rules', () => {
    const store = useInvoiceDesignerStore.getState();
    store.loadWorkspace({
      rootId: 'doc-1',
      nodesById: {
        'doc-1': { id: 'doc-1', type: 'document', props: { name: 'Document' }, children: ['page-1'] },
        'page-1': { id: 'page-1', type: 'page', props: { name: 'Page 1' }, children: ['section-a', 'section-b'] },
        'section-a': {
          id: 'section-a',
          type: 'section',
          props: { name: 'Section A', layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' } },
          children: ['text-1', 'text-2'],
        },
        'section-b': {
          id: 'section-b',
          type: 'section',
          props: { name: 'Section B', layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' } },
          children: ['text-3'],
        },
        'text-1': { id: 'text-1', type: 'text', props: { name: 'Text 1', metadata: { text: 'A' } }, children: [] },
        'text-2': { id: 'text-2', type: 'text', props: { name: 'Text 2', metadata: { text: 'B' } }, children: [] },
        'text-3': { id: 'text-3', type: 'text', props: { name: 'Text 3', metadata: { text: 'C' } }, children: [] },
      },
      snapToGrid: false,
      gridSize: 8,
      showGuides: false,
      showRulers: false,
      canvasScale: 1,
    });

    store.moveNode('text-2', 'section-b', 1);

    let exported = useInvoiceDesignerStore.getState().exportWorkspace();
    expect(exported.nodesById['section-a']?.children).toEqual(['text-1']);
    expect(exported.nodesById['section-b']?.children).toEqual(['text-3', 'text-2']);

    // Invalid nesting: a section cannot be nested within a text node. Should be a no-op.
    store.moveNode('section-b', 'text-1', 0);
    exported = useInvoiceDesignerStore.getState().exportWorkspace();
    expect(exported.nodesById['page-1']?.children).toEqual(['section-a', 'section-b']);
  });
});

