import { describe, expect, it } from 'vitest';
import {
  PAYMENT_TERMS,
  PAYMENT_TERM_LABELS,
  isOfflinePaymentMethod,
  isPaymentTerms,
  normalizePaymentTerms,
  normalizePreferredPaymentMethod,
  paymentMethodDisplayLabel,
  paymentTermDays,
  paymentTermOptions,
} from '../paymentPreferences';

describe('payment preferences', () => {
  it('normalizes stored payment methods, treating legacy blanks and free text as unset', () => {
    expect(normalizePreferredPaymentMethod('check')).toBe('check');
    expect(normalizePreferredPaymentMethod('')).toBeNull();
    expect(normalizePreferredPaymentMethod(null)).toBeNull();
    expect(normalizePreferredPaymentMethod('Wire, please')).toBeNull();
  });

  it('normalizes stored payment terms the same way', () => {
    expect(normalizePaymentTerms('net_15')).toBe('net_15');
    expect(normalizePaymentTerms('net_14')).toBe('net_14');
    expect(normalizePaymentTerms('net_7')).toBe('net_7');
    expect(isPaymentTerms('net_14')).toBe(true);
    expect(isPaymentTerms('net_7')).toBe(true);
    expect(normalizePaymentTerms('Net 45 days')).toBeNull();
    expect(normalizePaymentTerms(undefined)).toBeNull();
  });

  it('treats only check and bank transfer as offline', () => {
    expect(isOfflinePaymentMethod('check')).toBe(true);
    expect(isOfflinePaymentMethod('bank_transfer')).toBe(true);
    expect(isOfflinePaymentMethod('credit_card')).toBe(false);
    // Invoices generated before the snapshot existed keep online payment.
    expect(isOfflinePaymentMethod(null)).toBe(false);
    expect(isOfflinePaymentMethod('')).toBe(false);
  });

  it('maps term keys to days and falls back to Net 30 for anything unknown', () => {
    expect(paymentTermDays('due_on_receipt')).toBe(0);
    expect(paymentTermDays('net_15')).toBe(15);
    expect(paymentTermDays('net_30')).toBe(30);
    expect(paymentTermDays('net_14')).toBe(14);
    expect(paymentTermDays('net_7')).toBe(7);
    expect(paymentTermDays(null)).toBe(30);
    expect(paymentTermDays('net_90')).toBe(30);
  });

  it('labels known methods and returns null otherwise', () => {
    expect(paymentMethodDisplayLabel('bank_transfer')).toBe('Bank Transfer');
    expect(paymentMethodDisplayLabel(null)).toBeNull();
    expect(paymentMethodDisplayLabel('undefined')).toBeNull();
  });

  it('offers every term, in vocabulary order, with an authored label', () => {
    expect(paymentTermOptions().map((option) => option.id)).toEqual([...PAYMENT_TERMS]);
    expect(PAYMENT_TERM_LABELS.net_7).toBe('Net 7');
    expect(PAYMENT_TERM_LABELS.net_14).toBe('Net 14');
    expect(paymentTermOptions().every((option) => option.name.length > 0)).toBe(true);
  });
});
