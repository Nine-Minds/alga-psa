import { describe, expect, it } from 'vitest';

import { getNodeLayout, getNodeMetadata, getNodeName } from '../utils/nodeProps';
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

  it('inserts the Notes + Totals Row preset as a grid section with a wide-left narrow-right template', () => {
    const store = useInvoiceDesignerStore.getState();
    store.resetWorkspace();
    store.insertPreset('notes-totals-row', { x: 0, y: 0 });

    const section = useInvoiceDesignerStore.getState().nodes.find((node) => getNodeName(node) === 'Notes + Totals Row');
    expect(section).toBeTruthy();
    expect(getNodeLayout(section!).display).toBe('grid');
    expect(getNodeLayout(section!).gridTemplateColumns).toBe('2fr 1fr');
  });

  it('inserts the Two Equal Columns preset as a grid section with equal tracks', () => {
    const store = useInvoiceDesignerStore.getState();
    store.resetWorkspace();
    store.insertPreset('two-equal-columns-grid', { x: 0, y: 0 });

    const section = useInvoiceDesignerStore.getState().nodes.find((node) => getNodeName(node) === 'Two Equal Columns');
    expect(section).toBeTruthy();
    expect(getNodeLayout(section!).display).toBe('grid');
    expect(getNodeLayout(section!).gridTemplateColumns).toBe('1fr 1fr');
  });

  it('inserts the Three Info Columns preset as a grid section with three equal tracks', () => {
    const store = useInvoiceDesignerStore.getState();
    store.resetWorkspace();
    store.insertPreset('three-info-columns', { x: 0, y: 0 });

    const section = useInvoiceDesignerStore.getState().nodes.find((node) => getNodeName(node) === 'Three Info Columns');
    expect(section).toBeTruthy();
    expect(getNodeLayout(section!).display).toBe('grid');
    expect(getNodeLayout(section!).gridTemplateColumns).toBe('1fr 1fr 1fr');
  });

  it('keeps the new grid presets on modern CSS layout properties instead of the legacy flex preset shape', () => {
    const store = useInvoiceDesignerStore.getState();

    ['notes-totals-row', 'two-equal-columns-grid', 'three-info-columns', 'recurring-onetime-tables'].forEach((presetId) => {
      store.resetWorkspace();
      store.insertPreset(presetId, { x: 0, y: 0 });

      const section = useInvoiceDesignerStore.getState().nodes.find((node) => node.type === 'section');
      const layout = getNodeLayout(section!);
      expect(layout.display).toBe('grid');
      expect(typeof layout.gridTemplateColumns).toBe('string');
      expect((layout as any).mode).toBeUndefined();
      expect((layout as any).direction).toBeUndefined();
    });
  });

  it('inserts the Recurring + One-time Tables preset with quote-bound dynamic tables', () => {
    const store = useInvoiceDesignerStore.getState();
    store.resetWorkspace();
    store.insertPreset('recurring-onetime-tables', { x: 0, y: 0 });

    const nodes = useInvoiceDesignerStore.getState().nodes;
    const section = nodes.find((node) => getNodeName(node) === 'Recurring + One-time Tables');
    const recurringTable = nodes.find((node) => getNodeName(node) === 'Recurring Items');
    const onetimeTable = nodes.find((node) => getNodeName(node) === 'One-time Items');

    expect(section).toBeTruthy();
    expect(getNodeLayout(section!).display).toBe('grid');
    expect(getNodeLayout(section!).gridTemplateColumns).toBe('1fr');

    expect(recurringTable?.type).toBe('dynamic-table');
    expect(getNodeMetadata(recurringTable!).collectionBindingKey).toBe('recurringItems');

    expect(onetimeTable?.type).toBe('dynamic-table');
    expect(getNodeMetadata(onetimeTable!).collectionBindingKey).toBe('onetimeItems');
  });
});
