import { beforeEach, describe, expect, it } from 'vitest';

import { useInvoiceDesignerStore } from './designerStore';

describe('designerStore container layout editing', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('updateNodeLayout merges CSS-like container layout props', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')?.id;
    expect(pageId).toBeTruthy();
    if (!pageId) return;

    store.addNodeFromPalette('section', { x: 80, y: 120 }, { parentId: pageId });
    const sectionId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(sectionId).toBeTruthy();
    if (!sectionId) return;

    store.updateNodeLayout(sectionId, {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '12px',
    });

    const section = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === sectionId);
    expect(section?.layout?.display).toBe('grid');
    expect(section?.layout?.gridTemplateColumns).toBe('1fr 1fr');
    expect(section?.layout?.gap).toBe('12px');
  });
});

