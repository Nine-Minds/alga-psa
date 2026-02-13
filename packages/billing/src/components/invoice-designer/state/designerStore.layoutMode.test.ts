import { beforeEach, describe, expect, it } from 'vitest';

import { useInvoiceDesignerStore } from './designerStore';
import { getNodeLayout } from '../utils/nodeProps';

describe('designerStore container layout editing', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('setNodeProp updates CSS-like container layout props', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')?.id;
    expect(pageId).toBeTruthy();
    if (!pageId) return;

    store.addNodeFromPalette('section', { x: 80, y: 120 }, { parentId: pageId });
    const sectionId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(sectionId).toBeTruthy();
    if (!sectionId) return;

    store.setNodeProp(sectionId, 'layout.display', 'grid', false);
    store.setNodeProp(sectionId, 'layout.gridTemplateColumns', '1fr 1fr', false);
    store.setNodeProp(sectionId, 'layout.gap', '12px', true);

    const section = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === sectionId);
    expect(section).toBeTruthy();
    if (!section) return;

    expect(getNodeLayout(section)?.display).toBe('grid');
    expect(getNodeLayout(section)?.gridTemplateColumns).toBe('1fr 1fr');
    expect(getNodeLayout(section)?.gap).toBe('12px');
  });
});
