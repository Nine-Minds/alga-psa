import { describe, expect, it } from 'vitest';

import { getNodeMetadata, getNodeName } from '../utils/nodeProps';
import { useInvoiceDesignerStore } from './designerStore';

describe('designerStore preset metadata', () => {
  it('preserves default and preset metadata when inserting modern invoice preset', () => {
    const store = useInvoiceDesignerStore.getState();
    store.resetWorkspace();
    store.insertPreset('modern-invoice-complete', { x: 0, y: 0 });

    const nodes = useInvoiceDesignerStore.getState().nodes;
    const invoiceNumberField = nodes.find((node) => getNodeName(node) === 'Invoice Number');
    const invoiceNumberLabel = nodes.find((node) => getNodeName(node) === 'Invoice Number Label');
    const fromAddressText = nodes.find((node) => getNodeName(node) === 'From Address');
    const clientAddressText = nodes.find((node) => getNodeName(node) === 'Client Address');
    const headerSection = nodes.find((node) => getNodeName(node) === 'Header');
    const itemsTable = nodes.find((node) => getNodeName(node) === 'Line Items');

    expect(invoiceNumberField).toBeTruthy();
    expect(getNodeMetadata(invoiceNumberField!).bindingKey).toBe('invoice.number');
    expect(getNodeMetadata(invoiceNumberField!).format).toBe('text');
    expect(getNodeMetadata(invoiceNumberField!).placeholder).toBe('Invoice Number');
    expect(getNodeMetadata(invoiceNumberField!).fieldBorderStyle).toBe('underline');
    expect(getNodeMetadata(invoiceNumberLabel!).fontWeight).toBe('bold');

    expect(fromAddressText).toBeTruthy();
    expect(getNodeMetadata(fromAddressText!).bindingKey).toBe('tenant.address');

    expect(clientAddressText).toBeTruthy();
    expect(getNodeMetadata(clientAddressText!).bindingKey).toBe('customer.address');

    expect(headerSection).toBeTruthy();
    expect(getNodeMetadata(headerSection!).sectionBorderStyle).toBe('none');

    expect(itemsTable).toBeTruthy();
    expect(getNodeMetadata(itemsTable!).tableBorderPreset).toBe('list');
    expect(getNodeMetadata(itemsTable!).tableOuterBorder).toBe(false);
    expect(getNodeMetadata(itemsTable!).tableRowDividers).toBe(true);
    expect(getNodeMetadata(itemsTable!).tableColumnDividers).toBe(false);
    expect(getNodeMetadata(itemsTable!).tableHeaderFontWeight).toBe('semibold');
  });
});
