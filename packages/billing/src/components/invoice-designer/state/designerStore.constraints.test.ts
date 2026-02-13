import { beforeEach, describe, expect, it } from 'vitest';

import { useInvoiceDesignerStore } from './designerStore';

describe('designerStore (no constraint solver state)', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('exportWorkspace omits legacy constraint-solver fields', () => {
    const snapshot = useInvoiceDesignerStore.getState().exportWorkspace();
    expect('constraints' in (snapshot as Record<string, unknown>)).toBe(false);
  });

  it('allows setting non-px sizing strings via updateNodeStyle', () => {
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

    store.updateNodeStyle(nodeId, { width: '50%', height: 'auto', minWidth: '12rem' });
    const updated = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === nodeId);
    expect(updated?.style?.width).toBe('50%');
    expect(updated?.style?.height).toBe('auto');
    expect(updated?.style?.minWidth).toBe('12rem');
  });
});
