import { beforeEach, describe, expect, it } from 'vitest';

import { useInvoiceDesignerStore } from './designerStore';

describe('designerStore updateNodeSize', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('updates baseSize and CSS style width/height when resizing', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')?.id;
    expect(pageId).toBeTruthy();
    if (!pageId) return;

    store.addNodeFromPalette('section', { x: 40, y: 40 }, { parentId: pageId });
    const sectionId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(sectionId).toBeTruthy();
    if (!sectionId) return;

    store.addNodeFromPalette('signature', { x: 100, y: 100 }, { parentId: sectionId });
    const nodeId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(nodeId).toBeTruthy();
    if (!nodeId) return;

    store.updateNodeSize(nodeId, { width: 280, height: 1 }, true);

    const node = useInvoiceDesignerStore.getState().nodes.find((entry) => entry.id === nodeId);
    expect(node?.size.width).toBe(280);
    // Signature has a practical minimum height of 96.
    expect(node?.size.height).toBe(96);
    expect(node?.baseSize?.width).toBe(node?.size.width);
    expect(node?.baseSize?.height).toBe(node?.size.height);
    expect(node?.style?.width).toBe('280px');
    expect(node?.style?.height).toBe('96px');
  });
});
