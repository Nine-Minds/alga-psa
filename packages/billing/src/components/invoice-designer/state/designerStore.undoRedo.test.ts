import { beforeEach, describe, expect, it } from 'vitest';

import { useInvoiceDesignerStore } from './designerStore';

describe('designerStore undo/redo (patch ops history)', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('undo/redo returns to exact prior tree states after move + delete', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')?.id;
    expect(pageId).toBeTruthy();
    if (!pageId) return;

    // Build a small tree: page -> section -> container -> text
    store.addNodeFromPalette('section', { x: 40, y: 40 }, { parentId: pageId });
    const sectionId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(sectionId).toBeTruthy();
    if (!sectionId) return;

    store.addNodeFromPalette('container', { x: 60, y: 60 }, { parentId: sectionId });
    const containerId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(containerId).toBeTruthy();
    if (!containerId) return;

    store.addNodeFromPalette('text', { x: 80, y: 80 }, { parentId: containerId });
    const textId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(textId).toBeTruthy();
    if (!textId) return;

    // Reset history baseline to this authored tree.
    const baselineWorkspace = useInvoiceDesignerStore.getState().exportWorkspace();
    store.loadWorkspace(baselineWorkspace);

    const baseline = useInvoiceDesignerStore.getState().exportWorkspace();
    expect(baseline.nodesById[containerId]?.children).toEqual([textId]);
    expect(baseline.nodesById[sectionId]?.children).toEqual([containerId]);

    // Move text from container to section (before container).
    store.moveNode(textId, sectionId, 0);
    const moved = useInvoiceDesignerStore.getState().exportWorkspace();
    expect(moved.nodesById[containerId]?.children ?? []).toEqual([]);
    expect(moved.nodesById[sectionId]?.children).toEqual([textId, containerId]);

    // Delete the moved node.
    store.deleteNode(textId);
    const deleted = useInvoiceDesignerStore.getState().exportWorkspace();
    expect(deleted.nodesById[textId]).toBeUndefined();
    expect(deleted.nodesById[sectionId]?.children).toEqual([containerId]);

    // Undo delete -> back to moved state.
    store.undo();
    const undoDelete = useInvoiceDesignerStore.getState().exportWorkspace();
    expect(undoDelete.nodesById[textId]).toBeTruthy();
    expect(undoDelete.nodesById[sectionId]?.children).toEqual([textId, containerId]);

    // Undo move -> back to baseline.
    store.undo();
    const undoMove = useInvoiceDesignerStore.getState().exportWorkspace();
    expect(undoMove.nodesById[containerId]?.children).toEqual([textId]);
    expect(undoMove.nodesById[sectionId]?.children).toEqual([containerId]);

    // Redo move -> moved state again.
    store.redo();
    const redoMove = useInvoiceDesignerStore.getState().exportWorkspace();
    expect(redoMove.nodesById[sectionId]?.children).toEqual([textId, containerId]);

    // Redo delete -> deleted state again.
    store.redo();
    const redoDelete = useInvoiceDesignerStore.getState().exportWorkspace();
    expect(redoDelete.nodesById[textId]).toBeUndefined();
    expect(redoDelete.nodesById[sectionId]?.children).toEqual([containerId]);
  });

  it('undo/redo restores exact canonical JSON snapshots for array edits (including leaf-array unset splice semantics)', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')?.id;
    expect(pageId).toBeTruthy();
    if (!pageId) return;

    store.addNodeFromPalette('section', { x: 40, y: 40 }, { parentId: pageId });
    const sectionId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(sectionId).toBeTruthy();
    if (!sectionId) return;

    store.addNodeFromPalette('text', { x: 60, y: 60 }, { parentId: sectionId });
    const textId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(textId).toBeTruthy();
    if (!textId) return;

    // Reset history baseline to a deterministic starting state.
    const baselineWorkspace = useInvoiceDesignerStore.getState().exportWorkspace();
    store.loadWorkspace(baselineWorkspace);

    store.setNodeProp(textId, 'props.metadata.items', ['a', 'b', 'c']);
    const withItems = useInvoiceDesignerStore.getState().exportWorkspace();
    expect((withItems.nodesById[textId]?.props as any).metadata.items).toEqual(['a', 'b', 'c']);

    store.unsetNodeProp(textId, 'props.metadata.items.1');
    const withUnset = useInvoiceDesignerStore.getState().exportWorkspace();
    expect((withUnset.nodesById[textId]?.props as any).metadata.items).toEqual(['a', 'c']);

    store.undo();
    const undo = useInvoiceDesignerStore.getState().exportWorkspace();
    expect(undo).toEqual(withItems);
    expect((undo.nodesById[textId]?.props as any).metadata.items).toEqual(['a', 'b', 'c']);

    store.redo();
    const redo = useInvoiceDesignerStore.getState().exportWorkspace();
    expect(redo).toEqual(withUnset);
    expect((redo.nodesById[textId]?.props as any).metadata.items).toEqual(['a', 'c']);
  });
});
