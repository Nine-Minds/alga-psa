import { describe, it, expect } from 'vitest';
import { mapDbInvoiceToWasmViewModel } from 'server/src/lib/adapters/invoiceAdapters';

// Simple helper to create a minimal DbInvoiceViewModel-like object
const sampleDbInvoice = {
  invoice_number: 'INV-001',
  invoice_date: '2024-01-01',
  due_date: '2024-01-31',
  company: {
    name: 'Test Company',
    address: '123 Test St'
  },
  invoice_items: [
    {
      item_id: 'item1',
      description: 'Service',
      quantity: 1,
      unit_price: 12345, // cents
      total_price: 12345,
      is_manual: false
    }
  ],
  subtotal: 12345,
  tax: 1234,
  total_amount: 13579,
  credit_applied: 0,
  is_manual: false
} as any;

describe('mapDbInvoiceToWasmViewModel', () => {
  it('converts monetary fields from cents to dollars', () => {
    const result = mapDbInvoiceToWasmViewModel(sampleDbInvoice);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.items[0].unitPrice).toBeCloseTo(123.45);
    expect(result.items[0].total).toBeCloseTo(123.45);
    expect(result.subtotal).toBeCloseTo(123.45);
    expect(result.tax).toBeCloseTo(12.34);
    expect(result.total).toBeCloseTo(135.79);
  });
});
