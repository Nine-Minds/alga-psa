import { beforeEach, describe, expect, it } from 'vitest';

import { useInvoiceDesignerStore } from './designerStore';

describe('designerStore legacy path normalization', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('normalizes legacy metadata.* paths to canonical props.metadata.*', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')?.id;
    expect(pageId).toBeTruthy();
    if (!pageId) return;

    store.addNodeFromPalette('section', { x: 40, y: 40 }, { parentId: pageId });
    const sectionId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(sectionId).toBeTruthy();
    if (!sectionId) return;

    store.addNodeFromPalette('field', { x: 60, y: 60 }, { parentId: sectionId });
    const nodeId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(nodeId).toBeTruthy();
    if (!nodeId) return;

    store.setNodeProp(nodeId, 'metadata.bindingKey', 'invoice.invoiceNumber', true);

    const node = useInvoiceDesignerStore.getState().nodesById[nodeId];
    expect(node).toBeTruthy();
    if (!node) return;

    expect((node.props as any).metadata.bindingKey).toBe('invoice.invoiceNumber');
    expect((node.metadata as any).bindingKey).toBe('invoice.invoiceNumber');
    expect(node.metadata).toBe((node.props as any).metadata);
  });
});
