import { beforeEach, describe, expect, it } from 'vitest';

import { copyStyle } from '../utils/structureEditing';
import { useInvoiceDesignerStore } from './designerStore';

describe('designerStore pasteStyle', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('makes the target look like the source: copied visual keys set, the rest cleared, size untouched', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')!.id;
    store.addNodeFromPalette('container', { x: 0, y: 0 }, { parentId: pageId });
    const sourceId = useInvoiceDesignerStore.getState().selectedNodeId!;
    store.addNodeFromPalette('container', { x: 0, y: 0 }, { parentId: pageId });
    const targetId = useInvoiceDesignerStore.getState().selectedNodeId!;

    const { setNodeProp } = useInvoiceDesignerStore.getState();
    setNodeProp(sourceId, 'style.border', '1px solid #e5e7eb', true);
    setNodeProp(sourceId, 'style.borderRadius', '10px', true);
    setNodeProp(sourceId, 'layout.padding', '12px 14px', true);
    setNodeProp(targetId, 'style.backgroundColor', '#ff0000', true);
    setNodeProp(targetId, 'style.width', '300px', true);

    const copied = copyStyle(useInvoiceDesignerStore.getState().nodesById[sourceId]);
    useInvoiceDesignerStore.getState().pasteStyle(targetId, copied);

    const target = useInvoiceDesignerStore.getState().nodesById[targetId];
    const style = target.props.style as Record<string, unknown>;
    expect(style.border).toBe('1px solid #e5e7eb');
    expect(style.borderRadius).toBe('10px');
    expect(style.backgroundColor).toBeUndefined();
    expect(style.width).toBe('300px');
    expect((target.props.layout as Record<string, unknown>).padding).toBe('12px 14px');

    // One undo step restores the previous look.
    useInvoiceDesignerStore.getState().undo();
    const restored = useInvoiceDesignerStore.getState().nodesById[targetId].props.style as Record<string, unknown>;
    expect(restored.backgroundColor).toBe('#ff0000');
  });

  it('names new blocks with the first free number', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')!.id;
    store.addNodeFromPalette('container', { x: 0, y: 0 }, { parentId: pageId });
    const firstId = useInvoiceDesignerStore.getState().selectedNodeId!;
    store.addNodeFromPalette('container', { x: 0, y: 0 }, { parentId: pageId });
    const names = () =>
      useInvoiceDesignerStore.getState().nodes.filter((node) => node.type === 'container').map((node) => node.props.name);
    expect(names()).toEqual(['Box Container 1', 'Box Container 2']);

    useInvoiceDesignerStore.getState().deleteNode(firstId);
    useInvoiceDesignerStore.getState().addNodeFromPalette('container', { x: 0, y: 0 }, { parentId: pageId });
    expect(names()).toEqual(['Box Container 2', 'Box Container 1']);
  });

  it('inserts the header preset with company bindings and translated invoice labels', () => {
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')!.id;
    store.insertPreset('header-logo-address', { x: 0, y: 0 }, pageId);
    const nodes = useInvoiceDesignerStore.getState().nodes;
    const byName = (name: string) => nodes.find((node) => node.props.name === name)!;

    expect((byName('issuer-logo').props.metadata as Record<string, unknown>).srcBinding).toBe('tenantLogo');
    expect((byName('issuer-name').props.metadata as Record<string, unknown>).text).toBe('{{tenant.name}}');
    expect((byName('invoice-title').props.metadata as Record<string, unknown>).astContentExpression).toEqual({
      type: 'i18n',
      i18nKey: 'labels.invoiceTitle',
      defaultValue: 'INVOICE',
    });
    expect((byName('issue-date').props.metadata as Record<string, unknown>).__astLabelI18n).toEqual({
      i18nKey: 'labels.issueDate',
      defaultValue: 'Issue Date',
    });
  });
});
