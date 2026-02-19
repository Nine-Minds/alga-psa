import { describe, expect, it } from 'vitest';

import { useInvoiceDesignerStore } from './designerStore';

describe('designerStore.exportWorkspace', () => {
  it('serializes only the unified tree + UI settings and omits runtime/editor-only props', () => {
    useInvoiceDesignerStore.getState().resetWorkspace();

    useInvoiceDesignerStore.getState().loadWorkspace({
      rootId: 'doc-1',
      nodesById: {
        'doc-1': {
          id: 'doc-1',
          type: 'document',
          props: {
            name: 'Document',
            // These should be dropped from persisted props.
            position: { x: 0, y: 0 },
            size: { width: 816, height: 1056 },
            baseSize: { width: 816, height: 1056 },
            layoutPresetId: 'preset-1',
            layout: { display: 'flex', flexDirection: 'column', gap: '0px', padding: '0px' },
            style: { width: '816px', height: '1056px' },
            metadata: {},
          },
          children: ['page-1'],
        },
        'page-1': {
          id: 'page-1',
          type: 'page',
          props: {
            name: 'Page 1',
            position: { x: 0, y: 0 },
            size: { width: 816, height: 1056 },
            baseSize: { width: 816, height: 1056 },
            layoutPresetId: 'preset-2',
            layout: { display: 'flex', flexDirection: 'column', gap: '32px', padding: '40px' },
            style: { width: '816px', height: '1056px' },
            metadata: {},
          },
          children: ['text-1'],
        },
        'text-1': {
          id: 'text-1',
          type: 'text',
          props: {
            name: 'Text',
            metadata: { text: 'Hello' },
            style: { width: '200px', height: 'auto' },
            position: { x: 24, y: 24 },
            size: { width: 200, height: 48 },
          },
          children: [],
        },
      },
      snapToGrid: false,
      gridSize: 12,
      showGuides: true,
      showRulers: false,
      canvasScale: 0.75,
    });

    const exported = useInvoiceDesignerStore.getState().exportWorkspace();

    // Workspace contains only the unified snapshot + UI settings.
    expect(Object.keys(exported).sort()).toEqual([
      'canvasScale',
      'gridSize',
      'nodesById',
      'rootId',
      'showGuides',
      'showRulers',
      'snapToGrid',
    ]);

    // No legacy `nodes` array or per-node typed fields are persisted.
    expect((exported as any).nodes).toBeUndefined();

    const exportedDoc = exported.nodesById['doc-1'];
    expect(Object.keys(exportedDoc).sort()).toEqual(['children', 'id', 'props', 'type']);

    expect((exportedDoc.props as any).position).toBeUndefined();
    expect((exportedDoc.props as any).size).toBeUndefined();
    expect((exportedDoc.props as any).baseSize).toBeUndefined();
    expect((exportedDoc.props as any).layoutPresetId).toBeUndefined();
    expect((exportedDoc.props as any).layout).toMatchObject({ display: 'flex' });

    const exportedText = exported.nodesById['text-1'];
    expect((exportedText.props as any).position).toBeUndefined();
    expect((exportedText.props as any).size).toBeUndefined();
    expect((exportedText.props as any).metadata).toMatchObject({ text: 'Hello' });
  });
});

