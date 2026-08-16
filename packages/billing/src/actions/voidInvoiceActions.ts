// @ts-nocheck
'use server'

import { tenantDb, withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { reverseCreditApplicationsForInvoice } from '../lib/creditReversal';
import { enqueueInvoiceVoid } from '../services/accountingSync/syncProducers';
import { notifyInvoiceTerminalStatus } from '../services/accountingSync/invoiceTerminalStatusHandlers';

export type VoidInvoiceResult =
  | { success: true }
  | { success: false; error: string };

export const voidInvoice = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  reason: string
): Promise<VoidInvoiceResult> => {
  // Voiding reverses credits and pushes voids to accounting integrations —
  // internal MSP users with invoice update permission only.
  if (user.user_type === 'client') {
    return { success: false, error: 'Permission denied: operation not available in client portal' };
  }
  if (!await hasPermission(user, 'invoice', 'update')) {
    return { success: false, error: 'Permission denied: invoice update required' };
  }

  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    return { success: false, error: 'A reason is required to void an invoice.' };
  }

  const { knex } = await createTenantKnex();
  const now = new Date().toISOString();

  // Load invoice
  const invoice = await tenantDb(knex, tenant).table('invoices')
    .where({ invoice_id: invoiceId })
    .first();

  if (!invoice) {
    return { success: false, error: 'Invoice not found.' };
  }

  // Guard: drafts must be deleted, not voided
  if (!invoice.finalized_at) {
    return { success: false, error: 'Drafts must be deleted, not voided.' };
  }

  // Guard: already cancelled
  if (invoice.status === 'cancelled') {
    return { success: false, error: 'Invoice is already voided.' };
  }

  // Guard: payments exist
  let paymentSum = 0;
  try {
    const paymentRow = await tenantDb(knex, tenant).table('invoice_payments')
      .where({ invoice_id: invoiceId })
      .sum('amount as total')
      .first();
    paymentSum = Number(paymentRow?.total ?? 0);
  } catch {
    paymentSum = 0;
  }
  if (paymentSum > 0) {
    return { success: false, error: 'Unwind payments before voiding.' };
  }

  // Guard: consumed credit notes (for credit note invoices)
  // A credit note has consumed credit when credit_tracking rows linked to it
  // have remaining_amount < amount (i.e. some credit was used).
  // This read is an unlocked fast-fail only — the authoritative re-check runs
  // inside the transaction below, after the row locks (TOCTOU).
  const isCreditNote =
    invoice.invoice_type === 'credit_note' ||
    (Number(invoice.total_amount ?? 0) < 0 && !invoice.is_prepayment);

  if (isCreditNote) {
    // Find transactions generated from this invoice (credit issuance).
    // Credit notes finalized from negative invoices write
    // 'credit_issuance_from_negative_invoice'; prepayment credits write
    // 'credit_issuance' — cover both so neither slips through the guard.
    const creditIssuanceTxns = await tenantDb(knex, tenant).table('transactions')
      .where({ invoice_id: invoiceId })
      .whereIn('type', ['credit_issuance', 'credit_issuance_from_negative_invoice'])
      .select('transaction_id');
    const txnIds = creditIssuanceTxns.map((t: any) => t.transaction_id);

    if (txnIds.length > 0) {
      const consumedCredit = await tenantDb(knex, tenant).table('credit_tracking')
        .whereIn('transaction_id', txnIds)
        .where(knex.raw('remaining_amount < amount'))
        .first('credit_id');

      if (consumedCredit) {
        return { success: false, error: 'This credit note has applied credit. Unapply the credit before voiding.' };
      }
    }
  }

  const outcome = await withTransaction(knex, async (trx: Knex.Transaction): Promise<VoidInvoiceResult> => {
    // Lock-order contract with applyCreditToInvoiceInternal (creditActions.ts):
    // invoice row FIRST, credit_tracking rows only after. Credit application
    // locks the invoice row FOR UPDATE and then the client's credit_tracking
    // rows; before this lock the void path wrote credit_tracking first and the
    // invoice row last, so a concurrent apply + void could each hold one lock
    // while waiting on the other — a PostgreSQL deadlock (40P01). Taking the
    // same invoice row lock as this transaction's first statement makes void
    // queue behind (or ahead of) apply instead of interleaving with it.
    //
    // The re-read under the lock also supersedes the pre-transaction snapshot
    // for every in-transaction decision: `status` (a concurrent void may have
    // cancelled the invoice between the guard read and here — without this
    // re-check both voids would restore the applied credits twice) and
    // `credit_applied` (a concurrent application may have changed it).
    const lockedInvoice = await tenantDb(trx, tenant).table('invoices')
      .where({ invoice_id: invoiceId })
      .forUpdate()
      .first('status', 'credit_applied');

    if (!lockedInvoice) {
      return { success: false, error: 'Invoice not found.' };
    }
    if (lockedInvoice.status === 'cancelled') {
      return { success: false, error: 'Invoice is already voided.' };
    }

    if (isCreditNote) {
      // Claw back the issued pool credit: voiding the source document must
      // remove the credit it put into the pool, or the customer keeps
      // spendable phantom credit that no longer exists in the accounting
      // system. Matches both issuance transaction types (see guard above).
      const creditIssuanceTxns = await tenantDb(trx, tenant).table('transactions')
        .where({ invoice_id: invoiceId })
        .whereIn('type', ['credit_issuance', 'credit_issuance_from_negative_invoice'])
        .select('transaction_id', 'client_id', 'amount');

      // Re-check the consumed guard UNDER LOCK. The pre-transaction guard is
      // only a fast-fail on a snapshot: a concurrent
      // applyCreditToInvoiceInternal can consume this note's credit between
      // that read and this transaction. The invoice row lock above does not
      // serialize against it — the application locks the TARGET invoice's
      // row, not this credit note's — so contention lands on the
      // credit_tracking rows, which the apply path holds FOR UPDATE until it
      // commits. Taking FOR UPDATE here queues behind any in-flight
      // application (lock order invoice-row-then-credit-rows, matching
      // applyCreditToInvoiceInternal), making this re-read authoritative:
      // without it, the claw-back below zeroes out credit the concurrent
      // application just spent, voiding a consumed credit note.
      if (creditIssuanceTxns.length > 0) {
        const lockedCreditRows = await tenantDb(trx, tenant).table('credit_tracking')
          .whereIn('transaction_id', creditIssuanceTxns.map((t: any) => t.transaction_id))
          .forUpdate()
          .select('amount', 'remaining_amount');

        const consumedUnderLock = lockedCreditRows.some(
          (row: any) => Number(row.remaining_amount) < Number(row.amount)
        );
        if (consumedUnderLock) {
          return { success: false, error: 'This credit note has applied credit. Unapply the credit before voiding.' };
        }
      }

      for (const txn of creditIssuanceTxns) {
        const creditRow = await tenantDb(trx, tenant).table('credit_tracking')
          .where({ transaction_id: txn.transaction_id })
          .first('credit_id', 'remaining_amount');

        if (creditRow && Number(creditRow.remaining_amount) > 0) {
          const clawedBack = Number(creditRow.remaining_amount);

          // Zero out the credit tracking entry (removes it from the derived balance)
          await tenantDb(trx, tenant).table('credit_tracking')
            .where({ credit_id: creditRow.credit_id })
            .update({ remaining_amount: 0, updated_at: now });

          // Audit trail for the balance change
          await tenantDb(trx, tenant).table('transactions').insert({
            transaction_id: uuidv4(),
            client_id: txn.client_id,
            invoice_id: invoiceId,
            amount: -clawedBack,
            type: 'credit_adjustment',
            status: 'completed',
            description: `Issued credit clawed back: credit note voided (${trimmedReason})`,
            created_at: now,
            balance_after: null,
            tenant,
            metadata: {
              reversal_of: txn.transaction_id,
              credit_id: creditRow.credit_id,
              reason: 'credit_note_voided',
              voided_by: user.user_id
            }
          });
        }
      }
    } else {
      // Standard invoice: reverse any credit applications. Decided from the
      // locked row, not the pre-transaction snapshot — a concurrent
      // application committing between the two reads is invisible to the
      // snapshot but must still be reversed. The canonical primitive
      // (packages/billing/src/lib/creditReversal.ts) is repeat-safe and
      // restores every application.
      if (Number(lockedInvoice.credit_applied ?? 0) > 0) {
        await reverseCreditApplicationsForInvoice(trx, tenant, invoiceId, user.user_id, 'invoice_voided');
      }
    }

    // Update invoice status to cancelled
    await tenantDb(trx, tenant).table('invoices')
      .where({ invoice_id: invoiceId })
      .update({ status: 'cancelled', updated_at: now });

    // Write invoice_cancelled transaction
    await tenantDb(trx, tenant).table('transactions').insert({
      transaction_id: uuidv4(),
      client_id: invoice.client_id,
      invoice_id: invoiceId,
      amount: -Number(invoice.total_amount ?? 0),
      type: 'invoice_cancelled',
      status: 'completed',
      description: `Invoice voided: ${trimmedReason}`,
      created_at: now,
      balance_after: null,
      tenant,
      metadata: {
        reason: trimmedReason,
        voided_by: user.user_id
      }
    });

    return { success: true };
  });

  if (!outcome.success) {
    return outcome;
  }

  // Fire-and-forget: enqueue void_invoice op if accounting mapping exists
  const { knex: syncKnex } = await createTenantKnex();
  void enqueueInvoiceVoid(syncKnex, tenant, invoiceId);

  // Reconcile any still-active Checkout sessions: a voided invoice must never
  // be chargeable through an old email link. Best-effort (isolated handlers),
  // so the void response is unaffected.
  await notifyInvoiceTerminalStatus({
    knex,
    tenantId: tenant,
    invoiceId,
    newStatus: 'cancelled',
  });

  return { success: true };
});
