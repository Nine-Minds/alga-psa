import { beforeEach, describe, expect, it } from 'vitest';

import { useInvoiceDesignerStore } from './designerStore';

const addField = (): string => {
  const store = useInvoiceDesignerStore.getState();
  const pageId = store.nodes.find((node) => node.type === 'page')?.id as string;
  store.addNodeFromPalette('field', { x: 40, y: 40 }, { parentId: pageId });
  return useInvoiceDesignerStore.getState().selectedNodeId as string;
};

const metadataOf = (nodeId: string): Record<string, unknown> =>
  (useInvoiceDesignerStore.getState().nodesById[nodeId].props as { metadata: Record<string, unknown> }).metadata;

describe('designerStore.rebindDataField', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('starts from the default Invoice Number field', () => {
    const nodeId = addField();
    expect(metadataOf(nodeId)).toMatchObject({
      bindingKey: 'invoice.number',
      label: 'Invoice #',
      __astLabelI18n: { i18nKey: 'labels.invoiceNumber' },
    });
  });

  it('moves binding, format, label and label i18n together when the label is still automatic', () => {
    const nodeId = addField();
    useInvoiceDesignerStore.getState().rebindDataField(nodeId, 'dueDate');

    expect(metadataOf(nodeId)).toMatchObject({
      bindingKey: 'dueDate',
      format: 'date',
      label: 'Due Date',
      __astLabelI18n: { i18nKey: 'labels.dueDate', defaultValue: 'Due Date' },
    });
  });

  it('keeps an author-typed label while format and binding still update', () => {
    const nodeId = addField();
    const store = useInvoiceDesignerStore.getState();
    store.setNodeProp(nodeId, 'metadata.label', 'Pay by', true);
    store.unsetNodeProp(nodeId, 'metadata.__astLabelI18n', true);

    useInvoiceDesignerStore.getState().rebindDataField(nodeId, 'dueDate');

    const metadata = metadataOf(nodeId);
    expect(metadata.label).toBe('Pay by');
    expect(metadata.__astLabelI18n).toBeUndefined();
    expect(metadata.format).toBe('date');
    expect(metadata.bindingKey).toBe('dueDate');
  });

  it('uses the catalog label and clears the stale label i18n when the binding has no standard label', () => {
    const nodeId = addField();
    useInvoiceDesignerStore.getState().rebindDataField(nodeId, 'customer.name', 'Customer Name');

    const metadata = metadataOf(nodeId);
    expect(metadata.bindingKey).toBe('customer.name');
    expect(metadata.label).toBe('Customer Name');
    expect(metadata.__astLabelI18n).toBeUndefined();
  });

  it('falls back to the catalog label when none is passed', () => {
    const nodeId = addField();
    useInvoiceDesignerStore.getState().rebindDataField(nodeId, 'customer.name');
    expect(metadataOf(nodeId).label).toBeTruthy();
    expect(metadataOf(nodeId).label).not.toBe('Invoice #');
  });

  it('renames a still-generated layer name to describe the new binding', () => {
    const nodeId = addField();
    useInvoiceDesignerStore.getState().rebindDataField(nodeId, 'dueDate');
    const name = (useInvoiceDesignerStore.getState().nodesById[nodeId].props as { name: string }).name;
    expect(name).toBe('due-date');
  });

  it('is a single undo step that restores binding, label, format and name', () => {
    const nodeId = addField();
    const before = metadataOf(nodeId);
    const nameBefore = (useInvoiceDesignerStore.getState().nodesById[nodeId].props as { name: string }).name;

    useInvoiceDesignerStore.getState().rebindDataField(nodeId, 'dueDate');
    useInvoiceDesignerStore.getState().undo();

    expect(metadataOf(nodeId)).toEqual(before);
    expect((useInvoiceDesignerStore.getState().nodesById[nodeId].props as { name: string }).name).toBe(nameBefore);
  });

  it('does nothing for an unknown node', () => {
    const { historyIndex } = useInvoiceDesignerStore.getState();
    useInvoiceDesignerStore.getState().rebindDataField('missing-node', 'dueDate');
    expect(useInvoiceDesignerStore.getState().historyIndex).toBe(historyIndex);
  });
});
