import { describe, expect, it } from 'vitest';

import { invoiceDisplayStatus, isVoidedInvoice } from '../invoiceDisplayStatus';

describe('invoiceDisplayStatus', () => {
  it('treats cancelled as voided even when finalized_at is set', () => {
    const invoice = { status: 'cancelled', finalized_at: '2026-01-01T00:00:00Z' };
    expect(invoiceDisplayStatus(invoice)).toBe('voided');
    expect(isVoidedInvoice(invoice)).toBe(true);
  });

  it('treats cancelled without finalized_at as voided', () => {
    expect(invoiceDisplayStatus({ status: 'cancelled' })).toBe('voided');
  });

  it('returns finalized when finalized_at is set and not cancelled', () => {
    const invoice = { status: 'sent', finalized_at: '2026-01-01T00:00:00Z' };
    expect(invoiceDisplayStatus(invoice)).toBe('finalized');
    expect(isVoidedInvoice(invoice)).toBe(false);
  });

  it('returns draft otherwise', () => {
    expect(invoiceDisplayStatus({ status: 'draft', finalized_at: null })).toBe('draft');
    expect(invoiceDisplayStatus({})).toBe('draft');
  });
});
