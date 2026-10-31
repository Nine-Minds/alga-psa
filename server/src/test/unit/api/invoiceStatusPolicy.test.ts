import { describe, expect, it } from 'vitest';
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_TRANSITIONS,
  assertStatusChangeAllowed,
  classifyStatusChange,
} from '../../../lib/invoices/invoiceStatusPolicy';
import {
  invoiceStatusSchema,
  bulkInvoiceStatusUpdateSchema,
  updateInvoiceSchema,
} from '../../../lib/api/schemas/invoiceSchemas';
import { ConflictError } from '../../../lib/api/middleware/apiMiddleware';

type Expected = 'noop' | 'plain' | 'invalid' | 'recordPayment' | 'void' | 'finalizeInvoice';

// Independent statement of intent: any (from, to) not listed is 'invalid'.
const EXPECTED: Record<string, Expected> = {
  'draft>sent': 'finalizeInvoice',
  'draft>cancelled': 'void',
  'sent>paid': 'recordPayment',
  'sent>overdue': 'plain',
  'sent>partially_applied': 'plain',
  'sent>cancelled': 'void',
  'partially_applied>paid': 'recordPayment',
  'partially_applied>sent': 'plain',
  'partially_applied>overdue': 'plain',
  'partially_applied>cancelled': 'void',
  'overdue>paid': 'recordPayment',
  'overdue>partially_applied': 'plain',
  'overdue>cancelled': 'void',
  'pending>sent': 'plain',
  'pending>cancelled': 'void',
  'prepayment>paid': 'recordPayment',
  'prepayment>cancelled': 'void',
};

function expectedFor(from: string, to: string): Expected {
  if (from === to) return 'noop';
  return EXPECTED[`${from}>${to}`] ?? 'invalid';
}

describe('invoice status transition policy', () => {
  it('table covers every invoiceStatusSchema value in both axes', () => {
    expect(Object.keys(INVOICE_STATUS_TRANSITIONS).sort()).toEqual([...invoiceStatusSchema.options].sort());
    for (const from of invoiceStatusSchema.options) {
      expect(Object.keys((INVOICE_STATUS_TRANSITIONS as any)[from]).sort()).toEqual([...invoiceStatusSchema.options].sort());
    }
    expect([...INVOICE_STATUSES].sort()).toEqual([...invoiceStatusSchema.options].sort());
  });

  describe.each(invoiceStatusSchema.options)('from %s', (from) => {
    it.each(invoiceStatusSchema.options)('-> %s is classified as intended', (to) => {
      const expected = expectedFor(from, to);
      const actual = classifyStatusChange(from, to);
      if (expected === 'noop' || expected === 'plain' || expected === 'invalid') {
        expect(actual.kind).toBe(expected);
      } else {
        expect(actual).toMatchObject({ kind: 'command', command: expected });
      }
    });
  });

  it('command transitions throw a 409 naming the command and permission', () => {
    for (const [pair, command, permission] of [
      ['draft>cancelled', 'void', 'invoice:void'],
      ['sent>paid', 'recordPayment', 'invoice:payment'],
      ['draft>sent', 'finalizeInvoice', 'invoice:finalize'],
    ] as const) {
      const [from, to] = pair.split('>');
      let error: any;
      try { assertStatusChangeAllowed(from, to); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(ConflictError);
      expect(error.statusCode).toBe(409);
      expect(error.message).toContain(command);
      expect(error.message).toContain(permission);
    }
  });

  it('paid invoices stay locked and unknown statuses fail closed', () => {
    expect(() => assertStatusChangeAllowed('paid', 'sent')).toThrow('Cannot modify paid invoice status');
    expect(() => assertStatusChangeAllowed('bogus', 'sent')).toThrow(ConflictError);
    expect(() => assertStatusChangeAllowed('sent', 'sent')).not.toThrow();
    expect(() => assertStatusChangeAllowed('sent', 'overdue')).not.toThrow();
  });
});

describe('invoice update schemas', () => {
  it('updateInvoiceSchema rejects paid, cancelled and finalized_at', () => {
    expect(updateInvoiceSchema.safeParse({ status: 'paid' }).success).toBe(false);
    expect(updateInvoiceSchema.safeParse({ status: 'cancelled' }).success).toBe(false);
    expect(updateInvoiceSchema.safeParse({ finalized_at: '2026-01-01' }).success).toBe(false);
    expect(updateInvoiceSchema.safeParse({ status: 'overdue' }).success).toBe(true);
    expect(updateInvoiceSchema.safeParse({}).success).toBe(true);
  });

  it('bulk status schema no longer accepts finalized_at', () => {
    const ids = ['11111111-1111-4111-8111-111111111111'];
    expect(bulkInvoiceStatusUpdateSchema.safeParse({ invoice_ids: ids, status: 'sent', finalized_at: '2026-01-01' }).success).toBe(false);
    expect(bulkInvoiceStatusUpdateSchema.safeParse({ invoice_ids: ids, status: 'paid' }).success).toBe(true);
  });
});
