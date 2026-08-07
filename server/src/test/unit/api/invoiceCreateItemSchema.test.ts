import { describe, expect, it } from 'vitest';
import { createInvoiceSchema } from '../../../lib/api/schemas/invoiceSchemas';

const baseInvoice = {
  client_id: '11111111-1111-4111-8111-111111111111',
  invoice_date: '2026-08-06',
  due_date: '2026-09-05',
  subtotal: 7500,
  tax: 0,
  total_amount: 7500,
  status: 'draft',
};

const baseItem = {
  description: 'Managed workstation',
  quantity: 1,
  unit_price: 2500,
  tax_amount: 0,
  rate: 2500,
};

describe('invoice create item validation', () => {
  it('accepts an item that omits net_amount and total_price (server calculates them)', () => {
    const result = createInvoiceSchema.safeParse({
      ...baseInvoice,
      items: [baseItem],
    });

    expect(result.success).toBe(true);
  });

  it('accepts a zero quantity item and preserves the zero', () => {
    const result = createInvoiceSchema.safeParse({
      ...baseInvoice,
      items: [{ ...baseItem, quantity: 0 }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items?.[0]?.quantity).toBe(0);
    }
  });

  it('still accepts caller-supplied net_amount and total_price', () => {
    const result = createInvoiceSchema.safeParse({
      ...baseInvoice,
      items: [{ ...baseItem, quantity: 2, total_price: 5000, net_amount: 4000 }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items?.[0]?.total_price).toBe(5000);
      expect(result.data.items?.[0]?.net_amount).toBe(4000);
    }
  });
});
