import { beforeEach, describe, expect, it } from 'vitest';

import { copySubtree } from '../utils/structureEditing';
import { createUniqueLayerName, useInvoiceDesignerStore } from './designerStore';

describe('designerStore pasteSubtree', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('pastes a fresh copy of a subtree at the requested position and selects it', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')!.id;

    store.addNodeFromPalette('container', { x: 0, y: 0 }, { parentId: pageId });
    const boxId = useInvoiceDesignerStore.getState().selectedNodeId!;
    store.addNodeFromPalette('text', { x: 0, y: 0 }, { parentId: boxId });
    const textId = useInvoiceDesignerStore.getState().selectedNodeId!;
    // Imported layers carry their AST id; a copy must not reuse it.
    useInvoiceDesignerStore.getState().setNodeProp(textId, 'metadata.__astOriginalNodeId', 'issuer-name', true);

    const payload = copySubtree(useInvoiceDesignerStore.getState().nodes, boxId)!;
    const newRootId = useInvoiceDesignerStore.getState().pasteSubtree(payload, pageId, 0);

    const state = useInvoiceDesignerStore.getState();
    expect(newRootId).toBeTruthy();
    expect(newRootId).not.toBe(boxId);
    expect(state.selectedNodeId).toBe(newRootId);
    expect(state.nodesById[pageId].children).toEqual([newRootId, boxId]);

    const pastedBox = state.nodesById[newRootId!];
    expect(pastedBox.type).toBe('container');
    expect(pastedBox.children).toHaveLength(1);
    const pastedText = state.nodesById[pastedBox.children[0]];
    expect(pastedText.id).not.toBe(textId);
    expect(pastedText.parentId).toBe(newRootId);
    expect((pastedText.props.metadata as Record<string, unknown>).__astOriginalNodeId).toBeUndefined();
  });

  it('refuses to paste where the block may not live', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')!.id;
    store.addNodeFromPalette('section', { x: 0, y: 0 }, { parentId: pageId });
    const sectionId = useInvoiceDesignerStore.getState().selectedNodeId!;
    store.addNodeFromPalette('text', { x: 0, y: 0 }, { parentId: sectionId });
    const textId = useInvoiceDesignerStore.getState().selectedNodeId!;

    const sectionPayload = copySubtree(useInvoiceDesignerStore.getState().nodes, sectionId)!;
    // Sections only live on the page.
    expect(useInvoiceDesignerStore.getState().pasteSubtree(sectionPayload, sectionId, 0)).toBeNull();
    expect(useInvoiceDesignerStore.getState().selectedNodeId).toBe(textId);
  });

  it('gives copies the next free numbered name in the name\'s own style', () => {
    expect(createUniqueLayerName('from-card', new Set(['from-card']))).toBe('from-card-2');
    expect(createUniqueLayerName('from-card-2', new Set(['from-card', 'from-card-2']))).toBe('from-card-3');
    expect(createUniqueLayerName('Invoice #', new Set(['Invoice #']))).toBe('Invoice # 2');
    expect(createUniqueLayerName('Unique', new Set(['Other']))).toBe('Unique');
  });

  it('selects the next sibling after deleting the selected block, then the previous, then the container', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')!.id;
    store.addNodeFromPalette('container', { x: 0, y: 0 }, { parentId: pageId });
    const boxId = useInvoiceDesignerStore.getState().selectedNodeId!;
    store.addNodeFromPalette('text', { x: 0, y: 0 }, { parentId: boxId });
    const firstId = useInvoiceDesignerStore.getState().selectedNodeId!;
    store.addNodeFromPalette('text', { x: 0, y: 0 }, { parentId: boxId });
    const secondId = useInvoiceDesignerStore.getState().selectedNodeId!;

    store.selectNode(firstId);
    store.deleteNode(firstId);
    expect(useInvoiceDesignerStore.getState().selectedNodeId).toBe(secondId);

    store.deleteNode(secondId);
    expect(useInvoiceDesignerStore.getState().selectedNodeId).toBe(boxId);

    store.deleteNode(boxId);
    // Never falls back to the page itself.
    expect(useInvoiceDesignerStore.getState().selectedNodeId).toBeNull();
  });
});
