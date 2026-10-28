import { describe, expect, it } from 'vitest';
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  invoiceResponseSchema,
} from '../../../lib/api/schemas/invoiceSchemas';

const baseInvoice = {
  client_id: '11111111-1111-4111-8111-111111111111',
  invoice_date: '2026-08-06',
  due_date: '2026-09-05',
  subtotal: 7500,
  tax: 0,
  total_amount: 7500,
  status: 'draft',
};

describe('invoice payment_method / billing_profile_id schema', () => {
  it('keeps payment_method through create and update parsing', () => {
    const created = createInvoiceSchema.parse({ ...baseInvoice, payment_method: 'credit_card' });
    expect(created.payment_method).toBe('credit_card');
    expect(updateInvoiceSchema.parse({ payment_method: 'bank_transfer' }).payment_method).toBe('bank_transfer');
    expect(updateInvoiceSchema.parse({ payment_method: null }).payment_method).toBeNull();
  });

  it('keeps payment_method on the response schema', () => {
    const shape = invoiceResponseSchema.shape as Record<string, unknown>;
    expect(shape).toHaveProperty('payment_method');
    expect(shape).toHaveProperty('billing_profile_id');
  });

  it('stays optional so existing callers are unaffected', () => {
    expect(createInvoiceSchema.safeParse(baseInvoice).success).toBe(true);
    expect(updateInvoiceSchema.safeParse({ status: 'sent' }).success).toBe(true);
  });

  it('rejects values outside the preferred-method enum', () => {
    expect(createInvoiceSchema.safeParse({ ...baseInvoice, payment_method: 'bitcoin' }).success).toBe(false);
    expect(updateInvoiceSchema.safeParse({ payment_method: 'cash' }).success).toBe(false);
  });

  it('rejects a non-uuid billing_profile_id', () => {
    expect(createInvoiceSchema.safeParse({ ...baseInvoice, billing_profile_id: 'nope' }).success).toBe(false);
  });
});
