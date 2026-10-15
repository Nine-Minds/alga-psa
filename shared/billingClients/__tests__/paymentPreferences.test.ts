import { describe, expect, it } from 'vitest';
import {
  isOfflinePaymentMethod,
  normalizePaymentTerms,
  normalizePreferredPaymentMethod,
  paymentMethodDisplayLabel,
  paymentTermDays,
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
    expect(paymentTermDays(null)).toBe(30);
    expect(paymentTermDays('net_90')).toBe(30);
  });

  it('labels known methods and returns null otherwise', () => {
    expect(paymentMethodDisplayLabel('bank_transfer')).toBe('Bank Transfer');
    expect(paymentMethodDisplayLabel(null)).toBeNull();
    expect(paymentMethodDisplayLabel('undefined')).toBeNull();
  });
});
