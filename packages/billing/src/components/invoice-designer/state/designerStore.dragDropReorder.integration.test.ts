import { beforeEach, describe, expect, it } from 'vitest';

import { useInvoiceDesignerStore } from './designerStore';

describe('drag-drop reorder (unified tree integration)', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('reorders within a flex container by updating the parent children array via moveNode', () => {
    const store = useInvoiceDesignerStore.getState();
    store.loadWorkspace({
      rootId: 'doc-1',
      nodesById: {
        'doc-1': { id: 'doc-1', type: 'document', props: { name: 'Document' }, children: ['page-1'] },
        'page-1': { id: 'page-1', type: 'page', props: { name: 'Page 1' }, children: ['section-1'] },
        'section-1': {
          id: 'section-1',
          type: 'section',
          props: { name: 'Section', layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' } },
          children: ['text-1', 'text-2', 'text-3'],
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

    store.moveNode('text-3', 'section-1', 1);

    const exported = useInvoiceDesignerStore.getState().exportWorkspace();
    expect(exported.nodesById['section-1']?.children).toEqual(['text-1', 'text-3', 'text-2']);
  });
});

