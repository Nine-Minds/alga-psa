import { beforeEach, describe, expect, it } from 'vitest';

import { useInvoiceDesignerStore } from './designerStore';

describe('designerStore exportWorkspace', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('exports only canonical node shape (id, type, props, children) without legacy duplicates', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')?.id;
    expect(pageId).toBeTruthy();
    if (!pageId) return;

    store.addNodeFromPalette('section', { x: 40, y: 40 }, { parentId: pageId });
    const sectionId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(sectionId).toBeTruthy();
    if (!sectionId) return;

    const snapshot = store.exportWorkspace();
    const exported = snapshot.nodesById[sectionId];
    expect(exported).toBeTruthy();
    if (!exported) return;

    expect(Object.keys(exported).sort()).toEqual(['children', 'id', 'props', 'type']);
    expect('name' in (exported as any)).toBe(false);
    expect('metadata' in (exported as any)).toBe(false);
    expect('layout' in (exported as any)).toBe(false);
    expect('style' in (exported as any)).toBe(false);
    expect('childIds' in (exported as any)).toBe(false);
  });
});

