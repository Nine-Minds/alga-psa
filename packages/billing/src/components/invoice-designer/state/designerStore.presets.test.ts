import { describe, expect, it } from 'vitest';
import { useInvoiceDesignerStore } from './designerStore';

describe('designerStore preset metadata', () => {
  it('preserves default and preset metadata when inserting modern invoice preset', () => {
    const store = useInvoiceDesignerStore.getState();
    store.resetWorkspace();
    store.insertPreset('modern-invoice-complete', { x: 0, y: 0 });

    const nodes = useInvoiceDesignerStore.getState().nodes;
    const invoiceNumberField = nodes.find((node) => node.name === 'Invoice Number');
    const fromAddressText = nodes.find((node) => node.name === 'From Address');
    const clientAddressText = nodes.find((node) => node.name === 'Client Address');

    expect(invoiceNumberField).toBeTruthy();
    expect(invoiceNumberField?.metadata?.bindingKey).toBe('invoice.number');
    expect(invoiceNumberField?.metadata?.format).toBe('text');
    expect(invoiceNumberField?.metadata?.placeholder).toBe('Invoice Number');

    expect(fromAddressText).toBeTruthy();
    expect(fromAddressText?.metadata?.bindingKey).toBe('tenant.address');

    expect(clientAddressText).toBeTruthy();
    expect(clientAddressText?.metadata?.bindingKey).toBe('customer.address');
  });
});

