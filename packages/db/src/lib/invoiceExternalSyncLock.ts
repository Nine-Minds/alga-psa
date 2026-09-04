import type { Knex } from 'knex';
import { AppError } from '@alga-psa/core';
import { tenantDb } from './tenantDb';

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
 * Lives in @alga-psa/db so both the accounting adapters (billing) and the
 * generic mapping CRUD (integrations) can reach it: the vertical feature
 * packages may not import each other, and every invoice-typed mapping write
 * must pass through this same guard.
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

/**
 * Multi-invoice variant for a single transaction that must guard more than one
 * invoice mapping (for example updateExternalEntityMapping retargeting which
 * invoice a mapping row points at, which concerns the old and the new invoice).
 * Duplicates are collapsed and acquisition is sorted so two transactions that
 * lock the same pair in opposite orders cannot deadlock (40P01) — the same
 * ordering convention the QBO adapter uses for its batch lock.
 */
export async function lockInvoicesForExternalSync(
  trx: Knex.Transaction,
  tenantId: string,
  invoiceIds: readonly string[]
): Promise<Array<{ status: string | null }>> {
  const unique = [...new Set(invoiceIds.filter(Boolean))].sort();
  const statuses: Array<{ status: string | null }> = [];
  for (const invoiceId of unique) {
    statuses.push(await lockInvoiceForExternalSync(trx, tenantId, invoiceId));
  }
  return statuses;
}
