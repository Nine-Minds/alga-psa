/**
 * Display status for invoice lists and detail views.
 *
 * A voided invoice is stored as `invoices.status = 'cancelled'`. Display
 * surfaces that previously keyed only off `finalized_at` must say "Voided"
 * for those rows. Stored status values are unchanged.
 */
export type InvoiceDisplayStatus = 'draft' | 'finalized' | 'voided';

export interface InvoiceDisplayStatusInput {
  status?: string | null;
  finalized_at?: unknown;
}

export function isVoidedInvoice(invoice: InvoiceDisplayStatusInput): boolean {
  return invoice.status === 'cancelled';
}

export function invoiceDisplayStatus(invoice: InvoiceDisplayStatusInput): InvoiceDisplayStatus {
  if (isVoidedInvoice(invoice)) return 'voided';
  if (invoice.finalized_at) return 'finalized';
  return 'draft';
}
