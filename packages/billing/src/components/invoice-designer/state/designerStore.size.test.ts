import { beforeEach, describe, expect, it } from 'vitest';

import { clampNodeSizeToPracticalMinimum, useInvoiceDesignerStore } from './designerStore';

describe('designerStore resizing via setNodeProp', () => {
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

    const nodeBefore = useInvoiceDesignerStore.getState().nodesById[nodeId];
    expect(nodeBefore).toBeTruthy();
    if (!nodeBefore) return;

    const clamped = clampNodeSizeToPracticalMinimum(nodeBefore.type, { width: 280, height: 1 });
    const rounded = { width: Math.round(clamped.width), height: Math.round(clamped.height) };

    store.setNodeProp(nodeId, 'size.width', rounded.width, false);
    store.setNodeProp(nodeId, 'size.height', rounded.height, false);
    store.setNodeProp(nodeId, 'baseSize.width', rounded.width, false);
    store.setNodeProp(nodeId, 'baseSize.height', rounded.height, false);
    store.setNodeProp(nodeId, 'style.width', `${rounded.width}px`, false);
    store.setNodeProp(nodeId, 'style.height', `${rounded.height}px`, true);

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
