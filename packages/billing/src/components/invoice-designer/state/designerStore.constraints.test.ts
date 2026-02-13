import { beforeEach, describe, expect, it } from 'vitest';

import { useInvoiceDesignerStore } from './designerStore';

describe('designerStore (no constraint solver state)', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('exportWorkspace omits legacy constraint-solver fields', () => {
    const snapshot = useInvoiceDesignerStore.getState().exportWorkspace();
    expect('constraints' in (snapshot as Record<string, unknown>)).toBe(false);
    expect('nodes' in (snapshot as Record<string, unknown>)).toBe(false);
  });

  it('exported nodes use unified node shape and omit legacy geometry/editor props', () => {
    const snapshot = useInvoiceDesignerStore.getState().exportWorkspace();
    Object.values(snapshot.nodesById).forEach((node) => {
      expect(Object.keys(node).sort()).toEqual(['children', 'id', 'props', 'type']);
      expect('constraints' in (node as unknown as Record<string, unknown>)).toBe(false);
      expect('constraint' in (node as unknown as Record<string, unknown>)).toBe(false);
      expect('position' in (node as unknown as Record<string, unknown>)).toBe(false);
      expect('size' in (node as unknown as Record<string, unknown>)).toBe(false);
      expect('baseSize' in (node as unknown as Record<string, unknown>)).toBe(false);
      expect('layoutPresetId' in (node.props as Record<string, unknown>)).toBe(false);
      expect('position' in (node.props as Record<string, unknown>)).toBe(false);
      expect('size' in (node.props as Record<string, unknown>)).toBe(false);
      expect('baseSize' in (node.props as Record<string, unknown>)).toBe(false);
    });
  });

  it('allows setting non-px sizing strings via setNodeProp', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')?.id;
    expect(pageId).toBeTruthy();
    if (!pageId) return;

    store.addNodeFromPalette('section', { x: 40, y: 40 }, { parentId: pageId });
    const sectionId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(sectionId).toBeTruthy();
    if (!sectionId) return;

    store.addNodeFromPalette('text', { x: 80, y: 80 }, { parentId: sectionId });
    const nodeId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(nodeId).toBeTruthy();
    if (!nodeId) return;

    store.setNodeProp(nodeId, 'style.width', '50%', false);
    store.setNodeProp(nodeId, 'style.height', 'auto', false);
    store.setNodeProp(nodeId, 'style.minWidth', '12rem', true);
    const updated = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === nodeId);
    expect(updated?.style?.width).toBe('50%');
    expect(updated?.style?.height).toBe('auto');
    expect(updated?.style?.minWidth).toBe('12rem');
  });
});
