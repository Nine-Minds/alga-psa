import { describe, expect, it } from 'vitest';
import { mapDbInvoiceToWasmViewModel } from './invoiceAdapters';

describe('mapDbInvoiceToWasmViewModel', () => {
  it('maps db invoice payload numeric and string fields into wasm preview model', () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      invoice_number: 'INV-500',
      invoice_date: '2026-02-01',
      due_date: '2026-02-15',
      currency_code: 'USD',
      po_number: 'PO-1',
      tax_source: 'internal',
      client: {
        name: 'Acme',
        address: '123 Main',
      },
      invoice_charges: [
        {
          item_id: 'item-1',
          description: 'Managed Service',
          quantity: '2',
          unit_price: '1000',
          total_price: '2000',
        },
      ],
      subtotal: '2000',
      tax: '100',
      total: '2100',
    });

    expect(mapped).not.toBeNull();
    expect(mapped?.invoiceNumber).toBe('INV-500');
    expect(mapped?.customer.name).toBe('Acme');
    expect(mapped?.items[0]).toMatchObject({
      id: 'item-1',
      quantity: 2,
      unitPrice: 1000,
      total: 2000,
    });
    expect(mapped?.subtotal).toBe(2000);
    expect(mapped?.tax).toBe(100);
    expect(mapped?.total).toBe(2100);
  });

  it('handles nullable/partial values safely', () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      invoice_number: null,
      invoice_date: null,
      due_date: null,
      client: {
        name: null,
        address: null,
      },
      invoice_charges: [
        {
          item_id: null,
          description: null,
          quantity: null,
          unit_price: null,
          total_price: null,
        },
      ],
      subtotal: null,
      tax: null,
      total: null,
    });

    expect(mapped).not.toBeNull();
    expect(mapped?.invoiceNumber).toBe('N/A');
    expect(mapped?.items[0].quantity).toBe(0);
    expect(mapped?.items[0].unitPrice).toBe(0);
    expect(mapped?.items[0].total).toBe(0);
    expect(mapped?.subtotal).toBe(0);
    expect(mapped?.tax).toBe(0);
    expect(mapped?.total).toBe(0);
  });
});
