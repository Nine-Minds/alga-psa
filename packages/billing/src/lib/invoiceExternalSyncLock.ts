import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { AppError } from '@alga-psa/core';

/**
 * Shared row-lock discipline for every path that links an invoice to the
 * external accounting system (creating a tenant_external_entity_mappings row
 * for alga_entity_type='invoice', or mutating the remote document). The void
 * path (voidInvoiceActions.ts) serializes on this same lock: its transaction's
 * first statement is a FOR UPDATE on the invoice row, so a mapping-insertion
 * that takes this lock either commits before the void re-reads the mapping
 * (void sees the mapping and enqueues the remote void) or blocks until the
 * void commits and then sees the cancelled status (export refuses).
 *
 * Lock-order contract: invoice row FIRST, then anything else — the same order
 * applyCreditToInvoiceInternal and voidInvoiceActions document. Never take a
 * row lock on another table before this one for the same invoice, or a
 * concurrent void can deadlock (40P01) with you.
 *
 * The caller must hold the returned transaction (and this lock) until the
 * mapping write — and any remote mutation it decides — commits, otherwise a
 * void could slip in between the check here and the mapping insert.
 */
export const ACCOUNTING_EXPORT_INVOICE_CANCELLED = 'ACCOUNTING_EXPORT_INVOICE_CANCELLED';
export const ACCOUNTING_EXPORT_INVOICE_NOT_FOUND = 'ACCOUNTING_EXPORT_INVOICE_NOT_FOUND';

export async function lockInvoiceForExternalSync(
  trx: Knex.Transaction,
  tenantId: string,
  invoiceId: string
): Promise<{ status: string | null }> {
  const row = await tenantDb(trx, tenantId).table('invoices')
    .where({ invoice_id: invoiceId })
    .forUpdate()
    .first('status', 'finalized_at');

  if (!row) {
    throw new AppError(
      ACCOUNTING_EXPORT_INVOICE_NOT_FOUND,
      `Invoice ${invoiceId} no longer exists and cannot be exported`,
      { invoiceId }
    );
  }

  if (row.status === 'cancelled') {
    throw new AppError(
      ACCOUNTING_EXPORT_INVOICE_CANCELLED,
      `Invoice ${invoiceId} has been voided and cannot be exported to the accounting integration`,
      { invoiceId }
    );
  }

  return { status: row.status };
}
