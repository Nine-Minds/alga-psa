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
    for (const k of ['is_manual', 'is_prepayment']) {
      expect(p[k].create.kind).toBe('command-owned');
      expect(p[k].createAllows).toEqual([false]);
    }
    for (const k of ['client_id', 'invoice_date', 'due_date', 'items', 'payment_method'])
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

  it('rejects is_manual / is_prepayment = true and accepts their default (false)', () => {
    expect(keys({ is_manual: true })).toEqual(['is_manual']);
    expect(keys({ is_prepayment: true })).toEqual(['is_prepayment']);
    expect(keys({ is_manual: false, is_prepayment: false })).toEqual([]);
  });

  it('accepts draft / no status, zero or absent credit; rejects derived totals', () => {
    expect(keys({ status: 'draft', credit_applied: 0 })).toEqual([]);
    expect(keys({ client_id: 'c' })).toEqual([]);
    expect(keys({ subtotal: 0, tax: 0, total_amount: 0 })).toEqual(['subtotal', 'tax', 'total_amount']);
    expect(keys({ tenant: 't' })).toEqual([]);
  });
});

describe('create request schema hands the raw body to the classifier', () => {
  // The defect this guards: createInvoiceSchema does not declare tax_source (it is
  // update-only), so a strip-mode object schema deletes it before InvoiceService.create
  // can refuse it, turning a 400 into a silent no-op. The schema must preserve what the
  // caller sent so the policy — not zod's unknown-key handling — decides.
  it('does not strip a field the policy forbids on create (tax_source)', () => {
    const parsed = createInvoiceSchema.partial().parse({ tax_source: 'external' }) as Record<string, unknown>;
    expect(parsed.tax_source).toBe('external');
    expect(checkInvoicePayload('create', parsed).forbidden.map((f) => [f.key, f.command])).toEqual([
      ['tax_source', 'changeInvoiceTaxSource'],
    ]);
  });

  it('rejects every supplied total in the schema, including zero, with the field path', () => {
    for (const key of ['subtotal', 'tax', 'total_amount']) {
      const result = createInvoiceSchema.safeParse({
        client_id: '11111111-1111-4111-8111-111111111111',
        invoice_date: '2026-01-01',
        due_date: '2026-02-01',
        [key]: 0,
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual([key]);
    }
  });

  it('does not strip unknown keys either, so the classifier sees the body it validates', () => {
    const parsed = createInvoiceSchema.partial().parse({ credit_applied: 25 }) as Record<string, unknown>;
    expect(parsed.credit_applied).toBe(25);
    expect(checkInvoicePayload('create', parsed).forbidden.map((f) => f.key)).toEqual(['credit_applied']);
  });
});
