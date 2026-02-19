import { beforeEach, describe, expect, it } from 'vitest';

import { useInvoiceDesignerStore } from './designerStore';

describe('designerStore history commit semantics', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('commit=false updates do not append history entries; commit=true appends exactly one entry per commit', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')?.id;
    expect(pageId).toBeTruthy();
    if (!pageId) return;

    const initialLength = store.history.length;
    const initialIndex = store.historyIndex;

    // Multiple in-flight updates should not append history.
    store.setNodeProp(pageId, 'name', 'Draft A', false);
    store.setNodeProp(pageId, 'name', 'Draft B', false);
    store.setNodeProp(pageId, 'name', 'Draft C', false);

    expect(useInvoiceDesignerStore.getState().history.length).toBe(initialLength);
    expect(useInvoiceDesignerStore.getState().historyIndex).toBe(initialIndex);

    // Final committed update should append exactly one entry.
    store.setNodeProp(pageId, 'name', 'Committed', true);
    expect(useInvoiceDesignerStore.getState().history.length).toBe(initialLength + 1);
    expect(useInvoiceDesignerStore.getState().historyIndex).toBe(initialIndex + 1);

    // Another committed update appends exactly one more entry.
    store.setNodeProp(pageId, 'name', 'Committed Again', true);
    expect(useInvoiceDesignerStore.getState().history.length).toBe(initialLength + 2);
    expect(useInvoiceDesignerStore.getState().historyIndex).toBe(initialIndex + 2);
  });
});

