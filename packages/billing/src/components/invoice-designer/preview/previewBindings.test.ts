import { describe, expect, it } from 'vitest';
import type { WasmInvoiceViewModel } from '@alga-psa/types';
import { resolveFieldPreviewValue } from './previewBindings';

const previewInvoice: WasmInvoiceViewModel = {
  invoiceNumber: 'INV-100',
  issueDate: '2026-02-01',
  dueDate: '2026-02-15',
  currencyCode: 'USD',
  poNumber: 'PO-7781',
  customer: {
    name: 'Acme Co.',
    address: '123 Main St',
  },
  tenantClient: {
    name: 'Northwind MSP',
    address: '400 SW Main St',
    logoUrl: null,
  },
  items: [
    {
      id: 'item-1',
      description: 'Monitoring',
      quantity: 2,
      unitPrice: 1000,
      total: 2000,
    },
  ],
  subtotal: 2000,
  tax: 100,
  total: 2100,
};

describe('previewBindings', () => {
  it('prefers bound preview data values when available', () => {
    const value = resolveFieldPreviewValue({
      invoice: previewInvoice,
      bindingKey: 'invoice.number',
      format: 'text',
    });
    expect(value).toBe('INV-100');
  });

  it('returns null when binding is missing so scaffold fallback can apply', () => {
    const value = resolveFieldPreviewValue({
      invoice: previewInvoice,
      bindingKey: 'invoice.unknownField',
      format: 'text',
    });
    expect(value).toBeNull();
  });

  it('formats date and currency bindings', () => {
    const dateValue = resolveFieldPreviewValue({
      invoice: previewInvoice,
      bindingKey: 'invoice.issueDate',
      format: 'date',
    });
    const currencyValue = resolveFieldPreviewValue({
      invoice: previewInvoice,
      bindingKey: 'invoice.total',
      format: 'currency',
    });

    expect(dateValue).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    expect(currencyValue).toBe('$21.00');
  });

  it('derives invoice.discount from subtotal + tax - total', () => {
    const value = resolveFieldPreviewValue({
      invoice: {
        ...previewInvoice,
        subtotal: 2000,
        tax: 100,
        total: 1900,
      },
      bindingKey: 'invoice.discount',
      format: 'currency',
    });

    expect(value).toBe('$2.00');
  });

  it('does not mirror customer address when tenant address is missing', () => {
    const value = resolveFieldPreviewValue({
      invoice: {
        ...previewInvoice,
        tenantClient: null,
      },
      bindingKey: 'tenant.address',
      format: 'text',
    });

    expect(value).toBeNull();
  });
});
