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
});
