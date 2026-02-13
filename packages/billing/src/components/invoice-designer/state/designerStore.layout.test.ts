import { beforeEach, describe, expect, it } from 'vitest';

import { clampNodeSizeToPracticalMinimum, useInvoiceDesignerStore } from './designerStore';

describe('designerStore CSS-first model (sizing primitives)', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('adds nodes with CSS-like style width/height in px by default', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')?.id;
    expect(pageId).toBeTruthy();
    if (!pageId) return;

    store.addNodeFromPalette('section', { x: 40, y: 40 }, { parentId: pageId });
    const sectionId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(sectionId).toBeTruthy();
    if (!sectionId) return;

    store.addNodeFromPalette('field', { x: 120, y: 160 }, { parentId: sectionId });

    const selectedId = useInvoiceDesignerStore.getState().selectedNodeId;
    const selected = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === selectedId);
    expect(selected?.type).toBe('field');
    expect(selected?.style?.width).toMatch(/px$/);
    expect(selected?.style?.height).toMatch(/px$/);
  });

  it('clamps resizing to practical minimums and mirrors into CSS style', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')?.id;
    expect(pageId).toBeTruthy();
    if (!pageId) return;

    store.addNodeFromPalette('section', { x: 40, y: 40 }, { parentId: pageId });
    const sectionId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(sectionId).toBeTruthy();
    if (!sectionId) return;

    store.addNodeFromPalette('field', { x: 120, y: 160 }, { parentId: sectionId });
    const fieldId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(fieldId).toBeTruthy();
    if (!fieldId) return;

    const nodeBefore = useInvoiceDesignerStore.getState().nodesById[fieldId];
    expect(nodeBefore).toBeTruthy();
    if (!nodeBefore) return;

    const clamped = clampNodeSizeToPracticalMinimum(nodeBefore.type, { width: 1, height: 1 });
    const rounded = { width: Math.round(clamped.width), height: Math.round(clamped.height) };

    store.setNodeProp(fieldId, 'size.width', rounded.width, false);
    store.setNodeProp(fieldId, 'size.height', rounded.height, false);
    store.setNodeProp(fieldId, 'baseSize.width', rounded.width, false);
    store.setNodeProp(fieldId, 'baseSize.height', rounded.height, false);
    store.setNodeProp(fieldId, 'style.width', `${rounded.width}px`, false);
    store.setNodeProp(fieldId, 'style.height', `${rounded.height}px`, true);

    const field = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === fieldId);
    expect(field?.size.width).toBe(120);
    expect(field?.size.height).toBe(40);
    expect(field?.style?.width).toBe('120px');
    expect(field?.style?.height).toBe('40px');
  });
});
