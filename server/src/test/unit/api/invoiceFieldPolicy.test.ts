import { describe, expect, it } from 'vitest';
import { baseInvoiceSchema, createInvoiceSchema } from '../../../lib/api/schemas/invoiceSchemas';
import {
  INVOICE_FIELD_POLICY,
  checkInvoicePayload,
  type InvoiceSurface,
} from '../../../lib/api/schemas/invoiceFieldPolicy';

describe('invoice field policy matrix', () => {
  const createKeys = Object.keys(createInvoiceSchema.shape);
  const baseKeys = Object.keys(baseInvoiceSchema.shape);
  const classified = Object.keys(INVOICE_FIELD_POLICY);

  it.each<InvoiceSurface>(['create', 'update'])(
    'classifies every createInvoiceSchema and baseInvoiceSchema key exactly once on the %s surface',
    (surface) => {
      for (const key of [...createKeys, ...baseKeys, 'tenant']) {
        const rule = (INVOICE_FIELD_POLICY as Record<string, any>)[key];
        expect(rule, `${key} unclassified`).toBeDefined();
        expect(rule[surface]?.kind, `${key} has no ${surface} disposition`).toBeTruthy();
      }
      // exactly once: the policy object is keyed, so duplicates are impossible; ensure no key is listed twice
      expect(new Set(classified).size).toBe(classified.length);
    },
  );

  it('create surface: lifecycle, credit and provenance are command-owned; totals are engine-derived', () => {
    const p: any = INVOICE_FIELD_POLICY;
    expect(p.status.create).toMatchObject({ kind: 'command-owned' });
    expect(p.credit_applied.create).toMatchObject({ kind: 'command-owned', command: 'applyCredit' });
    expect(p.billing_cycle_id.create).toMatchObject({ kind: 'command-owned', command: 'invoiceGeneration' });
    for (const k of ['subtotal', 'tax', 'total_amount']) expect(p[k].create.kind).toBe('engine-derived');
    for (const k of ['client_id', 'invoice_date', 'due_date', 'is_manual', 'is_prepayment', 'items', 'payment_method'])
      expect(p[k].create.kind).toBe('writable');
  });
});

describe('checkInvoicePayload(create)', () => {
  const keys = (d: Record<string, unknown>) => checkInvoicePayload('create', d).forbidden.map((f) => f.key);

  it('rejects non-draft status, non-zero credit and billing_cycle_id', () => {
    expect(keys({ status: 'sent' })).toEqual(['status']);
    expect(keys({ credit_applied: 25 })).toEqual(['credit_applied']);
    expect(keys({ billing_cycle_id: 'abc' })).toEqual(['billing_cycle_id']);
  });

  it('accepts draft / no status, zero or absent credit, and ignores derived totals and tenant', () => {
    expect(keys({ status: 'draft', credit_applied: 0 })).toEqual([]);
    expect(keys({ client_id: 'c' })).toEqual([]);
    expect(keys({ subtotal: 5, tax: 1, total_amount: 6, tenant: 't' })).toEqual([]);
  });
});
