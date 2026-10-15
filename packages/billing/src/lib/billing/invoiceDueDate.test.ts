import { describe, expect, it } from 'vitest';
import { dueDateForPaymentTerms } from './invoiceDueDate';

describe('dueDateForPaymentTerms', () => {
  it('adds the term days to the invoice date', () => {
    expect(dueDateForPaymentTerms('2026-09-22', 'net_15')).toBe('2026-10-07');
    expect(dueDateForPaymentTerms('2026-09-22', 'net_30')).toBe('2026-10-22');
  });

  it('makes due-on-receipt invoices due on the invoice date', () => {
    expect(dueDateForPaymentTerms('2026-09-22', 'due_on_receipt')).toBe('2026-09-22');
  });

  it('falls back to Net 30 when no recognizable terms are set', () => {
    expect(dueDateForPaymentTerms('2026-09-22', null)).toBe('2026-10-22');
    expect(dueDateForPaymentTerms('2026-09-22', 'Net 45 days')).toBe('2026-10-22');
  });
});
