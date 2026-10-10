import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY,
  HANDLED_INVOICE_FAILURE_CODES,
  classifyInvoiceFailureMessageKey,
  invoiceFailureCodeFromMessageKey,
  messageKeyForInvoiceFailureCode,
} from '../../../../../packages/billing/src/errors/invoiceFailureMessageKeys';

describe('invoice failure message-key registry', () => {
  it.each(HANDLED_INVOICE_FAILURE_CODES)('round-trips %s between code and message key', (code) => {
    expect(invoiceFailureCodeFromMessageKey(messageKeyForInvoiceFailureCode(code))).toBe(code);
    expect(classifyInvoiceFailureMessageKey(messageKeyForInvoiceFailureCode(code))).toEqual({ kind: 'failure', code });
  });

  it('round-trips the UNEXPECTED catch-all', () => {
    expect(invoiceFailureCodeFromMessageKey(messageKeyForInvoiceFailureCode('UNEXPECTED'))).toBe('UNEXPECTED');
  });

  it('classifies the duplicate-recurring-invoice key as a skip, never a failure', () => {
    expect(invoiceFailureCodeFromMessageKey(DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY)).toBeNull();
    expect(classifyInvoiceFailureMessageKey(DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY)).toEqual({ kind: 'skip' });
  });

  it('classifies unrelated or empty keys as unknown', () => {
    expect(classifyInvoiceFailureMessageKey('msp/contracts:errors.contract.hasInvoices')).toEqual({ kind: 'unknown' });
    expect(classifyInvoiceFailureMessageKey(undefined)).toEqual({ kind: 'unknown' });
  });
});
