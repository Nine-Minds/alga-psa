import { beforeEach, describe, expect, it } from 'vitest';

import { getNodeLayout, getNodeMetadata, getNodeName, getNodeStyle } from '../utils/nodeProps';
import { useInvoiceDesignerStore } from './designerStore';

describe('designerStore.loadWorkspace (legacy nodes[] import)', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('materializes canonical props (name/metadata/layout/style) even when legacy nodes provide props: {}', () => {
    useInvoiceDesignerStore.getState().loadWorkspace({
      rootId: 'doc-1',
      nodes: [
        {
          id: 'doc-1',
          type: 'document',
          name: 'Legacy Document',
          props: {},
          position: { x: 0, y: 0 },
          size: { width: 816, height: 1056 },
          baseSize: { width: 816, height: 1056 },
          metadata: { note: 'legacy' },
          layout: { display: 'flex', flexDirection: 'column', gap: '0px', padding: '0px' },
          style: { width: '816px', height: '1056px' },
          parentId: null,
          children: undefined as unknown as string[],
          childIds: ['page-1'],
          allowedChildren: ['page'],
          canRotate: false,
          rotation: 0,
          allowResize: false,
        },
        {
          id: 'page-1',
          type: 'page',
          name: 'Legacy Page',
          props: {},
          position: { x: 0, y: 0 },
          size: { width: 816, height: 1056 },
          baseSize: { width: 816, height: 1056 },
          metadata: {},
          layout: { display: 'flex', flexDirection: 'column', gap: '32px', padding: '40px' },
          style: { width: '816px', height: '1056px' },
          parentId: 'doc-1',
          // Simulate older shape that used `childIds` but not `children`.
          children: undefined as unknown as string[],
          childIds: [],
          allowedChildren: ['section', 'column', 'container', 'text'],
          canRotate: false,
          rotation: 0,
          allowResize: false,
        },
      ],
    } as any);

    const importedDoc = useInvoiceDesignerStore.getState().nodesById['doc-1'];
    expect(importedDoc).toBeTruthy();
    if (!importedDoc) return;

    expect(importedDoc.props).toMatchObject({
      name: 'Legacy Document',
      metadata: { note: 'legacy' },
      layout: { display: 'flex' },
      style: { width: '816px', height: '1056px' },
    });

    // Helpers should resolve from canonical props (not relying on legacy top-level fields).
    expect(getNodeName(importedDoc)).toBe('Legacy Document');
    expect(getNodeMetadata(importedDoc)).toMatchObject({ note: 'legacy' });
    expect(getNodeLayout(importedDoc)).toMatchObject({ display: 'flex' });
    expect(getNodeStyle(importedDoc)).toMatchObject({ width: '816px' });

    // Children should materialize deterministically from either `children` or legacy `childIds`.
    expect(importedDoc.children).toEqual(['page-1']);
  });

  it('keeps AST-imported nodes fluid when AST did not author width/height', () => {
    useInvoiceDesignerStore.getState().loadWorkspace({
      rootId: 'doc-1',
      nodesById: {
        'doc-1': {
          id: 'doc-1',
          type: 'document',
          props: {
            name: 'Document',
            metadata: {},
            layout: { display: 'flex', flexDirection: 'column', gap: '0px', padding: '0px' },
            style: { width: '816px', height: '1056px' },
            size: { width: 816, height: 1056 },
            position: { x: 0, y: 0 },
          },
          children: ['page-1'],
        },
        'page-1': {
          id: 'page-1',
          type: 'page',
          props: {
            name: 'Page 1',
            metadata: {},
            layout: { display: 'flex', flexDirection: 'column', gap: '24px', padding: '32px' },
            style: { width: '816px', height: '1056px' },
            size: { width: 816, height: 1056 },
            position: { x: 0, y: 0 },
          },
          children: ['field-ast', 'field-native'],
        },
        'field-ast': {
          id: 'field-ast',
          type: 'field',
          props: {
            name: 'Due Date',
            metadata: {
              __astImported: true,
              __astHadWidth: false,
              __astHadHeight: false,
              bindingKey: 'invoice.dueDate',
            },
            style: {},
            size: { width: 200, height: 48 },
            position: { x: 24, y: 24 },
          },
          children: [],
        },
        'field-native': {
          id: 'field-native',
          type: 'field',
          props: {
            name: 'Invoice Number',
            metadata: {
              bindingKey: 'invoice.number',
            },
            style: {},
            size: { width: 200, height: 48 },
            position: { x: 24, y: 96 },
          },
          children: [],
        },
      },
    });

    const state = useInvoiceDesignerStore.getState();
    const astField = state.nodesById['field-ast'];
    const nativeField = state.nodesById['field-native'];
    expect(astField).toBeTruthy();
    expect(nativeField).toBeTruthy();
    if (!astField || !nativeField) return;

    const astStyle = getNodeStyle(astField);
    const nativeStyle = getNodeStyle(nativeField);
    expect(astStyle?.width).toBeUndefined();
    expect(astStyle?.height).toBeUndefined();
    expect(nativeStyle?.width).toBe('200px');
    expect(nativeStyle?.height).toBe('48px');
  });
});
