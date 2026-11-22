import type { InvoiceStatus } from '@alga-psa/types';

/**
 * Invoice statuses that must never be pushed to an accounting provider.
 * `cancelled` is how a voided invoice is stored (see voidInvoice); `paid`
 * invoices are settled and closed. Shared by the server action that refuses to
 * queue the export and the UI that hides the "Sync to <provider>" button.
 */
export const INVOICE_SYNC_BLOCKED_STATUSES: readonly InvoiceStatus[] = ['cancelled', 'paid'];

export function isInvoiceSyncBlockedStatus(status: string | null | undefined): boolean {
  return status != null && (INVOICE_SYNC_BLOCKED_STATUSES as readonly string[]).includes(status);
}
