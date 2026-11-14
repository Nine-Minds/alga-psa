import type { ISO8601String } from '@alga-psa/types';
import { toISODate, toPlainDate } from '@alga-psa/core';
import { paymentTermDays } from './paymentPreferences';

/**
 * Due date for an invoice dated `invoiceDate` under `paymentTerms` (unknown
 * terms → Net 30). The single arithmetic behind invoice generation, manual
 * invoices and the contract billing trace.
 */
export function dueDateForPaymentTerms(
  invoiceDate: ISO8601String,
  paymentTerms: string | null | undefined,
): ISO8601String {
  return toISODate(toPlainDate(invoiceDate).add({ days: paymentTermDays(paymentTerms) }));
}
